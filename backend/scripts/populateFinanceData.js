import { pool } from '../src/db.js';

const START = new Date('2025-04-01T00:00:00Z');
const LATEST_INVOICE = new Date('2026-01-30T00:00:00Z');

const VENDOR_INVOICE_COUNT = 5000;
const VENDOR_INVOICE_ITEM_COUNT = 12000;
const VENDOR_PAYMENT_COUNT = 4000;
const CUSTOMER_INVOICE_COUNT = 4500;
const CUSTOMER_INVOICE_ITEM_COUNT = 10000;
const CUSTOMER_RECEIPT_COUNT = 3800;

const money = (value) => Number((Math.round(Number(value) * 100) / 100).toFixed(2));
const dateSql = (date) => {
  const value = new Date(date);
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
};
const addDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};
const financeDate = (index) => {
  const days = Math.floor((LATEST_INVOICE - START) / 86400000) + 1;
  return addDays(START, (index * 3) % days);
};

async function tableIsEmpty(connection, table) {
  const [[row]] = await connection.query(`SELECT COUNT(*) AS row_count FROM ${table}`);
  return Number(row.row_count) === 0;
}

async function firstEmployeeId(connection) {
  const [[row]] = await connection.query('SELECT employee_id FROM employee_master ORDER BY employee_id LIMIT 1');
  if (!row) throw new Error('employee_master has no records.');
  return row.employee_id;
}

async function generateDocNumber(connection, table, column, prefix, docDate, cache) {
  const year = docDate.getUTCFullYear();
  const key = `${table}.${column}.${prefix}.${year}`;
  if (!cache.has(key)) {
    const [[row]] = await connection.query(
      `SELECT ${column} AS doc_no FROM ${table} WHERE ${column} LIKE ? ORDER BY ${column} DESC LIMIT 1`,
      [`${prefix}-${year}-%`],
    );
    const match = row?.doc_no?.match(/(\d+)$/);
    cache.set(key, match ? Number(match[1]) : 0);
  }
  cache.set(key, cache.get(key) + 1);
  return `${prefix}-${year}-${String(cache.get(key)).padStart(5, '0')}`;
}

async function insertMany(connection, table, columns, rows, chunkSize = 1000) {
  if (rows.length === 0) return;
  const columnSql = columns.map((column) => `\`${column}\``).join(', ');
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const placeholders = chunk.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
    await connection.query(
      `INSERT INTO ${table} (${columnSql}) VALUES ${placeholders}`,
      chunk.flat(),
    );
  }
}

async function populateChartOfAccounts(connection, employeeId) {
  if (!(await tableIsEmpty(connection, 'chart_of_accounts'))) {
    console.log('chart_of_accounts already populated. Skipping.');
    return;
  }
  const rows = [
    ['1000', 'Cash', 'Asset', 'Cash and Cash Equivalents', 'Debit', 'Physical cash balance'],
    ['1010', 'Bank', 'Asset', 'Bank and Cash Equivalents', 'Debit', 'Primary operating bank account'],
    ['1100', 'Accounts Receivable', 'Asset', 'Trade Receivables', 'Debit', 'Amounts receivable from customers'],
    ['1200', 'Raw Material Inventory', 'Asset', 'Inventory', 'Debit', 'Raw materials and bought-out components'],
    ['1210', 'Finished Goods Inventory', 'Asset', 'Inventory', 'Debit', 'Finished EV motor inventory'],
    ['1220', 'Work In Process Inventory', 'Asset', 'Inventory', 'Debit', 'WIP inventory in production'],
    ['1300', 'Input GST', 'Asset', 'GST Receivable', 'Debit', 'GST input tax credit'],
    ['1400', 'Advance to Vendors', 'Asset', 'Advances', 'Debit', 'Vendor advances'],
    ['1500', 'Plant and Machinery', 'Asset', 'Fixed Assets', 'Debit', 'Factory plant and machinery'],
    ['2000', 'Accounts Payable', 'Liability', 'Trade Payables', 'Credit', 'Amounts payable to vendors'],
    ['2100', 'Output GST', 'Liability', 'GST Payable', 'Credit', 'GST output tax liability'],
    ['2200', 'Advance from Customers', 'Liability', 'Advances', 'Credit', 'Customer advances'],
    ['2300', 'Duties and Taxes Payable', 'Liability', 'Statutory Payables', 'Credit', 'Other statutory dues payable'],
    ['3000', 'Owner Equity / Capital', 'Equity', 'Capital', 'Credit', 'Owner capital introduced'],
    ['4000', 'Sales Revenue', 'Revenue', 'Operating Revenue', 'Credit', 'EV motor sales revenue'],
    ['4100', 'Scrap Sales Revenue', 'Revenue', 'Other Operating Revenue', 'Credit', 'Sale of scrap and recoveries'],
    ['5000', 'Purchase Expense', 'Expense', 'Direct Expense', 'Debit', 'Material purchase expense'],
    ['5010', 'Freight Inward Expense', 'Expense', 'Procurement Cost', 'Debit', 'Freight and logistics on purchases'],
    ['5020', 'Packing Material Expense', 'Expense', 'Direct Expense', 'Debit', 'Packing material consumed'],
    ['5100', 'Salary Expense', 'Expense', 'Employee Cost', 'Debit', 'Factory and office salary cost'],
    ['5200', 'Electricity Expense', 'Expense', 'Factory Overheads', 'Debit', 'Power and electricity cost'],
    ['5300', 'Maintenance Expense', 'Expense', 'Factory Overheads', 'Debit', 'Plant maintenance cost'],
    ['5400', 'Depreciation Expense', 'Expense', 'Non Cash Expense', 'Debit', 'Depreciation on fixed assets'],
    ['5500', 'Bank Charges', 'Expense', 'Finance Cost', 'Debit', 'Bank fees and charges'],
    ['5600', 'Interest Expense', 'Expense', 'Finance Cost', 'Debit', 'Interest and borrowing cost'],
  ].map((row) => [...row.slice(0, 4), null, row[4], 0, 0, 'Active', row[5], employeeId, employeeId]);
  await insertMany(connection, 'chart_of_accounts', [
    'account_code', 'account_name', 'account_type', 'account_sub_type', 'parent_account_id',
    'normal_balance', 'opening_balance', 'current_balance', 'status', 'description', 'created_by', 'updated_by',
  ], rows);
  console.log('Inserted 25 chart_of_accounts records.');
}

async function populateTaxMaster(connection, employeeId) {
  if (!(await tableIsEmpty(connection, 'tax_master'))) {
    console.log('tax_master already populated. Skipping.');
    return;
  }
  const rows = [
    ['GST-IN-0', 'Input GST 0%', 'Input', 0, 'Purchase'],
    ['GST-IN-5', 'Input GST 5%', 'Input', 5, 'Purchase'],
    ['GST-IN-12', 'Input GST 12%', 'Input', 12, 'Purchase'],
    ['GST-IN-18', 'Input GST 18%', 'Input', 18, 'Purchase'],
    ['GST-OUT-0', 'Output GST 0%', 'Output', 0, 'Sales'],
    ['GST-OUT-5', 'Output GST 5%', 'Output', 5, 'Sales'],
    ['GST-OUT-12', 'Output GST 12%', 'Output', 12, 'Sales'],
    ['GST-OUT-18', 'Output GST 18%', 'Output', 18, 'Sales'],
  ].map((row) => [...row, 'Active', `${row[1]} for ${row[4].toLowerCase()} transactions`, employeeId, employeeId]);
  await insertMany(connection, 'tax_master', [
    'tax_code', 'tax_name', 'tax_type', 'tax_rate', 'applicable_on', 'status', 'description', 'created_by', 'updated_by',
  ], rows);
  console.log('Inserted 8 tax_master records.');
}

async function populateFinancialPeriod(connection, employeeId) {
  if (!(await tableIsEmpty(connection, 'financial_period'))) {
    console.log('financial_period already populated. Skipping.');
    return;
  }
  const rows = [];
  for (let index = 0; index < 24; index += 1) {
    const start = new Date(Date.UTC(2025, 3 + index, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    const fyStart = start.getUTCMonth() >= 3 ? start.getUTCFullYear() : start.getUTCFullYear() - 1;
    const periodCode = start.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase() + '-' + start.getUTCFullYear();
    const periodName = start.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }) + ' ' + start.getUTCFullYear();
    rows.push([periodCode, `FY ${fyStart}-${String(fyStart + 1).slice(-2)}`, periodName, dateSql(start), dateSql(end), 'Open', employeeId, employeeId]);
  }
  await insertMany(connection, 'financial_period', [
    'period_code', 'financial_year', 'period_name', 'start_date', 'end_date', 'period_status', 'created_by', 'updated_by',
  ], rows);
  console.log('Inserted 24 financial_period records.');
}

async function accountIds(connection) {
  const [rows] = await connection.query('SELECT account_id, account_code FROM chart_of_accounts');
  return Object.fromEntries(rows.map((row) => [row.account_code, row.account_id]));
}

async function populateBankMaster(connection, employeeId, accounts) {
  if (!(await tableIsEmpty(connection, 'bank_master'))) {
    console.log('bank_master already populated. Skipping.');
    return;
  }
  const rows = [
    ['BANK-HDFC-001', 'HDFC Bank', 'Hosur Industrial Estate', '50200011000123', 'HDFC0001234', 'Current', 1500000],
    ['BANK-ICICI-001', 'ICICI Bank', 'Bengaluru Peenya', '012305000456', 'ICIC0000123', 'Current', 750000],
    ['BANK-SBI-001', 'State Bank of India', 'Hosur Main', '33789012345', 'SBIN0002456', 'Cash Credit', 1200000],
    ['BANK-AXIS-001', 'Axis Bank', 'Chennai Ambattur', '918020045612345', 'UTIB0000678', 'Current', 500000],
  ].map((row) => [...row.slice(0, 6), row[6], row[6], accounts['1010'], 'Active', employeeId, employeeId]);
  await insertMany(connection, 'bank_master', [
    'bank_account_code', 'bank_name', 'branch_name', 'account_number', 'ifsc_code', 'account_type',
    'opening_balance', 'current_balance', 'linked_account_id', 'status', 'created_by', 'updated_by',
  ], rows);
  console.log('Inserted 4 bank_master records.');
}

async function loadMasters(connection) {
  const [inputTaxes] = await connection.query("SELECT tax_id, tax_rate FROM tax_master WHERE applicable_on IN ('Purchase', 'Both') ORDER BY tax_rate, tax_id");
  const [outputTaxes] = await connection.query("SELECT tax_id, tax_rate FROM tax_master WHERE applicable_on IN ('Sales', 'Both') ORDER BY tax_rate, tax_id");
  const [banks] = await connection.query('SELECT bank_id FROM bank_master ORDER BY bank_id');
  if (inputTaxes.length === 0 || outputTaxes.length === 0 || banks.length === 0) throw new Error('Finance masters are incomplete.');
  return { inputTaxes, outputTaxes, bankIds: banks.map((row) => row.bank_id) };
}

async function loadVendorSources(connection) {
  const [sources] = await connection.query(
    `SELECT grn.grn_id, grn.po_id, grn.vendor_id, grn.received_date
     FROM goods_receipt grn
     JOIN goods_receipt_items gri ON gri.grn_id = grn.grn_id
     WHERE grn.received_date BETWEEN '2025-04-01' AND '2026-01-30'
       AND COALESCE(gri.accepted_quantity, gri.received_quantity) > 0
     GROUP BY grn.grn_id, grn.po_id, grn.vendor_id, grn.received_date
     ORDER BY grn.received_date, grn.grn_id`,
  );
  const [items] = await connection.query(
    `SELECT gri.grn_id, gri.item_id,
            COALESCE(NULLIF(gri.accepted_quantity, 0), NULLIF(gri.received_quantity, 0), 1) quantity,
            COALESCE(NULLIF(gri.unit_price, 0), NULLIF(im.unit_cost, 0), 100) unit_price
     FROM goods_receipt_items gri
     JOIN item_master im ON im.item_id = gri.item_id
     JOIN goods_receipt grn ON grn.grn_id = gri.grn_id
     WHERE grn.received_date BETWEEN '2025-04-01' AND '2026-01-30'
       AND COALESCE(gri.accepted_quantity, gri.received_quantity) > 0
     ORDER BY gri.grn_id, gri.grn_item_id`,
  );
  const byGrn = new Map();
  for (const item of items) {
    if (!byGrn.has(item.grn_id)) byGrn.set(item.grn_id, []);
    byGrn.get(item.grn_id).push(item);
  }
  return sources.filter((source) => byGrn.has(source.grn_id)).map((source) => ({ ...source, items: byGrn.get(source.grn_id) }));
}

async function loadCustomerSources(connection) {
  const [sources] = await connection.query(
    `SELECT d.dispatch_id, d.co_id, COALESCE(d.customer_id, co.customer_id) customer_id, d.dispatch_date
     FROM dispatch d
     JOIN customer_order co ON co.co_id = d.co_id
     JOIN dispatch_items di ON di.dispatch_id = d.dispatch_id
     WHERE d.dispatch_date BETWEEN '2025-04-01' AND '2026-01-30'
       AND COALESCE(d.customer_id, co.customer_id) IS NOT NULL
       AND di.dispatched_quantity > 0
     GROUP BY d.dispatch_id, d.co_id, COALESCE(d.customer_id, co.customer_id), d.dispatch_date
     ORDER BY d.dispatch_date, d.dispatch_id`,
  );
  const [items] = await connection.query(
    `SELECT di.dispatch_id, di.item_id,
            COALESCE(NULLIF(di.dispatched_quantity, 0), 1) quantity,
            COALESCE(NULLIF(di.unit_price, 0), NULLIF(im.unit_cost, 0), 25000) unit_price
     FROM dispatch_items di
     JOIN item_master im ON im.item_id = di.item_id
     JOIN dispatch d ON d.dispatch_id = di.dispatch_id
     WHERE d.dispatch_date BETWEEN '2025-04-01' AND '2026-01-30'
       AND di.dispatched_quantity > 0
     ORDER BY di.dispatch_id, CASE WHEN LOWER(COALESCE(im.category, '')) LIKE '%finished%' THEN 0 ELSE 1 END, di.dispatch_item_id`,
  );
  const byDispatch = new Map();
  for (const item of items) {
    if (!byDispatch.has(item.dispatch_id)) byDispatch.set(item.dispatch_id, []);
    byDispatch.get(item.dispatch_id).push(item);
  }
  return sources.filter((source) => byDispatch.has(source.dispatch_id)).map((source) => ({ ...source, items: byDispatch.get(source.dispatch_id) }));
}

function itemRows(sourceItems, count, taxes) {
  const rows = [];
  let subtotal = 0;
  let taxAmount = 0;
  for (let i = 0; i < count; i += 1) {
    const source = sourceItems[i % sourceItems.length];
    const tax = taxes[i % taxes.length];
    const taxable = money(Number(source.quantity) * Number(source.unit_price));
    const taxValue = money(taxable * Number(tax.tax_rate) / 100);
    rows.push({ item_id: source.item_id, quantity: Number(source.quantity), unit_price: money(source.unit_price), taxable, tax_id: tax.tax_id, taxValue, lineTotal: money(taxable + taxValue) });
    subtotal = money(subtotal + taxable);
    taxAmount = money(taxAmount + taxValue);
  }
  return { rows, subtotal, taxAmount, total: money(subtotal + taxAmount) };
}

async function insertedByDocs(connection, table, keyColumn, docColumn, docs) {
  const map = new Map();
  for (let start = 0; start < docs.length; start += 1000) {
    const chunk = docs.slice(start, start + 1000);
    const [rows] = await connection.query(
      `SELECT * FROM ${table} WHERE ${docColumn} IN (${chunk.map(() => '?').join(',')})`,
      chunk,
    );
    for (const row of rows) map.set(row[docColumn], row);
  }
  return map;
}

async function populateVendorSide(connection, employeeId, taxes, banks, docCache) {
  const sources = await loadVendorSources(connection);
  if (sources.length === 0) throw new Error('No vendor-side source transactions found.');
  const invoices = [];
  const items = [];
  const docs = [];
  for (let i = 0; i < VENDOR_INVOICE_COUNT; i += 1) {
    const source = sources[i % sources.length];
    const invoiceDate = new Date(Math.max(new Date(source.received_date), financeDate(i)));
    const itemCount = i < (VENDOR_INVOICE_ITEM_COUNT - VENDOR_INVOICE_COUNT * 2) ? 3 : 2;
    const calc = itemRows(source.items, itemCount, taxes);
    const doc = await generateDocNumber(connection, 'vendor_invoice', 'vendor_invoice_no', 'VI', invoiceDate, docCache);
    docs.push(doc);
    const status = i < VENDOR_PAYMENT_COUNT ? (i % 5 === 0 ? 'Paid' : 'Partially Paid') : ['Approved', 'Draft', 'Cancelled'][i % 3];
    invoices.push([doc, source.vendor_id, source.po_id, source.grn_id, dateSql(invoiceDate), dateSql(addDays(invoiceDate, 30 + (i % 4) * 7)), calc.subtotal, calc.taxAmount, calc.total, 0, status, `Generated from GRN ${source.grn_id}`, employeeId, employeeId]);
    items.push({ doc, rows: calc.rows });
  }
  await insertMany(connection, 'vendor_invoice', ['vendor_invoice_no', 'vendor_id', 'po_id', 'grn_id', 'invoice_date', 'due_date', 'subtotal_amount', 'tax_amount', 'total_amount', 'paid_amount', 'invoice_status', 'remarks', 'created_by', 'updated_by'], invoices);
  const invoiceMap = await insertedByDocs(connection, 'vendor_invoice', 'vendor_invoice_id', 'vendor_invoice_no', docs);
  const itemRowsToInsert = [];
  for (const bundle of items) {
    const invoice = invoiceMap.get(bundle.doc);
    for (const row of bundle.rows) itemRowsToInsert.push([invoice.vendor_invoice_id, row.item_id, row.quantity, row.unit_price, row.taxable, row.tax_id, row.taxValue, row.lineTotal]);
  }
  await insertMany(connection, 'vendor_invoice_items', ['vendor_invoice_id', 'item_id', 'quantity', 'unit_price', 'taxable_amount', 'tax_id', 'tax_amount', 'line_total'], itemRowsToInsert);

  const payments = [];
  const paymentDocs = [];
  const payable = docs.slice(0, VENDOR_PAYMENT_COUNT).map((doc) => invoiceMap.get(doc));
  for (let i = 0; i < payable.length; i += 1) {
    const invoice = payable[i];
    const amount = invoice.invoice_status === 'Paid' ? money(invoice.total_amount) : money(Number(invoice.total_amount) * (0.4 + (i % 4) * 0.1));
    const paymentDate = addDays(new Date(invoice.invoice_date), 7 + (i % 5) * 4);
    const doc = await generateDocNumber(connection, 'vendor_payment', 'vendor_payment_no', 'VP', paymentDate, docCache);
    paymentDocs.push(doc);
    payments.push([doc, invoice.vendor_invoice_id, invoice.vendor_id, banks[i % banks.length], dateSql(paymentDate), ['NEFT', 'RTGS', 'IMPS', 'Cheque'][i % 4], `UTR-VP-${dateSql(paymentDate).replaceAll('-', '')}-${String(i + 1).padStart(5, '0')}`, amount, 'Posted', `Generated payment for invoice ${invoice.vendor_invoice_no}`, employeeId, employeeId]);
    await connection.query('UPDATE vendor_invoice SET paid_amount = ?, invoice_status = ?, updated_by = ? WHERE vendor_invoice_id = ?', [amount, invoice.invoice_status === 'Paid' ? 'Paid' : 'Partially Paid', employeeId, invoice.vendor_invoice_id]);
  }
  await insertMany(connection, 'vendor_payment', ['vendor_payment_no', 'vendor_invoice_id', 'vendor_id', 'bank_id', 'payment_date', 'payment_mode', 'reference_no', 'payment_amount', 'payment_status', 'remarks', 'created_by', 'updated_by'], payments);
  const paymentMap = await insertedByDocs(connection, 'vendor_payment', 'vendor_payment_id', 'vendor_payment_no', paymentDocs);
  console.log(`Inserted ${VENDOR_INVOICE_COUNT} vendor_invoice records.`);
  console.log(`Inserted ${VENDOR_INVOICE_ITEM_COUNT} vendor_invoice_items records.`);
  console.log(`Inserted ${VENDOR_PAYMENT_COUNT} vendor_payment records.`);
  return { vendorInvoices: [...invoiceMap.values()], vendorPayments: [...paymentMap.values()] };
}

async function populateCustomerSide(connection, employeeId, taxes, banks, docCache) {
  const sources = await loadCustomerSources(connection);
  if (sources.length === 0) throw new Error('No customer-side source transactions found.');
  const invoices = [];
  const items = [];
  const docs = [];
  for (let i = 0; i < CUSTOMER_INVOICE_COUNT; i += 1) {
    const source = sources[i % sources.length];
    const invoiceDate = new Date(Math.max(new Date(source.dispatch_date), financeDate(i)));
    const itemCount = i < (CUSTOMER_INVOICE_ITEM_COUNT - CUSTOMER_INVOICE_COUNT * 2) ? 3 : 2;
    const calc = itemRows(source.items, itemCount, taxes);
    const doc = await generateDocNumber(connection, 'customer_invoice', 'customer_invoice_no', 'CI', invoiceDate, docCache);
    docs.push(doc);
    const status = i < CUSTOMER_RECEIPT_COUNT ? (i % 5 === 0 ? 'Received' : 'Partially Received') : ['Approved', 'Draft', 'Cancelled'][i % 3];
    invoices.push([doc, source.customer_id, source.co_id, source.dispatch_id, dateSql(invoiceDate), dateSql(addDays(invoiceDate, 30 + (i % 4) * 7)), calc.subtotal, calc.taxAmount, calc.total, 0, status, `Generated from dispatch ${source.dispatch_id}`, employeeId, employeeId]);
    items.push({ doc, rows: calc.rows });
  }
  await insertMany(connection, 'customer_invoice', ['customer_invoice_no', 'customer_id', 'customer_order_id', 'dispatch_id', 'invoice_date', 'due_date', 'subtotal_amount', 'tax_amount', 'total_amount', 'received_amount', 'invoice_status', 'remarks', 'created_by', 'updated_by'], invoices);
  const invoiceMap = await insertedByDocs(connection, 'customer_invoice', 'customer_invoice_id', 'customer_invoice_no', docs);
  const itemRowsToInsert = [];
  for (const bundle of items) {
    const invoice = invoiceMap.get(bundle.doc);
    for (const row of bundle.rows) itemRowsToInsert.push([invoice.customer_invoice_id, row.item_id, row.quantity, row.unit_price, row.taxable, row.tax_id, row.taxValue, row.lineTotal]);
  }
  await insertMany(connection, 'customer_invoice_items', ['customer_invoice_id', 'item_id', 'quantity', 'unit_price', 'taxable_amount', 'tax_id', 'tax_amount', 'line_total'], itemRowsToInsert);

  const receipts = [];
  const receiptDocs = [];
  const receivable = docs.slice(0, CUSTOMER_RECEIPT_COUNT).map((doc) => invoiceMap.get(doc));
  for (let i = 0; i < receivable.length; i += 1) {
    const invoice = receivable[i];
    const amount = invoice.invoice_status === 'Received' ? money(invoice.total_amount) : money(Number(invoice.total_amount) * (0.35 + (i % 4) * 0.1));
    const receiptDate = addDays(new Date(invoice.invoice_date), 6 + (i % 5) * 4);
    const doc = await generateDocNumber(connection, 'customer_receipt', 'customer_receipt_no', 'CR', receiptDate, docCache);
    receiptDocs.push(doc);
    receipts.push([doc, invoice.customer_invoice_id, invoice.customer_id, banks[i % banks.length], dateSql(receiptDate), ['NEFT', 'RTGS', 'IMPS', 'Cheque'][i % 4], `UTR-CR-${dateSql(receiptDate).replaceAll('-', '')}-${String(i + 1).padStart(5, '0')}`, amount, 'Posted', `Generated receipt for invoice ${invoice.customer_invoice_no}`, employeeId, employeeId]);
    await connection.query('UPDATE customer_invoice SET received_amount = ?, invoice_status = ?, updated_by = ? WHERE customer_invoice_id = ?', [amount, invoice.invoice_status === 'Received' ? 'Received' : 'Partially Received', employeeId, invoice.customer_invoice_id]);
  }
  await insertMany(connection, 'customer_receipt', ['customer_receipt_no', 'customer_invoice_id', 'customer_id', 'bank_id', 'receipt_date', 'receipt_mode', 'reference_no', 'receipt_amount', 'receipt_status', 'remarks', 'created_by', 'updated_by'], receipts);
  const receiptMap = await insertedByDocs(connection, 'customer_receipt', 'customer_receipt_id', 'customer_receipt_no', receiptDocs);
  console.log(`Inserted ${CUSTOMER_INVOICE_COUNT} customer_invoice records.`);
  console.log(`Inserted ${CUSTOMER_INVOICE_ITEM_COUNT} customer_invoice_items records.`);
  console.log(`Inserted ${CUSTOMER_RECEIPT_COUNT} customer_receipt records.`);
  return { customerInvoices: [...invoiceMap.values()], customerReceipts: [...receiptMap.values()] };
}

async function periodId(connection, entryDate) {
  const [[row]] = await connection.query('SELECT period_id FROM financial_period WHERE ? BETWEEN start_date AND end_date LIMIT 1', [dateSql(new Date(entryDate))]);
  if (!row) throw new Error(`No period for ${dateSql(new Date(entryDate))}`);
  return row.period_id;
}

async function createJournals(connection, employeeId, accounts, sourceData, docCache) {
  const entries = [];
  const entryBundles = [];
  const pushEntry = async (sourceType, sourceId, entryDate, debit, credit, lines) => {
    const prefixes = { 'Vendor Invoice': 'JE-VI', 'Vendor Payment': 'JE-VP', 'Customer Invoice': 'JE-CI', 'Customer Receipt': 'JE-CR' };
    const doc = await generateDocNumber(connection, 'journal_entry', 'journal_entry_no', prefixes[sourceType], new Date(entryDate), docCache);
    entries.push([doc, dateSql(new Date(entryDate)), await periodId(connection, entryDate), 'Finance', sourceType, sourceId, debit, credit, 'Posted', `Generated journal for ${sourceType} ${sourceId}`, employeeId, employeeId]);
    entryBundles.push({ doc, sourceType, sourceId, lines });
  };
  for (const invoice of sourceData.vendorInvoices) {
    const lines = [[accounts['1200'], money(invoice.subtotal_amount), 0, 'Raw material inventory'], [accounts['2000'], 0, money(invoice.total_amount), 'Accounts payable']];
    if (Number(invoice.tax_amount) > 0) lines.splice(1, 0, [accounts['1300'], money(invoice.tax_amount), 0, 'Input GST']);
    await pushEntry('Vendor Invoice', invoice.vendor_invoice_id, invoice.invoice_date, money(invoice.total_amount), money(invoice.total_amount), lines);
  }
  for (const payment of sourceData.vendorPayments) {
    const amount = money(payment.payment_amount);
    await pushEntry('Vendor Payment', payment.vendor_payment_id, payment.payment_date, amount, amount, [[accounts['2000'], amount, 0, 'Accounts payable settlement'], [accounts['1010'], 0, amount, 'Bank payment']]);
  }
  for (const invoice of sourceData.customerInvoices) {
    const lines = [[accounts['1100'], money(invoice.total_amount), 0, 'Accounts receivable'], [accounts['4000'], 0, money(invoice.subtotal_amount), 'Sales revenue']];
    if (Number(invoice.tax_amount) > 0) lines.push([accounts['2100'], 0, money(invoice.tax_amount), 'Output GST']);
    await pushEntry('Customer Invoice', invoice.customer_invoice_id, invoice.invoice_date, money(invoice.total_amount), money(invoice.total_amount), lines);
  }
  for (const receipt of sourceData.customerReceipts) {
    const amount = money(receipt.receipt_amount);
    await pushEntry('Customer Receipt', receipt.customer_receipt_id, receipt.receipt_date, amount, amount, [[accounts['1010'], amount, 0, 'Bank receipt'], [accounts['1100'], 0, amount, 'Accounts receivable settlement']]);
  }
  await insertMany(connection, 'journal_entry', ['journal_entry_no', 'entry_date', 'period_id', 'source_module', 'source_document_type', 'source_document_id', 'total_debit', 'total_credit', 'journal_status', 'narration', 'created_by', 'updated_by'], entries, 500);
  const entryMap = await insertedByDocs(connection, 'journal_entry', 'journal_entry_id', 'journal_entry_no', entryBundles.map((entry) => entry.doc));
  const lines = [];
  for (const bundle of entryBundles) {
    const entry = entryMap.get(bundle.doc);
    for (const line of bundle.lines) lines.push([entry.journal_entry_id, line[0], line[1], line[2], line[3], bundle.sourceType, bundle.sourceId]);
  }
  await insertMany(connection, 'journal_entry_lines', ['journal_entry_id', 'account_id', 'debit_amount', 'credit_amount', 'line_narration', 'reference_type', 'reference_id'], lines, 1000);
  console.log(`Inserted ${entries.length} journal_entry records.`);
  console.log(`Inserted ${lines.length} journal_entry_lines records.`);
}

async function validate(connection) {
  const tables = ['chart_of_accounts', 'tax_master', 'bank_master', 'financial_period', 'vendor_invoice', 'vendor_invoice_items', 'vendor_payment', 'customer_invoice', 'customer_invoice_items', 'customer_receipt', 'journal_entry', 'journal_entry_lines'];
  console.log('\nValidation summary:');
  for (const table of tables) {
    const [[row]] = await connection.query(`SELECT COUNT(*) count FROM ${table}`);
    console.log(`${table}: ${row.count}`);
  }
  const checks = {
    unbalanced_journal_entries: `SELECT COUNT(*) result FROM journal_entry je LEFT JOIN (SELECT journal_entry_id, ROUND(SUM(debit_amount), 2) d, ROUND(SUM(credit_amount), 2) c FROM journal_entry_lines GROUP BY journal_entry_id) x ON x.journal_entry_id=je.journal_entry_id WHERE ROUND(je.total_debit, 2)<>ROUND(je.total_credit, 2) OR ROUND(je.total_debit, 2)<>COALESCE(x.d, -1) OR ROUND(je.total_credit, 2)<>COALESCE(x.c, -1)`,
    vendor_payments_exceeding_vendor_invoice_total: `SELECT COUNT(*) result FROM (SELECT vi.vendor_invoice_id, vi.total_amount, COALESCE(SUM(vp.payment_amount), 0) paid FROM vendor_invoice vi LEFT JOIN vendor_payment vp ON vp.vendor_invoice_id=vi.vendor_invoice_id GROUP BY vi.vendor_invoice_id, vi.total_amount HAVING paid > vi.total_amount) x`,
    customer_receipts_exceeding_customer_invoice_total: `SELECT COUNT(*) result FROM (SELECT ci.customer_invoice_id, ci.total_amount, COALESCE(SUM(cr.receipt_amount), 0) received FROM customer_invoice ci LEFT JOIN customer_receipt cr ON cr.customer_invoice_id=ci.customer_invoice_id GROUP BY ci.customer_invoice_id, ci.total_amount HAVING received > ci.total_amount) x`,
    vendor_invoices_with_invalid_vendor_id: `SELECT COUNT(*) result FROM vendor_invoice vi LEFT JOIN vendor_master vm ON vm.vendor_id=vi.vendor_id WHERE vm.vendor_id IS NULL`,
    customer_invoices_with_invalid_customer_id: `SELECT COUNT(*) result FROM customer_invoice ci LEFT JOIN customer_master cm ON cm.customer_id=ci.customer_id WHERE cm.customer_id IS NULL`,
    journal_entry_lines_without_matching_journal_entry: `SELECT COUNT(*) result FROM journal_entry_lines jel LEFT JOIN journal_entry je ON je.journal_entry_id=jel.journal_entry_id WHERE je.journal_entry_id IS NULL`,
    journal_entry_lines_without_matching_account_id: `SELECT COUNT(*) result FROM journal_entry_lines jel LEFT JOIN chart_of_accounts coa ON coa.account_id=jel.account_id WHERE coa.account_id IS NULL`,
  };
  for (const [label, sql] of Object.entries(checks)) {
    const [[row]] = await connection.query(sql);
    console.log(`${label}: ${row.result}`);
  }
}

async function main() {
  const connection = await pool.getConnection();
  const docCache = new Map();
  try {
    await connection.beginTransaction();
    const employeeId = await firstEmployeeId(connection);
    await populateChartOfAccounts(connection, employeeId);
    let accounts = await accountIds(connection);
    await populateTaxMaster(connection, employeeId);
    await populateFinancialPeriod(connection, employeeId);
    await populateBankMaster(connection, employeeId, accounts);
    accounts = await accountIds(connection);
    const masters = await loadMasters(connection);
    const vendorSide = await populateVendorSide(connection, employeeId, masters.inputTaxes, masters.bankIds, docCache);
    const customerSide = await populateCustomerSide(connection, employeeId, masters.outputTaxes, masters.bankIds, docCache);
    await createJournals(connection, employeeId, accounts, { ...vendorSide, ...customerSide }, docCache);
    await connection.commit();
    await validate(connection);
    console.log('\nFinance data import completed successfully.');
  } catch (error) {
    await connection.rollback();
    console.error(error);
    process.exitCode = 1;
  } finally {
    connection.release();
    await pool.end();
  }
}

await main();
