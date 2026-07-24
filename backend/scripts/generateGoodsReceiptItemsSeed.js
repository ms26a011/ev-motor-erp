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

const sqlOutputPath = path.join(backendRoot, 'sql', 'seed_goods_receipt_items.sql');
const csvOutputPath = path.join(projectRoot, 'goods_receipt_items.csv');

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

function isShelfLifeItem(item) {
  return ['Consumables', 'Packaging Materials'].includes(item.category)
    || /adhesive|oil|grease|varnish|solvent|flux|sealant|paint|tape|bag|gel/i.test(item.item_name);
}

function storageLocation(category, qualityStatus) {
  if (qualityStatus === 'Rejected') return 'REJECT-BAY';
  if (qualityStatus === 'Pending Inspection') return 'QA-HOLD';
  if (['Electrical Components', 'Electronic Components', 'Insulation Materials', 'Core Components', 'Magnetic Components'].includes(category)) return 'ELEC-A1';
  if (['Mechanical Components', 'Bearings', 'Sealing Components', 'Fasteners'].includes(category)) return 'MECH-B1';
  if (category === 'Consumables') return 'CONS-C1';
  if (category === 'Packaging Materials' || category === 'Identification & Documentation') return 'PACK-D1';
  return Number(category.length) % 2 === 0 ? 'RM-A1' : 'RM-B2';
}

function rejectionReason(category, index) {
  const reasons = [
    'Dimensional mismatch found during inward inspection',
    'Surface damage observed on received material',
    'Certificate of conformity mismatch',
    'Batch failed electrical continuity test',
    'Packaging damaged and material contaminated',
    'Shelf-life or date-code nonconformance',
  ];
  if (category === 'Bearings') return 'Bearing noise or free-play outside tolerance';
  if (category === 'Electrical Components' || category === 'Electronic Components') return 'Electrical parameter deviation found';
  return reasons[index % reasons.length];
}

function qualityForGrn(grn, index) {
  if (grn.grn_status === 'Rejected') return 'Rejected';
  if (grn.grn_status === 'Under Inspection') return 'Pending Inspection';
  if (grn.grn_status === 'Partially Accepted') return index % 3 === 0 ? 'Partially Accepted' : 'Accepted';
  if (grn.grn_status === 'Received' && grn.inspection_required === 'Yes') return 'Pending Inspection';
  if (grn.grn_status === 'Received') return 'Accepted';
  if (grn.grn_status === 'Closed' || grn.grn_status === 'Accepted') return index % 11 === 0 ? 'Partially Accepted' : 'Accepted';
  return 'Pending Inspection';
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
  });

  const [grns] = await connection.query(`
    SELECT grn_id, grn_number, po_id, received_date, inspection_required, grn_status
    FROM goods_receipt
    WHERE grn_status IN ('Received', 'Under Inspection', 'Accepted', 'Partially Accepted', 'Rejected', 'Closed')
    ORDER BY grn_id
  `);
  const [poItems] = await connection.query(`
    SELECT poi.po_item_id, poi.po_id, poi.item_id, poi.ordered_quantity, poi.pending_quantity, poi.uom,
           poi.unit_price, im.item_code, im.item_name, im.category
    FROM purchase_order_items poi
    JOIN item_master im ON im.item_id = poi.item_id
    WHERE poi.pending_quantity > 0
      AND poi.line_status IN ('Ordered', 'Partially Received', 'Cancelled')
    ORDER BY poi.po_id, poi.po_item_id
  `);
  await connection.end();

  const poItemsByPo = poItems.reduce((acc, item) => {
    acc[item.po_id] = acc[item.po_id] || [];
    acc[item.po_id].push(item);
    return acc;
  }, {});

  const rows = [];
  let grnItemId = 1;

  for (const grn of grns) {
    const candidates = poItemsByPo[grn.po_id] || [];
    if (!candidates.length) continue;
    const lineCount = Math.min(5, Math.max(1, ((Number(grn.grn_id) + candidates.length) % 5) + 1));
    for (let index = 0; index < lineCount; index += 1) {
      const item = candidates[(Number(grn.grn_id) + index) % candidates.length];
      const qualityStatus = qualityForGrn(grn, grnItemId + index);
      const pending = Number(item.pending_quantity);
      const receivedQuantity = round3(Math.max(0.001, pending * (0.2 + ((grnItemId + index) % 5) * 0.12)));
      const cappedReceived = Math.min(pending, receivedQuantity);
      let acceptedQuantity = 0;
      let rejectedQuantity = 0;
      let rejection = null;

      if (qualityStatus === 'Accepted') {
        acceptedQuantity = cappedReceived;
      } else if (qualityStatus === 'Partially Accepted') {
        rejectedQuantity = round3(Math.max(0.001, cappedReceived * (0.05 + ((index % 3) * 0.04))));
        acceptedQuantity = round3(cappedReceived - rejectedQuantity);
        rejection = rejectionReason(item.category, grnItemId);
      } else if (qualityStatus === 'Rejected') {
        rejectedQuantity = cappedReceived;
        rejection = rejectionReason(item.category, grnItemId);
      }

      const receivedDate = dateOnly(grn.received_date);
      const manufacturingDate = addDays(receivedDate, -(30 + ((grnItemId + index) % 150)));
      const expiryDate = isShelfLifeItem(item)
        ? addDays(manufacturingDate, 180 + ((grnItemId + index) % 420))
        : null;

      rows.push({
        grn_item_id: grnItemId,
        grn_id: grn.grn_id,
        po_item_id: item.po_item_id,
        item_id: item.item_id,
        ordered_quantity: Number(item.ordered_quantity).toFixed(3),
        received_quantity: cappedReceived.toFixed(3),
        accepted_quantity: acceptedQuantity.toFixed(3),
        rejected_quantity: rejectedQuantity.toFixed(3),
        uom: item.uom,
        unit_price: Number(item.unit_price).toFixed(6),
        batch_number: `B${item.item_code}-${receivedDate.replace(/-/g, '')}-${String(grnItemId).padStart(4, '0')}`,
        manufacturing_date: manufacturingDate,
        expiry_date: expiryDate,
        quality_status: qualityStatus,
        rejection_reason: rejection,
        storage_location: storageLocation(item.category, qualityStatus),
        remarks: `${qualityStatus} receipt for ${item.item_name} against ${grn.grn_number}`,
        created_at: `${receivedDate} 13:${String((grnItemId * 3) % 60).padStart(2, '0')}:00`,
        updated_at: `${receivedDate} 14:${String((grnItemId * 3) % 60).padStart(2, '0')}:00`,
      });
      grnItemId += 1;
      if (rows.length >= 300) break;
    }
    if (rows.length >= 300) break;
  }

  if (rows.length < 300) {
    throw new Error(`Only generated ${rows.length} rows; expected at least 300.`);
  }

  const insertColumns = [
    'grn_item_id',
    'grn_id',
    'po_item_id',
    'item_id',
    'ordered_quantity',
    'received_quantity',
    'accepted_quantity',
    'rejected_quantity',
    'uom',
    'unit_price',
    'batch_number',
    'manufacturing_date',
    'expiry_date',
    'quality_status',
    'rejection_reason',
    'storage_location',
    'remarks',
    'created_at',
    'updated_at',
  ];

  const sql = [
    '-- Generated by backend/scripts/generateGoodsReceiptItemsSeed.js',
    '-- Loads 300 goods receipt item rows from live GRN and purchase order item data.',
    '',
    'INSERT INTO goods_receipt_items',
    `  (${insertColumns.join(', ')})`,
    'VALUES',
    rows.map((row) => `  (${insertColumns.map((column) => sqlString(row[column])).join(', ')})`).join(',\n') + ';',
    '',
  ].join('\n');

  const csvColumns = [
    ...insertColumns.slice(0, 10),
    'line_value',
    ...insertColumns.slice(10),
  ];
  const csv = [
    csvColumns.join(','),
    ...rows.map((row) => csvColumns.map((column) => {
      const value = column === 'line_value'
        ? round2(Number(row.accepted_quantity) * Number(row.unit_price)).toFixed(2)
        : row[column];
      return csvCell(value);
    }).join(',')),
    '',
  ].join('\n');

  fs.writeFileSync(sqlOutputPath, sql);
  fs.writeFileSync(csvOutputPath, csv);

  const invalidQuantities = rows.filter((row) => {
    const sum = Number(row.accepted_quantity) + Number(row.rejected_quantity);
    return row.quality_status === 'Pending Inspection'
      ? sum !== 0
      : Math.abs(sum - Number(row.received_quantity)) > 0.001;
  });
  const rejectedWithoutReason = rows.filter((row) => Number(row.rejected_quantity) > 0 && !row.rejection_reason);
  const acceptedWithReason = rows.filter((row) => Number(row.rejected_quantity) === 0 && row.rejection_reason);
  const missingExpiry = rows.filter((row) => row.expiry_date === null && /CON|PKG|adhesive|oil|grease|varnish|solvent|flux|sealant|tape|bag|gel/i.test(row.batch_number));

  console.log(`Generated ${rows.length} goods receipt item rows.`);
  console.log(`SQL: ${sqlOutputPath}`);
  console.log(`CSV: ${csvOutputPath}`);
  console.log(`Validation invalidQuantities=${invalidQuantities.length} rejectedWithoutReason=${rejectedWithoutReason.length} acceptedWithReason=${acceptedWithReason.length} missingExpiry=${missingExpiry.length}`);
  console.table(rows.slice(0, 10).map((row) => ({
    grn_item_id: row.grn_item_id,
    grn_id: row.grn_id,
    po_item_id: row.po_item_id,
    item_id: row.item_id,
    received_quantity: row.received_quantity,
    accepted_quantity: row.accepted_quantity,
    rejected_quantity: row.rejected_quantity,
    quality_status: row.quality_status,
    storage_location: row.storage_location,
  })));
}

await main();
