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

const sqlOutputPath = path.join(backendRoot, 'sql', 'seed_production_order_items.sql');
const csvOutputPath = path.join(projectRoot, 'production_order_items.csv');

function sqlString(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sqlDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function stageFor(itemName, status, index) {
  const name = itemName.toLowerCase();
  if (status === 'Partially Completed' && index % 5 === 0) return 'Rework';
  if (status === 'Completed' && index % 7 === 0) return 'Testing';
  if (name.includes('stator')) return 'Stator Assembly';
  if (name.includes('rotor')) return 'Rotor Assembly';
  return 'Final Motor Assembly';
}

function lineStatusFor(orderStatus, accepted, rejected, index) {
  if (orderStatus === 'Completed') return 'Completed';
  if (orderStatus === 'Partially Completed') return index % 9 === 0 && rejected > 0 ? 'Rejected' : 'Partially Completed';
  if (orderStatus === 'In Progress') return 'In Progress';
  if (orderStatus === 'Released' || orderStatus === 'Planned') return 'Planned';
  if (orderStatus === 'On Hold' || orderStatus === 'Cancelled') return 'On Hold';
  if (accepted === 0 && rejected > 0) return 'Rejected';
  return 'Planned';
}

function remarksFor(row, itemName, lineStatus) {
  if (lineStatus === 'Rejected') return `Rejected output line for ${itemName}: dimensional or electrical test failure`;
  if (lineStatus === 'On Hold') return `Output line on hold for ${itemName}: ${row.remarks || 'awaiting production clearance'}`;
  if (lineStatus === 'Completed' && Number(row.rejected_quantity) > 0) return `Completed with minor rejection during final QA for ${itemName}`;
  if (lineStatus === 'Partially Completed') return `Partial output recorded for ${itemName}; remaining quantity is still in production`;
  if (lineStatus === 'In Progress') return `Manufacturing in progress for ${itemName}`;
  return row.remarks || `Planned output line for ${itemName}`;
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
  });

  const [orders] = await connection.query(`
    SELECT po.production_order_id, po.production_order_number, po.finished_item_id,
           po.planned_quantity, po.produced_quantity AS accepted_output_quantity,
           po.rejected_quantity, po.uom, po.production_status, po.remarks,
           po.created_at, po.updated_at, im.item_name, im.category
      FROM production_order po
      JOIN item_master im ON im.item_id = po.finished_item_id
     ORDER BY po.production_order_id
  `);
  await connection.end();

  if (!orders.length) {
    throw new Error('Production orders are required before generating production order items.');
  }

  const rows = orders.map((order, index) => {
    const accepted = Number(order.accepted_output_quantity);
    const rejected = Number(order.rejected_quantity);
    const produced = accepted + rejected;
    const lineStatus = lineStatusFor(order.production_status, accepted, rejected, index);

    return {
      production_order_item_id: index + 1,
      production_order_id: order.production_order_id,
      item_id: order.finished_item_id,
      planned_quantity: Number(order.planned_quantity).toFixed(3),
      produced_quantity: produced.toFixed(3),
      accepted_quantity: accepted.toFixed(3),
      rejected_quantity: rejected.toFixed(3),
      uom: order.uom,
      production_stage: stageFor(order.item_name, order.production_status, index),
      line_status: lineStatus,
      remarks: remarksFor(order, order.item_name, lineStatus),
      created_at: sqlDateTime(order.created_at),
      updated_at: sqlDateTime(order.updated_at),
    };
  });

  const insertColumns = [
    'production_order_item_id',
    'production_order_id',
    'item_id',
    'planned_quantity',
    'produced_quantity',
    'accepted_quantity',
    'rejected_quantity',
    'uom',
    'production_stage',
    'line_status',
    'remarks',
    'created_at',
    'updated_at',
  ];

  const sqlLines = [
    'SET FOREIGN_KEY_CHECKS = 0;',
    'TRUNCATE TABLE production_order_items;',
    'SET FOREIGN_KEY_CHECKS = 1;',
    `INSERT INTO production_order_items (${insertColumns.join(', ')}) VALUES`,
    rows.map((row) => `  (${insertColumns.map((column) => sqlString(row[column])).join(', ')})`).join(',\n') + ';',
    '',
  ];

  const csvLines = [
    insertColumns.join(','),
    ...rows.map((row) => insertColumns.map((column) => csvCell(row[column])).join(',')),
  ];

  fs.writeFileSync(sqlOutputPath, sqlLines.join('\n'));
  fs.writeFileSync(csvOutputPath, csvLines.join('\n'));

  console.log(`Generated ${rows.length} production_order_items rows.`);
  console.log(sqlOutputPath);
  console.log(csvOutputPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
