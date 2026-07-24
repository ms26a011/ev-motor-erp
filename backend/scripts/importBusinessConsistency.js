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

function readCsv(relativePath) {
  return parseCsv(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8').replace(/^\uFEFF/, ''));
}

function cleanValue(value) {
  return value === undefined || value === '' ? null : value;
}

async function backupTable(connection, table, suffix) {
  const backup = `${table}_business_repair_backup_${suffix}`;
  await connection.query(`CREATE TABLE \`${backup}\` AS SELECT * FROM \`${table}\``);
  return backup;
}

async function insertRows(connection, table, columns, rows) {
  if (!rows.length) return;
  const sql = `INSERT INTO \`${table}\` (${columns.map((column) => `\`${column}\``).join(', ')})
               VALUES (${columns.map(() => '?').join(', ')})`;
  for (const row of rows) {
    await connection.execute(sql, columns.map((column) => cleanValue(row[column])));
  }
}

function itemRows() {
  return readCsv('item_master_import.csv').map((row, index) => ({
    item_id: String(index + 1),
    item_code: row.item_code,
    item_name: row.item_name,
    item_description: row.item_description,
    uom: row.uom,
    category: row.category,
    unit_cost: row.unit_cost,
    default_vendor_id: null,
    reorder_level: row.reorder_level,
    safety_stock: row.safety_stock,
    maximum_stock: row.maximum_stock,
    criticality: row.criticality,
    status: row.status,
  }));
}

function moveOrderRows() {
  const mapDepartment = (location, fallback = 2) => {
    const value = String(location || '').toLowerCase();
    if (value.includes('fg') || value.includes('finished goods') || value.includes('dispatch')) return 6;
    if (value.includes('stator') || value.includes('winding') || value.includes('stat')) return 3;
    if (value.includes('rotor') || value.includes('rotr')) return 4;
    if (value.includes('assembly') || value.includes('asmb') || value.includes('final') || value.includes('quality')) return 5;
    if (value.includes('raw') || value.includes('rmwh')) return 2;
    return fallback;
  };

  return readCsv('move_order.csv').map((row) => ({
    mo_id: row.move_order_id,
    mo_number: row.move_order_number,
    mo_date: row.move_order_date,
    requested_by: row.requested_by || '1',
    requested_by_department: mapDepartment(row.destination_location, 5),
    from_department_id: mapDepartment(row.source_location, 2),
    to_department_id: mapDepartment(row.destination_location, 5),
    move_order_type: row.move_order_type,
    priority: row.priority,
    source_location: row.source_location,
    destination_location: row.destination_location,
    reason: row.remarks,
    required_date: row.move_order_date,
    approved_by: row.approved_by || '1',
    approved_date: row.move_order_date,
    issued_by: row.moved_by || '1',
    issued_date: row.move_order_date,
    received_by: row.moved_by || '1',
    received_date: row.move_status === 'Completed' ? row.move_order_date : null,
    status: row.move_status,
    remarks: row.remarks,
  }));
}

async function main() {
  const suffix = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const connection = await mysql.createConnection(databaseConfig);
  const backups = [];

  const loadPlan = [
    {
      table: 'item_master',
      columns: ['item_id', 'item_code', 'item_name', 'item_description', 'uom', 'category', 'unit_cost', 'default_vendor_id', 'reorder_level', 'safety_stock', 'maximum_stock', 'criticality', 'status'],
      rows: itemRows(),
    },
    {
      table: 'bom_master',
      columns: ['bom_id', 'bom_code', 'parent_item_id', 'component_item_id', 'component_name', 'component_category', 'specification', 'quantity_per_unit', 'uom', 'scrap_factor_percent', 'production_stage', 'effective_from', 'effective_to', 'status', 'remarks', 'created_at', 'updated_at'],
      rows: readCsv('bom_master.csv'),
    },
    {
      table: 'production_order',
      columns: ['production_order_id', 'production_order_number', 'customer_order_id', 'finished_item_id', 'department_id', 'planned_quantity', 'produced_quantity', 'rejected_quantity', 'uom', 'planned_start_date', 'planned_end_date', 'actual_start_date', 'actual_end_date', 'priority', 'production_status', 'created_by', 'approved_by', 'remarks', 'created_at', 'updated_at'],
      rows: readCsv('production_order.csv'),
    },
    {
      table: 'production_order_items',
      columns: ['production_order_item_id', 'production_order_id', 'item_id', 'planned_quantity', 'produced_quantity', 'accepted_quantity', 'rejected_quantity', 'uom', 'production_stage', 'line_status', 'remarks', 'created_at', 'updated_at'],
      rows: readCsv('production_order_items.csv'),
    },
    {
      table: 'bom_consumption',
      columns: ['bom_consumption_id', 'production_order_item_id', 'finished_item_id', 'consumed_item_id', 'planned_quantity', 'issued_quantity', 'actual_consumed_quantity', 'returned_quantity', 'wastage_quantity', 'uom', 'warehouse_location', 'batch_number', 'consumption_date', 'consumed_by', 'transaction_status', 'remarks', 'created_at', 'updated_at'],
      rows: readCsv('bom_consumption.csv'),
    },
    {
      table: 'finished_goods_receipt',
      columns: ['fg_receipt_id', 'fg_receipt_number', 'production_order_item_id', 'production_order_id', 'finished_item_id', 'received_quantity', 'accepted_quantity', 'rejected_quantity', 'uom', 'receipt_date', 'received_by', 'inspection_status', 'warehouse_location', 'batch_number', 'serial_number_start', 'serial_number_end', 'remarks', 'created_at', 'updated_at'],
      rows: readCsv('finished_goods_receipt.csv'),
    },
    {
      table: 'move_order',
      columns: ['mo_id', 'mo_number', 'mo_date', 'requested_by', 'requested_by_department', 'from_department_id', 'to_department_id', 'move_order_type', 'priority', 'source_location', 'destination_location', 'reason', 'required_date', 'approved_by', 'approved_date', 'issued_by', 'issued_date', 'received_by', 'received_date', 'status', 'remarks'],
      rows: moveOrderRows(),
    },
    {
      table: 'move_order_items',
      columns: ['mo_item_id', 'mo_id', 'item_id', 'requested_quantity', 'issued_quantity', 'uom', 'unit_cost', 'line_amount', 'source_location', 'destination_location', 'required_date', 'movement_date', 'remarks'],
      rows: readCsv('move_order_items.csv'),
    },
    {
      table: 'inventory_balance',
      columns: ['balance_id', 'item_id', 'department_id', 'location_id', 'warehouse_location', 'quantity_on_hand', 'reserved_quantity', 'available_quantity', 'reorder_level', 'safety_stock', 'max_stock', 'current_stock', 'inventory_value', 'last_updated', 'status', 'data_issue_quantity'],
      rows: readCsv('inventory_balance.csv'),
    },
  ];

  try {
    for (const { table } of loadPlan) backups.push(await backupTable(connection, table, suffix));
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of ['inventory_balance', 'bom_consumption', 'finished_goods_receipt', 'production_order_items', 'production_order', 'move_order_items', 'move_order', 'bom_master', 'item_master']) {
      await connection.query(`TRUNCATE TABLE \`${table}\``);
    }
    for (const step of loadPlan) await insertRows(connection, step.table, step.columns, step.rows);
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');

    const [counts] = await connection.query(`
      SELECT 'item_master' table_name, COUNT(*) row_count FROM item_master
      UNION ALL SELECT 'bom_master', COUNT(*) FROM bom_master
      UNION ALL SELECT 'production_order', COUNT(*) FROM production_order
      UNION ALL SELECT 'production_order_items', COUNT(*) FROM production_order_items
      UNION ALL SELECT 'bom_consumption', COUNT(*) FROM bom_consumption
      UNION ALL SELECT 'finished_goods_receipt', COUNT(*) FROM finished_goods_receipt
      UNION ALL SELECT 'move_order', COUNT(*) FROM move_order
      UNION ALL SELECT 'move_order_items', COUNT(*) FROM move_order_items
      UNION ALL SELECT 'inventory_balance', COUNT(*) FROM inventory_balance
    `);
    const [[checks]] = await connection.query(`
      SELECT
        SUM(CASE WHEN im.category = 'Finished Goods' AND dm.department_code <> 'FGWH' THEN 1 ELSE 0 END) fg_wrong_location,
        SUM(CASE WHEN im.category = 'Semi Finished Goods'
                  AND NOT ((im.item_name LIKE '%Stator%' AND dm.department_code IN ('STAT','ASMB'))
                       OR (im.item_name LIKE '%Rotor%' AND dm.department_code IN ('ROTR','ASMB'))) THEN 1 ELSE 0 END) sfg_wrong_location,
        SUM(CASE WHEN ib.quantity_on_hand < 0 OR ib.available_quantity < 0 THEN 1 ELSE 0 END) negative_stock,
        SUM(CASE WHEN ROUND(ib.inventory_value, 2) <> ROUND(ib.quantity_on_hand * im.unit_cost, 2) THEN 1 ELSE 0 END) value_errors
      FROM inventory_balance ib
      JOIN item_master im ON im.item_id = ib.item_id
      JOIN department_master dm ON dm.department_id = ib.department_id
    `);

    console.log(JSON.stringify({ database: databaseConfig.database, backups, counts, checks }, null, 2));
  } finally {
    await connection.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
