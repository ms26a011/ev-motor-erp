CREATE TABLE IF NOT EXISTS finished_goods_receipt (
  fg_receipt_id INT AUTO_INCREMENT PRIMARY KEY,
  fg_receipt_number VARCHAR(40) NOT NULL UNIQUE,
  production_order_item_id INT NOT NULL,
  production_order_id INT NOT NULL,
  finished_item_id INT NOT NULL,
  received_quantity DECIMAL(14, 3) NOT NULL,
  accepted_quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  rejected_quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  uom VARCHAR(20) NOT NULL,
  receipt_date DATE NOT NULL,
  received_by INT NOT NULL,
  inspection_status ENUM('Pending Inspection', 'Accepted', 'Partially Accepted', 'Rejected') NOT NULL DEFAULT 'Pending Inspection',
  warehouse_location VARCHAR(100) NOT NULL,
  batch_number VARCHAR(80) NOT NULL,
  serial_number_start VARCHAR(80) NULL,
  serial_number_end VARCHAR(80) NULL,
  remarks VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_fgr_prod_order_item
    FOREIGN KEY (production_order_item_id) REFERENCES production_order_items(production_order_item_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_fgr_prod_order
    FOREIGN KEY (production_order_id) REFERENCES production_order(production_order_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_fgr_finished_item
    FOREIGN KEY (finished_item_id) REFERENCES item_master(item_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_fgr_received_by
    FOREIGN KEY (received_by) REFERENCES employee_master(employee_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT chk_fgr_quantities CHECK (
    received_quantity > 0
    AND accepted_quantity >= 0
    AND rejected_quantity >= 0
    AND (
      (inspection_status = 'Pending Inspection' AND accepted_quantity = 0 AND rejected_quantity = 0)
      OR (inspection_status <> 'Pending Inspection' AND accepted_quantity + rejected_quantity = received_quantity)
    )
  ),
  INDEX idx_fgr_receipt_date (receipt_date),
  INDEX idx_fgr_prod_order_item (production_order_item_id),
  INDEX idx_fgr_prod_order (production_order_id),
  INDEX idx_fgr_finished_item_date (finished_item_id, receipt_date),
  INDEX idx_fgr_inspection_status (inspection_status, receipt_date),
  INDEX idx_fgr_batch (batch_number),
  INDEX idx_fgr_serial_range (serial_number_start, serial_number_end)
);

DELIMITER $$

DROP TRIGGER IF EXISTS trg_finished_goods_receipt_before_insert$$
DROP TRIGGER IF EXISTS trg_finished_goods_receipt_before_update$$

CREATE TRIGGER trg_finished_goods_receipt_before_insert
BEFORE INSERT ON finished_goods_receipt
FOR EACH ROW
BEGIN
  DECLARE parent_order_id INT;
  DECLARE output_item_id INT;
  DECLARE item_category VARCHAR(50);
  DECLARE start_date DATE;

  SELECT poi.production_order_id,
         poi.item_id,
         DATE(COALESCE(po.actual_start_date, po.planned_start_date))
    INTO parent_order_id, output_item_id, start_date
    FROM production_order_items poi
    JOIN production_order po ON po.production_order_id = poi.production_order_id
   WHERE poi.production_order_item_id = NEW.production_order_item_id;

  IF parent_order_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'production_order_item_id must reference an existing production order item';
  END IF;

  IF NEW.production_order_id <> parent_order_id THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'production_order_id must match the selected production order item';
  END IF;

  IF NEW.finished_item_id <> output_item_id THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'finished_item_id must match the item produced in production_order_items';
  END IF;

  SELECT category INTO item_category
    FROM item_master
   WHERE item_id = NEW.finished_item_id;

  IF item_category NOT IN ('Finished Goods', 'Semi-Finished Goods', 'Core Components', 'Mechanical Components') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'finished goods receipts must be for finished or semi-finished motor assemblies';
  END IF;

  IF NEW.receipt_date < start_date THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'receipt_date cannot be earlier than production start date';
  END IF;

  IF NEW.inspection_status = 'Accepted'
     AND NOT (NEW.accepted_quantity = NEW.received_quantity AND NEW.rejected_quantity = 0) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'accepted receipts must be fully accepted';
  END IF;

  IF NEW.inspection_status = 'Partially Accepted'
     AND NOT (NEW.accepted_quantity > 0 AND NEW.rejected_quantity > 0) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'partially accepted receipts require accepted and rejected quantities';
  END IF;

  IF NEW.inspection_status = 'Rejected'
     AND NOT (NEW.accepted_quantity = 0 AND NEW.rejected_quantity = NEW.received_quantity) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'rejected receipts must be fully rejected';
  END IF;

  IF NEW.rejected_quantity > 0
     AND (NEW.remarks IS NULL OR TRIM(NEW.remarks) = '') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'rejected finished goods receipts require remarks';
  END IF;
END$$

CREATE TRIGGER trg_finished_goods_receipt_before_update
BEFORE UPDATE ON finished_goods_receipt
FOR EACH ROW
BEGIN
  DECLARE parent_order_id INT;
  DECLARE output_item_id INT;
  DECLARE item_category VARCHAR(50);
  DECLARE start_date DATE;

  SELECT poi.production_order_id,
         poi.item_id,
         DATE(COALESCE(po.actual_start_date, po.planned_start_date))
    INTO parent_order_id, output_item_id, start_date
    FROM production_order_items poi
    JOIN production_order po ON po.production_order_id = poi.production_order_id
   WHERE poi.production_order_item_id = NEW.production_order_item_id;

  IF parent_order_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'production_order_item_id must reference an existing production order item';
  END IF;

  IF NEW.production_order_id <> parent_order_id THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'production_order_id must match the selected production order item';
  END IF;

  IF NEW.finished_item_id <> output_item_id THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'finished_item_id must match the item produced in production_order_items';
  END IF;

  SELECT category INTO item_category
    FROM item_master
   WHERE item_id = NEW.finished_item_id;

  IF item_category NOT IN ('Finished Goods', 'Semi-Finished Goods', 'Core Components', 'Mechanical Components') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'finished goods receipts must be for finished or semi-finished motor assemblies';
  END IF;

  IF NEW.receipt_date < start_date THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'receipt_date cannot be earlier than production start date';
  END IF;

  IF NEW.inspection_status = 'Accepted'
     AND NOT (NEW.accepted_quantity = NEW.received_quantity AND NEW.rejected_quantity = 0) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'accepted receipts must be fully accepted';
  END IF;

  IF NEW.inspection_status = 'Partially Accepted'
     AND NOT (NEW.accepted_quantity > 0 AND NEW.rejected_quantity > 0) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'partially accepted receipts require accepted and rejected quantities';
  END IF;

  IF NEW.inspection_status = 'Rejected'
     AND NOT (NEW.accepted_quantity = 0 AND NEW.rejected_quantity = NEW.received_quantity) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'rejected receipts must be fully rejected';
  END IF;

  IF NEW.rejected_quantity > 0
     AND (NEW.remarks IS NULL OR TRIM(NEW.remarks) = '') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'rejected finished goods receipts require remarks';
  END IF;
END$$

DELIMITER ;
