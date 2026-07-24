CREATE TABLE IF NOT EXISTS inventory_balance (
  balance_id INT AUTO_INCREMENT PRIMARY KEY,
  item_id INT NOT NULL,
  department_id INT NOT NULL,
  location_id VARCHAR(40) NOT NULL,
  warehouse_location VARCHAR(80) NOT NULL,
  quantity_on_hand DECIMAL(14, 3) NOT NULL DEFAULT 0,
  reserved_quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  available_quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  reorder_level DECIMAL(14, 3) NOT NULL DEFAULT 0,
  safety_stock DECIMAL(14, 3) NOT NULL DEFAULT 0,
  max_stock DECIMAL(14, 3) NOT NULL DEFAULT 0,
  current_stock DECIMAL(14, 3) NOT NULL DEFAULT 0,
  inventory_value DECIMAL(14, 2) NOT NULL DEFAULT 0,
  last_updated DATE NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'Active',
  data_issue_quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_inventory_balance_item
    FOREIGN KEY (item_id) REFERENCES item_master(item_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_inventory_balance_department
    FOREIGN KEY (department_id) REFERENCES department_master(department_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT chk_inventory_balance_quantities CHECK (
    quantity_on_hand >= 0
    AND reserved_quantity >= 0
    AND available_quantity = quantity_on_hand - reserved_quantity
    AND current_stock = quantity_on_hand
    AND data_issue_quantity >= 0
  ),
  CONSTRAINT chk_inventory_balance_stock_levels CHECK (
    reorder_level >= 0
    AND safety_stock >= 0
    AND max_stock >= reorder_level
  ),
  UNIQUE KEY uq_inventory_balance_item_department (item_id, department_id),
  INDEX idx_inventory_balance_department (department_id),
  INDEX idx_inventory_balance_location (location_id),
  INDEX idx_inventory_balance_status (status),
  INDEX idx_inventory_balance_reorder (department_id, available_quantity, reorder_level)
);
