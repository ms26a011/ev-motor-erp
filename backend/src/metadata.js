import { query } from './db.js';
import { ensureModule, erpModules, getTableToModuleMap } from './modules.js';
import { isTransactionNumberColumn } from './transactionNumbers.js';

let metadataCache = new Map();

function isAutoPrimaryKey(column) {
  return column.primary_key && column.extra.toLowerCase().includes('auto_increment');
}

function isSystemManagedColumn(column) {
  return ['created_at', 'updated_at', 'stock_posted', 'payment_posted'].includes(column.name)
    || column.extra.toLowerCase().includes('generated');
}

async function getForeignKeyDropdowns(tableName) {
  const rows = await query(
    `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME
     FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND REFERENCED_TABLE_NAME IS NOT NULL`,
    [tableName],
  );
  const tableToModule = getTableToModuleMap();
  return Object.fromEntries(
    rows
      .filter((row) => tableToModule[row.REFERENCED_TABLE_NAME])
      .map((row) => [row.COLUMN_NAME, tableToModule[row.REFERENCED_TABLE_NAME]]),
  );
}

export async function getColumnMetadata(moduleKey) {
  ensureModule(moduleKey);
  if (metadataCache.has(moduleKey)) {
    return metadataCache.get(moduleKey);
  }

  const module = erpModules[moduleKey];
  const rows = await query(
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [module.table],
  );

  if (rows.length === 0) {
    const error = new Error(`Table ${module.table} was not found in the selected database.`);
    error.status = 500;
    throw error;
  }

  const foreignKeyDropdowns = await getForeignKeyDropdowns(module.table);
  const configuredDropdowns = module.dropdowns || {};

  const columns = rows.map((row) => {
    const column = {
      name: row.COLUMN_NAME,
      type: row.COLUMN_TYPE,
      primary_key: row.COLUMN_KEY === 'PRI',
      required: false,
      readonly: false,
      dropdown_module: configuredDropdowns[row.COLUMN_NAME] || foreignKeyDropdowns[row.COLUMN_NAME],
      extra: row.EXTRA || '',
    };
    column.readonly = isAutoPrimaryKey(column) || isSystemManagedColumn(column) || isTransactionNumberColumn(moduleKey, column.name);
    column.required =
      row.IS_NULLABLE === 'NO' &&
      !column.readonly &&
      row.COLUMN_DEFAULT === null;
    delete column.extra;
    return column;
  });

  metadataCache.set(moduleKey, columns);
  return columns;
}

export async function getPrimaryKeyColumn(moduleKey) {
  const columns = await getColumnMetadata(moduleKey);
  const primaryKey = columns.find((column) => column.primary_key);
  if (!primaryKey) {
    const module = erpModules[moduleKey];
    const error = new Error(`Table ${module.table} does not have a primary key.`);
    error.status = 500;
    throw error;
  }
  return primaryKey;
}

export async function refreshMetadata() {
  metadataCache = new Map();
  const results = await Promise.allSettled(Object.keys(erpModules).map((moduleKey) => getColumnMetadata(moduleKey)));
  const startupErrors = results.filter((result) => result.status === 'rejected');
  if (startupErrors.length === results.length) {
    throw startupErrors[0].reason;
  }
}
