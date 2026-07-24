CREATE TABLE IF NOT EXISTS bom_consumption (
  bom_consumption_id INT AUTO_INCREMENT PRIMARY KEY,
  production_order_item_id INT NOT NULL,
  finished_item_id INT NOT NULL,
  consumed_item_id INT NOT NULL,
  planned_quantity DECIMAL(14, 3) NOT NULL,
  issued_quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  actual_consumed_quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  returned_quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  wastage_quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  uom VARCHAR(20) NOT NULL,
  warehouse_location VARCHAR(100) NOT NULL,
  batch_number VARCHAR(60) NOT NULL,
  consumption_date DATE NOT NULL,
  consumed_by INT NOT NULL,
  transaction_status ENUM('Planned', 'Issued', 'Consumed', 'Partially Consumed', 'Returned', 'Closed') NOT NULL DEFAULT 'Planned',
  remarks VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_bom_cons_prod_order_item
    FOREIGN KEY (production_order_item_id) REFERENCES production_order_items(production_order_item_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_bom_cons_finished_item
    FOREIGN KEY (finished_item_id) REFERENCES item_master(item_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_bom_cons_consumed_item
    FOREIGN KEY (consumed_item_id) REFERENCES item_master(item_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_bom_cons_consumed_by
    FOREIGN KEY (consumed_by) REFERENCES employee_master(employee_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT chk_bom_cons_quantities CHECK (
    planned_quantity > 0
    AND issued_quantity >= 0
    AND actual_consumed_quantity >= 0
    AND returned_quantity >= 0
    AND wastage_quantity >= 0
    AND issued_quantity >= actual_consumed_quantity
    AND returned_quantity <= issued_quantity
    AND returned_quantity + actual_consumed_quantity + wastage_quantity = issued_quantity
  ),
  INDEX idx_bom_cons_prod_item (production_order_item_id),
  INDEX idx_bom_cons_finished_item (finished_item_id),
  INDEX idx_bom_cons_consumed_item_date (consumed_item_id, consumption_date),
  INDEX idx_bom_cons_status_date (transaction_status, consumption_date),
  INDEX idx_bom_cons_batch (batch_number),
  INDEX idx_bom_cons_warehouse (warehouse_location)
);

DELIMITER $$

DROP TRIGGER IF EXISTS trg_bom_consumption_before_insert$$
DROP TRIGGER IF EXISTS trg_bom_consumption_before_update$$

CREATE TRIGGER trg_bom_consumption_before_insert
BEFORE INSERT ON bom_consumption
FOR EACH ROW
BEGIN
  DECLARE output_item_id INT;
  DECLARE consumed_category VARCHAR(50);
  DECLARE order_start DATE;
  DECLARE order_end DATE;

  SELECT poi.item_id,
         COALESCE(po.actual_start_date, po.planned_start_date),
         COALESCE(po.actual_end_date, po.planned_end_date)
    INTO output_item_id, order_start, order_end
    FROM production_order_items poi
    JOIN production_order po ON po.production_order_id = poi.production_order_id
   WHERE poi.production_order_item_id = NEW.production_order_item_id;

  IF output_item_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'production_order_item_id must reference an existing production order item';
  END IF;

  IF NEW.finished_item_id <> output_item_id THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'finished_item_id must match the output item in production_order_items';
  END IF;

  SELECT category INTO consumed_category
    FROM item_master
   WHERE item_id = NEW.consumed_item_id;

  IF consumed_category IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'consumed_item_id must reference an existing item';
  END IF;

  IF consumed_category IN ('Finished Goods') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'finished goods cannot normally be consumed as BOM materials';
  END IF;

  IF NEW.consumption_date < order_start OR NEW.consumption_date > order_end THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'consumption_date must fall within the production order date window';
  END IF;
END$$

CREATE TRIGGER trg_bom_consumption_before_update
BEFORE UPDATE ON bom_consumption
FOR EACH ROW
BEGIN
  DECLARE output_item_id INT;
  DECLARE consumed_category VARCHAR(50);
  DECLARE order_start DATE;
  DECLARE order_end DATE;

  SELECT poi.item_id,
         COALESCE(po.actual_start_date, po.planned_start_date),
         COALESCE(po.actual_end_date, po.planned_end_date)
    INTO output_item_id, order_start, order_end
    FROM production_order_items poi
    JOIN production_order po ON po.production_order_id = poi.production_order_id
   WHERE poi.production_order_item_id = NEW.production_order_item_id;

  IF output_item_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'production_order_item_id must reference an existing production order item';
  END IF;

  IF NEW.finished_item_id <> output_item_id THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'finished_item_id must match the output item in production_order_items';
  END IF;

  SELECT category INTO consumed_category
    FROM item_master
   WHERE item_id = NEW.consumed_item_id;

  IF consumed_category IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'consumed_item_id must reference an existing item';
  END IF;

  IF consumed_category IN ('Finished Goods') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'finished goods cannot normally be consumed as BOM materials';
  END IF;

  IF NEW.consumption_date < order_start OR NEW.consumption_date > order_end THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'consumption_date must fall within the production order date window';
  END IF;
END$$

DELIMITER ;
