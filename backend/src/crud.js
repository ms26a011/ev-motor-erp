import { query, withConnection } from './db.js';
import { getColumnMetadata, getPrimaryKeyColumn } from './metadata.js';
import { erpModules } from './modules.js';
import { applyGeneratedTransactionNumber, releaseGeneratedTransactionNumberLock } from './transactionNumbers.js';
import { applyTransactionEffects } from './transactions.js';

function tableName(moduleKey) {
  return `\`${erpModules[moduleKey].table}\``;
}

function columnName(name) {
  return `\`${name}\``;
}

async function cleanPayload(moduleKey, payload, { includePrimaryKey = false } = {}) {
  const columns = await getColumnMetadata(moduleKey);
  const primaryKey = columns.find((column) => column.primary_key);
  const allowed = new Set(columns.map((column) => column.name));
  const cleaned = {};

  Object.entries(payload || {}).forEach(([key, rawValue]) => {
    if (!allowed.has(key)) {
      return;
    }
    if (primaryKey && key === primaryKey.name && !includePrimaryKey) {
      return;
    }
    cleaned[key] = rawValue === '' ? null : rawValue;
  });

  return cleaned;
}

async function validateRequiredFields(moduleKey, payload) {
  const columns = await getColumnMetadata(moduleKey);
  const missing = columns
    .filter((column) => column.required && (payload?.[column.name] === undefined || payload?.[column.name] === null || payload?.[column.name] === ''))
    .map((column) => column.name);

  if (missing.length) {
    const error = new Error(`Required field(s) missing: ${missing.join(', ')}`);
    error.status = 400;
    throw error;
  }
}

export async function listRecords(moduleKey) {
  const primaryKey = await getPrimaryKeyColumn(moduleKey);
  return query(
    `SELECT * FROM ${tableName(moduleKey)} ORDER BY ${columnName(primaryKey.name)} DESC`,
  );
}

export async function getRecord(moduleKey, recordId, connection = null) {
  const primaryKey = await getPrimaryKeyColumn(moduleKey);
  const runner = connection || { execute: async (...args) => [await query(...args)] };
  const [rows] = await runner.execute(
    `SELECT * FROM ${tableName(moduleKey)} WHERE ${columnName(primaryKey.name)} = ? LIMIT 1`,
    [recordId],
  );
  return rows[0] || null;
}

export async function createRecord(moduleKey, payload) {
  const primaryKey = await getPrimaryKeyColumn(moduleKey);
  const includePrimaryKey = !primaryKey.readonly;

  return withConnection(async (connection) => {
    await connection.beginTransaction();
    try {
      const cleanedPayload = await cleanPayload(moduleKey, payload, { includePrimaryKey });
      const cleaned = await applyGeneratedTransactionNumber(connection, moduleKey, cleanedPayload);
      await validateRequiredFields(moduleKey, cleaned);
      const keys = Object.keys(cleaned);

      const [result] = await connection.execute(
        `INSERT INTO ${tableName(moduleKey)} (${keys.map(columnName).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
        keys.map((key) => cleaned[key]),
      );
      const insertedId = result.insertId || cleaned[primaryKey.name];
      const record = insertedId ? await getRecord(moduleKey, insertedId, connection) : cleaned;
      await applyTransactionEffects(connection, moduleKey, record);
      const refreshedRecord = insertedId ? await getRecord(moduleKey, insertedId, connection) : record;
      await connection.commit();
      await releaseGeneratedTransactionNumberLock(connection, moduleKey);
      return refreshedRecord;
    } catch (error) {
      await connection.rollback();
      await releaseGeneratedTransactionNumberLock(connection, moduleKey);
      if (error.code === 'ER_DUP_ENTRY') {
        error.message = 'A duplicate transaction number was generated. Please try saving again.';
        error.status = 409;
      }
      throw error;
    }
  });
}

export async function updateRecord(moduleKey, recordId, payload) {
  await validateRequiredFields(moduleKey, payload);
  const primaryKey = await getPrimaryKeyColumn(moduleKey);
  const cleaned = await cleanPayload(moduleKey, payload);
  const keys = Object.keys(cleaned);

  if (!keys.length) {
    const error = new Error('No valid fields were supplied.');
    error.status = 400;
    throw error;
  }

  return withConnection(async (connection) => {
    await connection.beginTransaction();
    try {
      const previousRecord = await getRecord(moduleKey, recordId, connection);
      const [result] = await connection.execute(
        `UPDATE ${tableName(moduleKey)} SET ${keys.map((key) => `${columnName(key)} = ?`).join(', ')} WHERE ${columnName(primaryKey.name)} = ?`,
        [...keys.map((key) => cleaned[key]), recordId],
      );

      if (result.affectedRows === 0) {
        await connection.rollback();
        return null;
      }
      const updatedRecord = await getRecord(moduleKey, recordId, connection);
      await applyTransactionEffects(connection, moduleKey, updatedRecord, previousRecord);
      const refreshedRecord = await getRecord(moduleKey, recordId, connection);
      await connection.commit();
      return refreshedRecord;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
}

export async function deleteRecord(moduleKey, recordId) {
  const primaryKey = await getPrimaryKeyColumn(moduleKey);
  const rows = await query(
    `DELETE FROM ${tableName(moduleKey)} WHERE ${columnName(primaryKey.name)} = ?`,
    [recordId],
  );
  return rows.affectedRows > 0;
}

export async function countRecords(moduleKey) {
  const rows = await query(`SELECT COUNT(*) AS count FROM ${tableName(moduleKey)}`);
  return rows[0].count;
}
