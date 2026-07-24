CREATE TABLE IF NOT EXISTS production_order_items (
  production_order_item_id INT AUTO_INCREMENT PRIMARY KEY,
  production_order_id INT NOT NULL,
  item_id INT NOT NULL,
  planned_quantity DECIMAL(12, 3) NOT NULL,
  produced_quantity DECIMAL(12, 3) NOT NULL DEFAULT 0,
  accepted_quantity DECIMAL(12, 3) NOT NULL DEFAULT 0,
  rejected_quantity DECIMAL(12, 3) NOT NULL DEFAULT 0,
  uom VARCHAR(10) NOT NULL,
  production_stage ENUM('Stator Assembly', 'Rotor Assembly', 'Final Motor Assembly', 'Rework', 'Testing') NOT NULL,
  line_status ENUM('Planned', 'In Progress', 'Completed', 'Partially Completed', 'Rejected', 'On Hold') NOT NULL DEFAULT 'Planned',
  remarks VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_prod_order_items_order
    FOREIGN KEY (production_order_id) REFERENCES production_order(production_order_id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_prod_order_items_item
    FOREIGN KEY (item_id) REFERENCES item_master(item_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT chk_prod_order_items_quantities CHECK (
    planned_quantity > 0
    AND produced_quantity >= 0
    AND accepted_quantity >= 0
    AND rejected_quantity >= 0
    AND accepted_quantity + rejected_quantity = produced_quantity
    AND produced_quantity <= planned_quantity
  ),
  INDEX idx_prod_order_items_order (production_order_id),
  INDEX idx_prod_order_items_item (item_id),
  INDEX idx_prod_order_items_stage_status (production_stage, line_status),
  INDEX idx_prod_order_items_rejection (item_id, rejected_quantity, line_status)
);

DELIMITER $$

DROP TRIGGER IF EXISTS trg_production_order_items_before_insert$$
DROP TRIGGER IF EXISTS trg_production_order_items_before_update$$

CREATE TRIGGER trg_production_order_items_before_insert
BEFORE INSERT ON production_order_items
FOR EACH ROW
BEGIN
  DECLARE item_category VARCHAR(50);
  DECLARE parent_item_id INT;

  SELECT category INTO item_category
    FROM item_master
   WHERE item_id = NEW.item_id;

  IF item_category IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'production_order_items.item_id must reference an existing item';
  END IF;

  IF item_category NOT IN ('Finished Goods', 'Semi-Finished Goods', 'Core Components', 'Mechanical Components') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'production order output items should be finished or semi-finished motor assemblies';
  END IF;

  SELECT finished_item_id INTO parent_item_id
    FROM production_order
   WHERE production_order_id = NEW.production_order_id;

  IF parent_item_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'production_order_id must reference an existing production order';
  END IF;

  IF NEW.accepted_quantity + NEW.rejected_quantity <> NEW.produced_quantity THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'accepted_quantity plus rejected_quantity must equal produced_quantity';
  END IF;

  IF NEW.produced_quantity > NEW.planned_quantity THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'produced_quantity cannot exceed planned_quantity';
  END IF;

  IF NEW.line_status = 'Completed'
     AND NEW.accepted_quantity <= 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'completed production order item lines require accepted quantity';
  END IF;

  IF NEW.line_status = 'Rejected'
     AND (NEW.remarks IS NULL OR TRIM(NEW.remarks) = '') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'rejected production order item lines require rejection remarks';
  END IF;
END$$

CREATE TRIGGER trg_production_order_items_before_update
BEFORE UPDATE ON production_order_items
FOR EACH ROW
BEGIN
  DECLARE item_category VARCHAR(50);
  DECLARE parent_item_id INT;

  SELECT category INTO item_category
    FROM item_master
   WHERE item_id = NEW.item_id;

  IF item_category IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'production_order_items.item_id must reference an existing item';
  END IF;

  IF item_category NOT IN ('Finished Goods', 'Semi-Finished Goods', 'Core Components', 'Mechanical Components') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'production order output items should be finished or semi-finished motor assemblies';
  END IF;

  SELECT finished_item_id INTO parent_item_id
    FROM production_order
   WHERE production_order_id = NEW.production_order_id;

  IF parent_item_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'production_order_id must reference an existing production order';
  END IF;

  IF NEW.accepted_quantity + NEW.rejected_quantity <> NEW.produced_quantity THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'accepted_quantity plus rejected_quantity must equal produced_quantity';
  END IF;

  IF NEW.produced_quantity > NEW.planned_quantity THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'produced_quantity cannot exceed planned_quantity';
  END IF;

  IF NEW.line_status = 'Completed'
     AND NEW.accepted_quantity <= 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'completed production order item lines require accepted quantity';
  END IF;

  IF NEW.line_status = 'Rejected'
     AND (NEW.remarks IS NULL OR TRIM(NEW.remarks) = '') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'rejected production order item lines require rejection remarks';
  END IF;
END$$

DELIMITER ;
