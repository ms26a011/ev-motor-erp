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

const sqlOutputPath = path.join(backendRoot, 'sql', 'seed_move_order.sql');
const csvOutputPath = path.join(projectRoot, 'move_order.csv');

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

function moveOrderNumber(dateString, index) {
  return `MO${dateString.replace(/-/g, '')}${String(index + 1).padStart(5, '0')}`;
}

function typePlan(index) {
  return [
    {
      type: 'Raw Material Transfer',
      source: 'Raw Material Store',
      dest: index % 2 === 0 ? 'Electrical Store' : 'Mechanical Store',
      ref: 'Manual Transfer',
    },
    {
      type: 'Production Issue Transfer',
      source: ['Raw Material Store', 'Electrical Store', 'Mechanical Store', 'Consumables Store'][index % 4],
      dest: index % 2 === 0 ? 'Production Line 1' : 'Production Line 2',
      ref: 'Production Order',
    },
    {
      type: 'Semi-Finished Transfer',
      source: index % 2 === 0 ? 'Production Line 1' : 'Production Line 2',
      dest: 'Semi-Finished Store',
      ref: 'Production Order',
    },
    {
      type: 'Finished Goods Transfer',
      source: 'Semi-Finished Store',
      dest: 'Finished Goods Store',
      ref: 'Finished Goods Receipt',
    },
    {
      type: 'QA Hold Transfer',
      source: index % 2 === 0 ? 'Production Line 1' : 'Finished Goods Store',
      dest: 'QA Hold Area',
      ref: 'Finished Goods Receipt',
    },
    {
      type: 'Rejection Transfer',
      source: 'QA Hold Area',
      dest: 'Rejection Bay',
      ref: 'Finished Goods Receipt',
    },
    {
      type: 'Dispatch Staging Transfer',
      source: 'Finished Goods Store',
      dest: 'Dispatch Staging Area',
      ref: 'Customer Order',
    },
  ][index % 7];
}

function statusFor(index) {
  return ['Completed', 'Completed', 'In Transit', 'Approved', 'Requested', 'Draft', 'Cancelled', 'Rejected'][index % 8];
}

function priorityFor(type, status, index) {
  if (status === 'Cancelled') return 'Low';
  if (type === 'Dispatch Staging Transfer' || type === 'Production Issue Transfer') return index % 5 === 0 ? 'Urgent' : 'High';
  if (type === 'QA Hold Transfer' || type === 'Rejection Transfer') return index % 3 === 0 ? 'Urgent' : 'High';
  return index % 4 === 0 ? 'High' : 'Medium';
}

function remarkFor(type, status) {
  if (status === 'Cancelled') return `${type} cancelled due to revised material movement plan`;
  if (status === 'Rejected') return `${type} rejected due to location or quantity mismatch`;
  if (status === 'Draft') return `Draft ${type.toLowerCase()} request awaiting confirmation`;
  return `${type} for motor manufacturing warehouse movement`;
}

function referenceId(plan, refs, index) {
  if (plan.ref === 'Production Order') return refs.productionOrders[index % refs.productionOrders.length]?.production_order_id;
  if (plan.ref === 'Finished Goods Receipt') return refs.finishedGoodsReceipts[index % refs.finishedGoodsReceipts.length]?.fg_receipt_id;
  if (plan.ref === 'Customer Order') return refs.customerOrders[index % refs.customerOrders.length]?.co_id;
  return null;
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
  });

  const [employees] = await connection.query('SELECT employee_id FROM employee_master WHERE status = "Active" ORDER BY employee_id');
  const [productionOrders] = await connection.query('SELECT production_order_id, DATE_FORMAT(planned_start_date, "%Y-%m-%d") AS base_date FROM production_order ORDER BY production_order_id');
  const [finishedGoodsReceipts] = await connection.query('SELECT fg_receipt_id, DATE_FORMAT(receipt_date, "%Y-%m-%d") AS base_date FROM finished_goods_receipt ORDER BY fg_receipt_id');
  const [customerOrders] = await connection.query('SELECT co_id, DATE_FORMAT(order_date, "%Y-%m-%d") AS base_date FROM customer_order ORDER BY co_id');
  await connection.end();

  if (!employees.length || !productionOrders.length || !finishedGoodsReceipts.length || !customerOrders.length) {
    throw new Error('Employees, production orders, finished goods receipts, and customer orders are required before generating move orders.');
  }

  const rows = [];
  const rowCount = 300;
  const refs = { productionOrders, finishedGoodsReceipts, customerOrders };
  for (let index = 0; index < rowCount; index += 1) {
    const plan = typePlan(index);
    const status = statusFor(index);
    const refId = referenceId(plan, refs, index);
    const refSource = plan.ref === 'Production Order'
      ? productionOrders[index % productionOrders.length]
      : plan.ref === 'Finished Goods Receipt'
        ? finishedGoodsReceipts[index % finishedGoodsReceipts.length]
        : plan.ref === 'Customer Order'
          ? customerOrders[index % customerOrders.length]
          : { base_date: '2025-01-01' };
    const moveDate = addDays(refSource.base_date, 1 + (index % 6));
    const approved = ['Approved', 'In Transit', 'Completed'].includes(status);
    const moved = ['In Transit', 'Completed'].includes(status);

    rows.push({
      move_order_id: index + 1,
      move_order_number: moveOrderNumber(moveDate, index),
      move_order_date: moveDate,
      move_order_type: plan.type,
      source_location: plan.source,
      destination_location: plan.dest,
      requested_by: employees[index % employees.length].employee_id,
      approved_by: approved ? employees[(index + 2) % employees.length].employee_id : null,
      moved_by: moved ? employees[(index + 4) % employees.length].employee_id : null,
      reference_type: plan.ref,
      reference_id: refId,
      priority: priorityFor(plan.type, status, index),
      move_status: status,
      remarks: remarkFor(plan.type, status),
      created_at: `${moveDate} 09:${String((index * 7) % 60).padStart(2, '0')}:00`,
      updated_at: `${moveDate} 15:${String((index * 11) % 60).padStart(2, '0')}:00`,
    });
  }

  const insertColumns = [
    'move_order_id',
    'move_order_number',
    'move_order_date',
    'move_order_type',
    'source_location',
    'destination_location',
    'requested_by',
    'approved_by',
    'moved_by',
    'reference_type',
    'reference_id',
    'priority',
    'move_status',
    'remarks',
    'created_at',
    'updated_at',
  ];

  const sqlLines = [
    'SET FOREIGN_KEY_CHECKS = 0;',
    'TRUNCATE TABLE move_order;',
    'SET FOREIGN_KEY_CHECKS = 1;',
    `INSERT INTO move_order (${insertColumns.join(', ')}) VALUES`,
    rows.map((row) => `  (${insertColumns.map((column) => sqlString(row[column])).join(', ')})`).join(',\n') + ';',
    '',
  ];
  const csvLines = [
    insertColumns.join(','),
    ...rows.map((row) => insertColumns.map((column) => csvCell(row[column])).join(',')),
  ];

  fs.writeFileSync(sqlOutputPath, sqlLines.join('\n'));
  fs.writeFileSync(csvOutputPath, csvLines.join('\n'));

  console.log(`Generated ${rows.length} move_order rows.`);
  console.log(sqlOutputPath);
  console.log(csvOutputPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
