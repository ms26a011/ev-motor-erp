import cors from 'cors';
import express from 'express';

import { authenticateRequest, authenticateUser, ensureUserAccountTable } from './auth.js';
import { canAccessModule, canUseDataImport } from './accessControl.js';
import { config } from './config.js';
import {
  countRecords,
  createRecord,
  deleteRecord,
  getRecord,
  listRecords,
  updateRecord,
} from './crud.js';
import {
  buildTemplate,
  getImportHistory,
  getImportModules,
  importRows,
  previewImport,
} from './importService.js';
import { getInventoryAnalytics } from './inventoryAnalytics.js';
import { query } from './db.js';
import { getColumnMetadata, getPrimaryKeyColumn, refreshMetadata } from './metadata.js';
import { ensureModule, erpModules } from './modules.js';

const app = express();

app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
}));
app.use(express.json({ limit: '30mb' }));

app.get('/', (req, res) => {
  res.json({ message: 'EV Motor Manufacturing ERP API is running.' });
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      res.status(400).json({ detail: 'Username and password are required.' });
      return;
    }
    res.json(await authenticateUser(username, password));
  } catch (error) {
    next(error);
  }
});

app.use('/api', authenticateRequest());

app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.user });
});

app.post('/api/auth/logout', (req, res) => {
  res.json({ message: 'Logged out successfully.' });
});

app.get('/api/modules', async (req, res, next) => {
  try {
    const moduleResults = await Promise.allSettled(
      Object.entries(erpModules).map(async ([key, module]) => ({
        key,
        title: module.title,
        table: module.table,
        route: module.route,
        group: module.group || 'Master Data',
        columns: await getColumnMetadata(key),
      })),
    );
    res.json(moduleResults
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value)
      .filter((module) => canAccessModule(req.user, module.key)));
  } catch (error) {
    next(error);
  }
});

async function scalar(sql, params = []) {
  try {
    const rows = await query(sql, params);
    return rows[0] ? Object.values(rows[0])[0] : 0;
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') {
      return 0;
    }
    throw error;
  }
}

app.get('/api/dashboard', async (req, res, next) => {
  try {
    res.json({
      departments: await countRecords('departments'),
      employees: await countRecords('employees'),
      vendors: await countRecords('vendors'),
      items: await countRecords('items'),
      customers: await countRecords('customers'),
      pendingPurchaseRequisitions: await scalar("SELECT COUNT(*) FROM purchase_requisition WHERE status IN ('Draft', 'Pending', 'Submitted')"),
      openPurchaseOrders: await scalar("SELECT COUNT(*) FROM purchase_order WHERE po_status IN ('Draft', 'Issued', 'Partially Received')"),
      pendingGrns: await scalar("SELECT COUNT(*) FROM goods_receipt WHERE grn_status IN ('Draft', 'Received', 'Under Inspection', 'Partially Accepted')"),
      currentStockValue: await scalar(`SELECT COALESCE(SUM(ib.current_stock * COALESCE(im.unit_cost, 0)), 0)
        FROM inventory_balance ib
        LEFT JOIN item_master im ON im.item_id = ib.item_id`),
      lowStockItems: await scalar(`SELECT COUNT(*)
        FROM inventory_balance ib
        JOIN item_master im ON im.item_id = ib.item_id
        WHERE ib.current_stock <= im.reorder_level`),
      activeProductionOrders: await scalar("SELECT COUNT(*) FROM production_order WHERE production_status IN ('Planned', 'Released', 'In Progress', 'Partially Completed', 'On Hold')"),
      pendingSalesOrders: await scalar("SELECT COUNT(*) FROM customer_order WHERE status IN ('Pending', 'Draft', 'Confirmed', 'Partially Dispatched')"),
      stockTransactions: await scalar('SELECT COUNT(*) FROM stock_transaction_log'),
      pendingQualityInspections: 0,
      unpaidVendorInvoices: 0,
      pendingCustomerPayments: 0,
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/inventory-analytics', async (req, res, next) => {
  try {
    if (!canAccessModule(req.user, 'inventoryAnalytics')) {
      res.status(403).json({ detail: 'Access denied.' });
      return;
    }
    res.json(await getInventoryAnalytics());
  } catch (error) {
    next(error);
  }
});

app.get('/api/import/modules', async (req, res, next) => {
  try {
    if (!canUseDataImport(req.user)) {
      res.status(403).json({ detail: 'Access denied.' });
      return;
    }
    res.json(await getImportModules());
  } catch (error) {
    next(error);
  }
});

app.get('/api/import/history', async (req, res, next) => {
  try {
    if (!canUseDataImport(req.user, req.query.moduleKey || '')) {
      res.status(403).json({ detail: 'Access denied.' });
      return;
    }
    res.json(await getImportHistory(req.query.moduleKey || ''));
  } catch (error) {
    next(error);
  }
});

app.get('/api/import/:moduleKey/template', async (req, res, next) => {
  try {
    ensureModule(req.params.moduleKey);
    if (!canUseDataImport(req.user, req.params.moduleKey)) {
      res.status(403).json({ detail: 'Access denied.' });
      return;
    }
    const csv = await buildTemplate(req.params.moduleKey);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.moduleKey}_template.csv"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

app.post('/api/import/:moduleKey/preview', async (req, res, next) => {
  try {
    ensureModule(req.params.moduleKey);
    if (!canUseDataImport(req.user, req.params.moduleKey)) {
      res.status(403).json({ detail: 'Access denied.' });
      return;
    }
    res.json(await previewImport(req.params.moduleKey, req.body));
  } catch (error) {
    next(error);
  }
});

app.post('/api/import/:moduleKey/run', async (req, res, next) => {
  try {
    ensureModule(req.params.moduleKey);
    if (!canUseDataImport(req.user, req.params.moduleKey)) {
      res.status(403).json({ detail: 'Access denied.' });
      return;
    }
    res.json(await importRows(req.params.moduleKey, req.body));
  } catch (error) {
    next(error);
  }
});

app.post('/api/import/error-report', (req, res) => {
  if (!canUseDataImport(req.user)) {
    res.status(403).json({ detail: 'Access denied.' });
    return;
  }
  const errors = req.body?.errors || [];
  const lines = [
    'row_number,error_message,raw_data',
    ...errors.map((error) => [
      error.rowNumber,
      csvEscape(error.error || error.message || ''),
      csvEscape(JSON.stringify(error.row || {})),
    ].join(',')),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="import_errors.csv"');
  res.send(lines.join('\n'));
});

app.get('/api/:moduleKey/lookup', async (req, res, next) => {
  try {
    const { moduleKey } = req.params;
    ensureModule(moduleKey);
    if (!canAccessModule(req.user, moduleKey)) {
      res.status(403).json({ detail: 'Access denied.' });
      return;
    }
    const primaryKey = await getPrimaryKeyColumn(moduleKey);
    const rows = await listRecords(moduleKey);
    res.json(rows.map((row) => {
      const labelParts = Object.entries(row)
        .filter(([key, value]) => key !== primaryKey.name && value !== null && value !== '')
        .slice(0, 3)
        .map(([, value]) => String(value));
      return {
        value: row[primaryKey.name],
        label: labelParts.join(' - ') || String(row[primaryKey.name]),
      };
    }));
  } catch (error) {
    next(error);
  }
});

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

app.get('/api/:moduleKey', async (req, res, next) => {
  try {
    ensureModule(req.params.moduleKey);
    if (!canAccessModule(req.user, req.params.moduleKey)) {
      res.status(403).json({ detail: 'Access denied.' });
      return;
    }
    res.json(await listRecords(req.params.moduleKey));
  } catch (error) {
    next(error);
  }
});

app.get('/api/:moduleKey/:recordId', async (req, res, next) => {
  try {
    ensureModule(req.params.moduleKey);
    if (!canAccessModule(req.user, req.params.moduleKey)) {
      res.status(403).json({ detail: 'Access denied.' });
      return;
    }
    const record = await getRecord(req.params.moduleKey, req.params.recordId);
    if (!record) {
      res.status(404).json({ detail: 'Record not found.' });
      return;
    }
    res.json(record);
  } catch (error) {
    next(error);
  }
});

app.post('/api/:moduleKey', async (req, res, next) => {
  try {
    ensureModule(req.params.moduleKey);
    if (!canAccessModule(req.user, req.params.moduleKey)) {
      res.status(403).json({ detail: 'Access denied.' });
      return;
    }
    res.status(201).json(await createRecord(req.params.moduleKey, req.body));
  } catch (error) {
    next(error);
  }
});

app.put('/api/:moduleKey/:recordId', async (req, res, next) => {
  try {
    ensureModule(req.params.moduleKey);
    if (!canAccessModule(req.user, req.params.moduleKey)) {
      res.status(403).json({ detail: 'Access denied.' });
      return;
    }
    const record = await updateRecord(req.params.moduleKey, req.params.recordId, req.body);
    if (!record) {
      res.status(404).json({ detail: 'Record not found.' });
      return;
    }
    res.json(record);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/:moduleKey/:recordId', async (req, res, next) => {
  try {
    ensureModule(req.params.moduleKey);
    if (!canAccessModule(req.user, req.params.moduleKey)) {
      res.status(403).json({ detail: 'Access denied.' });
      return;
    }
    const deleted = await deleteRecord(req.params.moduleKey, req.params.recordId);
    if (!deleted) {
      res.status(404).json({ detail: 'Record not found.' });
      return;
    }
    res.json({ message: 'Record deleted successfully.' });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  const status = error.status || error.statusCode || 500;
  res.status(status).json({ detail: error.message || 'Something went wrong.' });
});

Promise.all([ensureUserAccountTable(), refreshMetadata()])
  .then(() => {
    app.listen(config.port, () => {
      console.log(`EV Motor Manufacturing ERP API is running at http://localhost:${config.port}`);
    });
  })
  .catch((error) => {
    console.error('Unable to start the API server.');
    console.error(error.message);
    process.exit(1);
  });
