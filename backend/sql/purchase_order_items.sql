CREATE TABLE IF NOT EXISTS purchase_order_items (
  po_item_id INT AUTO_INCREMENT PRIMARY KEY,
  po_id INT NOT NULL,
  pr_item_id INT NULL,
  item_id INT NOT NULL,
  ordered_quantity DECIMAL(14, 3) NOT NULL,
  uom VARCHAR(20) NOT NULL,
  unit_price DECIMAL(14, 6) NOT NULL,
  line_subtotal DECIMAL(14, 2) NOT NULL,
  tax_rate DECIMAL(5, 2) NOT NULL DEFAULT 18.00,
  tax_amount DECIMAL(14, 2) NOT NULL,
  discount_amount DECIMAL(14, 2) NOT NULL DEFAULT 0,
  line_total DECIMAL(14, 2) NOT NULL,
  expected_delivery_date DATE NOT NULL,
  received_quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  pending_quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  line_status ENUM('Ordered', 'Partially Received', 'Fully Received', 'Cancelled', 'Closed') NOT NULL DEFAULT 'Ordered',
  remarks VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_po_items_po
    FOREIGN KEY (po_id) REFERENCES purchase_order(po_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_po_items_pr_item
    FOREIGN KEY (pr_item_id) REFERENCES purchase_requisition_items(pr_item_id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT fk_po_items_item
    FOREIGN KEY (item_id) REFERENCES item_master(item_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT chk_po_items_quantity CHECK (ordered_quantity > 0),
  CONSTRAINT chk_po_items_received CHECK (received_quantity >= 0 AND received_quantity <= ordered_quantity),
  CONSTRAINT chk_po_items_pending CHECK (pending_quantity >= 0 AND pending_quantity <= ordered_quantity),
  CONSTRAINT chk_po_items_price CHECK (unit_price >= 0),
  CONSTRAINT chk_po_items_amounts CHECK (
    line_subtotal >= 0
    AND tax_rate >= 0
    AND tax_amount >= 0
    AND discount_amount >= 0
    AND line_total >= 0
    AND discount_amount <= line_subtotal
  ),
  CONSTRAINT chk_po_items_uom CHECK (TRIM(uom) <> ''),
  INDEX idx_po_items_po (po_id),
  INDEX idx_po_items_pr_item (pr_item_id),
  INDEX idx_po_items_item (item_id),
  INDEX idx_po_items_delivery (expected_delivery_date),
  INDEX idx_po_items_status_pending (line_status, pending_quantity),
  INDEX idx_po_items_value (line_total),
  INDEX idx_po_items_item_value (item_id, line_total)
);

DELIMITER $$

CREATE TRIGGER trg_po_items_before_insert
BEFORE INSERT ON purchase_order_items
FOR EACH ROW
BEGIN
  DECLARE parent_po_date DATE;
  DECLARE parent_expected_delivery_date DATE;
  DECLARE parent_pr_id INT;
  DECLARE source_pr_id INT;
  DECLARE source_item_id INT;

  SELECT po_date, expected_delivery_date, pr_id
    INTO parent_po_date, parent_expected_delivery_date, parent_pr_id
    FROM purchase_order
   WHERE po_id = NEW.po_id;

  IF parent_po_date IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'purchase_order_items.po_id must reference an existing purchase order';
  END IF;

  IF NEW.expected_delivery_date < parent_po_date THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'line expected_delivery_date cannot be earlier than po_date';
  END IF;

  IF NEW.pr_item_id IS NOT NULL THEN
    SELECT pr_id, item_id
      INTO source_pr_id, source_item_id
      FROM purchase_requisition_items
     WHERE pr_item_id = NEW.pr_item_id;

    IF source_pr_id IS NULL THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'pr_item_id must reference an existing purchase requisition item';
    END IF;

    IF parent_pr_id IS NULL OR parent_pr_id <> source_pr_id THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'pr_item_id must belong to the purchase order referenced PR';
    END IF;

    IF NEW.item_id <> source_item_id THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'item_id must match the referenced purchase requisition item';
    END IF;
  END IF;

  IF ABS(NEW.line_subtotal - ROUND(NEW.ordered_quantity * NEW.unit_price, 2)) > 0.05 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'line_subtotal must equal ordered_quantity multiplied by unit_price';
  END IF;

  IF ABS(NEW.tax_amount - ROUND(NEW.line_subtotal * NEW.tax_rate / 100, 2)) > 0.05 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'tax_amount must equal line_subtotal multiplied by tax_rate';
  END IF;

  IF ABS(NEW.line_total - ROUND(NEW.line_subtotal + NEW.tax_amount - NEW.discount_amount, 2)) > 0.05 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'line_total must equal line_subtotal plus tax_amount minus discount_amount';
  END IF;

  IF ABS(NEW.pending_quantity - (NEW.ordered_quantity - NEW.received_quantity)) > 0.001 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'pending_quantity must equal ordered_quantity minus received_quantity';
  END IF;

  IF NEW.line_status = 'Cancelled' AND NEW.received_quantity <> 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'cancelled line items must have zero received quantity';
  END IF;

  IF NEW.line_status IN ('Fully Received', 'Closed') AND NEW.pending_quantity <> 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'fully received or closed line items must have zero pending quantity';
  END IF;

  IF NEW.line_status = 'Partially Received'
     AND NOT (NEW.received_quantity > 0 AND NEW.received_quantity < NEW.ordered_quantity) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'partially received line items require received quantity between zero and ordered quantity';
  END IF;
END$$

CREATE TRIGGER trg_po_items_before_update
BEFORE UPDATE ON purchase_order_items
FOR EACH ROW
BEGIN
  DECLARE parent_po_date DATE;
  DECLARE parent_expected_delivery_date DATE;
  DECLARE parent_pr_id INT;
  DECLARE source_pr_id INT;
  DECLARE source_item_id INT;

  SELECT po_date, expected_delivery_date, pr_id
    INTO parent_po_date, parent_expected_delivery_date, parent_pr_id
    FROM purchase_order
   WHERE po_id = NEW.po_id;

  IF parent_po_date IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'purchase_order_items.po_id must reference an existing purchase order';
  END IF;

  IF NEW.expected_delivery_date < parent_po_date THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'line expected_delivery_date cannot be earlier than po_date';
  END IF;

  IF NEW.pr_item_id IS NOT NULL THEN
    SELECT pr_id, item_id
      INTO source_pr_id, source_item_id
      FROM purchase_requisition_items
     WHERE pr_item_id = NEW.pr_item_id;

    IF source_pr_id IS NULL THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'pr_item_id must reference an existing purchase requisition item';
    END IF;

    IF parent_pr_id IS NULL OR parent_pr_id <> source_pr_id THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'pr_item_id must belong to the purchase order referenced PR';
    END IF;

    IF NEW.item_id <> source_item_id THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'item_id must match the referenced purchase requisition item';
    END IF;
  END IF;

  IF ABS(NEW.line_subtotal - ROUND(NEW.ordered_quantity * NEW.unit_price, 2)) > 0.05 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'line_subtotal must equal ordered_quantity multiplied by unit_price';
  END IF;

  IF ABS(NEW.tax_amount - ROUND(NEW.line_subtotal * NEW.tax_rate / 100, 2)) > 0.05 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'tax_amount must equal line_subtotal multiplied by tax_rate';
  END IF;

  IF ABS(NEW.line_total - ROUND(NEW.line_subtotal + NEW.tax_amount - NEW.discount_amount, 2)) > 0.05 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'line_total must equal line_subtotal plus tax_amount minus discount_amount';
  END IF;

  IF ABS(NEW.pending_quantity - (NEW.ordered_quantity - NEW.received_quantity)) > 0.001 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'pending_quantity must equal ordered_quantity minus received_quantity';
  END IF;

  IF NEW.line_status = 'Cancelled' AND NEW.received_quantity <> 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'cancelled line items must have zero received quantity';
  END IF;

  IF NEW.line_status IN ('Fully Received', 'Closed') AND NEW.pending_quantity <> 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'fully received or closed line items must have zero pending quantity';
  END IF;

  IF NEW.line_status = 'Partially Received'
     AND NOT (NEW.received_quantity > 0 AND NEW.received_quantity < NEW.ordered_quantity) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'partially received line items require received quantity between zero and ordered quantity';
  END IF;
END$$

DELIMITER ;

-- Validation checks after loading seed data.
SELECT COUNT(*) AS orphan_po_rows
FROM purchase_order_items poi
LEFT JOIN purchase_order po ON po.po_id = poi.po_id
WHERE po.po_id IS NULL;

SELECT COUNT(*) AS orphan_pr_item_rows
FROM purchase_order_items poi
LEFT JOIN purchase_requisition_items pri ON pri.pr_item_id = poi.pr_item_id
WHERE poi.pr_item_id IS NOT NULL
  AND pri.pr_item_id IS NULL;

SELECT COUNT(*) AS orphan_item_rows
FROM purchase_order_items poi
LEFT JOIN item_master im ON im.item_id = poi.item_id
WHERE im.item_id IS NULL;

SELECT COUNT(*) AS invalid_quantity_rows
FROM purchase_order_items
WHERE ordered_quantity <= 0
  OR received_quantity > ordered_quantity
  OR pending_quantity <> ordered_quantity - received_quantity;

SELECT COUNT(*) AS invalid_amount_rows
FROM purchase_order_items
WHERE ABS(line_subtotal - ROUND(ordered_quantity * unit_price, 2)) > 0.05
  OR ABS(tax_amount - ROUND(line_subtotal * tax_rate / 100, 2)) > 0.05
  OR ABS(line_total - ROUND(line_subtotal + tax_amount - discount_amount, 2)) > 0.05;

SELECT COUNT(*) AS invalid_status_quantity_rows
FROM purchase_order_items
WHERE (line_status = 'Cancelled' AND received_quantity <> 0)
   OR (line_status IN ('Fully Received', 'Closed') AND pending_quantity <> 0)
   OR (line_status = 'Partially Received' AND NOT (received_quantity > 0 AND received_quantity < ordered_quantity));

SELECT COUNT(*) AS invalid_header_reconciliation_rows
FROM (
  SELECT
    po.po_id,
    ABS(po.subtotal_amount - SUM(poi.line_subtotal)) AS subtotal_diff,
    ABS(po.tax_amount - SUM(poi.tax_amount)) AS tax_diff,
    ABS(po.discount_amount - SUM(poi.discount_amount)) AS discount_diff,
    ABS((po.total_po_amount - po.freight_charges) - SUM(poi.line_total)) AS line_total_diff
  FROM purchase_order po
  JOIN purchase_order_items poi ON poi.po_id = po.po_id
  GROUP BY po.po_id, po.subtotal_amount, po.tax_amount, po.discount_amount, po.freight_charges, po.total_po_amount
) x
WHERE subtotal_diff > 0.05
   OR tax_diff > 0.05
   OR discount_diff > 0.05
   OR line_total_diff > 0.05;

-- Sample output.
SELECT
  poi.po_item_id,
  po.po_number,
  pri.pr_item_id,
  im.item_code,
  im.item_name,
  poi.ordered_quantity,
  poi.uom,
  poi.unit_price,
  poi.line_subtotal,
  poi.tax_amount,
  poi.discount_amount,
  poi.line_total,
  poi.received_quantity,
  poi.pending_quantity,
  poi.line_status
FROM purchase_order_items poi
JOIN purchase_order po ON po.po_id = poi.po_id
LEFT JOIN purchase_requisition_items pri ON pri.pr_item_id = poi.pr_item_id
JOIN item_master im ON im.item_id = poi.item_id
ORDER BY poi.po_item_id
LIMIT 10;
