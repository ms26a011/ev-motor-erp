CREATE TABLE IF NOT EXISTS inventory_transactions (
  inventory_transaction_id INT AUTO_INCREMENT PRIMARY KEY,
  transaction_number VARCHAR(40) NOT NULL UNIQUE,
  transaction_date DATE NOT NULL,
  transaction_type ENUM(
    'GRN Receipt',
    'Production Issue',
    'Production Return',
    'Stock Adjustment',
    'Stock Transfer',
    'Rejection',
    'Finished Goods Receipt',
    'Sales Dispatch'
  ) NOT NULL,
  item_id INT NOT NULL,
  source_reference_type ENUM('PR', 'PO', 'GRN', 'Production Order', 'Customer Order', 'Manual Adjustment') NOT NULL,
  source_reference_id INT NULL,
  warehouse_location VARCHAR(120) NOT NULL,
  from_location VARCHAR(120) NULL,
  to_location VARCHAR(120) NULL,
  quantity_in DECIMAL(14, 3) NOT NULL DEFAULT 0,
  quantity_out DECIMAL(14, 3) NOT NULL DEFAULT 0,
  uom VARCHAR(20) NOT NULL,
  unit_cost DECIMAL(14, 6) NOT NULL DEFAULT 0,
  transaction_value DECIMAL(14, 2)
    GENERATED ALWAYS AS (ROUND((CASE WHEN quantity_in > 0 THEN quantity_in ELSE quantity_out END) * unit_cost, 2)) STORED,
  batch_number VARCHAR(80) NULL,
  performed_by INT NOT NULL,
  remarks VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_inventory_txn_item
    FOREIGN KEY (item_id) REFERENCES item_master(item_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_inventory_txn_employee
    FOREIGN KEY (performed_by) REFERENCES employee_master(employee_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT chk_inventory_txn_quantity_direction CHECK (
    (quantity_in > 0 AND quantity_out = 0)
    OR (quantity_out > 0 AND quantity_in = 0)
  ),
  CONSTRAINT chk_inventory_txn_cost CHECK (unit_cost >= 0),
  CONSTRAINT chk_inventory_txn_locations CHECK (TRIM(warehouse_location) <> ''),
  CONSTRAINT chk_inventory_txn_uom CHECK (TRIM(uom) <> ''),
  INDEX idx_inventory_txn_date_type (transaction_date, transaction_type),
  INDEX idx_inventory_txn_item_date (item_id, transaction_date),
  INDEX idx_inventory_txn_reference (source_reference_type, source_reference_id),
  INDEX idx_inventory_txn_location (warehouse_location, transaction_date),
  INDEX idx_inventory_txn_from_to (from_location, to_location),
  INDEX idx_inventory_txn_batch (batch_number),
  INDEX idx_inventory_txn_employee (performed_by),
  INDEX idx_inventory_txn_value (transaction_value)
);

DELIMITER $$

CREATE TRIGGER trg_inventory_txn_before_insert
BEFORE INSERT ON inventory_transactions
FOR EACH ROW
BEGIN
  DECLARE item_uom VARCHAR(20);
  DECLARE item_category VARCHAR(100);
  DECLARE ref_count INT DEFAULT 0;

  SELECT uom, category
    INTO item_uom, item_category
    FROM item_master
   WHERE item_id = NEW.item_id;

  IF item_uom IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'item_id must reference an existing item';
  END IF;

  IF NEW.uom <> item_uom THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'uom must match item master uom';
  END IF;

  IF NEW.transaction_type IN ('GRN Receipt', 'Production Return', 'Finished Goods Receipt')
     AND NOT (NEW.quantity_in > 0 AND NEW.quantity_out = 0) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'inward transactions require quantity_in greater than zero and quantity_out equal to zero';
  END IF;

  IF NEW.transaction_type IN ('Production Issue', 'Rejection', 'Sales Dispatch')
     AND NOT (NEW.quantity_out > 0 AND NEW.quantity_in = 0) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'outward transactions require quantity_out greater than zero and quantity_in equal to zero';
  END IF;

  IF NEW.transaction_type = 'Stock Transfer' THEN
    IF NOT (NEW.quantity_out > 0 AND NEW.quantity_in = 0) THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'stock transfers should carry quantity_out from the source location';
    END IF;
    IF NEW.from_location IS NULL OR NEW.to_location IS NULL OR NEW.from_location = NEW.to_location THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'stock transfers require different from_location and to_location values';
    END IF;
  END IF;

  IF NEW.transaction_type = 'Stock Adjustment'
     AND (NEW.remarks IS NULL OR TRIM(NEW.remarks) = '') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'manual stock adjustments require remarks';
  END IF;

  IF NEW.transaction_type = 'GRN Receipt' THEN
    IF NEW.source_reference_type <> 'GRN' OR NEW.source_reference_id IS NULL THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'GRN Receipt transactions must reference a GRN item';
    END IF;

    SELECT COUNT(*)
      INTO ref_count
      FROM goods_receipt_items gri
      JOIN goods_receipt grn ON grn.grn_id = gri.grn_id
     WHERE gri.grn_item_id = NEW.source_reference_id
       AND gri.item_id = NEW.item_id
       AND gri.accepted_quantity > 0
       AND grn.grn_status IN ('Accepted', 'Partially Accepted', 'Closed', 'Received');

    IF ref_count = 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'GRN Receipt transactions must reference an accepted goods receipt item';
    END IF;
  END IF;

  IF NEW.transaction_type = 'Sales Dispatch' THEN
    IF item_category <> 'Finished Goods' THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Sales Dispatch transactions must use finished goods items';
    END IF;

    IF NEW.source_reference_type <> 'Customer Order' OR NEW.source_reference_id IS NULL THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Sales Dispatch transactions must reference a customer order';
    END IF;

    SELECT COUNT(*)
      INTO ref_count
      FROM customer_order
     WHERE co_id = NEW.source_reference_id;

    IF ref_count = 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Sales Dispatch source_reference_id must reference an existing customer order';
    END IF;
  END IF;

  IF NEW.transaction_type = 'Finished Goods Receipt' AND item_category <> 'Finished Goods' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Finished Goods Receipt transactions must use finished goods items';
  END IF;

  IF NEW.transaction_type = 'Rejection'
     AND NEW.to_location NOT IN ('Rejection Bay', 'Scrap Yard', 'QA Hold Area') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'rejection transactions must move stock to rejection, scrap, or QA hold location';
  END IF;
END$$

CREATE TRIGGER trg_inventory_txn_before_update
BEFORE UPDATE ON inventory_transactions
FOR EACH ROW
BEGIN
  DECLARE item_uom VARCHAR(20);
  DECLARE item_category VARCHAR(100);
  DECLARE ref_count INT DEFAULT 0;

  SELECT uom, category
    INTO item_uom, item_category
    FROM item_master
   WHERE item_id = NEW.item_id;

  IF item_uom IS NULL OR NEW.uom <> item_uom THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'item_id must exist and uom must match item master';
  END IF;

  IF NEW.transaction_type IN ('GRN Receipt', 'Production Return', 'Finished Goods Receipt')
     AND NOT (NEW.quantity_in > 0 AND NEW.quantity_out = 0) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'inward transactions require quantity_in greater than zero and quantity_out equal to zero';
  END IF;

  IF NEW.transaction_type IN ('Production Issue', 'Rejection', 'Sales Dispatch')
     AND NOT (NEW.quantity_out > 0 AND NEW.quantity_in = 0) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'outward transactions require quantity_out greater than zero and quantity_in equal to zero';
  END IF;

  IF NEW.transaction_type = 'Stock Transfer'
     AND (NEW.quantity_out <= 0 OR NEW.quantity_in <> 0 OR NEW.from_location IS NULL OR NEW.to_location IS NULL OR NEW.from_location = NEW.to_location) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'stock transfers require quantity_out and different from/to locations';
  END IF;

  IF NEW.transaction_type = 'Stock Adjustment'
     AND (NEW.remarks IS NULL OR TRIM(NEW.remarks) = '') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'manual stock adjustments require remarks';
  END IF;

  IF NEW.transaction_type = 'GRN Receipt' THEN
    SELECT COUNT(*)
      INTO ref_count
      FROM goods_receipt_items gri
      JOIN goods_receipt grn ON grn.grn_id = gri.grn_id
     WHERE gri.grn_item_id = NEW.source_reference_id
       AND gri.item_id = NEW.item_id
       AND gri.accepted_quantity > 0
       AND grn.grn_status IN ('Accepted', 'Partially Accepted', 'Closed', 'Received');

    IF NEW.source_reference_type <> 'GRN' OR ref_count = 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'GRN Receipt transactions must reference an accepted goods receipt item';
    END IF;
  END IF;

  IF NEW.transaction_type = 'Sales Dispatch' THEN
    SELECT COUNT(*)
      INTO ref_count
      FROM customer_order
     WHERE co_id = NEW.source_reference_id;

    IF item_category <> 'Finished Goods' OR NEW.source_reference_type <> 'Customer Order' OR ref_count = 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Sales Dispatch transactions must reference a customer order and finished goods item';
    END IF;
  END IF;

  IF NEW.transaction_type = 'Finished Goods Receipt' AND item_category <> 'Finished Goods' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Finished Goods Receipt transactions must use finished goods items';
  END IF;

  IF NEW.transaction_type = 'Rejection'
     AND NEW.to_location NOT IN ('Rejection Bay', 'Scrap Yard', 'QA Hold Area') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'rejection transactions must move stock to rejection, scrap, or QA hold location';
  END IF;
END$$

DELIMITER ;

-- Validation checks after loading seed data.
SELECT COUNT(*) AS orphan_item_rows
FROM inventory_transactions it
LEFT JOIN item_master im ON im.item_id = it.item_id
WHERE im.item_id IS NULL;

SELECT COUNT(*) AS orphan_employee_rows
FROM inventory_transactions it
LEFT JOIN employee_master em ON em.employee_id = it.performed_by
WHERE em.employee_id IS NULL;

SELECT COUNT(*) AS invalid_quantity_direction_rows
FROM inventory_transactions
WHERE NOT (
  (quantity_in > 0 AND quantity_out = 0)
  OR (quantity_out > 0 AND quantity_in = 0)
);

SELECT COUNT(*) AS invalid_value_rows
FROM inventory_transactions
WHERE transaction_value <> ROUND((CASE WHEN quantity_in > 0 THEN quantity_in ELSE quantity_out END) * unit_cost, 2);

SELECT COUNT(*) AS invalid_transfer_rows
FROM inventory_transactions
WHERE transaction_type = 'Stock Transfer'
  AND (from_location IS NULL OR to_location IS NULL OR from_location = to_location);

SELECT COUNT(*) AS invalid_adjustment_rows
FROM inventory_transactions
WHERE transaction_type = 'Stock Adjustment'
  AND (remarks IS NULL OR TRIM(remarks) = '');

SELECT COUNT(*) AS invalid_grn_reference_rows
FROM inventory_transactions it
LEFT JOIN goods_receipt_items gri
  ON gri.grn_item_id = it.source_reference_id
 AND gri.item_id = it.item_id
WHERE it.transaction_type = 'GRN Receipt'
  AND (it.source_reference_type <> 'GRN' OR gri.grn_item_id IS NULL);

SELECT COUNT(*) AS invalid_sales_dispatch_rows
FROM inventory_transactions it
LEFT JOIN customer_order co ON co.co_id = it.source_reference_id
LEFT JOIN item_master im ON im.item_id = it.item_id
WHERE it.transaction_type = 'Sales Dispatch'
  AND (it.source_reference_type <> 'Customer Order' OR co.co_id IS NULL OR im.category <> 'Finished Goods');

-- Sample output.
SELECT
  it.inventory_transaction_id,
  it.transaction_number,
  it.transaction_date,
  it.transaction_type,
  im.item_code,
  im.item_name,
  it.source_reference_type,
  it.source_reference_id,
  it.warehouse_location,
  it.from_location,
  it.to_location,
  it.quantity_in,
  it.quantity_out,
  it.uom,
  it.transaction_value
FROM inventory_transactions it
JOIN item_master im ON im.item_id = it.item_id
ORDER BY it.inventory_transaction_id
LIMIT 10;
