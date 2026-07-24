CREATE TABLE IF NOT EXISTS production_order (
  production_order_id INT AUTO_INCREMENT PRIMARY KEY,
  production_order_number VARCHAR(30) NOT NULL UNIQUE,
  customer_order_id INT NULL,
  finished_item_id INT NOT NULL,
  department_id INT NOT NULL,
  planned_quantity DECIMAL(12, 3) NOT NULL,
  produced_quantity DECIMAL(12, 3) NOT NULL DEFAULT 0,
  rejected_quantity DECIMAL(12, 3) NOT NULL DEFAULT 0,
  uom VARCHAR(10) NOT NULL,
  planned_start_date DATE NOT NULL,
  planned_end_date DATE NOT NULL,
  actual_start_date DATE NULL,
  actual_end_date DATE NULL,
  priority ENUM('Low', 'Medium', 'High', 'Urgent') NOT NULL DEFAULT 'Medium',
  production_status ENUM('Planned', 'Released', 'In Progress', 'Completed', 'Partially Completed', 'Cancelled', 'On Hold') NOT NULL DEFAULT 'Planned',
  created_by INT NOT NULL,
  approved_by INT NULL,
  remarks VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_prod_order_customer_order
    FOREIGN KEY (customer_order_id) REFERENCES customer_order(co_id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT fk_prod_order_finished_item
    FOREIGN KEY (finished_item_id) REFERENCES item_master(item_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_prod_order_department
    FOREIGN KEY (department_id) REFERENCES department_master(department_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_prod_order_created_by
    FOREIGN KEY (created_by) REFERENCES employee_master(employee_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_prod_order_approved_by
    FOREIGN KEY (approved_by) REFERENCES employee_master(employee_id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT chk_prod_order_quantities CHECK (
    planned_quantity > 0
    AND produced_quantity >= 0
    AND rejected_quantity >= 0
    AND produced_quantity + rejected_quantity <= planned_quantity
  ),
  CONSTRAINT chk_prod_order_planned_dates CHECK (planned_end_date > planned_start_date),
  CONSTRAINT chk_prod_order_actual_dates CHECK (
    actual_start_date IS NULL
    OR actual_end_date IS NULL
    OR actual_end_date >= actual_start_date
  ),
  INDEX idx_prod_order_customer_order (customer_order_id),
  INDEX idx_prod_order_finished_item (finished_item_id),
  INDEX idx_prod_order_department_status (department_id, production_status),
  INDEX idx_prod_order_dates (planned_start_date, planned_end_date, actual_end_date),
  INDEX idx_prod_order_priority_status (priority, production_status),
  INDEX idx_prod_order_monthly_trend (planned_start_date, planned_quantity)
);

DELIMITER $$

DROP TRIGGER IF EXISTS trg_production_order_before_insert$$
DROP TRIGGER IF EXISTS trg_production_order_before_update$$

CREATE TRIGGER trg_production_order_before_insert
BEFORE INSERT ON production_order
FOR EACH ROW
BEGIN
  DECLARE item_category VARCHAR(50);

  SELECT category INTO item_category
    FROM item_master
   WHERE item_id = NEW.finished_item_id;

  IF item_category IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'finished_item_id must reference an existing item';
  END IF;

  IF item_category NOT IN ('Finished Goods', 'Semi-Finished Goods', 'Core Components', 'Mechanical Components') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'production orders should be for finished or semi-finished motor assemblies';
  END IF;

  IF NEW.planned_end_date <= NEW.planned_start_date THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'planned_end_date must be after planned_start_date';
  END IF;

  IF NEW.actual_start_date IS NOT NULL
     AND NEW.actual_end_date IS NOT NULL
     AND NEW.actual_end_date < NEW.actual_start_date THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'actual_end_date cannot be earlier than actual_start_date';
  END IF;

  IF NEW.production_status = 'Completed'
     AND (NEW.actual_start_date IS NULL OR NEW.actual_end_date IS NULL) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'completed production orders require actual start and end dates';
  END IF;

  IF NEW.production_status = 'Cancelled'
     AND NEW.produced_quantity <> 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'cancelled production orders must have produced quantity as zero';
  END IF;

  IF NEW.production_status = 'On Hold'
     AND (NEW.remarks IS NULL OR TRIM(NEW.remarks) = '') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'on hold production orders require remarks';
  END IF;
END$$

CREATE TRIGGER trg_production_order_before_update
BEFORE UPDATE ON production_order
FOR EACH ROW
BEGIN
  DECLARE item_category VARCHAR(50);

  SELECT category INTO item_category
    FROM item_master
   WHERE item_id = NEW.finished_item_id;

  IF item_category IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'finished_item_id must reference an existing item';
  END IF;

  IF item_category NOT IN ('Finished Goods', 'Semi-Finished Goods', 'Core Components', 'Mechanical Components') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'production orders should be for finished or semi-finished motor assemblies';
  END IF;

  IF NEW.planned_end_date <= NEW.planned_start_date THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'planned_end_date must be after planned_start_date';
  END IF;

  IF NEW.actual_start_date IS NOT NULL
     AND NEW.actual_end_date IS NOT NULL
     AND NEW.actual_end_date < NEW.actual_start_date THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'actual_end_date cannot be earlier than actual_start_date';
  END IF;

  IF NEW.production_status = 'Completed'
     AND (NEW.actual_start_date IS NULL OR NEW.actual_end_date IS NULL) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'completed production orders require actual start and end dates';
  END IF;

  IF NEW.production_status = 'Cancelled'
     AND NEW.produced_quantity <> 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'cancelled production orders must have produced quantity as zero';
  END IF;

  IF NEW.production_status = 'On Hold'
     AND (NEW.remarks IS NULL OR TRIM(NEW.remarks) = '') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'on hold production orders require remarks';
  END IF;
END$$

DELIMITER ;
