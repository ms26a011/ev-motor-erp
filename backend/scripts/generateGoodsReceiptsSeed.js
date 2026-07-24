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

const sqlOutputPath = path.join(backendRoot, 'sql', 'seed_goods_receipt.sql');
const csvOutputPath = path.join(projectRoot, 'goods_receipt.csv');

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

function grnNumber(receivedDate, index) {
  return `GRN${receivedDate.replace(/-/g, '')}${String(index + 1).padStart(4, '0')}`;
}

function receiptCountForPo(po) {
  if (po.po_status === 'Partially Received') return 2;
  if (po.po_status === 'Issued') return Number(po.po_id) % 5 === 0 ? 0 : 1;
  if (po.po_status === 'Fully Received' || po.po_status === 'Closed') return Number(po.po_id) % 4 === 0 ? 2 : 1;
  return 0;
}

function warehouseFor(category, status) {
  if (status === 'Rejected' || status === 'Under Inspection') return 'QA Hold Area';
  if (['Electrical Components', 'Electronic Components', 'Insulation Materials', 'Core Components', 'Magnetic Components'].includes(category)) return 'Electrical Store';
  if (['Mechanical Components', 'Bearings', 'Sealing Components', 'Fasteners'].includes(category)) return 'Mechanical Store';
  if (category === 'Consumables') return 'Consumables Store';
  if (category === 'Packaging Materials' || category === 'Identification & Documentation') return 'Packaging Store';
  return 'Raw Material Store';
}

function requiresInspection(category, poValue, index) {
  if (poValue > 500000) return 'Yes';
  if (['Core Components', 'Electrical Components', 'Electronic Components', 'Bearings', 'Insulation Materials', 'Magnetic Components', 'Mechanical Components'].includes(category)) return 'Yes';
  if (['Consumables', 'Packaging Materials', 'Identification & Documentation'].includes(category)) return index % 3 === 0 ? 'Yes' : 'No';
  return index % 2 === 0 ? 'Yes' : 'No';
}

function grnStatus(poStatus, inspectionRequired, index) {
  if (poStatus === 'Closed') return index % 5 === 0 ? 'Closed' : 'Accepted';
  if (poStatus === 'Fully Received') return index % 9 === 0 ? 'Partially Accepted' : 'Accepted';
  if (poStatus === 'Partially Received') return index % 6 === 0 ? 'Under Inspection' : 'Partially Accepted';
  if (poStatus === 'Issued') {
    if (index % 11 === 0) return 'Rejected';
    return inspectionRequired === 'Yes' ? 'Under Inspection' : 'Received';
  }
  return 'Draft';
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
    SELECT
      po.po_id,
      po.po_number,
      po.vendor_id,
      po.po_date,
      po.expected_delivery_date,
      po.total_po_amount,
      po.po_status,
      COALESCE(SUBSTRING_INDEX(GROUP_CONCAT(im.category ORDER BY poi.line_total DESC SEPARATOR ','), ',', 1), 'Mechanical Components') AS top_category
    FROM purchase_order po
    LEFT JOIN purchase_order_items poi ON poi.po_id = po.po_id
    LEFT JOIN item_master im ON im.item_id = poi.item_id
    WHERE po.po_status IN ('Issued', 'Partially Received', 'Fully Received', 'Closed')
      AND po.approval_status = 'Approved'
    GROUP BY po.po_id, po.po_number, po.vendor_id, po.po_date, po.expected_delivery_date, po.total_po_amount, po.po_status
    ORDER BY po.po_date, po.po_id
  `);
  const [employees] = await connection.query(`
    SELECT employee_id
    FROM employee_master
    WHERE department_id IN (2, 3, 4, 5, 6)
    ORDER BY employee_id
  `);
  await connection.end();

  if (!purchaseOrders.length || !employees.length) {
    throw new Error('Approved purchase orders and receiving employees are required before generating goods receipts.');
  }

  const rows = [];
  let grnId = 1;

  for (const po of purchaseOrders) {
    const count = receiptCountForPo(po);
    for (let receiptIndex = 0; receiptIndex < count; receiptIndex += 1) {
      const poDate = dateOnly(po.po_date);
      const baseDeliveryDate = dateOnly(po.expected_delivery_date);
      const receivedDate = addDays(baseDeliveryDate, receiptIndex + ((Number(po.po_id) + receiptIndex) % 5) - 2);
      const safeReceivedDate = receivedDate < poDate ? addDays(poDate, 2 + receiptIndex) : receivedDate;
      const inspectionRequired = requiresInspection(po.top_category, Number(po.total_po_amount), grnId);
      const status = grnStatus(po.po_status, inspectionRequired, grnId);
      const finalInspectionRequired = status === 'Rejected' ? 'Yes' : inspectionRequired;
      const warehouse = warehouseFor(po.top_category, status);
      const invoiceDate = addDays(safeReceivedDate, -(Number(po.po_id) % 4));

      rows.push({
        grn_id: grnId,
        grn_number: grnNumber(safeReceivedDate, grnId - 1),
        po_id: po.po_id,
        vendor_id: po.vendor_id,
        received_date: safeReceivedDate,
        invoice_number: `INV-${po.po_number.slice(2)}-${String(receiptIndex + 1).padStart(2, '0')}`,
        invoice_date: invoiceDate,
        delivery_challan_number: `DC-${po.po_number.slice(2)}-${String(receiptIndex + 1).padStart(2, '0')}`,
        received_by: employees[(grnId + receiptIndex) % employees.length].employee_id,
        warehouse_location: warehouse,
        inspection_required: finalInspectionRequired,
        grn_status: status,
        remarks: `${status} receipt for ${po.top_category} against ${po.po_number}`,
        created_at: `${safeReceivedDate} 09:${String((grnId * 5) % 60).padStart(2, '0')}:00`,
        updated_at: `${safeReceivedDate} 10:${String((grnId * 5) % 60).padStart(2, '0')}:00`,
      });
      grnId += 1;
    }
  }

  const targetRows = 300;
  let sourceIndex = 0;
  while (rows.length < targetRows) {
    const po = purchaseOrders[sourceIndex % purchaseOrders.length];
    if (!['Issued', 'Partially Received', 'Fully Received', 'Closed'].includes(po.po_status)) {
      sourceIndex += 1;
      continue;
    }
    const poDate = dateOnly(po.po_date);
    const safeReceivedDate = addDays(dateOnly(po.expected_delivery_date), 4 + (sourceIndex % 7));
    const inspectionRequired = requiresInspection(po.top_category, Number(po.total_po_amount), grnId);
    const status = sourceIndex % 13 === 0 ? 'Rejected' : (inspectionRequired === 'Yes' ? 'Under Inspection' : 'Received');
    rows.push({
      grn_id: grnId,
      grn_number: grnNumber(safeReceivedDate, grnId - 1),
      po_id: po.po_id,
      vendor_id: po.vendor_id,
      received_date: safeReceivedDate < poDate ? addDays(poDate, 3) : safeReceivedDate,
      invoice_number: `INV-${po.po_number.slice(2)}-EX${String(grnId).padStart(3, '0')}`,
      invoice_date: addDays(safeReceivedDate, -(sourceIndex % 3)),
      delivery_challan_number: `DC-${po.po_number.slice(2)}-EX${String(grnId).padStart(3, '0')}`,
      received_by: employees[(grnId + sourceIndex) % employees.length].employee_id,
      warehouse_location: warehouseFor(po.top_category, status),
      inspection_required: status === 'Rejected' ? 'Yes' : inspectionRequired,
      grn_status: status,
      remarks: `${status} split receipt for ${po.top_category} against ${po.po_number}`,
      created_at: `${safeReceivedDate} 11:${String((grnId * 7) % 60).padStart(2, '0')}:00`,
      updated_at: `${safeReceivedDate} 12:${String((grnId * 7) % 60).padStart(2, '0')}:00`,
    });
    grnId += 1;
    sourceIndex += 1;
  }

  const finalRows = rows.slice(0, targetRows);
  const insertColumns = [
    'grn_id',
    'grn_number',
    'po_id',
    'vendor_id',
    'received_date',
    'invoice_number',
    'invoice_date',
    'delivery_challan_number',
    'received_by',
    'warehouse_location',
    'inspection_required',
    'grn_status',
    'remarks',
    'created_at',
    'updated_at',
  ];

  const sql = [
    '-- Generated by backend/scripts/generateGoodsReceiptsSeed.js',
    '-- Loads 300 goods receipt header rows from live ERP purchase order data.',
    '',
    'INSERT INTO goods_receipt',
    `  (${insertColumns.join(', ')})`,
    'VALUES',
    finalRows.map((row) => `  (${insertColumns.map((column) => sqlString(row[column])).join(', ')})`).join(',\n') + ';',
    '',
  ].join('\n');

  const csv = [
    insertColumns.join(','),
    ...finalRows.map((row) => insertColumns.map((column) => csvCell(row[column])).join(',')),
    '',
  ].join('\n');

  fs.writeFileSync(sqlOutputPath, sql);
  fs.writeFileSync(csvOutputPath, csv);

  const invalidDates = finalRows.filter((row) => row.invoice_date > row.received_date);
  const rejectedWithoutInspection = finalRows.filter((row) => row.grn_status === 'Rejected' && row.inspection_required !== 'Yes');
  console.log(`Generated ${finalRows.length} goods receipt rows.`);
  console.log(`SQL: ${sqlOutputPath}`);
  console.log(`CSV: ${csvOutputPath}`);
  console.log(`Validation invalidDates=${invalidDates.length} rejectedWithoutInspection=${rejectedWithoutInspection.length}`);
  console.table(finalRows.slice(0, 10).map((row) => ({
    grn_id: row.grn_id,
    grn_number: row.grn_number,
    po_id: row.po_id,
    vendor_id: row.vendor_id,
    received_date: row.received_date,
    invoice_date: row.invoice_date,
    warehouse_location: row.warehouse_location,
    inspection_required: row.inspection_required,
    grn_status: row.grn_status,
  })));
}

await main();
