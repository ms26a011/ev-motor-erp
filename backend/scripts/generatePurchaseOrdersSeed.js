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

const sqlOutputPath = path.join(backendRoot, 'sql', 'seed_purchase_order.sql');
const csvOutputPath = path.join(projectRoot, 'purchase_order.csv');

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

const billingAddress = 'EV Motor Manufacturing Pvt Ltd, SIPCOT Industrial Park, Hosur, Tamil Nadu 635126';
const shippingAddresses = [
  'Raw Material Store, EV Motor Manufacturing Pvt Ltd, Hosur Plant',
  'Stator Shop, EV Motor Manufacturing Pvt Ltd, Hosur Plant',
  'Rotor Shop, EV Motor Manufacturing Pvt Ltd, Hosur Plant',
  'Assembly Shop, EV Motor Manufacturing Pvt Ltd, Hosur Plant',
  'Maintenance Store, EV Motor Manufacturing Pvt Ltd, Hosur Plant',
];

const paymentTerms = [
  '30 days credit from invoice date',
  '45 days credit after GRN acceptance',
  '50% advance, balance against dispatch',
  '15 days after material acceptance',
  'Immediate payment against proforma invoice',
];

const deliveryTerms = [
  'FOR Hosur plant, freight included',
  'Ex-works supplier warehouse',
  'Door delivery to raw material store',
  'Freight extra at actuals',
  'Delivery in staggered lots as per production plan',
];

const directRemarks = [
  'Direct PO for tool calibration and production support services',
  'Direct PO for urgent MRO consumables',
  'Direct PO for packaging replenishment',
  'Direct PO for maintenance spares',
  'Direct PO for supplier development sample lot',
];

const vendorTypeByCategory = {
  Bearings: ['Bearings'],
  'Consumables': ['Chemicals', 'Consumables', 'Industrial Supplies'],
  'Core Components': ['Electrical Steel'],
  'Electrical Components': ['Copper Wire', 'Electrical Components'],
  'Electronic Components': ['Electronics'],
  Fasteners: ['Fasteners'],
  'Finished Goods': ['Mechanical Components', 'Electrical Components'],
  'Identification & Documentation': ['Packaging', 'Printing'],
  'Insulation Materials': ['Insulation'],
  'Magnetic Components': ['Magnets'],
  'Mechanical Components': ['Mechanical Components'],
  'Packaging Materials': ['Packaging'],
  'Sealing Components': ['Seals', 'Mechanical Components'],
};

function chooseVendor(vendors, category, index) {
  const preferredTypes = vendorTypeByCategory[category] || [];
  let pool = vendors.filter((vendor) => preferredTypes.some((type) => vendor.vendor_type.toLowerCase().includes(type.toLowerCase())));
  if (pool.length === 0) pool = vendors;
  return pool[index % pool.length];
}

function poStatus(index, amount, direct) {
  if (direct && index % 5 === 0) return 'Draft';
  const statuses = ['Issued', 'Partially Received', 'Fully Received', 'Closed', 'Issued', 'Partially Received', 'Fully Received', 'Cancelled'];
  if (amount > 1200000 && index % 6 === 0) return 'Issued';
  return statuses[index % statuses.length];
}

function approvalStatus(status, amount, index) {
  if (status === 'Draft') return 'Pending';
  if (status === 'Cancelled') return index % 2 === 0 ? 'Rejected' : 'Pending';
  if (status === 'Closed' || status === 'Fully Received' || status === 'Partially Received') return 'Approved';
  if (amount > 1500000 && index % 4 === 0) return 'Pending';
  return index % 9 === 0 ? 'Pending' : 'Approved';
}

function amountFor(baseAmount, index, direct) {
  const directBase = [65000, 95000, 180000, 320000, 520000][index % 5];
  const subtotal = direct
    ? directBase + ((index * 17321) % 90000)
    : Math.max(25000, Math.round((Number(baseAmount || 0) * (0.35 + ((index % 5) * 0.16))) / 100) * 100);
  const tax = Math.round(subtotal * 0.18 * 100) / 100;
  const freight = Math.round((1500 + (subtotal * (0.006 + ((index % 3) * 0.002)))) * 100) / 100;
  const discount = index % 7 === 0 ? Math.round(subtotal * 0.015 * 100) / 100 : 0;
  const total = Math.round((subtotal + tax + freight - discount) * 100) / 100;
  return { subtotal, tax, freight, discount, total };
}

function poNumber(dateString, index) {
  return `PO${dateString.replace(/-/g, '')}${String(index + 1).padStart(4, '0')}`;
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
  });

  const [vendors] = await connection.query('SELECT vendor_id, vendor_code, vendor_name, vendor_type, lead_time_days FROM vendor_master WHERE status = "Active" ORDER BY vendor_id');
  const [employees] = await connection.query('SELECT employee_id FROM employee_master ORDER BY employee_id');
  const [prs] = await connection.query(`
    SELECT pr.pr_id, pr.pr_number, pr.department_id, pr.pr_date, pr.required_date, pr.status,
           COALESCE(SUM(pri.estimated_total_cost), 0) AS pr_value,
           COALESCE(SUBSTRING_INDEX(GROUP_CONCAT(im.category ORDER BY pri.estimated_total_cost DESC SEPARATOR ','), ',', 1), 'Mechanical Components') AS top_category
      FROM purchase_requisition pr
      LEFT JOIN purchase_requisition_items pri ON pri.pr_id = pr.pr_id
      LEFT JOIN item_master im ON im.item_id = pri.item_id
     WHERE pr.status IN ('Approved', 'Converted to PO')
     GROUP BY pr.pr_id, pr.pr_number, pr.department_id, pr.pr_date, pr.required_date, pr.status
     ORDER BY pr.pr_date, pr.pr_id
  `);
  const [departments] = await connection.query('SELECT department_id FROM department_master ORDER BY department_id');
  await connection.end();

  if (!vendors.length || !employees.length || !prs.length || !departments.length) {
    throw new Error('Vendor, employee, department, and approved PR data are required before generating purchase orders.');
  }

  const approverIds = employees.map((employee) => employee.employee_id);
  const rows = [];
  const prBasedCount = 270;
  const directCount = 30;

  for (let index = 0; index < prBasedCount; index += 1) {
    const pr = prs[index % prs.length];
    const vendor = chooseVendor(vendors, pr.top_category, index);
    const poDate = addDays(dateOnly(pr.pr_date), 1 + (index % 5));
    const deliveryDate = addDays(poDate, Number(vendor.lead_time_days || 12) + 3 + (index % 9));
    const amounts = amountFor(pr.pr_value, index, false);
    const status = poStatus(index, amounts.total, false);
    const approval = approvalStatus(status, amounts.total, index);
    const approved = approval === 'Approved';

    rows.push({
      po_id: index + 1,
      po_number: poNumber(poDate, index),
      pr_id: pr.pr_id,
      vendor_id: vendor.vendor_id,
      department_id: pr.department_id,
      po_date: poDate,
      expected_delivery_date: deliveryDate,
      payment_terms: paymentTerms[index % paymentTerms.length],
      delivery_terms: deliveryTerms[index % deliveryTerms.length],
      billing_address: billingAddress,
      shipping_address: shippingAddresses[Number(pr.department_id) % shippingAddresses.length],
      subtotal_amount: amounts.subtotal.toFixed(2),
      tax_amount: amounts.tax.toFixed(2),
      freight_charges: amounts.freight.toFixed(2),
      discount_amount: amounts.discount.toFixed(2),
      total_po_amount: amounts.total.toFixed(2),
      currency: 'INR',
      po_status: status,
      approval_status: approval,
      approved_by: approved ? approverIds[index % approverIds.length] : null,
      approved_date: approved ? addDays(poDate, index % 3) : null,
      remarks: `PR-based procurement for ${pr.top_category} from ${pr.pr_number}`,
      created_at: `${poDate} 10:${String((index * 7) % 60).padStart(2, '0')}:00`,
      updated_at: `${poDate} 11:${String((index * 7) % 60).padStart(2, '0')}:00`,
    });
  }

  for (let offset = 0; offset < directCount; offset += 1) {
    const index = prBasedCount + offset;
    const vendor = vendors[(offset * 3) % vendors.length];
    const department = departments[offset % departments.length];
    const poDate = addDays('2025-05-01', offset * 11);
    const amounts = amountFor(0, offset, true);
    const status = poStatus(offset, amounts.total, true);
    const approval = approvalStatus(status, amounts.total, offset);
    const approved = approval === 'Approved';

    rows.push({
      po_id: index + 1,
      po_number: poNumber(poDate, index),
      pr_id: null,
      vendor_id: vendor.vendor_id,
      department_id: department.department_id,
      po_date: poDate,
      expected_delivery_date: addDays(poDate, Number(vendor.lead_time_days || 12) + 5 + (offset % 6)),
      payment_terms: paymentTerms[(offset + 2) % paymentTerms.length],
      delivery_terms: deliveryTerms[(offset + 1) % deliveryTerms.length],
      billing_address: billingAddress,
      shipping_address: shippingAddresses[offset % shippingAddresses.length],
      subtotal_amount: amounts.subtotal.toFixed(2),
      tax_amount: amounts.tax.toFixed(2),
      freight_charges: amounts.freight.toFixed(2),
      discount_amount: amounts.discount.toFixed(2),
      total_po_amount: amounts.total.toFixed(2),
      currency: 'INR',
      po_status: status,
      approval_status: approval,
      approved_by: approved ? approverIds[index % approverIds.length] : null,
      approved_date: approved ? addDays(poDate, offset % 3) : null,
      remarks: directRemarks[offset % directRemarks.length],
      created_at: `${poDate} 12:${String((offset * 5) % 60).padStart(2, '0')}:00`,
      updated_at: `${poDate} 13:${String((offset * 5) % 60).padStart(2, '0')}:00`,
    });
  }

  const insertColumns = [
    'po_id',
    'po_number',
    'pr_id',
    'vendor_id',
    'department_id',
    'po_date',
    'expected_delivery_date',
    'payment_terms',
    'delivery_terms',
    'billing_address',
    'shipping_address',
    'subtotal_amount',
    'tax_amount',
    'freight_charges',
    'discount_amount',
    'currency',
    'po_status',
    'approval_status',
    'approved_by',
    'approved_date',
    'remarks',
    'created_at',
    'updated_at',
  ];

  const sql = [
    '-- Generated by backend/scripts/generatePurchaseOrdersSeed.js',
    '-- Loads 300 purchase order header rows from live ERP master and requisition data.',
    '',
    'INSERT INTO purchase_order',
    `  (${insertColumns.join(', ')})`,
    'VALUES',
    rows.map((row) => `  (${insertColumns.map((column) => sqlString(row[column])).join(', ')})`).join(',\n') + ';',
    '',
  ].join('\n');

  const csvColumns = [
    'po_id',
    'po_number',
    'pr_id',
    'vendor_id',
    'department_id',
    'po_date',
    'expected_delivery_date',
    'payment_terms',
    'delivery_terms',
    'billing_address',
    'shipping_address',
    'subtotal_amount',
    'tax_amount',
    'freight_charges',
    'discount_amount',
    'total_po_amount',
    'currency',
    'po_status',
    'approval_status',
    'approved_by',
    'approved_date',
    'remarks',
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

  const invalidDelivery = rows.filter((row) => row.expected_delivery_date <= row.po_date);
  const invalidTotals = rows.filter((row) => Number(row.total_po_amount) !== Number((Number(row.subtotal_amount) + Number(row.tax_amount) + Number(row.freight_charges) - Number(row.discount_amount)).toFixed(2)));
  const invalidApprovalDates = rows.filter((row) => row.approved_date && row.approved_date < row.po_date);
  const directRows = rows.filter((row) => row.pr_id === null);

  console.log(`Generated ${rows.length} purchase order rows.`);
  console.log(`Direct POs: ${directRows.length}`);
  console.log(`SQL: ${sqlOutputPath}`);
  console.log(`CSV: ${csvOutputPath}`);
  console.log(`Validation invalidDelivery=${invalidDelivery.length} invalidTotals=${invalidTotals.length} invalidApprovalDates=${invalidApprovalDates.length}`);
  console.table(rows.slice(0, 10).map((row) => ({
    po_id: row.po_id,
    po_number: row.po_number,
    pr_id: row.pr_id,
    vendor_id: row.vendor_id,
    department_id: row.department_id,
    po_date: row.po_date,
    expected_delivery_date: row.expected_delivery_date,
    total_po_amount: row.total_po_amount,
    po_status: row.po_status,
    approval_status: row.approval_status,
  })));
}

await main();
