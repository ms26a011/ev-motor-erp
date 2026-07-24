import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const backendRoot = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(backendRoot, '.env') });

const sqlOutputPath = path.join(backendRoot, 'sql', 'seed_finished_goods_receipt.sql');
const csvOutputPath = path.join(projectRoot, 'finished_goods_receipt.csv');

function sqlString(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function round3(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
}

function receiptNumber(dateString, index) {
  return `FGR${dateString.replace(/-/g, '')}${String(index + 1).padStart(5, '0')}`;
}

function inspectionStatus(itemIndex, lotIndex) {
  return ['Accepted', 'Partially Accepted', 'Pending Inspection', 'Rejected'][(itemIndex + lotIndex) % 4];
}

function warehouseFor(status, category) {
  if (status === 'Pending Inspection') return 'QA Hold Area';
  if (status === 'Rejected') return 'Rejection Bay';
  if (category === 'Finished Goods') return status === 'Accepted' ? 'Finished Goods Store' : 'Dispatch Staging Area';
  return status === 'Accepted' ? 'Semi-Finished Store' : 'QA Hold Area';
}

function receiptQuantities(received, status, index) {
  if (status === 'Pending Inspection') {
    return { accepted: 0, rejected: 0 };
  }
  if (status === 'Rejected') {
    return { accepted: 0, rejected: received };
  }
  if (status === 'Partially Accepted') {
    const rejected = Math.max(1, Math.min(received - 1, Math.floor(received * (0.01 + ((index % 3) * 0.01)))));
    return { accepted: round3(received - rejected), rejected: round3(rejected) };
  }
  return { accepted: received, rejected: 0 };
}

function serialRange(itemCode, dateString, startNumber, quantity) {
  const count = Math.max(1, Math.floor(quantity));
  const prefix = `${itemCode}-${dateString.replace(/-/g, '')}`;
  return {
    start: `${prefix}-${String(startNumber).padStart(5, '0')}`,
    end: `${prefix}-${String(startNumber + count - 1).padStart(5, '0')}`,
  };
}

function receiptLotSizes(total, lots) {
  const first = round3(total * 0.5);
  const second = round3(total * 0.3);
  const third = round3(total - first - second);
  return [first, second, third].slice(0, lots).filter((quantity) => quantity > 0);
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
  });

  const [orderItems] = await connection.query(`
    SELECT poi.production_order_item_id, poi.production_order_id, poi.item_id AS finished_item_id,
           poi.produced_quantity, poi.accepted_quantity, poi.rejected_quantity, poi.uom, poi.line_status,
           po.production_order_number,
           DATE_FORMAT(COALESCE(po.actual_start_date, po.planned_start_date), '%Y-%m-%d') AS start_date,
           DATE_FORMAT(COALESCE(po.actual_end_date, po.planned_end_date), '%Y-%m-%d') AS end_date,
           im.item_code, im.item_name, im.category
      FROM production_order_items poi
      JOIN production_order po ON po.production_order_id = poi.production_order_id
      JOIN item_master im ON im.item_id = poi.item_id
     WHERE poi.line_status IN ('Completed', 'Partially Completed')
       AND poi.produced_quantity > 0
     ORDER BY poi.production_order_item_id
  `);
  const [employees] = await connection.query('SELECT employee_id FROM employee_master WHERE status = "Active" ORDER BY employee_id');
  await connection.end();

  if (!orderItems.length || !employees.length) {
    throw new Error('Completed production order items and employees are required before generating finished goods receipts.');
  }

  const rows = [];
  let serialCounter = 1;
  let rowId = 1;
  orderItems.forEach((orderItem, itemIndex) => {
    const lots = receiptLotSizes(Number(orderItem.produced_quantity), 3);
    lots.forEach((receivedQty, lotIndex) => {
      const status = inspectionStatus(itemIndex, lotIndex);
      const quantities = receiptQuantities(receivedQty, status, rowId + lotIndex);
      const receiptDate = addDays(orderItem.start_date, lotIndex + (itemIndex % 2));
      const hasSerials = orderItem.category === 'Finished Goods';
      const serials = hasSerials
        ? serialRange(orderItem.item_code, receiptDate, serialCounter, receivedQty)
        : { start: null, end: null };
      if (hasSerials) serialCounter += Math.max(1, Math.floor(receivedQty));

      rows.push({
        fg_receipt_id: rowId,
        fg_receipt_number: receiptNumber(receiptDate, rowId - 1),
        production_order_item_id: orderItem.production_order_item_id,
        production_order_id: orderItem.production_order_id,
        finished_item_id: orderItem.finished_item_id,
        received_quantity: receivedQty.toFixed(3),
        accepted_quantity: quantities.accepted.toFixed(3),
        rejected_quantity: quantities.rejected.toFixed(3),
        uom: orderItem.uom,
        receipt_date: receiptDate,
        received_by: employees[(rowId + itemIndex) % employees.length].employee_id,
        inspection_status: status,
        warehouse_location: warehouseFor(status, orderItem.category),
        batch_number: `FGB-${orderItem.item_code}-${receiptDate.replace(/-/g, '')}-${String(rowId).padStart(5, '0')}`,
        serial_number_start: serials.start,
        serial_number_end: serials.end,
        remarks: quantities.rejected > 0
          ? `${status} output from ${orderItem.production_order_number}; rejection recorded during final QA`
          : `${status} output receipt from ${orderItem.production_order_number}`,
        created_at: `${receiptDate} 10:${String((rowId * 7) % 60).padStart(2, '0')}:00`,
        updated_at: `${receiptDate} 16:${String((rowId * 11) % 60).padStart(2, '0')}:00`,
      });
      rowId += 1;
    });
  });

  const insertColumns = [
    'fg_receipt_id',
    'fg_receipt_number',
    'production_order_item_id',
    'production_order_id',
    'finished_item_id',
    'received_quantity',
    'accepted_quantity',
    'rejected_quantity',
    'uom',
    'receipt_date',
    'received_by',
    'inspection_status',
    'warehouse_location',
    'batch_number',
    'serial_number_start',
    'serial_number_end',
    'remarks',
    'created_at',
    'updated_at',
  ];

  const sqlLines = [
    'SET FOREIGN_KEY_CHECKS = 0;',
    'TRUNCATE TABLE finished_goods_receipt;',
    'SET FOREIGN_KEY_CHECKS = 1;',
    `INSERT INTO finished_goods_receipt (${insertColumns.join(', ')}) VALUES`,
    rows.map((row) => `  (${insertColumns.map((column) => sqlString(row[column])).join(', ')})`).join(',\n') + ';',
    '',
  ];
  const csvLines = [
    insertColumns.join(','),
    ...rows.map((row) => insertColumns.map((column) => csvCell(row[column])).join(',')),
  ];

  fs.writeFileSync(sqlOutputPath, sqlLines.join('\n'));
  fs.writeFileSync(csvOutputPath, csvLines.join('\n'));

  console.log(`Generated ${rows.length} finished_goods_receipt rows.`);
  console.log(sqlOutputPath);
  console.log(csvOutputPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
