CREATE TABLE IF NOT EXISTS purchase_requisition (
  purchase_requisition_id INT AUTO_INCREMENT PRIMARY KEY,
  requisition_number VARCHAR(50) NOT NULL UNIQUE,
  requisition_date DATE NOT NULL,
  department_id INT NOT NULL,
  employee_id INT NOT NULL,
  item_id INT NOT NULL,
  required_quantity DECIMAL(14, 3) NOT NULL,
  required_date DATE NULL,
  purpose VARCHAR(255) NULL,
  status ENUM('Draft', 'Submitted', 'Approved', 'Rejected', 'Converted to PO') NOT NULL DEFAULT 'Draft',
  created_by VARCHAR(100) NULL,
  updated_by VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pr_department FOREIGN KEY (department_id) REFERENCES department_master(department_id),
  CONSTRAINT fk_pr_employee FOREIGN KEY (employee_id) REFERENCES employee_master(employee_id),
  CONSTRAINT fk_pr_item FOREIGN KEY (item_id) REFERENCES item_master(item_id)
);

CREATE TABLE IF NOT EXISTS purchase_order (
  purchase_order_id INT AUTO_INCREMENT PRIMARY KEY,
  po_number VARCHAR(50) NOT NULL UNIQUE,
  po_date DATE NOT NULL,
  vendor_id INT NOT NULL,
  item_id INT NOT NULL,
  purchase_requisition_id INT NULL,
  ordered_quantity DECIMAL(14, 3) NOT NULL,
  unit_price DECIMAL(14, 2) NOT NULL,
  tax_amount DECIMAL(14, 2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(14, 2) NOT NULL,
  expected_delivery_date DATE NULL,
  status ENUM('Draft', 'Approved', 'Sent', 'Partially Received', 'Received', 'Closed', 'Cancelled') NOT NULL DEFAULT 'Draft',
  created_by VARCHAR(100) NULL,
  updated_by VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_po_vendor FOREIGN KEY (vendor_id) REFERENCES vendor_master(vendor_id),
  CONSTRAINT fk_po_item FOREIGN KEY (item_id) REFERENCES item_master(item_id),
  CONSTRAINT fk_po_pr FOREIGN KEY (purchase_requisition_id) REFERENCES purchase_requisition(purchase_requisition_id)
);

CREATE TABLE IF NOT EXISTS goods_receipt_note (
  grn_id INT AUTO_INCREMENT PRIMARY KEY,
  grn_number VARCHAR(50) NOT NULL UNIQUE,
  grn_date DATE NOT NULL,
  purchase_order_id INT NOT NULL,
  item_id INT NOT NULL,
  received_quantity DECIMAL(14, 3) NOT NULL,
  accepted_quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  rejected_quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  status ENUM('Draft', 'Under Inspection', 'Accepted', 'Partially Accepted', 'Rejected', 'Posted') NOT NULL DEFAULT 'Draft',
  stock_posted TINYINT(1) NOT NULL DEFAULT 0,
  created_by VARCHAR(100) NULL,
  updated_by VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_grn_po FOREIGN KEY (purchase_order_id) REFERENCES purchase_order(purchase_order_id),
  CONSTRAINT fk_grn_item FOREIGN KEY (item_id) REFERENCES item_master(item_id)
);

CREATE TABLE IF NOT EXISTS inventory_stock_balance (
  item_id INT PRIMARY KEY,
  quantity_on_hand DECIMAL(14, 3) NOT NULL DEFAULT 0,
  stock_value DECIMAL(14, 2) NOT NULL DEFAULT 0,
  reorder_level DECIMAL(14, 3) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_stock_balance_item FOREIGN KEY (item_id) REFERENCES item_master(item_id)
);

CREATE TABLE IF NOT EXISTS inventory_stock_ledger (
  stock_ledger_id INT AUTO_INCREMENT PRIMARY KEY,
  item_id INT NOT NULL,
  movement_type ENUM('IN', 'OUT') NOT NULL,
  source_type VARCHAR(50) NOT NULL,
  source_id INT NOT NULL,
  reference_number VARCHAR(50) NULL,
  quantity DECIMAL(14, 3) NOT NULL,
  movement_date DATE NOT NULL,
  created_by VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_stock_ledger_item FOREIGN KEY (item_id) REFERENCES item_master(item_id),
  INDEX idx_stock_ledger_source (source_type, source_id),
  INDEX idx_stock_ledger_item_date (item_id, movement_date)
);

CREATE TABLE IF NOT EXISTS inventory_stock_inward (
  stock_inward_id INT AUTO_INCREMENT PRIMARY KEY,
  inward_number VARCHAR(50) NOT NULL UNIQUE,
  inward_date DATE NOT NULL,
  grn_id INT NULL,
  item_id INT NOT NULL,
  quantity DECIMAL(14, 3) NOT NULL,
  status ENUM('Draft', 'Posted', 'Cancelled') NOT NULL DEFAULT 'Draft',
  stock_posted TINYINT(1) NOT NULL DEFAULT 0,
  created_by VARCHAR(100) NULL,
  updated_by VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_stock_inward_grn FOREIGN KEY (grn_id) REFERENCES goods_receipt_note(grn_id),
  CONSTRAINT fk_stock_inward_item FOREIGN KEY (item_id) REFERENCES item_master(item_id)
);

CREATE TABLE IF NOT EXISTS production_order (
  production_order_id INT AUTO_INCREMENT PRIMARY KEY,
  production_order_number VARCHAR(50) NOT NULL UNIQUE,
  order_date DATE NOT NULL,
  finished_goods_item_id INT NOT NULL,
  planned_quantity DECIMAL(14, 3) NOT NULL,
  completed_quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  planned_start_date DATE NULL,
  planned_end_date DATE NULL,
  status ENUM('Planned', 'Released', 'In Progress', 'Completed', 'Cancelled') NOT NULL DEFAULT 'Planned',
  created_by VARCHAR(100) NULL,
  updated_by VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_prod_finished_item FOREIGN KEY (finished_goods_item_id) REFERENCES item_master(item_id)
);

CREATE TABLE IF NOT EXISTS inventory_stock_issue (
  stock_issue_id INT AUTO_INCREMENT PRIMARY KEY,
  issue_number VARCHAR(50) NOT NULL UNIQUE,
  issue_date DATE NOT NULL,
  department_id INT NOT NULL,
  employee_id INT NOT NULL,
  production_order_id INT NULL,
  item_id INT NOT NULL,
  quantity DECIMAL(14, 3) NOT NULL,
  status ENUM('Draft', 'Approved', 'Issued', 'Cancelled') NOT NULL DEFAULT 'Draft',
  stock_posted TINYINT(1) NOT NULL DEFAULT 0,
  created_by VARCHAR(100) NULL,
  updated_by VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_stock_issue_department FOREIGN KEY (department_id) REFERENCES department_master(department_id),
  CONSTRAINT fk_stock_issue_employee FOREIGN KEY (employee_id) REFERENCES employee_master(employee_id),
  CONSTRAINT fk_stock_issue_production FOREIGN KEY (production_order_id) REFERENCES production_order(production_order_id),
  CONSTRAINT fk_stock_issue_item FOREIGN KEY (item_id) REFERENCES item_master(item_id)
);

CREATE TABLE IF NOT EXISTS bom_consumption (
  bom_consumption_id INT AUTO_INCREMENT PRIMARY KEY,
  production_order_id INT NOT NULL,
  component_item_id INT NOT NULL,
  planned_quantity DECIMAL(14, 3) NOT NULL,
  consumed_quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  variance_quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  status ENUM('Draft', 'Posted', 'Cancelled') NOT NULL DEFAULT 'Draft',
  created_by VARCHAR(100) NULL,
  updated_by VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_bom_production FOREIGN KEY (production_order_id) REFERENCES production_order(production_order_id),
  CONSTRAINT fk_bom_component_item FOREIGN KEY (component_item_id) REFERENCES item_master(item_id)
);

CREATE TABLE IF NOT EXISTS finished_goods_receipt (
  finished_goods_receipt_id INT AUTO_INCREMENT PRIMARY KEY,
  receipt_number VARCHAR(50) NOT NULL UNIQUE,
  receipt_date DATE NOT NULL,
  production_order_id INT NOT NULL,
  finished_goods_item_id INT NOT NULL,
  quantity DECIMAL(14, 3) NOT NULL,
  status ENUM('Draft', 'Received', 'Posted', 'Cancelled') NOT NULL DEFAULT 'Draft',
  stock_posted TINYINT(1) NOT NULL DEFAULT 0,
  created_by VARCHAR(100) NULL,
  updated_by VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_fgr_production FOREIGN KEY (production_order_id) REFERENCES production_order(production_order_id),
  CONSTRAINT fk_fgr_item FOREIGN KEY (finished_goods_item_id) REFERENCES item_master(item_id)
);

CREATE TABLE IF NOT EXISTS sales_order (
  sales_order_id INT AUTO_INCREMENT PRIMARY KEY,
  sales_order_number VARCHAR(50) NOT NULL UNIQUE,
  order_date DATE NOT NULL,
  customer_id INT NOT NULL,
  finished_goods_item_id INT NOT NULL,
  ordered_quantity DECIMAL(14, 3) NOT NULL,
  unit_price DECIMAL(14, 2) NOT NULL,
  tax_amount DECIMAL(14, 2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(14, 2) NOT NULL,
  promised_delivery_date DATE NULL,
  status ENUM('Draft', 'Confirmed', 'Partially Dispatched', 'Dispatched', 'Closed', 'Cancelled') NOT NULL DEFAULT 'Draft',
  created_by VARCHAR(100) NULL,
  updated_by VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_so_customer FOREIGN KEY (customer_id) REFERENCES customer_master(customer_id),
  CONSTRAINT fk_so_finished_item FOREIGN KEY (finished_goods_item_id) REFERENCES item_master(item_id)
);

CREATE TABLE IF NOT EXISTS dispatch (
  dispatch_id INT AUTO_INCREMENT PRIMARY KEY,
  dispatch_number VARCHAR(50) NOT NULL UNIQUE,
  dispatch_date DATE NOT NULL,
  sales_order_id INT NOT NULL,
  finished_goods_item_id INT NOT NULL,
  quantity DECIMAL(14, 3) NOT NULL,
  transporter_name VARCHAR(120) NULL,
  vehicle_number VARCHAR(50) NULL,
  status ENUM('Draft', 'Packed', 'Dispatched', 'Completed', 'Cancelled') NOT NULL DEFAULT 'Draft',
  stock_posted TINYINT(1) NOT NULL DEFAULT 0,
  created_by VARCHAR(100) NULL,
  updated_by VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_dispatch_so FOREIGN KEY (sales_order_id) REFERENCES sales_order(sales_order_id),
  CONSTRAINT fk_dispatch_finished_item FOREIGN KEY (finished_goods_item_id) REFERENCES item_master(item_id)
);

CREATE TABLE IF NOT EXISTS quality_inspection (
  quality_inspection_id INT AUTO_INCREMENT PRIMARY KEY,
  inspection_number VARCHAR(50) NOT NULL UNIQUE,
  inspection_date DATE NOT NULL,
  inspection_type ENUM('GRN', 'Production', 'Finished Goods') NOT NULL,
  grn_id INT NULL,
  production_order_id INT NULL,
  finished_goods_receipt_id INT NULL,
  inspected_quantity DECIMAL(14, 3) NOT NULL,
  passed_quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  failed_quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  inspector_name VARCHAR(120) NULL,
  remarks VARCHAR(255) NULL,
  status ENUM('Pending', 'Passed', 'Partially Passed', 'Failed') NOT NULL DEFAULT 'Pending',
  created_by VARCHAR(100) NULL,
  updated_by VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_qi_grn FOREIGN KEY (grn_id) REFERENCES goods_receipt_note(grn_id),
  CONSTRAINT fk_qi_production FOREIGN KEY (production_order_id) REFERENCES production_order(production_order_id),
  CONSTRAINT fk_qi_fgr FOREIGN KEY (finished_goods_receipt_id) REFERENCES finished_goods_receipt(finished_goods_receipt_id)
);

CREATE TABLE IF NOT EXISTS vendor_invoice (
  vendor_invoice_id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_number VARCHAR(50) NOT NULL UNIQUE,
  invoice_date DATE NOT NULL,
  vendor_id INT NOT NULL,
  purchase_order_id INT NOT NULL,
  grn_id INT NOT NULL,
  invoice_amount DECIMAL(14, 2) NOT NULL,
  paid_amount DECIMAL(14, 2) NOT NULL DEFAULT 0,
  due_date DATE NULL,
  status ENUM('Draft', 'Posted', 'Partially Paid', 'Paid', 'Cancelled') NOT NULL DEFAULT 'Draft',
  created_by VARCHAR(100) NULL,
  updated_by VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_vi_vendor FOREIGN KEY (vendor_id) REFERENCES vendor_master(vendor_id),
  CONSTRAINT fk_vi_po FOREIGN KEY (purchase_order_id) REFERENCES purchase_order(purchase_order_id),
  CONSTRAINT fk_vi_grn FOREIGN KEY (grn_id) REFERENCES goods_receipt_note(grn_id)
);

CREATE TABLE IF NOT EXISTS customer_invoice (
  customer_invoice_id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_number VARCHAR(50) NOT NULL UNIQUE,
  invoice_date DATE NOT NULL,
  customer_id INT NOT NULL,
  sales_order_id INT NOT NULL,
  dispatch_id INT NOT NULL,
  invoice_amount DECIMAL(14, 2) NOT NULL,
  received_amount DECIMAL(14, 2) NOT NULL DEFAULT 0,
  due_date DATE NULL,
  status ENUM('Draft', 'Posted', 'Partially Paid', 'Paid', 'Cancelled') NOT NULL DEFAULT 'Draft',
  created_by VARCHAR(100) NULL,
  updated_by VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ci_customer FOREIGN KEY (customer_id) REFERENCES customer_master(customer_id),
  CONSTRAINT fk_ci_so FOREIGN KEY (sales_order_id) REFERENCES sales_order(sales_order_id),
  CONSTRAINT fk_ci_dispatch FOREIGN KEY (dispatch_id) REFERENCES dispatch(dispatch_id)
);

CREATE TABLE IF NOT EXISTS payment_tracking (
  payment_id INT AUTO_INCREMENT PRIMARY KEY,
  payment_number VARCHAR(50) NOT NULL UNIQUE,
  payment_date DATE NOT NULL,
  payment_type ENUM('Vendor Payment', 'Customer Receipt') NOT NULL,
  vendor_invoice_id INT NULL,
  customer_invoice_id INT NULL,
  amount DECIMAL(14, 2) NOT NULL,
  payment_mode VARCHAR(50) NULL,
  reference_number VARCHAR(100) NULL,
  status ENUM('Pending', 'Completed', 'Failed', 'Reversed') NOT NULL DEFAULT 'Pending',
  payment_posted TINYINT(1) NOT NULL DEFAULT 0,
  created_by VARCHAR(100) NULL,
  updated_by VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_payment_vendor_invoice FOREIGN KEY (vendor_invoice_id) REFERENCES vendor_invoice(vendor_invoice_id),
  CONSTRAINT fk_payment_customer_invoice FOREIGN KEY (customer_invoice_id) REFERENCES customer_invoice(customer_invoice_id)
);
