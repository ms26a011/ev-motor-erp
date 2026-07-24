CREATE TABLE IF NOT EXISTS goods_receipt_items (
  grn_item_id INT AUTO_INCREMENT PRIMARY KEY,
  grn_id INT NOT NULL,
  po_item_id INT NOT NULL,
  item_id INT NOT NULL,
  ordered_quantity DECIMAL(14, 3) NOT NULL,
  received_quantity DECIMAL(14, 3) NOT NULL,
  accepted_quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  rejected_quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  uom VARCHAR(20) NOT NULL,
  unit_price DECIMAL(14, 6) NOT NULL,
  line_value DECIMAL(14, 2)
    GENERATED ALWAYS AS (ROUND(accepted_quantity * unit_price, 2)) STORED,
  batch_number VARCHAR(60) NOT NULL,
  manufacturing_date DATE NOT NULL,
  expiry_date DATE NULL,
  quality_status ENUM('Pending Inspection', 'Accepted', 'Partially Accepted', 'Rejected') NOT NULL DEFAULT 'Pending Inspection',
  rejection_reason VARCHAR(255) NULL,
  storage_location VARCHAR(80) NOT NULL,
  remarks VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_grn_items_grn
    FOREIGN KEY (grn_id) REFERENCES goods_receipt(grn_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_grn_items_po_item
    FOREIGN KEY (po_item_id) REFERENCES purchase_order_items(po_item_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_grn_items_item
    FOREIGN KEY (item_id) REFERENCES item_master(item_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT chk_grn_items_quantities CHECK (
    ordered_quantity > 0
    AND received_quantity >= 0
    AND accepted_quantity >= 0
    AND rejected_quantity >= 0
    AND received_quantity <= ordered_quantity
  ),
  CONSTRAINT chk_grn_items_price CHECK (unit_price >= 0),
  CONSTRAINT chk_grn_items_uom CHECK (TRIM(uom) <> ''),
  CONSTRAINT chk_grn_items_batch CHECK (TRIM(batch_number) <> ''),
  CONSTRAINT chk_grn_items_storage CHECK (TRIM(storage_location) <> ''),
  INDEX idx_grn_items_grn (grn_id),
  INDEX idx_grn_items_po_item (po_item_id),
  INDEX idx_grn_items_item (item_id),
  INDEX idx_grn_items_quality (quality_status),
  INDEX idx_grn_items_batch (batch_number),
  INDEX idx_grn_items_storage (storage_location),
  INDEX idx_grn_items_expiry (expiry_date),
  INDEX idx_grn_items_value (line_value)
);

DELIMITER $$

CREATE TRIGGER trg_grn_items_before_insert
BEFORE INSERT ON goods_receipt_items
FOR EACH ROW
BEGIN
  DECLARE parent_po_id INT;
  DECLARE parent_received_date DATE;
  DECLARE parent_status VARCHAR(30);
  DECLARE source_po_id INT;
  DECLARE source_item_id INT;
  DECLARE source_ordered_quantity DECIMAL(14, 3);
  DECLARE source_pending_quantity DECIMAL(14, 3);
  DECLARE source_uom VARCHAR(20);
  DECLARE item_category VARCHAR(100);
  DECLARE item_name VARCHAR(255);
  DECLARE shelf_life_required TINYINT DEFAULT 0;

  SELECT po_id, received_date, grn_status
    INTO parent_po_id, parent_received_date, parent_status
    FROM goods_receipt
   WHERE grn_id = NEW.grn_id;

  IF parent_po_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'goods_receipt_items.grn_id must reference an existing goods receipt';
  END IF;

  SELECT po_id, item_id, ordered_quantity, pending_quantity, uom
    INTO source_po_id, source_item_id, source_ordered_quantity, source_pending_quantity, source_uom
    FROM purchase_order_items
   WHERE po_item_id = NEW.po_item_id;

  IF source_po_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'po_item_id must reference an existing purchase order item';
  END IF;

  IF source_po_id <> parent_po_id THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'po_item_id must belong to the same purchase order as the GRN';
  END IF;

  IF NEW.item_id <> source_item_id THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'item_id must match the purchase order item';
  END IF;

  IF NEW.ordered_quantity <> source_ordered_quantity THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'ordered_quantity must match the purchase order item quantity';
  END IF;

  IF NEW.uom <> source_uom THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'uom must match the purchase order item uom';
  END IF;

  IF NEW.received_quantity > source_pending_quantity THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'received_quantity cannot be greater than purchase order item pending_quantity';
  END IF;

  IF NEW.quality_status = 'Pending Inspection' THEN
    IF NEW.accepted_quantity <> 0 OR NEW.rejected_quantity <> 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'pending inspection items must have zero accepted and rejected quantities';
    END IF;
  ELSEIF ABS((NEW.accepted_quantity + NEW.rejected_quantity) - NEW.received_quantity) > 0.001 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'accepted_quantity plus rejected_quantity must equal received_quantity';
  END IF;

  IF NEW.quality_status = 'Accepted'
     AND (NEW.accepted_quantity <> NEW.received_quantity OR NEW.rejected_quantity <> 0) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'accepted items must be fully accepted with zero rejection';
  END IF;

  IF NEW.quality_status = 'Partially Accepted'
     AND NOT (NEW.accepted_quantity > 0 AND NEW.rejected_quantity > 0) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'partially accepted items require both accepted and rejected quantities';
  END IF;

  IF NEW.quality_status = 'Rejected'
     AND (NEW.rejected_quantity <> NEW.received_quantity OR NEW.accepted_quantity <> 0) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'rejected items must have all received quantity rejected';
  END IF;

  IF NEW.rejected_quantity > 0 AND (NEW.rejection_reason IS NULL OR TRIM(NEW.rejection_reason) = '') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'rejected items require a rejection reason';
  END IF;

  IF NEW.rejected_quantity = 0 AND NEW.rejection_reason IS NOT NULL AND TRIM(NEW.rejection_reason) <> '' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'accepted or pending items should not have a rejection reason';
  END IF;

  IF NEW.manufacturing_date >= parent_received_date THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'manufacturing_date must be before received_date';
  END IF;

  SELECT category, item_name
    INTO item_category, item_name
    FROM item_master
   WHERE item_id = NEW.item_id;

  SET shelf_life_required =
    item_category IN ('Consumables', 'Packaging Materials')
    OR LOWER(item_name) REGEXP 'adhesive|oil|grease|varnish|solvent|flux|sealant|paint|tape|bag|gel';

  IF shelf_life_required = 1 AND NEW.expiry_date IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'expiry_date is required for shelf-life items';
  END IF;

  IF NEW.expiry_date IS NOT NULL AND NEW.expiry_date <= NEW.manufacturing_date THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'expiry_date must be after manufacturing_date';
  END IF;

  IF parent_status = 'Rejected' AND NEW.quality_status <> 'Rejected' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'items under rejected GRNs must be rejected';
  END IF;
END$$

CREATE TRIGGER trg_grn_items_before_update
BEFORE UPDATE ON goods_receipt_items
FOR EACH ROW
BEGIN
  DECLARE parent_po_id INT;
  DECLARE parent_received_date DATE;
  DECLARE parent_status VARCHAR(30);
  DECLARE source_po_id INT;
  DECLARE source_item_id INT;
  DECLARE source_ordered_quantity DECIMAL(14, 3);
  DECLARE source_pending_quantity DECIMAL(14, 3);
  DECLARE source_uom VARCHAR(20);
  DECLARE item_category VARCHAR(100);
  DECLARE item_name VARCHAR(255);
  DECLARE shelf_life_required TINYINT DEFAULT 0;

  SELECT po_id, received_date, grn_status
    INTO parent_po_id, parent_received_date, parent_status
    FROM goods_receipt
   WHERE grn_id = NEW.grn_id;

  SELECT po_id, item_id, ordered_quantity, pending_quantity, uom
    INTO source_po_id, source_item_id, source_ordered_quantity, source_pending_quantity, source_uom
    FROM purchase_order_items
   WHERE po_item_id = NEW.po_item_id;

  IF parent_po_id IS NULL OR source_po_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'goods receipt and purchase order item references must exist';
  END IF;

  IF source_po_id <> parent_po_id THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'po_item_id must belong to the same purchase order as the GRN';
  END IF;

  IF NEW.item_id <> source_item_id OR NEW.ordered_quantity <> source_ordered_quantity OR NEW.uom <> source_uom THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'item_id, ordered_quantity, and uom must match the purchase order item';
  END IF;

  IF NEW.received_quantity > source_pending_quantity THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'received_quantity cannot be greater than purchase order item pending_quantity';
  END IF;

  IF NEW.quality_status = 'Pending Inspection' THEN
    IF NEW.accepted_quantity <> 0 OR NEW.rejected_quantity <> 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'pending inspection items must have zero accepted and rejected quantities';
    END IF;
  ELSEIF ABS((NEW.accepted_quantity + NEW.rejected_quantity) - NEW.received_quantity) > 0.001 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'accepted_quantity plus rejected_quantity must equal received_quantity';
  END IF;

  IF NEW.quality_status = 'Accepted'
     AND (NEW.accepted_quantity <> NEW.received_quantity OR NEW.rejected_quantity <> 0) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'accepted items must be fully accepted with zero rejection';
  END IF;

  IF NEW.quality_status = 'Partially Accepted'
     AND NOT (NEW.accepted_quantity > 0 AND NEW.rejected_quantity > 0) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'partially accepted items require both accepted and rejected quantities';
  END IF;

  IF NEW.quality_status = 'Rejected'
     AND (NEW.rejected_quantity <> NEW.received_quantity OR NEW.accepted_quantity <> 0) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'rejected items must have all received quantity rejected';
  END IF;

  IF NEW.rejected_quantity > 0 AND (NEW.rejection_reason IS NULL OR TRIM(NEW.rejection_reason) = '') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'rejected items require a rejection reason';
  END IF;

  IF NEW.rejected_quantity = 0 AND NEW.rejection_reason IS NOT NULL AND TRIM(NEW.rejection_reason) <> '' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'accepted or pending items should not have a rejection reason';
  END IF;

  IF NEW.manufacturing_date >= parent_received_date THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'manufacturing_date must be before received_date';
  END IF;

  SELECT category, item_name
    INTO item_category, item_name
    FROM item_master
   WHERE item_id = NEW.item_id;

  SET shelf_life_required =
    item_category IN ('Consumables', 'Packaging Materials')
    OR LOWER(item_name) REGEXP 'adhesive|oil|grease|varnish|solvent|flux|sealant|paint|tape|bag|gel';

  IF shelf_life_required = 1 AND NEW.expiry_date IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'expiry_date is required for shelf-life items';
  END IF;

  IF NEW.expiry_date IS NOT NULL AND NEW.expiry_date <= NEW.manufacturing_date THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'expiry_date must be after manufacturing_date';
  END IF;

  IF parent_status = 'Rejected' AND NEW.quality_status <> 'Rejected' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'items under rejected GRNs must be rejected';
  END IF;
END$$

DELIMITER ;

-- Validation checks after loading seed data.
SELECT COUNT(*) AS orphan_grn_rows
FROM goods_receipt_items gri
LEFT JOIN goods_receipt grn ON grn.grn_id = gri.grn_id
WHERE grn.grn_id IS NULL;

SELECT COUNT(*) AS orphan_po_item_rows
FROM goods_receipt_items gri
LEFT JOIN purchase_order_items poi ON poi.po_item_id = gri.po_item_id
WHERE poi.po_item_id IS NULL;

SELECT COUNT(*) AS orphan_item_rows
FROM goods_receipt_items gri
LEFT JOIN item_master im ON im.item_id = gri.item_id
WHERE im.item_id IS NULL;

SELECT COUNT(*) AS invalid_reference_rows
FROM goods_receipt_items gri
JOIN goods_receipt grn ON grn.grn_id = gri.grn_id
JOIN purchase_order_items poi ON poi.po_item_id = gri.po_item_id
WHERE poi.po_id <> grn.po_id
   OR poi.item_id <> gri.item_id;

SELECT COUNT(*) AS invalid_quantity_rows
FROM goods_receipt_items gri
JOIN purchase_order_items poi ON poi.po_item_id = gri.po_item_id
WHERE gri.received_quantity > poi.pending_quantity
   OR gri.received_quantity > gri.ordered_quantity
   OR (
     gri.quality_status <> 'Pending Inspection'
     AND ABS((gri.accepted_quantity + gri.rejected_quantity) - gri.received_quantity) > 0.001
   )
   OR (
     gri.quality_status = 'Pending Inspection'
     AND (gri.accepted_quantity <> 0 OR gri.rejected_quantity <> 0)
   );

SELECT COUNT(*) AS invalid_quality_rows
FROM goods_receipt_items
WHERE (quality_status = 'Accepted' AND (accepted_quantity <> received_quantity OR rejected_quantity <> 0 OR rejection_reason IS NOT NULL))
   OR (quality_status = 'Partially Accepted' AND NOT (accepted_quantity > 0 AND rejected_quantity > 0 AND rejection_reason IS NOT NULL))
   OR (quality_status = 'Rejected' AND NOT (rejected_quantity = received_quantity AND accepted_quantity = 0 AND rejection_reason IS NOT NULL));

SELECT COUNT(*) AS invalid_date_rows
FROM goods_receipt_items gri
JOIN goods_receipt grn ON grn.grn_id = gri.grn_id
WHERE gri.manufacturing_date >= grn.received_date
   OR (gri.expiry_date IS NOT NULL AND gri.expiry_date <= gri.manufacturing_date);

SELECT COUNT(*) AS missing_expiry_rows
FROM goods_receipt_items gri
JOIN item_master im ON im.item_id = gri.item_id
WHERE (
    im.category IN ('Consumables', 'Packaging Materials')
    OR LOWER(im.item_name) REGEXP 'adhesive|oil|grease|varnish|solvent|flux|sealant|paint|tape|bag|gel'
  )
  AND gri.expiry_date IS NULL;

-- Sample output.
SELECT
  gri.grn_item_id,
  grn.grn_number,
  po.po_number,
  poi.po_item_id,
  im.item_code,
  im.item_name,
  gri.received_quantity,
  gri.accepted_quantity,
  gri.rejected_quantity,
  gri.uom,
  gri.line_value,
  gri.batch_number,
  gri.quality_status,
  gri.storage_location
FROM goods_receipt_items gri
JOIN goods_receipt grn ON grn.grn_id = gri.grn_id
JOIN purchase_order po ON po.po_id = grn.po_id
JOIN purchase_order_items poi ON poi.po_item_id = gri.po_item_id
JOIN item_master im ON im.item_id = gri.item_id
ORDER BY gri.grn_item_id
LIMIT 10;
