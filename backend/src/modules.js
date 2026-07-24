export const phaseOneModules = {
  departments: {
    title: 'Department Master',
    table: 'department_master',
    route: '/api/departments',
  },
  employees: {
    title: 'Employee Master',
    table: 'employee_master',
    route: '/api/employees',
    dropdowns: {
      department: 'departments',
      department_id: 'departments',
      dept_id: 'departments',
      department_code: 'departments',
    },
  },
  vendors: {
    title: 'Vendor Master',
    table: 'vendor_master',
    route: '/api/vendors',
  },
  items: {
    title: 'Item Master',
    table: 'item_master',
    route: '/api/items',
    dropdowns: {
      vendor: 'vendors',
      vendor_id: 'vendors',
      vendor_code: 'vendors',
    },
  },
  bomMaster: {
    title: 'BOM Master',
    table: 'bom_master',
    route: '/api/bomMaster',
    group: 'Master Data',
    dropdowns: {
      parent_item_id: 'items',
      component_item_id: 'items',
    },
  },
  customers: {
    title: 'Customer Master',
    table: 'customer_master',
    route: '/api/customers',
  },
};

export const phaseTwoModules = {
  purchaseRequisitions: {
    title: 'Purchase Requisition',
    table: 'purchase_requisition',
    route: '/api/purchaseRequisitions',
    group: 'Procurement',
    transactionNumber: { column: 'pr_number', prefix: 'PR' },
    dropdowns: {
      department_id: 'departments',
      requested_by: 'employees',
      approved_by: 'employees',
    },
  },
  purchaseRequisitionItems: {
    title: 'Purchase Requisition Items',
    table: 'purchase_requisition_items',
    route: '/api/purchaseRequisitionItems',
    group: 'Procurement',
    dropdowns: {
      pr_id: 'purchaseRequisitions',
      item_id: 'items',
    },
  },
  purchaseOrders: {
    title: 'Purchase Order',
    table: 'purchase_order',
    route: '/api/purchaseOrders',
    group: 'Procurement',
    transactionNumber: { column: 'po_number', prefix: 'PO' },
    dropdowns: {
      vendor_id: 'vendors',
      pr_id: 'purchaseRequisitions',
      department_id: 'departments',
      approved_by: 'employees',
    },
  },
  purchaseOrderItems: {
    title: 'Purchase Order Items',
    table: 'purchase_order_items',
    route: '/api/purchaseOrderItems',
    group: 'Procurement',
    dropdowns: {
      po_id: 'purchaseOrders',
      pr_item_id: 'purchaseRequisitionItems',
      item_id: 'items',
    },
  },
  grns: {
    title: 'Goods Receipt Note / GRN',
    table: 'goods_receipt',
    route: '/api/grns',
    group: 'Procurement',
    transactionNumber: { column: 'grn_number', prefix: 'GRN' },
    dropdowns: {
      po_id: 'purchaseOrders',
      vendor_id: 'vendors',
      received_by: 'employees',
    },
  },
  grnItems: {
    title: 'GRN Items',
    table: 'goods_receipt_items',
    route: '/api/grnItems',
    group: 'Procurement',
    dropdowns: {
      grn_id: 'grns',
      po_item_id: 'purchaseOrderItems',
      item_id: 'items',
    },
  },
  stockInwards: {
    title: 'Inventory Balance',
    table: 'inventory_balance',
    route: '/api/stockInwards',
    group: 'Inventory',
    transactionNumber: { column: 'stock_inward_number', prefix: 'SI' },
    dropdowns: {
      item_id: 'items',
      department_id: 'departments',
    },
  },
  stockTransactions: {
    title: 'Stock Transaction Log',
    table: 'stock_transaction_log',
    route: '/api/stockTransactions',
    group: 'Inventory',
    transactionNumber: { column: 'stock_transaction_number', prefix: 'ST' },
    dropdowns: {
      item_id: 'items',
      department_id: 'departments',
      created_by: 'employees',
    },
  },
  stockIssues: {
    title: 'Move Order',
    table: 'move_order',
    route: '/api/stockIssues',
    group: 'Inventory',
    transactionNumber: { column: 'move_order_number', prefix: 'MO' },
    dropdowns: {
      requested_by: 'employees',
      approved_by: 'employees',
      moved_by: 'employees',
      issued_by: 'employees',
      received_by: 'employees',
    },
  },
  stockIssueItems: {
    title: 'Stock Issue Items',
    table: 'move_order_items',
    route: '/api/stockIssueItems',
    group: 'Inventory',
    dropdowns: {
      mo_id: 'stockIssues',
      item_id: 'items',
    },
  },
  productionOrders: {
    title: 'Production Order',
    table: 'production_order',
    route: '/api/productionOrders',
    group: 'Production',
    transactionNumber: { column: 'production_order_number', prefix: 'PROD' },
    dropdowns: {
      customer_order_id: 'salesOrders',
      finished_item_id: 'items',
      department_id: 'departments',
      created_by: 'employees',
      approved_by: 'employees',
    },
  },
  productionOrderItems: {
    title: 'Production Order Items',
    table: 'production_order_items',
    route: '/api/productionOrderItems',
    group: 'Production',
    dropdowns: {
      production_order_id: 'productionOrders',
      item_id: 'items',
    },
  },
  bomConsumptions: {
    title: 'BOM Consumption',
    table: 'bom_consumption',
    route: '/api/bomConsumptions',
    group: 'Production',
    dropdowns: {
      production_order_item_id: 'productionOrderItems',
      finished_item_id: 'items',
      consumed_item_id: 'items',
      consumed_by: 'employees',
    },
  },
  finishedGoodsReceipts: {
    title: 'Finished Goods Receipt',
    table: 'finished_goods_receipt',
    route: '/api/finishedGoodsReceipts',
    group: 'Production',
    transactionNumber: { column: 'fg_receipt_number', prefix: 'FGR' },
    dropdowns: {
      production_order_item_id: 'productionOrderItems',
      production_order_id: 'productionOrders',
      finished_item_id: 'items',
      received_by: 'employees',
    },
  },
  salesOrders: {
    title: 'Sales Order',
    table: 'customer_order',
    route: '/api/salesOrders',
    group: 'Sales',
    transactionNumber: { column: 'co_number', prefix: 'SO' },
    dropdowns: {
      customer_id: 'customers',
    },
  },
  salesOrderItems: {
    title: 'Sales Order Items',
    table: 'customer_order_items',
    route: '/api/salesOrderItems',
    group: 'Sales',
    dropdowns: {
      co_id: 'salesOrders',
      item_id: 'items',
    },
  },
  dispatches: {
    title: 'Dispatch',
    table: 'dispatch',
    route: '/api/dispatches',
    group: 'Sales',
    transactionNumber: { column: 'dispatch_number', prefix: 'DSP' },
    dropdowns: {
      co_id: 'salesOrders',
      customer_id: 'customers',
      dispatched_by: 'employees',
    },
  },
  dispatchItems: {
    title: 'Dispatch Items',
    table: 'dispatch_items',
    route: '/api/dispatchItems',
    group: 'Sales',
    dropdowns: {
      dispatch_id: 'dispatches',
      co_item_id: 'salesOrderItems',
      item_id: 'items',
    },
  },
  qualityInspections: {
    title: 'Quality Inspection',
    table: 'quality_inspection',
    route: '/api/qualityInspections',
    group: 'Quality',
    dropdowns: {
      grn_id: 'grns',
      production_order_id: 'productionOrders',
      finished_goods_receipt_id: 'finishedGoodsReceipts',
    },
  },
};

export const financeModules = {
  chartOfAccounts: {
    title: 'Chart of Accounts',
    table: 'chart_of_accounts',
    route: '/api/chartOfAccounts',
    group: 'Finance',
    dropdowns: {
      parent_account_id: 'chartOfAccounts',
      created_by: 'employees',
      updated_by: 'employees',
    },
  },
  taxMaster: {
    title: 'Tax Master',
    table: 'tax_master',
    route: '/api/taxMaster',
    group: 'Finance',
    dropdowns: {
      created_by: 'employees',
      updated_by: 'employees',
    },
  },
  bankMaster: {
    title: 'Bank Master',
    table: 'bank_master',
    route: '/api/bankMaster',
    group: 'Finance',
    dropdowns: {
      linked_account_id: 'chartOfAccounts',
      created_by: 'employees',
      updated_by: 'employees',
    },
  },
  financialPeriods: {
    title: 'Financial Period',
    table: 'financial_period',
    route: '/api/financialPeriods',
    group: 'Finance',
    dropdowns: {
      created_by: 'employees',
      updated_by: 'employees',
    },
  },
  vendorInvoices: {
    title: 'Vendor Invoice',
    table: 'vendor_invoice',
    route: '/api/vendorInvoices',
    group: 'Finance',
    transactionNumber: { column: 'vendor_invoice_no', prefix: 'VI' },
    dropdowns: {
      vendor_id: 'vendors',
      po_id: 'purchaseOrders',
      grn_id: 'grns',
      created_by: 'employees',
      updated_by: 'employees',
    },
  },
  vendorInvoiceItems: {
    title: 'Vendor Invoice Items',
    table: 'vendor_invoice_items',
    route: '/api/vendorInvoiceItems',
    group: 'Finance',
    dropdowns: {
      vendor_invoice_id: 'vendorInvoices',
      item_id: 'items',
      tax_id: 'taxMaster',
    },
  },
  vendorPayments: {
    title: 'Vendor Payment',
    table: 'vendor_payment',
    route: '/api/vendorPayments',
    group: 'Finance',
    transactionNumber: { column: 'vendor_payment_no', prefix: 'VP' },
    dropdowns: {
      vendor_invoice_id: 'vendorInvoices',
      vendor_id: 'vendors',
      bank_id: 'bankMaster',
      created_by: 'employees',
      updated_by: 'employees',
    },
  },
  customerInvoices: {
    title: 'Customer Invoice',
    table: 'customer_invoice',
    route: '/api/customerInvoices',
    group: 'Finance',
    transactionNumber: { column: 'customer_invoice_no', prefix: 'CI' },
    dropdowns: {
      customer_id: 'customers',
      customer_order_id: 'salesOrders',
      dispatch_id: 'dispatches',
      created_by: 'employees',
      updated_by: 'employees',
    },
  },
  customerInvoiceItems: {
    title: 'Customer Invoice Items',
    table: 'customer_invoice_items',
    route: '/api/customerInvoiceItems',
    group: 'Finance',
    dropdowns: {
      customer_invoice_id: 'customerInvoices',
      item_id: 'items',
      tax_id: 'taxMaster',
    },
  },
  customerReceipts: {
    title: 'Customer Receipt',
    table: 'customer_receipt',
    route: '/api/customerReceipts',
    group: 'Finance',
    transactionNumber: { column: 'customer_receipt_no', prefix: 'CR' },
    dropdowns: {
      customer_invoice_id: 'customerInvoices',
      customer_id: 'customers',
      bank_id: 'bankMaster',
      created_by: 'employees',
      updated_by: 'employees',
    },
  },
  journalEntries: {
    title: 'Journal Entry',
    table: 'journal_entry',
    route: '/api/journalEntries',
    group: 'Finance',
    transactionNumber: { column: 'journal_entry_no', prefix: 'JE' },
    dropdowns: {
      period_id: 'financialPeriods',
      created_by: 'employees',
      updated_by: 'employees',
    },
  },
  journalEntryLines: {
    title: 'Journal Entry Lines',
    table: 'journal_entry_lines',
    route: '/api/journalEntryLines',
    group: 'Finance',
    dropdowns: {
      journal_entry_id: 'journalEntries',
      account_id: 'chartOfAccounts',
    },
  },
};

export const erpModules = {
  ...phaseOneModules,
  ...phaseTwoModules,
  ...financeModules,
};

export function ensureModule(moduleKey) {
  const module = erpModules[moduleKey];
  if (!module) {
    const error = new Error('Module not found.');
    error.status = 404;
    throw error;
  }
  return module;
}

export function getTableToModuleMap() {
  return Object.fromEntries(
    Object.entries(erpModules).map(([key, module]) => [module.table, key]),
  );
}
