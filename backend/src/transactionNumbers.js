import { erpModules } from './modules.js';
import crypto from 'crypto';

function tableName(name) {
  return `\`${name}\``;
}

function columnName(name) {
  return `\`${name}\``;
}

function todayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

async function columnExists(connection, table, column) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [table, column],
  );
  return Number(rows[0]?.count || 0) > 0;
}

async function acquireNumberLock(connection, lockName) {
  const [rows] = await connection.execute('SELECT GET_LOCK(?, 10) AS locked', [lockName]);
  if (Number(rows[0]?.locked || 0) !== 1) {
    const error = new Error('Could not reserve a transaction number. Please try again.');
    error.status = 409;
    throw error;
  }
}

async function releaseNumberLock(connection, lockName) {
  await connection.execute('SELECT RELEASE_LOCK(?)', [lockName]);
}

function lockNameFor({ table, column, prefix }) {
  const datePart = todayKey();
  const base = `${prefix}${datePart}`;
  const signature = crypto
    .createHash('sha1')
    .update(`${table}:${column}:${base}`)
    .digest('hex')
    .slice(0, 16);
  return {
    base,
    lockName: `erp_txn_no_${signature}`,
  };
}

async function nextNumber(connection, { table, column, prefix }) {
  const { base, lockName } = lockNameFor({ table, column, prefix });
  await acquireNumberLock(connection, lockName);
  const [rows] = await connection.execute(
    `SELECT MAX(${columnName(column)}) AS latest_number
     FROM ${tableName(table)}
     WHERE ${columnName(column)} LIKE ?`,
    [`${base}%`],
  );
  const latest = rows[0]?.latest_number || '';
  const latestSerial = latest.startsWith(base) ? Number(latest.slice(base.length)) : 0;
  const nextSerial = String((Number.isNaN(latestSerial) ? 0 : latestSerial) + 1).padStart(4, '0');
  return `${base}${nextSerial}`;
}

export async function applyGeneratedTransactionNumber(connection, moduleKey, payload) {
  const module = erpModules[moduleKey];
  const config = module?.transactionNumber;
  if (!config) {
    return payload;
  }

  const hasColumn = await columnExists(connection, module.table, config.column);
  if (!hasColumn) {
    return payload;
  }

  return {
    ...payload,
    [config.column]: await nextNumber(connection, {
      table: module.table,
      column: config.column,
      prefix: config.prefix,
    }),
  };
}

export async function releaseGeneratedTransactionNumberLock(connection, moduleKey) {
  const module = erpModules[moduleKey];
  const config = module?.transactionNumber;
  if (!config) {
    return;
  }
  const { lockName } = lockNameFor({
    table: module.table,
    column: config.column,
    prefix: config.prefix,
  });
  await releaseNumberLock(connection, lockName);
}

export function isTransactionNumberColumn(moduleKey, columnNameToCheck) {
  return erpModules[moduleKey]?.transactionNumber?.column === columnNameToCheck;
}
