import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

const prCsvPath = path.join(projectRoot, 'purchase_requisition.csv');
const itemCsvPath = path.join(projectRoot, 'item_master_import.csv');
const sqlOutputPath = path.join(projectRoot, 'backend', 'sql', 'seed_purchase_requisition_items.sql');
const csvOutputPath = path.join(projectRoot, 'purchase_requisition_items.csv');

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
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values, index) => ({
    __rowNumber: index + 2,
    ...Object.fromEntries(headers.map((header, columnIndex) => [header, values[columnIndex] ?? ''])),
  }));
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

const quantityRules = [
  { test: /Consumables/, min: 600, max: 12000 },
  { test: /Insulation Materials/, min: 800, max: 18000 },
  { test: /Fasteners/, min: 500, max: 9000 },
  { test: /Packaging Materials/, min: 200, max: 3000 },
  { test: /Electrical Components/, min: 80, max: 2200 },
  { test: /Electronic Components/, min: 40, max: 900 },
  { test: /Bearings/, min: 60, max: 800 },
  { test: /Core Components/, min: 30, max: 600 },
  { test: /Magnetic Components/, min: 150, max: 2400 },
  { test: /Mechanical Components/, min: 40, max: 900 },
  { test: /Finished Goods/, min: 5, max: 80 },
];

const budgetByCategory = {
  Bearings: 'PRD-BRG-410',
  'Consumables': 'MNT-CON-520',
  'Core Components': 'PRD-CORE-430',
  'Electrical Components': 'PRD-ELE-440',
  'Electronic Components': 'ENG-ELC-450',
  Fasteners: 'PRD-FAS-460',
  'Finished Goods': 'SLS-FG-610',
  'Identification & Documentation': 'QA-ID-560',
  'Insulation Materials': 'PRD-INS-470',
  'Magnetic Components': 'PRD-MAG-480',
  'Mechanical Components': 'PRD-MEC-490',
  'Packaging Materials': 'LOG-PKG-530',
  'Sealing Components': 'PRD-SEA-500',
};

const itemReasons = [
  'Batch production requirement',
  'Line-side replenishment',
  'Safety stock top-up',
  'Preventive maintenance support',
  'Customer order material coverage',
  'High demand month planning',
  'Stockout risk mitigation',
];

function lineCountForPr(index) {
  if (index < 10) return 5;
  if (index < 25) return 4;
  if (index < 45) return 3;
  if (index < 70) return 2;
  return 1;
}

function itemPoolForPr(pr, items) {
  const remarks = pr.remarks.toLowerCase();
  if (remarks.includes('fastener')) return items.filter((item) => item.category === 'Fasteners');
  if (remarks.includes('packaging')) return items.filter((item) => item.category === 'Packaging Materials');
  if (remarks.includes('urgent') || remarks.includes('shortage')) {
    return items.filter((item) => ['Core Components', 'Electrical Components', 'Electronic Components', 'Bearings', 'Insulation Materials', 'Magnetic Components'].includes(item.category));
  }
  if (remarks.includes('safety')) {
    return items.filter((item) => ['Consumables', 'Fasteners', 'Bearings', 'Sealing Components', 'Packaging Materials'].includes(item.category));
  }
  return items;
}

function requestedQuantity(item, sequence) {
  const rule = quantityRules.find((entry) => entry.test.test(item.category)) || { min: 20, max: 500 };
  const span = rule.max - rule.min;
  const stepped = rule.min + ((sequence * 37 + item.item_id * 19) % (span + 1));
  const rounded = item.uom === 'kg' || item.uom === 'ml' || item.uom === 'g' || item.uom === 'm'
    ? Math.round(stepped / 5) * 5
    : Math.round(stepped);
  return Math.max(rule.min, rounded);
}

function stockSnapshot(item, pr, sequence) {
  const reorder = Number(item.reorder_level);
  const urgent = /urgent|shortage/i.test(pr.remarks);
  const stockRatio = urgent
    ? [0.18, 0.35, 0.62][sequence % 3]
    : [0.55, 0.85, 1.1, 1.35, 1.8][(sequence + item.item_id) % 5];
  const stock = Math.max(0, Math.round(reorder * stockRatio));
  return { reorder, stock };
}

function priorityFor({ stock, reorder, pr, item }) {
  if (stock < reorder * 0.45 || /urgent|shortage/i.test(pr.remarks)) return 'Urgent';
  if (stock < reorder || item.criticality === 'Critical') return 'High';
  if (stock < reorder * 1.5 || item.criticality === 'Semi Critical') return 'Medium';
  return 'Low';
}

function itemStatus(prStatus, sequence) {
  if (prStatus === 'Converted to PO') return 'Converted to PO';
  if (prStatus === 'Rejected') return 'Rejected';
  if (prStatus === 'Approved') return sequence % 4 === 0 ? 'Pending' : 'Approved';
  if (prStatus === 'Draft' || prStatus === 'Submitted') return 'Pending';
  return 'Pending';
}

const purchaseRequisitions = parseCsv(fs.readFileSync(prCsvPath, 'utf8'));
const items = parseCsv(fs.readFileSync(itemCsvPath, 'utf8')).map((item, index) => ({
  item_id: index + 1,
  item_code: item.item_code,
  item_name: item.item_name,
  category: item.category,
  uom: item.uom,
  unit_cost: Number(item.unit_cost),
  reorder_level: Number(item.reorder_level),
  criticality: item.criticality,
}));

const rows = [];
let prItemId = 1;

purchaseRequisitions.forEach((pr, prIndex) => {
  const pool = itemPoolForPr(pr, items);
  const count = lineCountForPr(prIndex);
  const usedItemIds = new Set();

  for (let lineIndex = 0; lineIndex < count; lineIndex += 1) {
    let item = pool[(prIndex * 11 + lineIndex * 7) % pool.length];
    let attempts = 0;
    while (usedItemIds.has(item.item_id) && attempts < pool.length) {
      attempts += 1;
      item = pool[(prIndex * 11 + lineIndex * 7 + attempts) % pool.length];
    }
    usedItemIds.add(item.item_id);

    const sequence = prIndex + lineIndex + 1;
    const { reorder, stock } = stockSnapshot(item, pr, sequence);
    const quantity = requestedQuantity(item, sequence);
    const priority = priorityFor({ stock, reorder, pr, item });
    const requiredDate = pr.required_date && pr.required_date >= pr.pr_date
      ? pr.required_date
      : addDays(pr.pr_date, 7 + (sequence % 14));

    rows.push({
      pr_item_id: prItemId,
      pr_id: Number(pr.pr_id),
      item_id: item.item_id,
      requested_quantity: quantity.toFixed(3),
      uom: item.uom,
      required_date: requiredDate,
      estimated_unit_cost: item.unit_cost.toFixed(2),
      estimated_total_cost: (quantity * item.unit_cost).toFixed(2),
      priority,
      reason_for_requirement: itemReasons[sequence % itemReasons.length],
      current_stock_quantity: stock.toFixed(3),
      reorder_level: reorder.toFixed(3),
      budget_code: budgetByCategory[item.category] || 'PRD-MAT-400',
      remarks: `${item.category} requirement for ${pr.remarks.toLowerCase()}`,
      status: itemStatus(pr.status, sequence),
      created_at: `${pr.pr_date} 09:${String((sequence * 3) % 60).padStart(2, '0')}:00`,
      updated_at: `${pr.pr_date} 09:${String(((sequence * 3) + 5) % 60).padStart(2, '0')}:00`,
    });
    prItemId += 1;
  }
});

const insertColumns = [
  'pr_item_id',
  'pr_id',
  'item_id',
  'requested_quantity',
  'uom',
  'required_date',
  'estimated_unit_cost',
  'priority',
  'reason_for_requirement',
  'current_stock_quantity',
  'reorder_level',
  'budget_code',
  'remarks',
  'status',
  'created_at',
  'updated_at',
];

const sql = [
  '-- Generated by backend/scripts/generatePurchaseRequisitionItemsSeed.js',
  '-- Loads 300 purchase requisition item rows from existing PR and item master CSV context.',
  '',
  'INSERT INTO purchase_requisition_items',
  `  (${insertColumns.join(', ')})`,
  'VALUES',
  rows.map((row) => `  (${insertColumns.map((column) => sqlString(row[column])).join(', ')})`).join(',\n') + ';',
  '',
].join('\n');

const csvColumns = [
  'pr_item_id',
  'pr_id',
  'item_id',
  'requested_quantity',
  'uom',
  'required_date',
  'estimated_unit_cost',
  'estimated_total_cost',
  'priority',
  'reason_for_requirement',
  'current_stock_quantity',
  'reorder_level',
  'budget_code',
  'remarks',
  'status',
  'created_at',
  'updated_at',
];
const csv = [
  csvColumns.join(','),
  ...rows.map((row) => csvColumns.map((column) => csvCell(row[column])).join(',')),
  '',
].join('\n');

fs.writeFileSync(sqlOutputPath, sql);
fs.writeFileSync(csvOutputPath, csv);

const invalidStockPriority = rows.filter((row) => Number(row.current_stock_quantity) < Number(row.reorder_level) && !['High', 'Urgent'].includes(row.priority));
const invalidQuantity = rows.filter((row) => Number(row.requested_quantity) <= 0);
const invalidCost = rows.filter((row) => Number(row.estimated_total_cost) !== Number((Number(row.requested_quantity) * Number(row.estimated_unit_cost)).toFixed(2)));

console.log(`Generated ${rows.length} purchase requisition item rows.`);
console.log(`SQL: ${sqlOutputPath}`);
console.log(`CSV: ${csvOutputPath}`);
console.log(`Validation invalidQuantity=${invalidQuantity.length} invalidCost=${invalidCost.length} invalidStockPriority=${invalidStockPriority.length}`);
console.table(rows.slice(0, 10).map((row) => ({
  pr_item_id: row.pr_item_id,
  pr_id: row.pr_id,
  item_id: row.item_id,
  requested_quantity: row.requested_quantity,
  uom: row.uom,
  required_date: row.required_date,
  estimated_total_cost: row.estimated_total_cost,
  priority: row.priority,
  stock: row.current_stock_quantity,
  reorder: row.reorder_level,
  status: row.status,
})));
