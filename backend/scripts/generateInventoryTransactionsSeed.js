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

const sqlOutputPath = path.join(backendRoot, 'sql', 'seed_inventory_transactions.sql');
const csvOutputPath = path.join(projectRoot, 'inventory_transactions.csv');

function dateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

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

function round3(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
}

function txnNumber(type, dateString, index) {
  const prefix = {
    'GRN Receipt': 'ITGRN',
    'Production Issue': 'ITISS',
    'Production Return': 'ITRET',
    'Stock Adjustment': 'ITADJ',
    'Stock Transfer': 'ITTRF',
    Rejection: 'ITREJ',
    'Finished Goods Receipt': 'ITFGR',
    'Sales Dispatch': 'ITDSP',
  }[type];
  return `${prefix}${dateString.replace(/-/g, '')}${String(index).padStart(5, '0')}`;
}

function locationForCategory(category) {
  if (['Electrical Components', 'Electronic Components', 'Insulation Materials', 'Core Components', 'Magnetic Components'].includes(category)) return 'Electrical Store';
  if (['Mechanical Components', 'Bearings', 'Sealing Components', 'Fasteners'].includes(category)) return 'Mechanical Store';
  if (category === 'Consumables') return 'Consumables Store';
  if (category === 'Packaging Materials' || category === 'Identification & Documentation') return 'Packaging Store';
  if (category === 'Finished Goods') return 'Finished Goods Store';
  return 'Raw Material Store';
}

function issueLocation(category, index) {
  if (category === 'Electrical Components' || category === 'Insulation Materials') return index % 2 === 0 ? 'Production Line 1' : 'Stator Winding Line';
  if (category === 'Core Components' || category === 'Magnetic Components') return index % 2 === 0 ? 'Production Line 2' : 'Rotor Assembly Line';
  if (category === 'Packaging Materials') return 'Dispatch Area';
  return index % 2 === 0 ? 'Production Line 1' : 'Production Line 2';
}

function addStock(stock, key, quantity) {
  stock[key] = round3((stock[key] || 0) + Number(quantity));
}

function takeStock(stock, key, desired) {
  const available = stock[key] || 0;
  const qty = round3(Math.min(Math.max(available * 0.08, 1), desired, available * 0.35));
  stock[key] = round3(available - qty);
  return qty;
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
  });

  const [grnItems] = await connection.query(`
    SELECT gri.grn_item_id, gri.item_id, gri.accepted_quantity, gri.rejected_quantity, gri.unit_price,
           gri.batch_number, gri.storage_location, grn.received_date,
           im.item_code, im.item_name, im.category, im.uom, im.unit_cost
    FROM goods_receipt_items gri
    JOIN goods_receipt grn ON grn.grn_id = gri.grn_id
    JOIN item_master im ON im.item_id = gri.item_id
    WHERE gri.accepted_quantity > 0
    ORDER BY grn.received_date, gri.grn_item_id
  `);
  const [rejectedItems] = await connection.query(`
    SELECT gri.grn_item_id, gri.item_id, gri.rejected_quantity, gri.unit_price,
           gri.batch_number, grn.received_date,
           im.item_code, im.item_name, im.category, im.uom, im.unit_cost
    FROM goods_receipt_items gri
    JOIN goods_receipt grn ON grn.grn_id = gri.grn_id
    JOIN item_master im ON im.item_id = gri.item_id
    WHERE gri.rejected_quantity > 0
    ORDER BY grn.received_date, gri.grn_item_id
  `);
  const [items] = await connection.query(`
    SELECT item_id, item_code, item_name, category, uom, unit_cost
    FROM item_master
    WHERE status = 'Active'
    ORDER BY item_id
  `);
  const [employees] = await connection.query('SELECT employee_id FROM employee_master ORDER BY employee_id');
  const [customerOrders] = await connection.query('SELECT co_id FROM customer_order ORDER BY co_id LIMIT 80');
  await connection.end();

  const employeeIds = employees.map((row) => row.employee_id);
  const fgItems = items.filter((item) => item.category === 'Finished Goods');
  const nonFgItems = items.filter((item) => item.category !== 'Finished Goods');
  const itemById = Object.fromEntries(items.map((item) => [item.item_id, item]));
  const rows = [];
  const stock = {};

  function pushRow(data) {
    const id = rows.length + 1;
    const date = data.transaction_date;
    rows.push({
      inventory_transaction_id: id,
      transaction_number: txnNumber(data.transaction_type, date, id),
      created_at: `${date} 09:${String((id * 3) % 60).padStart(2, '0')}:00`,
      updated_at: `${date} 10:${String((id * 3) % 60).padStart(2, '0')}:00`,
      ...data,
    });
  }

  for (const item of grnItems.slice(0, 120)) {
    const location = locationForCategory(item.category);
    pushRow({
      transaction_date: dateOnly(item.received_date),
      transaction_type: 'GRN Receipt',
      item_id: item.item_id,
      source_reference_type: 'GRN',
      source_reference_id: item.grn_item_id,
      warehouse_location: location,
      from_location: null,
      to_location: location,
      quantity_in: Number(item.accepted_quantity).toFixed(3),
      quantity_out: '0.000',
      uom: item.uom,
      unit_cost: Number(item.unit_price || item.unit_cost).toFixed(6),
      batch_number: item.batch_number,
      performed_by: employeeIds[rows.length % employeeIds.length],
      remarks: `Accepted inward from GRN item ${item.grn_item_id}`,
    });
    addStock(stock, `${item.item_id}|${location}`, item.accepted_quantity);
  }

  let issueIndex = 0;
  let issueAttempts = 0;
  while (issueIndex < 55 && issueAttempts < 800) {
    issueAttempts += 1;
    const availableKeys = Object.keys(stock).filter((key) => (stock[key] || 0) > 2);
    if (!availableKeys.length) break;
    const stockKey = availableKeys[issueIndex % availableKeys.length];
    const [itemId, from] = stockKey.split('|');
    const item = itemById[itemId];
    if (!item || item.category === 'Finished Goods') continue;
    const qty = takeStock(stock, stockKey, 5 + (issueIndex % 9) * 3);
    if (qty <= 0) continue;
    pushRow({
      transaction_date: addDays('2025-06-01', issueIndex * 2),
      transaction_type: 'Production Issue',
      item_id: item.item_id,
      source_reference_type: 'Production Order',
      source_reference_id: 1000 + issueIndex,
      warehouse_location: from,
      from_location: from,
      to_location: issueLocation(item.category, issueIndex),
      quantity_in: '0.000',
      quantity_out: qty.toFixed(3),
      uom: item.uom,
      unit_cost: Number(item.unit_cost || 1).toFixed(6),
      batch_number: `ISS-${item.item_code}-${String(issueIndex + 1).padStart(4, '0')}`,
      performed_by: employeeIds[(issueIndex + 2) % employeeIds.length],
      remarks: 'Material issued to production line for motor assembly',
    });
    issueIndex += 1;
  }

  for (let i = 0; i < 20; i += 1) {
    const item = nonFgItems[(i * 3) % nonFgItems.length];
    const location = locationForCategory(item.category);
    const qty = round3(2 + (i % 5) * 1.5);
    pushRow({
      transaction_date: addDays('2025-07-01', i * 3),
      transaction_type: 'Production Return',
      item_id: item.item_id,
      source_reference_type: 'Production Order',
      source_reference_id: 2000 + i,
      warehouse_location: location,
      from_location: issueLocation(item.category, i),
      to_location: location,
      quantity_in: qty.toFixed(3),
      quantity_out: '0.000',
      uom: item.uom,
      unit_cost: Number(item.unit_cost || 1).toFixed(6),
      batch_number: `RET-${item.item_code}-${String(i + 1).padStart(4, '0')}`,
      performed_by: employeeIds[(i + 4) % employeeIds.length],
      remarks: 'Unused production material returned to store',
    });
    addStock(stock, `${item.item_id}|${location}`, qty);
  }

  for (let i = 0; i < 31; i += 1) {
    const item = nonFgItems[(i * 5) % nonFgItems.length];
    const location = locationForCategory(item.category);
    const inbound = i % 3 !== 0;
    const qty = round3(1 + (i % 7) * 2.25);
    pushRow({
      transaction_date: addDays('2025-08-01', i * 4),
      transaction_type: 'Stock Adjustment',
      item_id: item.item_id,
      source_reference_type: 'Manual Adjustment',
      source_reference_id: null,
      warehouse_location: location,
      from_location: inbound ? null : location,
      to_location: inbound ? location : 'Adjustment Variance',
      quantity_in: inbound ? qty.toFixed(3) : '0.000',
      quantity_out: inbound ? '0.000' : qty.toFixed(3),
      uom: item.uom,
      unit_cost: Number(item.unit_cost || 1).toFixed(6),
      batch_number: `ADJ-${item.item_code}-${String(i + 1).padStart(4, '0')}`,
      performed_by: employeeIds[(i + 6) % employeeIds.length],
      remarks: inbound ? 'Cycle count positive adjustment' : 'Cycle count shortage adjustment',
    });
    if (inbound) addStock(stock, `${item.item_id}|${location}`, qty);
  }

  let transferIndex = 0;
  let transferAttempts = 0;
  while (transferIndex < 25 && transferAttempts < 500) {
    transferAttempts += 1;
    const availableKeys = Object.keys(stock).filter((key) => (stock[key] || 0) > 1);
    if (!availableKeys.length) break;
    const key = availableKeys[transferIndex % availableKeys.length];
    const [itemId, from] = key.split('|');
    const item = itemById[itemId];
    if (!item || item.category === 'Finished Goods') continue;
    const to = issueLocation(item.category, transferIndex);
    const qty = takeStock(stock, key, 2 + (transferIndex % 5) * 2);
    if (qty <= 0) continue;
    pushRow({
      transaction_date: addDays('2025-09-01', transferIndex * 3),
      transaction_type: 'Stock Transfer',
      item_id: item.item_id,
      source_reference_type: 'Manual Adjustment',
      source_reference_id: null,
      warehouse_location: from,
      from_location: from,
      to_location: to,
      quantity_in: '0.000',
      quantity_out: qty.toFixed(3),
      uom: item.uom,
      unit_cost: Number(item.unit_cost || 1).toFixed(6),
      batch_number: `TRF-${item.item_code}-${String(transferIndex + 1).padStart(4, '0')}`,
      performed_by: employeeIds[(transferIndex + 8) % employeeIds.length],
      remarks: 'Location transfer for production staging',
    });
    transferIndex += 1;
  }

  for (const item of rejectedItems.slice(0, 15)) {
    pushRow({
      transaction_date: dateOnly(item.received_date),
      transaction_type: 'Rejection',
      item_id: item.item_id,
      source_reference_type: 'GRN',
      source_reference_id: item.grn_item_id,
      warehouse_location: 'QA Hold Area',
      from_location: 'QA Hold Area',
      to_location: 'Rejection Bay',
      quantity_in: '0.000',
      quantity_out: Number(item.rejected_quantity).toFixed(3),
      uom: item.uom,
      unit_cost: Number(item.unit_price || item.unit_cost || 1).toFixed(6),
      batch_number: item.batch_number,
      performed_by: employeeIds[rows.length % employeeIds.length],
      remarks: 'Rejected material moved to rejection bay',
    });
  }

  for (let i = 0; i < 25; i += 1) {
    const item = fgItems[i % fgItems.length];
    const qty = round3(5 + (i % 6) * 3);
    pushRow({
      transaction_date: addDays('2025-10-01', i * 5),
      transaction_type: 'Finished Goods Receipt',
      item_id: item.item_id,
      source_reference_type: 'Production Order',
      source_reference_id: 3000 + i,
      warehouse_location: 'Finished Goods Store',
      from_location: 'Production Line 2',
      to_location: 'Finished Goods Store',
      quantity_in: qty.toFixed(3),
      quantity_out: '0.000',
      uom: item.uom,
      unit_cost: Number(item.unit_cost || 1).toFixed(6),
      batch_number: `FG-${item.item_code}-${String(i + 1).padStart(4, '0')}`,
      performed_by: employeeIds[(i + 3) % employeeIds.length],
      remarks: 'Finished motor receipt from production',
    });
    addStock(stock, `${item.item_id}|Finished Goods Store`, qty);
  }

  for (let i = 0; i < 15; i += 1) {
    const item = fgItems[i % fgItems.length];
    const key = `${item.item_id}|Finished Goods Store`;
    const qty = takeStock(stock, key, 2 + (i % 4) * 2);
    const order = customerOrders[i % customerOrders.length];
    pushRow({
      transaction_date: addDays('2025-11-01', i * 6),
      transaction_type: 'Sales Dispatch',
      item_id: item.item_id,
      source_reference_type: 'Customer Order',
      source_reference_id: order.co_id,
      warehouse_location: 'Finished Goods Store',
      from_location: 'Finished Goods Store',
      to_location: 'Dispatch Area',
      quantity_in: '0.000',
      quantity_out: qty.toFixed(3),
      uom: item.uom,
      unit_cost: Number(item.unit_cost || 1).toFixed(6),
      batch_number: `DSP-${item.item_code}-${String(i + 1).padStart(4, '0')}`,
      performed_by: employeeIds[(i + 5) % employeeIds.length],
      remarks: 'Finished motor dispatched against customer order',
    });
  }

  const rows300 = rows.slice(0, 300);
  const columns = [
    'inventory_transaction_id',
    'transaction_number',
    'transaction_date',
    'transaction_type',
    'item_id',
    'source_reference_type',
    'source_reference_id',
    'warehouse_location',
    'from_location',
    'to_location',
    'quantity_in',
    'quantity_out',
    'uom',
    'unit_cost',
    'batch_number',
    'performed_by',
    'remarks',
    'created_at',
    'updated_at',
  ];

  const sql = [
    '-- Generated by backend/scripts/generateInventoryTransactionsSeed.js',
    '-- Loads 300 inventory ledger rows across inward, outward, transfer, adjustment, rejection, FG, and dispatch movements.',
    '',
    'INSERT INTO inventory_transactions',
    `  (${columns.join(', ')})`,
    'VALUES',
    rows300.map((row) => `  (${columns.map((column) => sqlString(row[column])).join(', ')})`).join(',\n') + ';',
    '',
  ].join('\n');

  const csvColumns = [...columns.slice(0, 14), 'transaction_value', ...columns.slice(14)];
  const csv = [
    csvColumns.join(','),
    ...rows300.map((row) => csvColumns.map((column) => {
      const quantity = Number(row.quantity_in) > 0 ? Number(row.quantity_in) : Number(row.quantity_out);
      const value = column === 'transaction_value' ? (quantity * Number(row.unit_cost)).toFixed(2) : row[column];
      return csvCell(value);
    }).join(',')),
    '',
  ].join('\n');

  fs.writeFileSync(sqlOutputPath, sql);
  fs.writeFileSync(csvOutputPath, csv);

  const typeMix = rows300.reduce((acc, row) => {
    acc[row.transaction_type] = (acc[row.transaction_type] || 0) + 1;
    return acc;
  }, {});
  const invalidDirections = rows300.filter((row) => !((Number(row.quantity_in) > 0 && Number(row.quantity_out) === 0) || (Number(row.quantity_out) > 0 && Number(row.quantity_in) === 0)));
  console.log(`Generated ${rows300.length} inventory transaction rows.`);
  console.log(`SQL: ${sqlOutputPath}`);
  console.log(`CSV: ${csvOutputPath}`);
  console.log('Type mix:', typeMix);
  console.log(`Validation invalidDirections=${invalidDirections.length}`);
  console.table(rows300.slice(0, 10).map((row) => ({
    inventory_transaction_id: row.inventory_transaction_id,
    transaction_number: row.transaction_number,
    transaction_date: row.transaction_date,
    transaction_type: row.transaction_type,
    item_id: row.item_id,
    quantity_in: row.quantity_in,
    quantity_out: row.quantity_out,
    warehouse_location: row.warehouse_location,
  })));
}

await main();
