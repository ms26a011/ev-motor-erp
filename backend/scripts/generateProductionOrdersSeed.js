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

const sqlOutputPath = path.join(backendRoot, 'sql', 'seed_production_order.sql');
const csvOutputPath = path.join(projectRoot, 'production_order.csv');

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function sqlString(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function dateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function productionNumber(dateString, index) {
  return `PROD${dateString.replace(/-/g, '')}${String(index + 1).padStart(4, '0')}`;
}

function plannedQuantity(item, index, makeToOrder) {
  if (item.category === 'Finished Goods') {
    const base = makeToOrder ? [12, 18, 24, 30, 36, 48] : [40, 60, 75, 90, 120, 150];
    return base[index % base.length];
  }
  if (item.item_name.toLowerCase().includes('stator')) return [80, 120, 160, 200, 240, 300][index % 6];
  if (item.item_name.toLowerCase().includes('rotor')) return [70, 110, 150, 190, 230, 280][index % 6];
  return [50, 75, 100, 125, 150, 200][index % 6];
}

function durationDays(item, quantity) {
  if (item.category === 'Finished Goods') return 2 + Math.ceil(quantity / 45);
  if (item.item_name.toLowerCase().includes('stator')) return 2 + Math.ceil(quantity / 100);
  if (item.item_name.toLowerCase().includes('rotor')) return 2 + Math.ceil(quantity / 120);
  return 2 + Math.ceil(quantity / 130);
}

function departmentForItem(item, departments) {
  const name = item.item_name.toLowerCase();
  const category = item.category;
  const wanted = category === 'Finished Goods'
    ? 'Assembly'
    : name.includes('stator')
      ? 'Stator Manufacturing'
      : name.includes('rotor')
        ? 'Rotor Manufacturing'
        : 'Assembly';
  return departments.find((department) => department.department_name === wanted) || departments[0];
}

function employeesForDepartment(employees, departmentId) {
  const pool = employees.filter((employee) => employee.department_id === departmentId);
  return pool.length ? pool : employees;
}

function statusFor(index) {
  return ['Completed', 'Completed', 'Partially Completed', 'In Progress', 'Released', 'Planned', 'On Hold', 'Cancelled'][index % 8];
}

function priorityFor(status, orderDate, requiredDate, index) {
  if (status === 'On Hold') return index % 2 === 0 ? 'High' : 'Urgent';
  if (status === 'Cancelled') return index % 3 === 0 ? 'Low' : 'Medium';
  if (requiredDate) {
    const gap = (new Date(`${requiredDate}T00:00:00Z`) - new Date(`${orderDate}T00:00:00Z`)) / 86400000;
    if (gap <= 7) return 'Urgent';
    if (gap <= 14) return 'High';
  }
  return ['Medium', 'High', 'Medium', 'Low'][index % 4];
}

function quantities(status, planned, index) {
  if (status === 'Planned' || status === 'Released' || status === 'On Hold') {
    return { produced: 0, rejected: 0 };
  }
  if (status === 'Cancelled') {
    return { produced: 0, rejected: 0 };
  }
  const rejectionRate = [0.005, 0.01, 0.015, 0.02, 0.03][index % 5];
  if (status === 'Completed') {
    const rejected = Math.min(Math.floor(planned * rejectionRate), Math.max(0, planned - 1));
    return { produced: planned - rejected, rejected };
  }
  if (status === 'Partially Completed') {
    const produced = Math.floor(planned * (0.45 + ((index % 4) * 0.1)));
    const rejected = Math.min(Math.floor(produced * rejectionRate), planned - produced);
    return { produced, rejected };
  }
  const produced = Math.floor(planned * (0.15 + ((index % 3) * 0.08)));
  const rejected = Math.min(Math.floor(produced * rejectionRate), planned - produced);
  return { produced, rejected };
}

function actualDates(status, plannedStart, plannedEnd, index) {
  if (status === 'Planned' || status === 'Released' || status === 'Cancelled') {
    return { actualStart: null, actualEnd: null };
  }
  const actualStart = addDays(plannedStart, index % 3 === 0 ? 1 : 0);
  if (status === 'In Progress' || status === 'On Hold') {
    return { actualStart, actualEnd: null };
  }
  const delay = index % 6 === 0 ? 2 : index % 5 === 0 ? 1 : 0;
  return { actualStart, actualEnd: addDays(plannedEnd, delay) };
}

function remarkFor(status, item, customerOrder) {
  if (status === 'On Hold') return `Production hold for ${item.item_name}: awaiting material clearance from stores`;
  if (status === 'Cancelled') return `Cancelled due to revised production plan for ${item.item_name}`;
  if (customerOrder) return `Make-to-order production linked to ${customerOrder.co_number}`;
  return `Make-to-stock production for ${item.item_name}`;
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
  });

  const [items] = await connection.query(`
    SELECT item_id, item_code, item_name, category, uom
      FROM item_master
     WHERE status = 'Active'
       AND (
         category = 'Finished Goods'
         OR item_name LIKE '%Stator%'
         OR item_name LIKE '%Rotor%'
       )
     ORDER BY
       CASE WHEN category = 'Finished Goods' THEN 0 ELSE 1 END,
       item_id
  `);
  const [customerOrders] = await connection.query(`
    SELECT co_id, co_number, order_date, required_delivery_date, status
      FROM customer_order
     WHERE status IN ('Confirmed', 'Partially Dispatched', 'Pending')
     ORDER BY order_date, co_id
  `);
  const [departments] = await connection.query('SELECT department_id, department_name FROM department_master ORDER BY department_id');
  const [employees] = await connection.query('SELECT employee_id, department_id FROM employee_master WHERE status = "Active" ORDER BY employee_id');
  await connection.end();

  if (!items.length || !departments.length || !employees.length) {
    throw new Error('Item, department, and employee data are required before generating production orders.');
  }

  const rows = [];
  const rowCount = 300;
  const baseDate = '2025-01-03';

  for (let index = 0; index < rowCount; index += 1) {
    const makeToOrder = index % 5 !== 0 && customerOrders.length > 0;
    const customerOrder = makeToOrder ? customerOrders[index % customerOrders.length] : null;
    const item = items[index % items.length];
    const department = departmentForItem(item, departments);
    const departmentEmployees = employeesForDepartment(employees, department.department_id);
    const plannedStart = customerOrder
      ? addDays(dateOnly(customerOrder.order_date), 2 + (index % 7))
      : addDays(baseDate, index * 3);
    const plannedQty = plannedQuantity(item, index, makeToOrder);
    const plannedEnd = addDays(plannedStart, durationDays(item, plannedQty));
    const status = statusFor(index);
    const { produced, rejected } = quantities(status, plannedQty, index);
    const { actualStart, actualEnd } = actualDates(status, plannedStart, plannedEnd, index);
    const priority = priorityFor(status, plannedStart, customerOrder?.required_delivery_date, index);

    rows.push({
      production_order_id: index + 1,
      production_order_number: productionNumber(plannedStart, index),
      customer_order_id: customerOrder?.co_id || null,
      finished_item_id: item.item_id,
      department_id: department.department_id,
      planned_quantity: plannedQty.toFixed(3),
      produced_quantity: produced.toFixed(3),
      rejected_quantity: rejected.toFixed(3),
      uom: item.uom,
      planned_start_date: plannedStart,
      planned_end_date: plannedEnd,
      actual_start_date: actualStart,
      actual_end_date: actualEnd,
      priority,
      production_status: status,
      created_by: departmentEmployees[index % departmentEmployees.length].employee_id,
      approved_by: status === 'Planned' ? null : departmentEmployees[(index + 1) % departmentEmployees.length].employee_id,
      remarks: remarkFor(status, item, customerOrder),
      created_at: `${addDays(plannedStart, -1)} 09:${String((index * 7) % 60).padStart(2, '0')}:00`,
      updated_at: `${plannedStart} 17:${String((index * 11) % 60).padStart(2, '0')}:00`,
    });
  }

  const insertColumns = [
    'production_order_id',
    'production_order_number',
    'customer_order_id',
    'finished_item_id',
    'department_id',
    'planned_quantity',
    'produced_quantity',
    'rejected_quantity',
    'uom',
    'planned_start_date',
    'planned_end_date',
    'actual_start_date',
    'actual_end_date',
    'priority',
    'production_status',
    'created_by',
    'approved_by',
    'remarks',
    'created_at',
    'updated_at',
  ];

  const sqlLines = [
    'SET FOREIGN_KEY_CHECKS = 0;',
    'TRUNCATE TABLE production_order;',
    'SET FOREIGN_KEY_CHECKS = 1;',
    `INSERT INTO production_order (${insertColumns.join(', ')}) VALUES`,
    rows.map((row) => `  (${insertColumns.map((column) => sqlString(row[column])).join(', ')})`).join(',\n') + ';',
    '',
  ];

  const csvLines = [
    insertColumns.join(','),
    ...rows.map((row) => insertColumns.map((column) => csvCell(row[column])).join(',')),
  ];

  fs.writeFileSync(sqlOutputPath, sqlLines.join('\n'));
  fs.writeFileSync(csvOutputPath, csvLines.join('\n'));

  console.log(`Generated ${rows.length} production_order rows.`);
  console.log(sqlOutputPath);
  console.log(csvOutputPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
