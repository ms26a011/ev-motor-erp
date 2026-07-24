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

const sqlOutputPath = path.join(backendRoot, 'sql', 'seed_bom_consumption.sql');
const csvOutputPath = path.join(projectRoot, 'bom_consumption.csv');

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

function daysBetween(start, end) {
  return Math.max(0, Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000));
}

function round3(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
}

function locationFor(category) {
  if (['Electrical Components', 'Electronic Components', 'Insulation Materials', 'Core Components', 'Magnetic Components'].includes(category)) return 'Electrical Store';
  if (['Mechanical Components', 'Bearings', 'Sealing Components', 'Fasteners'].includes(category)) return 'Mechanical Store';
  if (category === 'Consumables') return 'Consumables Store';
  if (category === 'Packaging Materials' || category === 'Identification & Documentation') return 'Packaging Store';
  return 'RM Store';
}

function batchFor(itemCode, dateString, index) {
  return `${itemCode || 'MAT'}-${dateString.replace(/-/g, '')}-${String(index + 1).padStart(4, '0')}`;
}

function statusFor(lineStatus, index) {
  if (lineStatus === 'Planned') return 'Planned';
  if (lineStatus === 'In Progress') return index % 3 === 0 ? 'Partially Consumed' : 'Issued';
  if (lineStatus === 'Partially Completed') return index % 4 === 0 ? 'Returned' : 'Partially Consumed';
  if (lineStatus === 'On Hold') return index % 2 === 0 ? 'Issued' : 'Returned';
  return index % 7 === 0 ? 'Closed' : 'Consumed';
}

function quantities(planned, status, index) {
  if (status === 'Planned') {
    return { issued: 0, consumed: 0, returned: 0, wastage: 0 };
  }
  const returnRate = index % 6 === 0 ? 0.02 : index % 5 === 0 ? 0.01 : 0;
  const wastageRate = [0, 0.004, 0.008, 0.012, 0.018, 0.024][index % 6];
  const consumptionFactor = status === 'Issued' ? 0.35 : status === 'Partially Consumed' ? 0.65 : 1;
  const consumed = round3(Math.max(0.001, planned * consumptionFactor));
  const wastage = round3(consumed * wastageRate);
  const returned = round3(consumed * returnRate);
  const issued = round3(consumed + wastage + returned);
  return { issued, consumed, returned, wastage };
}

function actualWindow(row) {
  const start = row.actual_start_date_text || row.planned_start_date_text;
  const end = row.actual_end_date_text || row.planned_end_date_text;
  return { start, end };
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
    SELECT poi.production_order_item_id, poi.item_id AS finished_item_id, poi.planned_quantity,
           poi.produced_quantity, poi.line_status, po.production_order_number,
           DATE_FORMAT(po.planned_start_date, '%Y-%m-%d') AS planned_start_date_text,
           DATE_FORMAT(po.planned_end_date, '%Y-%m-%d') AS planned_end_date_text,
           DATE_FORMAT(po.actual_start_date, '%Y-%m-%d') AS actual_start_date_text,
           DATE_FORMAT(po.actual_end_date, '%Y-%m-%d') AS actual_end_date_text
      FROM production_order_items poi
      JOIN production_order po ON po.production_order_id = poi.production_order_id
     ORDER BY poi.production_order_item_id
  `);
  const [bomLines] = await connection.query(`
    SELECT bm.parent_item_id, bm.component_item_id, bm.quantity_per_unit, bm.uom,
           bm.production_stage, im.item_code, im.category
      FROM bom_master bm
      JOIN item_master im ON im.item_id = bm.component_item_id
     WHERE bm.status = 'Active'
     ORDER BY bm.parent_item_id, bm.bom_id
  `);
  const [items] = await connection.query('SELECT item_id, item_code, item_name, category, uom FROM item_master WHERE status = "Active" ORDER BY item_id');
  const [employees] = await connection.query('SELECT employee_id FROM employee_master WHERE status = "Active" ORDER BY employee_id');
  await connection.end();

  if (!orderItems.length || !bomLines.length || !employees.length) {
    throw new Error('Production order items, BOM master, and employees are required before generating BOM consumption.');
  }

  const bomByParent = bomLines.reduce((acc, line) => {
    acc[line.parent_item_id] = acc[line.parent_item_id] || [];
    acc[line.parent_item_id].push(line);
    return acc;
  }, {});

  function itemByCode(code) {
    return items.find((item) => item.item_code === code);
  }

  function fallbackBomFor(orderItem) {
    const output = items.find((item) => item.item_id === orderItem.finished_item_id);
    const name = String(output?.item_name || '').toLowerCase();
    const codes = name.includes('stator')
      ? ['ELE001', 'INS001', 'INS004', 'INS005', 'CON001', 'CON002', 'FAS001', 'FAS004', 'FAS007', 'FAS010']
      : name.includes('rotor')
        ? ['MAG001', 'MEC001', 'MEC004', 'BRG001', 'MEC012', 'FAS016', 'FAS017', 'CON003', 'CON004', 'SEA001']
        : ['MEC001', 'MEC010', 'MEC011', 'BRG001', 'FAS001', 'FAS004', 'FAS007', 'CON003', 'CON004', 'SEA001'];
    return codes
      .map((code, index) => {
        const item = itemByCode(code);
        if (!item) return null;
        return {
          parent_item_id: orderItem.finished_item_id,
          component_item_id: item.item_id,
          quantity_per_unit: [1, 1.25, 0.5, 2, 0.08, 0.05, 4, 4, 4, 4][index] || 1,
          uom: item.uom,
          production_stage: name.includes('stator') ? 'Stator Assembly' : name.includes('rotor') ? 'Rotor Assembly' : 'Final Motor Assembly',
          item_code: item.item_code,
          category: item.category,
        };
      })
      .filter(Boolean);
  }

  const rows = [];
  let rowId = 1;
  for (const orderItem of orderItems) {
    const parentBom = bomByParent[orderItem.finished_item_id]?.length
      ? bomByParent[orderItem.finished_item_id]
      : fallbackBomFor(orderItem);
    if (!parentBom?.length) continue;
    const lineCount = 5 + (Number(orderItem.production_order_item_id) % 16);
    const selectedBomLines = parentBom.slice(0, Math.min(lineCount, parentBom.length));
    const outputQuantity = Number(orderItem.produced_quantity) > 0
      ? Number(orderItem.produced_quantity)
      : Math.max(1, Number(orderItem.planned_quantity) * 0.25);
    const { start, end } = actualWindow(orderItem);
    const span = daysBetween(start, end);

    selectedBomLines.forEach((bomLine, lineIndex) => {
      const planned = round3(Number(bomLine.quantity_per_unit) * outputQuantity);
      const status = statusFor(orderItem.line_status, rowId + lineIndex);
      const quantitySet = quantities(planned, status, rowId + lineIndex);
      const consumptionDate = addDays(start, span === 0 ? 0 : (rowId + lineIndex) % (span + 1));
      rows.push({
        bom_consumption_id: rowId,
        production_order_item_id: orderItem.production_order_item_id,
        finished_item_id: orderItem.finished_item_id,
        consumed_item_id: bomLine.component_item_id,
        planned_quantity: planned.toFixed(3),
        issued_quantity: quantitySet.issued.toFixed(3),
        actual_consumed_quantity: quantitySet.consumed.toFixed(3),
        returned_quantity: quantitySet.returned.toFixed(3),
        wastage_quantity: quantitySet.wastage.toFixed(3),
        uom: bomLine.uom,
        warehouse_location: locationFor(bomLine.category),
        batch_number: batchFor(bomLine.item_code, consumptionDate, rowId),
        consumption_date: consumptionDate,
        consumed_by: employees[(rowId + lineIndex) % employees.length].employee_id,
        transaction_status: status,
        remarks: `${status} material consumption for ${orderItem.production_order_number}; ${bomLine.production_stage}`,
        created_at: `${consumptionDate} 09:${String((rowId * 7) % 60).padStart(2, '0')}:00`,
        updated_at: `${consumptionDate} 16:${String((rowId * 11) % 60).padStart(2, '0')}:00`,
      });
      rowId += 1;
    });
  }

  const insertColumns = [
    'bom_consumption_id',
    'production_order_item_id',
    'finished_item_id',
    'consumed_item_id',
    'planned_quantity',
    'issued_quantity',
    'actual_consumed_quantity',
    'returned_quantity',
    'wastage_quantity',
    'uom',
    'warehouse_location',
    'batch_number',
    'consumption_date',
    'consumed_by',
    'transaction_status',
    'remarks',
    'created_at',
    'updated_at',
  ];

  const sqlLines = [
    'SET FOREIGN_KEY_CHECKS = 0;',
    'TRUNCATE TABLE bom_consumption;',
    'SET FOREIGN_KEY_CHECKS = 1;',
    `INSERT INTO bom_consumption (${insertColumns.join(', ')}) VALUES`,
    rows.map((row) => `  (${insertColumns.map((column) => sqlString(row[column])).join(', ')})`).join(',\n') + ';',
    '',
  ];
  const csvLines = [
    insertColumns.join(','),
    ...rows.map((row) => insertColumns.map((column) => csvCell(row[column])).join(',')),
  ];

  fs.writeFileSync(sqlOutputPath, sqlLines.join('\n'));
  fs.writeFileSync(csvOutputPath, csvLines.join('\n'));

  console.log(`Generated ${rows.length} bom_consumption rows.`);
  console.log(sqlOutputPath);
  console.log(csvOutputPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
