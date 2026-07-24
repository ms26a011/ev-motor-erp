import { applyGeneratedTransactionNumber, releaseGeneratedTransactionNumberLock } from './transactionNumbers.js';

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function numberValue(value) {
  return Number(value || 0);
}

function departmentFromLocation(value, fallback = null) {
  const text = String(value || '').toLowerCase();
  if (text.includes('finished goods') || text.includes('dispatch') || text.includes('fg store')) return 6;
  if (text.includes('raw material') || text.includes('central warehouse')) return 2;
  if (text.includes('stator') || text.includes('winding') || text.includes('electrical')) return 3;
  if (text.includes('rotor') || text.includes('magnet')) return 4;
  if (text.includes('assembly') || text.includes('final') || text.includes('packing') || text.includes('quality')) return 5;
  return fallback;
}

function locationForDepartment(departmentId) {
  return {
    2: 'RMWH_STORE',
    3: 'STAT_WIP',
    4: 'ROTR_WIP',
    5: 'ASMB_WIP',
    6: 'FGWH_STORE',
  }[Number(departmentId)] || 'RMWH_STORE';
}

async function alreadyLogged(connection, referenceType, referenceId) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS count
     FROM stock_transaction_log
     WHERE reference_document_type = ? AND reference_document_id = ?`,
    [referenceType, referenceId],
  );
  return Number(rows[0]?.count || 0) > 0;
}

async function journalExists(connection, sourceDocumentType, sourceDocumentId) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS count
     FROM journal_entry
     WHERE source_document_type = ? AND source_document_id = ?`,
    [sourceDocumentType, sourceDocumentId],
  );
  return Number(rows[0]?.count || 0) > 0;
}

async function getAccountByCode(connection, accountCode) {
  const [rows] = await connection.execute(
    'SELECT account_id, normal_balance FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
    [accountCode],
  );
  return rows[0] || null;
}

async function ensureAccount(connection, {
  code,
  name,
  type,
  subType,
  normalBalance,
  description,
}) {
  const existing = await getAccountByCode(connection, code);
  if (existing) return existing;

  const [result] = await connection.execute(
    `INSERT INTO chart_of_accounts
      (account_code, account_name, account_type, account_sub_type, normal_balance,
       opening_balance, current_balance, status, description)
     VALUES (?, ?, ?, ?, ?, 0, 0, 'Active', ?)`,
    [code, name, type, subType, normalBalance, description],
  );
  return { account_id: result.insertId, normal_balance: normalBalance };
}

async function account(connection, code) {
  const defaults = {
    1000: {
      name: 'Cash',
      type: 'Asset',
      subType: 'Cash and Cash Equivalents',
      normalBalance: 'Debit',
      description: 'Cash account',
    },
    1010: {
      name: 'Bank',
      type: 'Asset',
      subType: 'Bank and Cash Equivalents',
      normalBalance: 'Debit',
      description: 'Bank account',
    },
    1100: {
      name: 'Accounts Receivable',
      type: 'Asset',
      subType: 'Trade Receivables',
      normalBalance: 'Debit',
      description: 'Customer receivables',
    },
    1200: {
      name: 'Raw Material Inventory',
      type: 'Asset',
      subType: 'Inventory',
      normalBalance: 'Debit',
      description: 'Raw material stock value',
    },
    1210: {
      name: 'Finished Goods Inventory',
      type: 'Asset',
      subType: 'Inventory',
      normalBalance: 'Debit',
      description: 'Finished goods stock value',
    },
    1220: {
      name: 'Work In Process Inventory',
      type: 'Asset',
      subType: 'Inventory',
      normalBalance: 'Debit',
      description: 'WIP inventory value',
    },
    1300: {
      name: 'Input GST',
      type: 'Asset',
      subType: 'GST Receivable',
      normalBalance: 'Debit',
      description: 'GST input credit',
    },
    2000: {
      name: 'Accounts Payable',
      type: 'Liability',
      subType: 'Trade Payables',
      normalBalance: 'Credit',
      description: 'Vendor payables',
    },
    2050: {
      name: 'GRN Clearing / Goods Received Not Invoiced',
      type: 'Liability',
      subType: 'Accrued Payables',
      normalBalance: 'Credit',
      description: 'Goods received but not yet invoiced',
    },
    2100: {
      name: 'Output GST',
      type: 'Liability',
      subType: 'GST Payable',
      normalBalance: 'Credit',
      description: 'GST output liability',
    },
    4000: {
      name: 'Sales Revenue',
      type: 'Revenue',
      subType: 'Operating Revenue',
      normalBalance: 'Credit',
      description: 'Sales revenue',
    },
    5000: {
      name: 'Purchase Expense',
      type: 'Expense',
      subType: 'Direct Expense',
      normalBalance: 'Debit',
      description: 'Purchase expense',
    },
    5700: {
      name: 'Cost of Goods Sold',
      type: 'Expense',
      subType: 'Cost of Sales',
      normalBalance: 'Debit',
      description: 'Inventory cost recognized on dispatch',
    },
  }[code];

  if (!defaults) {
    const error = new Error(`Finance account ${code} is not configured.`);
    error.status = 500;
    throw error;
  }
  return ensureAccount(connection, { code, ...defaults });
}

async function getFinancialPeriodId(connection, entryDate) {
  const [matched] = await connection.execute(
    `SELECT period_id
     FROM financial_period
     WHERE ? BETWEEN start_date AND end_date
     ORDER BY start_date DESC
     LIMIT 1`,
    [entryDate],
  );
  if (matched[0]) return matched[0].period_id;

  const [fallback] = await connection.execute(
    `SELECT period_id
     FROM financial_period
     ORDER BY start_date DESC
     LIMIT 1`,
  );
  if (fallback[0]) return fallback[0].period_id;

  const error = new Error('No financial period is available for journal posting.');
  error.status = 400;
  throw error;
}

async function applyAccountBalance(connection, accountId, debitAmount, creditAmount) {
  const [rows] = await connection.execute(
    'SELECT normal_balance FROM chart_of_accounts WHERE account_id = ? FOR UPDATE',
    [accountId],
  );
  const normalBalance = String(rows[0]?.normal_balance || 'Debit').toLowerCase();
  const movement = normalBalance === 'credit'
    ? numberValue(creditAmount) - numberValue(debitAmount)
    : numberValue(debitAmount) - numberValue(creditAmount);
  await connection.execute(
    'UPDATE chart_of_accounts SET current_balance = current_balance + ? WHERE account_id = ?',
    [movement, accountId],
  );
}

async function postJournal(connection, {
  entryDate = new Date().toISOString().slice(0, 10),
  sourceModule = 'ERP',
  sourceDocumentType,
  sourceDocumentId,
  narration,
  createdBy = null,
  lines,
}) {
  if (!sourceDocumentType || !sourceDocumentId) return;
  if (await journalExists(connection, sourceDocumentType, sourceDocumentId)) return;

  const validLines = lines
    .map((line) => ({
      ...line,
      debit: numberValue(line.debit),
      credit: numberValue(line.credit),
    }))
    .filter((line) => line.debit > 0 || line.credit > 0);

  const totalDebit = validLines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = validLines.reduce((sum, line) => sum + line.credit, 0);
  if (validLines.length < 2 || Math.round(totalDebit * 100) !== Math.round(totalCredit * 100)) {
    const error = new Error(`Journal entry for ${sourceDocumentType} ${sourceDocumentId} is not balanced.`);
    error.status = 400;
    throw error;
  }

  const periodId = await getFinancialPeriodId(connection, entryDate);
  const payload = await applyGeneratedTransactionNumber(connection, 'journalEntries', {
    entry_date: entryDate,
    period_id: periodId,
    source_module: sourceModule,
    source_document_type: sourceDocumentType,
    source_document_id: sourceDocumentId,
    total_debit: totalDebit.toFixed(2),
    total_credit: totalCredit.toFixed(2),
    journal_status: 'Posted',
    narration,
    created_by: createdBy,
  });

  try {
    const [result] = await connection.execute(
      `INSERT INTO journal_entry
        (${Object.keys(payload).map((key) => `\`${key}\``).join(', ')})
       VALUES (${Object.keys(payload).map(() => '?').join(', ')})`,
      Object.values(payload),
    );
    const journalEntryId = result.insertId;

    for (const line of validLines) {
      await connection.execute(
        `INSERT INTO journal_entry_lines
          (journal_entry_id, account_id, debit_amount, credit_amount,
           line_narration, reference_type, reference_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          journalEntryId,
          line.account.account_id,
          line.debit.toFixed(2),
          line.credit.toFixed(2),
          line.narration || narration,
          sourceDocumentType,
          sourceDocumentId,
        ],
      );
      await applyAccountBalance(connection, line.account.account_id, line.debit, line.credit);
    }
  } finally {
    await releaseGeneratedTransactionNumberLock(connection, 'journalEntries');
  }
}

async function getItemUnitCost(connection, itemId) {
  const [rows] = await connection.execute(
    'SELECT COALESCE(unit_cost, 0) AS unit_cost FROM item_master WHERE item_id = ? LIMIT 1',
    [itemId],
  );
  return numberValue(rows[0]?.unit_cost);
}

async function getBalance(connection, itemId, departmentId) {
  const [rows] = await connection.execute(
    `SELECT balance_id, current_stock, quantity_on_hand, reserved_quantity
     FROM inventory_balance
     WHERE item_id = ? AND department_id = ?
     FOR UPDATE`,
    [itemId, departmentId],
  );
  return rows[0] || null;
}

async function addStock(connection, { itemId, departmentId, quantityIn = 0, quantityOut = 0 }) {
  const current = await getBalance(connection, itemId, departmentId);
  const currentStock = numberValue(current?.quantity_on_hand ?? current?.current_stock);
  const nextStock = currentStock + numberValue(quantityIn) - numberValue(quantityOut);

  if (nextStock < 0) {
    const error = new Error(`Insufficient stock for item ${itemId} in department ${departmentId}. Available: ${currentStock}, required: ${quantityOut}.`);
    error.status = 400;
    throw error;
  }

  if (current) {
    await connection.execute(
      `UPDATE inventory_balance ib
       JOIN item_master im ON im.item_id = ib.item_id
       SET ib.current_stock = ?,
           ib.quantity_on_hand = ?,
           ib.available_quantity = ? - COALESCE(ib.reserved_quantity, 0),
           ib.inventory_value = ROUND(? * COALESCE(im.unit_cost, 0), 2),
           ib.status = CASE
             WHEN ? <= 0 THEN 'Below Reorder'
             WHEN ? <= COALESCE(ib.reorder_level, im.reorder_level, 0) THEN 'Below Reorder'
             ELSE 'Active'
           END,
           ib.last_updated = CURDATE()
       WHERE ib.balance_id = ?`,
      [nextStock, nextStock, nextStock, nextStock, nextStock, nextStock, current.balance_id],
    );
  } else {
    const locationId = locationForDepartment(departmentId);
    await connection.execute(
      `INSERT INTO inventory_balance
        (item_id, department_id, location_id, warehouse_location, quantity_on_hand,
         reserved_quantity, available_quantity, reorder_level, safety_stock, max_stock,
         current_stock, inventory_value, last_updated, status, data_issue_quantity)
       SELECT ?, ?, ?, ?, ?, 0, ?, im.reorder_level, im.safety_stock, im.maximum_stock,
              ?, ROUND(? * COALESCE(im.unit_cost, 0), 2), CURDATE(),
              CASE WHEN ? <= im.reorder_level THEN 'Below Reorder' ELSE 'Active' END, 0
       FROM item_master im
       WHERE im.item_id = ?`,
      [itemId, departmentId, locationId, locationId, nextStock, nextStock, nextStock, nextStock, nextStock, itemId],
    );
  }

  return nextStock;
}

async function writeStockLog(connection, {
  itemId,
  departmentId,
  transactionType,
  referenceType,
  referenceId,
  quantityIn = 0,
  quantityOut = 0,
  balanceAfter,
  createdBy = null,
  remarks = null,
}) {
  const payload = await applyGeneratedTransactionNumber(connection, 'stockTransactions', {
    transaction_date: new Date().toISOString().slice(0, 10),
    item_id: itemId,
    department_id: departmentId,
    transaction_type: transactionType,
    reference_document_type: referenceType,
    reference_document_id: referenceId,
    quantity_in: quantityIn,
    quantity_out: quantityOut,
    balance_after_transaction: balanceAfter,
    created_by: createdBy,
    remarks,
  });

  try {
    await connection.execute(
      `INSERT INTO stock_transaction_log
        (${Object.keys(payload).map((key) => `\`${key}\``).join(', ')})
       VALUES (${Object.keys(payload).map(() => '?').join(', ')})`,
      Object.values(payload),
    );
  } finally {
    await releaseGeneratedTransactionNumberLock(connection, 'stockTransactions');
  }
}

async function postGrn(connection, grn) {
  const status = normalizeStatus(grn.status || grn.grn_status);
  if (!['received', 'accepted', 'posted', 'completed'].includes(status)) return;
  const stockAlreadyLogged = await alreadyLogged(connection, 'GRN', grn.grn_id);

  const [items] = await connection.execute(
    'SELECT item_id, received_quantity, accepted_quantity, unit_price, remarks FROM goods_receipt_items WHERE grn_id = ?',
    [grn.grn_id],
  );

  let grnValue = 0;
  for (const item of items) {
    const quantity = numberValue(item.accepted_quantity || item.received_quantity);
    if (quantity <= 0) continue;
    grnValue += quantity * numberValue(item.unit_price);
    if (!stockAlreadyLogged) {
      const balanceAfter = await addStock(connection, {
        itemId: item.item_id,
        departmentId: grn.receiving_department_id || departmentFromLocation(grn.warehouse_location, 2),
        quantityIn: quantity,
      });
      await writeStockLog(connection, {
        itemId: item.item_id,
        departmentId: grn.receiving_department_id || departmentFromLocation(grn.warehouse_location, 2),
        transactionType: 'GRN_RECEIPT',
        referenceType: 'GRN',
        referenceId: grn.grn_id,
        quantityIn: quantity,
        balanceAfter,
        createdBy: grn.received_by,
        remarks: item.remarks || grn.remarks,
      });
    }
  }

  if (grnValue <= 0) return;
  await postJournal(connection, {
    entryDate: grn.received_date,
    sourceModule: 'Procurement',
    sourceDocumentType: 'GRN',
    sourceDocumentId: grn.grn_id,
    narration: `GRN inventory receipt ${grn.grn_number || grn.grn_id}`,
    createdBy: grn.received_by,
    lines: [
      { account: await account(connection, '1200'), debit: grnValue },
      { account: await account(connection, '2050'), credit: grnValue },
    ],
  });
}

async function postMoveOrderIssue(connection, moveOrder) {
  const status = normalizeStatus(moveOrder.status || moveOrder.move_status);
  if (!['issued', 'completed', 'closed', 'received', 'in transit'].includes(status)) return;
  const moveOrderId = moveOrder.mo_id || moveOrder.move_order_id;
  if (await alreadyLogged(connection, 'MOVE_ORDER_ISSUE', moveOrderId)) return;

  const [items] = await connection.execute(
    'SELECT item_id, issued_quantity, requested_quantity, remarks FROM move_order_items WHERE mo_id = ?',
    [moveOrderId],
  );

  for (const item of items) {
    const quantity = numberValue(item.issued_quantity || item.requested_quantity);
    if (quantity <= 0) continue;
    const fromDepartmentId = moveOrder.from_department_id || departmentFromLocation(moveOrder.source_location || moveOrder.from_location);
    const toDepartmentId = moveOrder.to_department_id || departmentFromLocation(moveOrder.destination_location || moveOrder.to_location);
    if (!fromDepartmentId) continue;
    const balanceAfter = await addStock(connection, {
      itemId: item.item_id,
      departmentId: fromDepartmentId,
      quantityOut: quantity,
    });
    await writeStockLog(connection, {
      itemId: item.item_id,
      departmentId: fromDepartmentId,
      transactionType: 'STOCK_ISSUE',
      referenceType: 'MOVE_ORDER_ISSUE',
      referenceId: moveOrderId,
      quantityOut: quantity,
      balanceAfter,
      createdBy: moveOrder.issued_by,
      remarks: item.remarks || moveOrder.remarks,
    });

    if (['completed', 'closed', 'received'].includes(status) && toDepartmentId && toDepartmentId !== fromDepartmentId) {
      await addStock(connection, {
        itemId: item.item_id,
        departmentId: toDepartmentId,
        quantityIn: quantity,
      });
    }
  }
}

async function postFinishedGoodsReceipt(connection, receipt) {
  const status = normalizeStatus(receipt.status || receipt.inspection_status);
  if (!['accepted', 'partially accepted', 'completed', 'posted', 'received'].includes(status)) return;
  const receiptId = receipt.fg_receipt_id || receipt.finished_goods_receipt_id;
  const stockAlreadyLogged = await alreadyLogged(connection, 'FINISHED_GOODS_RECEIPT', receiptId);

  const quantity = numberValue(receipt.accepted_quantity || receipt.received_quantity);
  if (quantity <= 0) return;
  const itemId = receipt.finished_item_id || receipt.finished_goods_item_id;
  if (!stockAlreadyLogged) {
    const balanceAfter = await addStock(connection, {
      itemId,
      departmentId: 6,
      quantityIn: quantity,
    });
    await writeStockLog(connection, {
      itemId,
      departmentId: 6,
      transactionType: 'FINISHED_GOODS_RECEIPT',
      referenceType: 'FINISHED_GOODS_RECEIPT',
      referenceId: receiptId,
      quantityIn: quantity,
      balanceAfter,
      createdBy: receipt.received_by,
      remarks: receipt.remarks,
    });
  }
  const amount = quantity * await getItemUnitCost(connection, itemId);
  if (amount <= 0) return;
  await postJournal(connection, {
    entryDate: receipt.receipt_date,
    sourceModule: 'Production',
    sourceDocumentType: 'FINISHED_GOODS_RECEIPT',
    sourceDocumentId: receiptId,
    narration: `Finished goods receipt ${receipt.fg_receipt_number || receiptId}`,
    createdBy: receipt.received_by,
    lines: [
      { account: await account(connection, '1210'), debit: amount },
      { account: await account(connection, '1220'), credit: amount },
    ],
  });
}

async function postDispatch(connection, dispatch) {
  const status = normalizeStatus(dispatch.status);
  if (!['dispatched', 'completed', 'closed', 'delivered', 'in transit', 'partially delivered'].includes(status)) return;
  const stockAlreadyLogged = await alreadyLogged(connection, 'DISPATCH', dispatch.dispatch_id);

  const [items] = await connection.execute(
    'SELECT item_id, dispatched_quantity, remarks FROM dispatch_items WHERE dispatch_id = ?',
    [dispatch.dispatch_id],
  );

  let dispatchCost = 0;
  for (const item of items) {
    const quantity = numberValue(item.dispatched_quantity);
    if (quantity <= 0) continue;
    dispatchCost += quantity * await getItemUnitCost(connection, item.item_id);
    if (!stockAlreadyLogged) {
      const balanceAfter = await addStock(connection, {
        itemId: item.item_id,
        departmentId: 6,
        quantityOut: quantity,
      });
      await writeStockLog(connection, {
        itemId: item.item_id,
        departmentId: 6,
        transactionType: 'DISPATCH',
        referenceType: 'DISPATCH',
        referenceId: dispatch.dispatch_id,
        quantityOut: quantity,
        balanceAfter,
        createdBy: dispatch.dispatched_by,
        remarks: item.remarks || dispatch.remarks,
      });
    }
  }

  if (dispatchCost <= 0) return;
  await postJournal(connection, {
    entryDate: dispatch.dispatch_date,
    sourceModule: 'Sales',
    sourceDocumentType: 'DISPATCH',
    sourceDocumentId: dispatch.dispatch_id,
    narration: `Dispatch cost recognition ${dispatch.dispatch_number || dispatch.dispatch_id}`,
    createdBy: dispatch.dispatched_by,
    lines: [
      { account: await account(connection, '5700'), debit: dispatchCost },
      { account: await account(connection, '1210'), credit: dispatchCost },
    ],
  });
}

async function postBomConsumption(connection, consumption) {
  const status = normalizeStatus(consumption.transaction_status || consumption.status);
  if (!['issued', 'consumed', 'partially consumed', 'closed'].includes(status)) return;
  if (await alreadyLogged(connection, 'BOM_CONSUMPTION', consumption.bom_consumption_id)) return;

  const quantity = numberValue(consumption.actual_consumed_quantity || consumption.issued_quantity);
  if (quantity <= 0) return;
  const departmentId = departmentFromLocation(consumption.warehouse_location, 2);
  const balanceAfter = await addStock(connection, {
    itemId: consumption.consumed_item_id,
    departmentId,
    quantityOut: quantity,
  });
  await writeStockLog(connection, {
    itemId: consumption.consumed_item_id,
    departmentId,
    transactionType: 'BOM_CONSUMPTION',
    referenceType: 'BOM_CONSUMPTION',
    referenceId: consumption.bom_consumption_id,
    quantityOut: quantity,
    balanceAfter,
    createdBy: consumption.consumed_by,
    remarks: consumption.remarks,
  });

  const amount = quantity * await getItemUnitCost(connection, consumption.consumed_item_id);
  if (amount <= 0) return;
  await postJournal(connection, {
    entryDate: consumption.consumption_date,
    sourceModule: 'Production',
    sourceDocumentType: 'BOM_CONSUMPTION',
    sourceDocumentId: consumption.bom_consumption_id,
    narration: `Raw material consumption ${consumption.bom_consumption_id}`,
    createdBy: consumption.consumed_by,
    lines: [
      { account: await account(connection, '1220'), debit: amount },
      { account: await account(connection, '1200'), credit: amount },
    ],
  });
}

function isPostedFinanceStatus(value) {
  const status = normalizeStatus(value);
  return !['', 'draft', 'pending', 'cancelled', 'canceled', 'failed', 'reversed'].includes(status);
}

async function postVendorInvoice(connection, invoice) {
  if (!isPostedFinanceStatus(invoice.invoice_status)) return;
  if (!invoice.po_id && !invoice.grn_id) {
    const error = new Error('Vendor invoice must reference a purchase order or GRN.');
    error.status = 400;
    throw error;
  }
  const invoiceId = invoice.vendor_invoice_id;
  if (await journalExists(connection, 'Vendor Invoice', invoiceId)) return;

  await postJournal(connection, {
    entryDate: invoice.invoice_date,
    sourceModule: 'Finance',
    sourceDocumentType: 'Vendor Invoice',
    sourceDocumentId: invoiceId,
    narration: `Vendor invoice ${invoice.vendor_invoice_no || invoiceId}`,
    createdBy: invoice.created_by,
    lines: [
      { account: await account(connection, invoice.grn_id ? '2050' : '5000'), debit: invoice.subtotal_amount },
      { account: await account(connection, '1300'), debit: invoice.tax_amount },
      { account: await account(connection, '2000'), credit: invoice.total_amount },
    ],
  });
}

async function postVendorPayment(connection, payment) {
  if (!isPostedFinanceStatus(payment.payment_status)) return;
  const paymentId = payment.vendor_payment_id;
  if (await journalExists(connection, 'Vendor Payment', paymentId)) return;

  const [invoices] = await connection.execute(
    `SELECT vendor_invoice_id, total_amount, paid_amount, balance_amount
     FROM vendor_invoice
     WHERE vendor_invoice_id = ?
     FOR UPDATE`,
    [payment.vendor_invoice_id],
  );
  const invoice = invoices[0];
  if (!invoice) {
    const error = new Error('Vendor payment references an invoice that does not exist.');
    error.status = 400;
    throw error;
  }

  const paymentAmount = numberValue(payment.payment_amount);
  if (paymentAmount <= 0 || paymentAmount > numberValue(invoice.balance_amount)) {
    const error = new Error(`Vendor payment cannot exceed outstanding amount ${invoice.balance_amount}.`);
    error.status = 400;
    throw error;
  }

  const nextPaid = numberValue(invoice.paid_amount) + paymentAmount;
  await connection.execute(
    `UPDATE vendor_invoice
     SET paid_amount = ?,
         invoice_status = CASE WHEN ? >= total_amount THEN 'Paid' ELSE 'Partially Paid' END
     WHERE vendor_invoice_id = ?`,
    [nextPaid, nextPaid, payment.vendor_invoice_id],
  );

  await postJournal(connection, {
    entryDate: payment.payment_date,
    sourceModule: 'Finance',
    sourceDocumentType: 'Vendor Payment',
    sourceDocumentId: paymentId,
    narration: `Vendor payment ${payment.vendor_payment_no || paymentId}`,
    createdBy: payment.created_by,
    lines: [
      { account: await account(connection, '2000'), debit: paymentAmount },
      { account: await account(connection, '1010'), credit: paymentAmount },
    ],
  });
  await connection.execute(
    'UPDATE bank_master SET current_balance = current_balance - ? WHERE bank_id = ?',
    [paymentAmount, payment.bank_id],
  );
}

async function postCustomerInvoice(connection, invoice) {
  if (!isPostedFinanceStatus(invoice.invoice_status)) return;
  if (!invoice.dispatch_id) {
    const error = new Error('Customer invoice must reference a dispatch.');
    error.status = 400;
    throw error;
  }
  const invoiceId = invoice.customer_invoice_id;
  if (await journalExists(connection, 'Customer Invoice', invoiceId)) return;

  await postJournal(connection, {
    entryDate: invoice.invoice_date,
    sourceModule: 'Finance',
    sourceDocumentType: 'Customer Invoice',
    sourceDocumentId: invoiceId,
    narration: `Customer invoice ${invoice.customer_invoice_no || invoiceId}`,
    createdBy: invoice.created_by,
    lines: [
      { account: await account(connection, '1100'), debit: invoice.total_amount },
      { account: await account(connection, '4000'), credit: invoice.subtotal_amount },
      { account: await account(connection, '2100'), credit: invoice.tax_amount },
    ],
  });
}

async function postCustomerReceipt(connection, receipt) {
  if (!isPostedFinanceStatus(receipt.receipt_status)) return;
  const receiptId = receipt.customer_receipt_id;
  if (await journalExists(connection, 'Customer Receipt', receiptId)) return;

  const [invoices] = await connection.execute(
    `SELECT customer_invoice_id, total_amount, received_amount, balance_amount
     FROM customer_invoice
     WHERE customer_invoice_id = ?
     FOR UPDATE`,
    [receipt.customer_invoice_id],
  );
  const invoice = invoices[0];
  if (!invoice) {
    const error = new Error('Customer receipt references an invoice that does not exist.');
    error.status = 400;
    throw error;
  }

  const receiptAmount = numberValue(receipt.receipt_amount);
  if (receiptAmount <= 0 || receiptAmount > numberValue(invoice.balance_amount)) {
    const error = new Error(`Customer receipt cannot exceed outstanding amount ${invoice.balance_amount}.`);
    error.status = 400;
    throw error;
  }

  const nextReceived = numberValue(invoice.received_amount) + receiptAmount;
  await connection.execute(
    `UPDATE customer_invoice
     SET received_amount = ?,
         invoice_status = CASE WHEN ? >= total_amount THEN 'Received' ELSE 'Partially Received' END
     WHERE customer_invoice_id = ?`,
    [nextReceived, nextReceived, receipt.customer_invoice_id],
  );

  await postJournal(connection, {
    entryDate: receipt.receipt_date,
    sourceModule: 'Finance',
    sourceDocumentType: 'Customer Receipt',
    sourceDocumentId: receiptId,
    narration: `Customer receipt ${receipt.customer_receipt_no || receiptId}`,
    createdBy: receipt.created_by,
    lines: [
      { account: await account(connection, '1010'), debit: receiptAmount },
      { account: await account(connection, '1100'), credit: receiptAmount },
    ],
  });
  await connection.execute(
    'UPDATE bank_master SET current_balance = current_balance + ? WHERE bank_id = ?',
    [receiptAmount, receipt.bank_id],
  );
}

export async function applyTransactionEffects(connection, moduleKey, record) {
  if (moduleKey === 'grns') {
    await postGrn(connection, record);
  }
  if (moduleKey === 'grnItems') {
    const [rows] = await connection.execute('SELECT * FROM goods_receipt WHERE grn_id = ? LIMIT 1', [record.grn_id]);
    if (rows[0]) await postGrn(connection, rows[0]);
  }
  if (moduleKey === 'stockIssues') {
    await postMoveOrderIssue(connection, record);
  }
  if (moduleKey === 'stockIssueItems') {
    const [rows] = await connection.execute('SELECT * FROM move_order WHERE mo_id = ? LIMIT 1', [record.mo_id]);
    if (rows[0]) await postMoveOrderIssue(connection, rows[0]);
  }
  if (moduleKey === 'bomConsumptions') {
    await postBomConsumption(connection, record);
  }
  if (moduleKey === 'finishedGoodsReceipts') {
    await postFinishedGoodsReceipt(connection, record);
  }
  if (moduleKey === 'dispatches') {
    await postDispatch(connection, record);
  }
  if (moduleKey === 'dispatchItems') {
    const [rows] = await connection.execute('SELECT * FROM dispatch WHERE dispatch_id = ? LIMIT 1', [record.dispatch_id]);
    if (rows[0]) await postDispatch(connection, rows[0]);
  }
  if (moduleKey === 'vendorInvoices') {
    await postVendorInvoice(connection, record);
  }
  if (moduleKey === 'vendorPayments') {
    await postVendorPayment(connection, record);
  }
  if (moduleKey === 'customerInvoices') {
    await postCustomerInvoice(connection, record);
  }
  if (moduleKey === 'customerReceipts') {
    await postCustomerReceipt(connection, record);
  }
}
