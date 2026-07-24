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

const sqlOutputPath = path.join(backendRoot, 'sql', 'seed_purchase_order_items.sql');
const csvOutputPath = path.join(projectRoot, 'purchase_order_items.csv');

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

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function round3(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
}

function round4(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
}

function round6(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000000) / 1000000;
}

function statusQuantities(lineStatus, orderedQuantity, index) {
  if (lineStatus === 'Cancelled' || lineStatus === 'Ordered') {
    return { received: 0, pending: orderedQuantity };
  }
  if (lineStatus === 'Fully Received' || lineStatus === 'Closed') {
    return { received: orderedQuantity, pending: 0 };
  }
  const ratio = [0.25, 0.4, 0.55, 0.7][index % 4];
  const received = Math.max(0.001, round3(orderedQuantity * ratio));
  return { received, pending: round3(orderedQuantity - received) };
}

function lineStatusFromPo(poStatus, index) {
  if (poStatus === 'Cancelled') return 'Cancelled';
  if (poStatus === 'Closed') return 'Closed';
  if (poStatus === 'Fully Received') return 'Fully Received';
  if (poStatus === 'Partially Received') return index % 4 === 0 ? 'Fully Received' : 'Partially Received';
  return 'Ordered';
}

function lineCountForPo(po) {
  const count = (Number(po.po_id) % 5) + 1;
  return Math.min(5, Math.max(1, count));
}

function allocationParts(total, count) {
  const weights = Array.from({ length: count }, (_, index) => index + 2);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const parts = weights.map((weight) => round2((Number(total) * weight) / weightTotal));
  const diff = round2(Number(total) - parts.reduce((sum, value) => round2(sum + value), 0));
  parts[parts.length - 1] = round2(parts[parts.length - 1] + diff);
  return parts;
}

function directItemPool(items, vendorType) {
  const type = String(vendorType || '').toLowerCase();
  if (type.includes('copper')) return items.filter((item) => item.category === 'Electrical Components');
  if (type.includes('steel')) return items.filter((item) => item.category === 'Core Components');
  if (type.includes('magnet')) return items.filter((item) => item.category === 'Magnetic Components');
  if (type.includes('bearing')) return items.filter((item) => item.category === 'Bearings');
  if (type.includes('electronic')) return items.filter((item) => item.category === 'Electronic Components');
  if (type.includes('insulation')) return items.filter((item) => item.category === 'Insulation Materials');
  if (type.includes('fastener')) return items.filter((item) => item.category === 'Fasteners');
  if (type.includes('pack')) return items.filter((item) => item.category === 'Packaging Materials');
  if (type.includes('chemical') || type.includes('consum')) return items.filter((item) => item.category === 'Consumables');
  return items.filter((item) => ['Mechanical Components', 'Sealing Components', 'Consumables'].includes(item.category));
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
  });

  const [purchaseOrders] = await connection.query(`
    SELECT po.*, vm.vendor_type
      FROM purchase_order po
      JOIN vendor_master vm ON vm.vendor_id = po.vendor_id
     ORDER BY po.po_id
  `);
  const [prItems] = await connection.query(`
    SELECT pri.*, im.item_code, im.item_name, im.category, im.uom AS item_uom, im.unit_cost
      FROM purchase_requisition_items pri
      JOIN item_master im ON im.item_id = pri.item_id
     ORDER BY pri.pr_id, pri.pr_item_id
  `);
  const [items] = await connection.query(`
    SELECT item_id, item_code, item_name, category, uom, unit_cost
      FROM item_master
     WHERE status = 'Active'
     ORDER BY item_id
  `);
  await connection.end();

  const prItemsByPr = prItems.reduce((acc, item) => {
    acc[item.pr_id] = acc[item.pr_id] || [];
    acc[item.pr_id].push(item);
    return acc;
  }, {});

  const rows = [];
  let poItemId = 1;

  for (const po of purchaseOrders) {
    const count = lineCountForPo(po);
    const subtotalParts = allocationParts(po.subtotal_amount, count);
    const taxParts = allocationParts(po.tax_amount, count);
    const discountParts = allocationParts(po.discount_amount, count);
    const sourceItems = po.pr_id ? (prItemsByPr[po.pr_id] || []) : [];
    const directPool = directItemPool(items, po.vendor_type);

    for (let index = 0; index < count; index += 1) {
      const source = sourceItems.length
        ? sourceItems[index % sourceItems.length]
        : directPool[(Number(po.po_id) * 7 + index * 3) % directPool.length];
      const lineSubtotal = subtotalParts[index];
      const taxAmount = taxParts[index];
      const discountAmount = discountParts[index];
      const taxRate = lineSubtotal === 0 ? 18 : round2((taxAmount / lineSubtotal) * 100);
      const lineTotal = round2(lineSubtotal + taxAmount - discountAmount);
      const baseQuantity = source.requested_quantity
        ? Number(source.requested_quantity)
        : Math.max(1, Math.round(lineSubtotal / Math.max(1, Number(source.unit_cost || 1))));
      const orderedQuantity = Math.max(0.001, round3(baseQuantity * (0.35 + ((index + Number(po.po_id)) % 4) * 0.15)));
      const unitPrice = round6(lineSubtotal / orderedQuantity);
      const adjustedSubtotal = round2(orderedQuantity * unitPrice);
      const subtotalDiff = round2(lineSubtotal - adjustedSubtotal);
      const finalUnitPrice = round6((adjustedSubtotal + subtotalDiff) / orderedQuantity);
      const lineStatus = lineStatusFromPo(po.po_status, index);
      const quantities = statusQuantities(lineStatus, orderedQuantity, index + Number(po.po_id));
      const poDate = dateOnly(po.po_date);
      const expectedDeliveryDate = addDays(poDate, 3 + ((index + Number(po.po_id)) % 6));

      rows.push({
        po_item_id: poItemId,
        po_id: po.po_id,
        pr_item_id: source.pr_item_id || null,
        item_id: source.item_id,
        ordered_quantity: orderedQuantity.toFixed(3),
        uom: source.item_uom || source.uom,
        unit_price: finalUnitPrice.toFixed(6),
        line_subtotal: lineSubtotal.toFixed(2),
        tax_rate: taxRate.toFixed(2),
        tax_amount: taxAmount.toFixed(2),
        discount_amount: discountAmount.toFixed(2),
        line_total: lineTotal.toFixed(2),
        expected_delivery_date: expectedDeliveryDate,
        received_quantity: quantities.received.toFixed(3),
        pending_quantity: quantities.pending.toFixed(3),
        line_status: lineStatus,
        remarks: source.pr_item_id
          ? `PO line converted from PR item ${source.pr_item_id} for ${source.item_name}`
          : `Direct PO line for ${source.category} - ${source.item_name}`,
        created_at: `${poDate} 14:${String((poItemId * 3) % 60).padStart(2, '0')}:00`,
        updated_at: `${poDate} 15:${String((poItemId * 3) % 60).padStart(2, '0')}:00`,
      });
      poItemId += 1;
    }
  }

  const insertColumns = [
    'po_item_id',
    'po_id',
    'pr_item_id',
    'item_id',
    'ordered_quantity',
    'uom',
    'unit_price',
    'line_subtotal',
    'tax_rate',
    'tax_amount',
    'discount_amount',
    'line_total',
    'expected_delivery_date',
    'received_quantity',
    'pending_quantity',
    'line_status',
    'remarks',
    'created_at',
    'updated_at',
  ];

  const sql = [
    '-- Generated by backend/scripts/generatePurchaseOrderItemsSeed.js',
    '-- Loads purchase order item rows reconciled to live purchase_order headers.',
    '',
    'INSERT INTO purchase_order_items',
    `  (${insertColumns.join(', ')})`,
    'VALUES',
    rows.map((row) => `  (${insertColumns.map((column) => sqlString(row[column])).join(', ')})`).join(',\n') + ';',
    '',
  ].join('\n');

  const csv = [
    insertColumns.join(','),
    ...rows.map((row) => insertColumns.map((column) => csvCell(row[column])).join(',')),
    '',
  ].join('\n');

  fs.writeFileSync(sqlOutputPath, sql);
  fs.writeFileSync(csvOutputPath, csv);

  const invalidQuantity = rows.filter((row) => Number(row.ordered_quantity) <= 0 || Number(row.received_quantity) > Number(row.ordered_quantity));
  const invalidPending = rows.filter((row) => Math.abs(Number(row.pending_quantity) - (Number(row.ordered_quantity) - Number(row.received_quantity))) > 0.001);
  const directRows = rows.filter((row) => row.pr_item_id === null);

  console.log(`Generated ${rows.length} purchase order item rows.`);
  console.log(`Direct PO item rows: ${directRows.length}`);
  console.log(`SQL: ${sqlOutputPath}`);
  console.log(`CSV: ${csvOutputPath}`);
  console.log(`Validation invalidQuantity=${invalidQuantity.length} invalidPending=${invalidPending.length}`);
  console.table(rows.slice(0, 10).map((row) => ({
    po_item_id: row.po_item_id,
    po_id: row.po_id,
    pr_item_id: row.pr_item_id,
    item_id: row.item_id,
    ordered_quantity: row.ordered_quantity,
    uom: row.uom,
    line_total: row.line_total,
    received_quantity: row.received_quantity,
    pending_quantity: row.pending_quantity,
    line_status: row.line_status,
  })));
}

await main();
