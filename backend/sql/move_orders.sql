CREATE TABLE IF NOT EXISTS move_orders (
  move_order_id INT AUTO_INCREMENT PRIMARY KEY,
  move_order_no VARCHAR(30) NOT NULL,
  move_order_date DATE NOT NULL,
  requested_by_employee_id INT NOT NULL,
  from_department_id INT NOT NULL,
  to_department_id INT NOT NULL,
  from_location VARCHAR(120) NOT NULL,
  to_location VARCHAR(120) NOT NULL,
  move_order_type ENUM(
    'Stores to Production',
    'Stores to Maintenance',
    'Production to Quality',
    'Production to Finished Goods',
    'Finished Goods to Dispatch',
    'Inter-Department Transfer',
    'Return to Stores'
  ) NOT NULL,
  priority ENUM('Low', 'Medium', 'High', 'Urgent') NOT NULL DEFAULT 'Medium',
  reason VARCHAR(500) NULL,
  required_date DATE NULL,
  status ENUM(
    'Draft',
    'Pending Approval',
    'Approved',
    'Issued',
    'Partially Received',
    'Received',
    'Cancelled'
  ) NOT NULL DEFAULT 'Draft',
  approved_by_employee_id INT NULL,
  approved_date DATE NULL,
  issued_by_employee_id INT NULL,
  received_by_employee_id INT NULL,
  remarks VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_move_orders_move_order_no UNIQUE (move_order_no),
  CONSTRAINT fk_move_orders_requested_by
    FOREIGN KEY (requested_by_employee_id) REFERENCES employee_master(employee_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_move_orders_approved_by
    FOREIGN KEY (approved_by_employee_id) REFERENCES employee_master(employee_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_move_orders_issued_by
    FOREIGN KEY (issued_by_employee_id) REFERENCES employee_master(employee_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_move_orders_received_by
    FOREIGN KEY (received_by_employee_id) REFERENCES employee_master(employee_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_move_orders_from_department
    FOREIGN KEY (from_department_id) REFERENCES department_master(department_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_move_orders_to_department
    FOREIGN KEY (to_department_id) REFERENCES department_master(department_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT chk_move_orders_locations CHECK (
    TRIM(from_location) <> ''
    AND TRIM(to_location) <> ''
    AND from_location <> to_location
  ),
  CONSTRAINT chk_move_orders_required_date CHECK (
    required_date IS NULL OR required_date >= move_order_date
  ),
  CONSTRAINT chk_move_orders_approved_date CHECK (
    approved_date IS NULL OR approved_date >= move_order_date
  ),
  INDEX idx_move_orders_date (move_order_date),
  INDEX idx_move_orders_status (status),
  INDEX idx_move_orders_from_department (from_department_id),
  INDEX idx_move_orders_to_department (to_department_id),
  INDEX idx_move_orders_departments (from_department_id, to_department_id),
  INDEX idx_move_orders_requested_by (requested_by_employee_id),
  INDEX idx_move_orders_type_status (move_order_type, status),
  INDEX idx_move_orders_required_date (required_date)
);
