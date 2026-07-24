import crypto from 'crypto';
import zlib from 'zlib';

import { createRecord } from './crud.js';
import { query, withConnection } from './db.js';
import { getColumnMetadata } from './metadata.js';
import { erpModules, ensureModule } from './modules.js';

const unavailableImports = [
  { key: 'warehouses', title: 'Warehouse Master', table: 'warehouse_master', group: 'Master Data' },
  { key: 'qualityInspections', title: 'Quality Inspection', table: 'quality_inspection', group: 'Quality' },
  { key: 'vendorInvoices', title: 'Vendor Invoice', table: 'vendor_invoice', group: 'Finance' },
  { key: 'customerInvoices', title: 'Customer Invoice', table: 'customer_invoice', group: 'Finance' },
  { key: 'payments', title: 'Payment', table: 'payment_tracking', group: 'Finance' },
];

const importOrder = [
  'departments',
  'employees',
  'vendors',
  'customers',
  'items',
  'bomMaster',
  'purchaseRequisitions',
  'purchaseRequisitionItems',
  'purchaseOrders',
  'purchaseOrderItems',
  'grns',
  'grnItems',
  'stockInwards',
  'stockIssues',
  'stockIssueItems',
  'productionOrders',
  'productionOrderItems',
  'bomConsumptions',
  'finishedGoodsReceipts',
  'salesOrders',
  'salesOrderItems',
  'dispatches',
  'dispatchItems',
  'qualityInspections',
  'vendorInvoices',
  'customerInvoices',
  'payments',
];

const allowedValues = {
  items: {
    criticality: ['Low', 'Medium', 'High', 'Critical', 'Semi Critical', 'Non Critical'],
    status: ['Active', 'Inactive'],
  },
};

const lookupColumns = {
  department_id: { table: 'department_master', id: 'department_id', code: 'department_code' },
  requested_by_department: { table: 'department_master', id: 'department_id', code: 'department_code' },
  receiving_department_id: { table: 'department_master', id: 'department_id', code: 'department_code' },
  from_department_id: { table: 'department_master', id: 'department_id', code: 'department_code' },
  to_department_id: { table: 'department_master', id: 'department_id', code: 'department_code' },
  requested_by: { table: 'employee_master', id: 'employee_id', code: 'employee_code' },
  created_by: { table: 'employee_master', id: 'employee_id', code: 'employee_code' },
  approved_by: { table: 'employee_master', id: 'employee_id', code: 'employee_code' },
  received_by: { table: 'employee_master', id: 'employee_id', code: 'employee_code' },
  issued_by: { table: 'employee_master', id: 'employee_id', code: 'employee_code' },
  dispatched_by: { table: 'employee_master', id: 'employee_id', code: 'employee_code' },
  supervisor_id: { table: 'employee_master', id: 'employee_id', code: 'employee_code' },
  vendor_id: { table: 'vendor_master', id: 'vendor_id', code: 'vendor_code' },
  default_vendor_id: { table: 'vendor_master', id: 'vendor_id', code: 'vendor_code' },
  customer_id: { table: 'customer_master', id: 'customer_id', code: 'customer_code' },
  item_id: { table: 'item_master', id: 'item_id', code: 'item_code' },
  parent_item_id: { table: 'item_master', id: 'item_id', code: 'item_code' },
  component_item_id: { table: 'item_master', id: 'item_id', code: 'item_code' },
  produced_item_id: { table: 'item_master', id: 'item_id', code: 'item_code' },
  pr_id: { table: 'purchase_requisition', id: 'pr_id', code: 'pr_number' },
  po_id: { table: 'purchase_order', id: 'po_id', code: 'po_number' },
  po_item_id: { table: 'purchase_order_items', id: 'po_item_id' },
  grn_id: { table: 'goods_receipt', id: 'grn_id', code: 'grn_number' },
  mo_id: { table: 'move_order', id: 'mo_id', code: 'mo_number' },
  move_order_id: { table: 'move_order', id: 'mo_id', code: 'mo_number' },
  production_id: { table: 'production_entry', id: 'production_id', code: 'production_number' },
  production_order_id: { table: 'production_order', id: 'production_order_id', code: 'production_order_number' },
  production_order_item_id: { table: 'production_order_items', id: 'production_order_item_id' },
  finished_item_id: { table: 'item_master', id: 'item_id', code: 'item_code' },
  consumed_item_id: { table: 'item_master', id: 'item_id', code: 'item_code' },
  received_by: { table: 'employee_master', id: 'employee_id', code: 'employee_code' },
  co_id: { table: 'customer_order', id: 'co_id', code: 'co_number' },
  dispatch_id: { table: 'dispatch', id: 'dispatch_id', code: 'dispatch_number' },
  co_item_id: { table: 'customer_order_items', id: 'co_item_id' },
};

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseCsv(text) {
  const rows = [];
  let cell = '';
  let row = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted && char === '"' && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ',') {
      row.push(cell);
      cell = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => String(value).trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => String(value).trim() !== '')) rows.push(row);
  return rowsToObjects(rows);
}

function rowsToObjects(rows) {
  const headers = (rows[0] || []).map(normalizeHeader);
  return rows.slice(1).map((row, index) => ({
    __rowNumber: index + 2,
    ...Object.fromEntries(headers.map((header, columnIndex) => [header, row[columnIndex] ?? ''])),
  }));
}

function parseZipEntries(buffer) {
  const entries = new Map();
  let offset = buffer.length - 22;
  while (offset >= 0 && buffer.readUInt32LE(offset) !== 0x06054b50) offset -= 1;
  if (offset < 0) throw new Error('Invalid .xlsx file.');
  const totalEntries = buffer.readUInt16LE(offset + 10);
  let centralOffset = buffer.readUInt32LE(offset + 16);
  for (let index = 0; index < totalEntries; index += 1) {
    const nameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const compression = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const localOffset = buffer.readUInt32LE(centralOffset + 42);
    const name = buffer.slice(centralOffset + 46, centralOffset + 46 + nameLength).toString();
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    const data = compression === 8 ? zlib.inflateRawSync(compressed) : compressed;
    entries.set(name, data.toString('utf8'));
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function columnIndex(cellRef) {
  const letters = String(cellRef || '').replace(/[0-9]/g, '');
  return letters.split('').reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function parseXlsx(buffer) {
  const entries = parseZipEntries(buffer);
  const sharedXml = entries.get('xl/sharedStrings.xml') || '';
  const sharedStrings = Array.from(sharedXml.matchAll(/<si[\s\S]*?<\/si>/g)).map(([si]) => decodeXml(
    Array.from(si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((match) => match[1]).join(''),
  ));
  const sheetXml = entries.get('xl/worksheets/sheet1.xml');
  if (!sheetXml) throw new Error('The workbook must contain data on the first worksheet.');
  const rows = Array.from(sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)).map(([, rowXml]) => {
    const values = [];
    Array.from(rowXml.matchAll(/<c[^>]*r="([^"]+)"[^>]*?(?:t="([^"]+)")?[^>]*>([\s\S]*?)<\/c>/g)).forEach((match) => {
      const [, ref, type, cellXml] = match;
      const valueMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
      const inlineMatch = cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/);
      const rawValue = valueMatch?.[1] ?? inlineMatch?.[1] ?? '';
      values[columnIndex(ref)] = type === 's' ? sharedStrings[Number(rawValue)] || '' : decodeXml(rawValue);
    });
    return values;
  });
  return rowsToObjects(rows);
}

export function parseImportFile({ fileName, contentBase64 }) {
  const buffer = Buffer.from(contentBase64 || '', 'base64');
  const extension = String(fileName || '').toLowerCase().split('.').pop();
  if (extension === 'csv') return parseCsv(buffer.toString('utf8').replace(/^\uFEFF/, ''));
  if (extension === 'xlsx') return parseXlsx(buffer);
  const error = new Error('Only .csv and .xlsx files are supported.');
  error.status = 400;
  throw error;
}

async function tableExists(table) {
  const rows = await query(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table],
  );
  return Number(rows[0]?.count || 0) > 0;
}

async function uniqueColumns(table) {
  const rows = await query(
    `SELECT s.INDEX_NAME, s.COLUMN_NAME, s.SEQ_IN_INDEX
     FROM INFORMATION_SCHEMA.STATISTICS s
     JOIN INFORMATION_SCHEMA.COLUMNS c
       ON c.TABLE_SCHEMA = s.TABLE_SCHEMA
      AND c.TABLE_NAME = s.TABLE_NAME
      AND c.COLUMN_NAME = s.COLUMN_NAME
     WHERE s.TABLE_SCHEMA = DATABASE()
       AND s.TABLE_NAME = ?
       AND s.NON_UNIQUE = 0
       AND c.EXTRA NOT LIKE '%auto_increment%'`,
    [table],
  );
  const grouped = rows.reduce((acc, row) => {
    acc[row.INDEX_NAME] = acc[row.INDEX_NAME] || [];
    acc[row.INDEX_NAME].push(row);
    return acc;
  }, {});
  return Object.values(grouped)
    .map((indexRows) => indexRows
      .sort((first, second) => first.SEQ_IN_INDEX - second.SEQ_IN_INDEX)
      .map((row) => row.COLUMN_NAME));
}

async function valueExists(connection, table, column, value) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS count FROM \`${table}\` WHERE \`${column}\` = ?`,
    [value],
  );
  return Number(rows[0]?.count || 0) > 0;
}

async function uniqueValueExists(connection, table, columns, payload) {
  if (columns.some((column) => payload[column] === undefined || payload[column] === null || payload[column] === '')) {
    return false;
  }
  const where = columns.map((column) => `\`${column}\` = ?`).join(' AND ');
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS count FROM \`${table}\` WHERE ${where}`,
    columns.map((column) => payload[column]),
  );
  return Number(rows[0]?.count || 0) > 0;
}

async function resolveLookup(connection, row, column) {
  const lookup = lookupColumns[column];
  if (!lookup) return row[column];
  const directValue = row[column];
  if (directValue !== undefined && directValue !== '') {
    const exists = await valueExists(connection, lookup.table, lookup.id, directValue);
    if (!exists) throw new Error(`${column} references missing ${lookup.table}.${lookup.id}: ${directValue}`);
    return directValue;
  }
  if (!lookup.code) return directValue;
  const codeKey = lookup.code;
  const codeValue = row[codeKey] || row[column.replace(/_id$/, '_code')];
  if (codeValue === undefined || codeValue === '') return directValue;
  const [rows] = await connection.execute(
    `SELECT \`${lookup.id}\` AS id FROM \`${lookup.table}\` WHERE \`${lookup.code}\` = ? LIMIT 1`,
    [codeValue],
  );
  if (!rows[0]) throw new Error(`${codeKey} does not exist: ${codeValue}`);
  return rows[0].id;
}

function coerceValue(value) {
  return value === '' || value === undefined ? null : value;
}

async function normalizeRow(connection, moduleKey, row, columns) {
  const writableColumns = columns.filter((column) => !column.readonly);
  const result = {};
  for (const column of writableColumns) {
    if (row[column.name] !== undefined || lookupColumns[column.name]) {
      result[column.name] = coerceValue(await resolveLookup(connection, row, column.name));
    }
  }
  return result;
}

function validateModuleRules(moduleKey, row, payload, columns) {
  const errors = [];
  columns
    .filter((column) => column.required && !column.readonly)
    .forEach((column) => {
      if (payload[column.name] === undefined || payload[column.name] === null || payload[column.name] === '') {
        errors.push(`${column.name} is mandatory`);
      }
    });

  if (moduleKey === 'items') {
    if (Number(payload.unit_cost || 0) < 0) errors.push('Unit Cost cannot be negative');
    if (payload.reorder_level !== undefined && payload.maximum_stock !== undefined && payload.maximum_stock !== null
      && Number(payload.reorder_level) >= Number(payload.maximum_stock)) {
      errors.push('Reorder Level must be less than Maximum Stock');
    }
    Object.entries(allowedValues.items).forEach(([field, allowed]) => {
      if (payload[field] && !allowed.map((value) => value.toLowerCase()).includes(String(payload[field]).toLowerCase())) {
        errors.push(`${field} must be one of: ${allowed.join(', ')}`);
      }
    });
  }

  if (moduleKey === 'vendors') {
    if (payload.rating !== undefined && payload.rating !== null && (Number(payload.rating) < 1 || Number(payload.rating) > 5)) {
      errors.push('Rating should be between 1 and 5');
    }
    if (payload.lead_time_days !== undefined && payload.lead_time_days !== null && Number(payload.lead_time_days) <= 0) {
      errors.push('Lead Time must be greater than zero');
    }
  }

  if (['vendors', 'customers', 'employees'].includes(moduleKey) && payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    errors.push('Email format is invalid');
  }

  return errors;
}

async function validateRows(moduleKey, rows) {
  ensureModule(moduleKey);
  const module = erpModules[moduleKey];
  const columns = await getColumnMetadata(moduleKey);
  const unique = await uniqueColumns(module.table);

  return withConnection(async (connection) => {
    const seen = new Set();
    const results = [];
    for (const row of rows) {
      const errors = [];
      const skipMessages = [];
      let payload = {};
      try {
        payload = await normalizeRow(connection, moduleKey, row, columns);
        errors.push(...validateModuleRules(moduleKey, row, payload, columns));
        for (const columns of unique) {
          if (columns.some((column) => payload[column] === undefined || payload[column] === null || payload[column] === '')) continue;
          const key = columns.map((column) => `${column}:${String(payload[column]).toLowerCase()}`).join('|');
          if (seen.has(key)) errors.push(`${columns.join(', ')} is duplicated in this file`);
          seen.add(key);
          if (await uniqueValueExists(connection, module.table, columns, payload)) {
            skipMessages.push(`${columns.join(', ')} already exists and will be skipped`);
          }
        }
      } catch (error) {
        errors.push(error.message);
      }
      results.push({
        rowNumber: row.__rowNumber,
        row,
        payload,
        valid: errors.length === 0 && skipMessages.length === 0,
        skipped: errors.length === 0 && skipMessages.length > 0,
        errors,
        messages: skipMessages,
      });
    }
    return results;
  });
}

export async function getImportModules() {
  const available = await Promise.all(Object.entries(erpModules).map(async ([key, module]) => ({
    key,
    title: module.title,
    table: module.table,
    group: module.group || 'Master Data',
    available: await tableExists(module.table),
  })));
  const unavailable = await Promise.all(unavailableImports.map(async (module) => ({
    ...module,
    available: await tableExists(module.table),
  })));
  const all = [...available, ...unavailable];
  return importOrder
    .map((key) => all.find((module) => module.key === key))
    .filter(Boolean);
}

export async function buildTemplate(moduleKey) {
  ensureModule(moduleKey);
  const columns = (await getColumnMetadata(moduleKey))
    .filter((column) => !column.readonly)
    .map((column) => column.name);
  return `${columns.join(',')}\n`;
}

export async function previewImport(moduleKey, { fileName, contentBase64 }) {
  const rows = parseImportFile({ fileName, contentBase64 });
  const validation = await validateRows(moduleKey, rows);
  return {
    rows: validation.slice(0, 100),
    totalRows: validation.length,
    validRows: validation.filter((row) => row.valid).length,
    skippedRows: validation.filter((row) => row.skipped).length,
    failedRows: validation.filter((row) => !row.valid && !row.skipped).length,
  };
}

async function ensureImportTables(connection) {
  await connection.execute(
    `CREATE TABLE IF NOT EXISTS import_history (
      import_id INT AUTO_INCREMENT PRIMARY KEY,
      import_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      imported_by VARCHAR(100) NULL,
      file_name VARCHAR(255) NOT NULL,
      file_hash VARCHAR(64) NOT NULL,
      table_name VARCHAR(100) NOT NULL,
      records_imported INT NOT NULL DEFAULT 0,
      records_skipped INT NOT NULL DEFAULT 0,
      records_failed INT NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL,
      UNIQUE KEY uq_import_file_table (file_hash, table_name)
    )`,
  );
  await connection.execute(
    `CREATE TABLE IF NOT EXISTS import_errors (
      import_error_id INT AUTO_INCREMENT PRIMARY KEY,
      import_id INT NULL,
      \`row_number\` INT NOT NULL,
      table_name VARCHAR(100) NOT NULL,
      error_message VARCHAR(1000) NOT NULL,
      raw_data JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );
}

export async function importRows(moduleKey, { fileName, contentBase64, importedBy = 'system' }) {
  ensureModule(moduleKey);
  const module = erpModules[moduleKey];
  const rows = parseImportFile({ fileName, contentBase64 });
  const fileHash = crypto.createHash('sha256').update(Buffer.from(contentBase64 || '', 'base64')).digest('hex');
  const validation = await validateRows(moduleKey, rows);
  const valid = validation.filter((row) => row.valid);
  const skippedRows = validation.filter((row) => row.skipped);
  const failed = validation.filter((row) => !row.valid && !row.skipped);
  let imported = 0;
  let skipped = 0;
  let duplicateImport = false;

  await withConnection(async (connection) => {
    await ensureImportTables(connection);
    const [existing] = await connection.execute(
      'SELECT import_id FROM import_history WHERE file_hash = ? AND table_name = ? LIMIT 1',
      [fileHash, module.table],
    );
    if (existing[0]) {
      skipped = valid.length + skippedRows.length;
      duplicateImport = true;
    }
  });

  if (!duplicateImport) {
    skipped += skippedRows.length;
  }

  if (!duplicateImport) {
    for (const row of valid) {
      try {
        await createRecord(moduleKey, row.payload);
        imported += 1;
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY' || error.status === 409) {
          skipped += 1;
        } else {
          failed.push({ ...row, valid: false, errors: [error.message] });
        }
      }
    }
  }

  const importId = await withConnection(async (connection) => {
    await ensureImportTables(connection);
    const status = duplicateImport ? 'Skipped Duplicate File' : failed.length ? (imported ? 'Completed with Errors' : 'Failed') : 'Completed';
    const [result] = await connection.execute(
      `INSERT IGNORE INTO import_history
        (import_date, imported_by, file_name, file_hash, table_name, records_imported, records_skipped, records_failed, status)
       VALUES (NOW(), ?, ?, ?, ?, ?, ?, ?, ?)`,
      [importedBy, fileName, fileHash, module.table, imported, skipped, failed.length, status],
    );
    const id = result.insertId;
    for (const row of failed) {
      await connection.execute(
        `INSERT INTO import_errors (import_id, \`row_number\`, table_name, error_message, raw_data)
         VALUES (?, ?, ?, ?, ?)`,
        [id || null, row.rowNumber, module.table, row.errors.join('; '), JSON.stringify(row.row)],
      );
    }
    return id;
  });

  return {
    importId,
    imported,
    skipped,
    failed: failed.length,
    errors: failed.map((row) => ({
      rowNumber: row.rowNumber,
      error: row.errors.join('; '),
      row: row.row,
    })),
    skippedRows: skippedRows.map((row) => ({
      rowNumber: row.rowNumber,
      message: row.messages.join('; '),
      row: row.row,
    })),
  };
}

export async function getImportHistory(moduleKey = '') {
  return withConnection(async (connection) => {
    await ensureImportTables(connection);
    const params = [];
    const where = moduleKey && erpModules[moduleKey] ? 'WHERE table_name = ?' : '';
    if (where) params.push(erpModules[moduleKey].table);
    const [rows] = await connection.execute(
      `SELECT * FROM import_history ${where} ORDER BY import_date DESC LIMIT 100`,
      params,
    );
    return rows;
  });
}
