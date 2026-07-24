import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(backendRoot, '..');

dotenv.config({ path: path.join(backendRoot, '.env') });

const databaseConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'your_password_here',
  database: process.env.DB_NAME || 'ev_motor_erp',
  port: Number(process.env.DB_PORT || 3306),
  multipleStatements: false,
};

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
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  const headers = rows[0] || [];
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

async function columnExists(connection, columnName) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'inventory_balance'
       AND COLUMN_NAME = ?`,
    [columnName],
  );
  return Number(rows[0]?.count || 0) > 0;
}

async function ensureColumn(connection, columnName, definition) {
  if (!(await columnExists(connection, columnName))) {
    await connection.execute(`ALTER TABLE inventory_balance ADD COLUMN \`${columnName}\` ${definition}`);
  }
}

async function ensureSchema(connection) {
  await connection.execute('ALTER TABLE inventory_balance MODIFY current_stock DECIMAL(14, 3) NULL');
  await ensureColumn(connection, 'location_id', 'VARCHAR(40) NULL AFTER department_id');
  await ensureColumn(connection, 'warehouse_location', 'VARCHAR(80) NULL AFTER location_id');
  await ensureColumn(connection, 'quantity_on_hand', 'DECIMAL(14, 3) NOT NULL DEFAULT 0 AFTER warehouse_location');
  await ensureColumn(connection, 'reserved_quantity', 'DECIMAL(14, 3) NOT NULL DEFAULT 0 AFTER quantity_on_hand');
  await ensureColumn(connection, 'available_quantity', 'DECIMAL(14, 3) NOT NULL DEFAULT 0 AFTER reserved_quantity');
  await ensureColumn(connection, 'reorder_level', 'DECIMAL(14, 3) NOT NULL DEFAULT 0 AFTER available_quantity');
  await ensureColumn(connection, 'safety_stock', 'DECIMAL(14, 3) NOT NULL DEFAULT 0 AFTER reorder_level');
  await ensureColumn(connection, 'max_stock', 'DECIMAL(14, 3) NOT NULL DEFAULT 0 AFTER safety_stock');
  await ensureColumn(connection, 'inventory_value', 'DECIMAL(14, 2) NOT NULL DEFAULT 0 AFTER current_stock');
  await ensureColumn(connection, 'status', "VARCHAR(40) NOT NULL DEFAULT 'Active' AFTER last_updated");
  await ensureColumn(connection, 'data_issue_quantity', 'DECIMAL(14, 3) NOT NULL DEFAULT 0 AFTER status');
}

async function importRows(connection, rows) {
  const columns = [
    'balance_id',
    'item_id',
    'department_id',
    'location_id',
    'warehouse_location',
    'quantity_on_hand',
    'reserved_quantity',
    'available_quantity',
    'reorder_level',
    'safety_stock',
    'max_stock',
    'current_stock',
    'inventory_value',
    'last_updated',
    'status',
    'data_issue_quantity',
  ];

  await connection.beginTransaction();
  try {
    await connection.execute('SET FOREIGN_KEY_CHECKS = 0');
    await connection.execute('TRUNCATE TABLE inventory_balance');
    await connection.execute('SET FOREIGN_KEY_CHECKS = 1');

    const placeholders = columns.map(() => '?').join(', ');
    const sql = `INSERT INTO inventory_balance (${columns.map((column) => `\`${column}\``).join(', ')}) VALUES (${placeholders})`;
    for (const row of rows) {
      await connection.execute(sql, columns.map((column) => row[column] || null));
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

async function validate(connection) {
  const [departmentCounts] = await connection.query(
    `SELECT dm.department_code, COUNT(*) AS records, ROUND(SUM(ib.inventory_value), 2) AS inventory_value
     FROM inventory_balance ib
     JOIN department_master dm ON dm.department_id = ib.department_id
     GROUP BY dm.department_code
     ORDER BY dm.department_code`,
  );
  const [[checks]] = await connection.query(
    `SELECT
       SUM(CASE WHEN ib.quantity_on_hand < 0 OR ib.available_quantity < 0 THEN 1 ELSE 0 END) AS negative_stock,
       SUM(CASE WHEN ib.available_quantity <> ib.quantity_on_hand - ib.reserved_quantity THEN 1 ELSE 0 END) AS availability_errors,
       SUM(CASE WHEN ROUND(ib.inventory_value, 2) <> ROUND(ib.quantity_on_hand * im.unit_cost, 2) THEN 1 ELSE 0 END) AS value_errors,
       SUM(CASE WHEN im.category = 'Finished Goods' AND dm.department_code <> 'FGWH' THEN 1 ELSE 0 END) AS fg_wrong_location,
       SUM(CASE WHEN im.category <> 'Finished Goods' AND dm.department_code = 'FGWH' THEN 1 ELSE 0 END) AS raw_wrong_location,
       SUM(CASE WHEN ib.status LIKE 'Data Issue%' THEN 1 ELSE 0 END) AS flagged_over_issue
     FROM inventory_balance ib
     JOIN item_master im ON im.item_id = ib.item_id
     JOIN department_master dm ON dm.department_id = ib.department_id`,
  );
  return { departmentCounts, checks };
}

async function main() {
  const csvPath = path.join(projectRoot, 'inventory_balance.csv');
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, ''));
  const connection = await mysql.createConnection(databaseConfig);

  try {
    await ensureSchema(connection);
    await importRows(connection, rows);
    const result = await validate(connection);
    console.log(JSON.stringify({
      database: databaseConfig.database,
      importedRows: rows.length,
      ...result,
    }, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
