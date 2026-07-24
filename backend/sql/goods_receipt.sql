CREATE TABLE IF NOT EXISTS goods_receipt (
  grn_id INT AUTO_INCREMENT PRIMARY KEY,
  grn_number VARCHAR(30) NOT NULL UNIQUE,
  po_id INT NOT NULL,
  vendor_id INT NOT NULL,
  received_date DATE NOT NULL,
  invoice_number VARCHAR(60) NOT NULL,
  invoice_date DATE NOT NULL,
  delivery_challan_number VARCHAR(60) NOT NULL,
  received_by INT NOT NULL,
  warehouse_location VARCHAR(120) NOT NULL,
  inspection_required ENUM('Yes', 'No') NOT NULL DEFAULT 'Yes',
  grn_status ENUM('Draft', 'Received', 'Under Inspection', 'Accepted', 'Partially Accepted', 'Rejected', 'Closed') NOT NULL DEFAULT 'Draft',
  remarks VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_grn_po
    FOREIGN KEY (po_id) REFERENCES purchase_order(po_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_grn_vendor
    FOREIGN KEY (vendor_id) REFERENCES vendor_master(vendor_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_grn_received_by
    FOREIGN KEY (received_by) REFERENCES employee_master(employee_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT chk_grn_dates CHECK (invoice_date <= received_date),
  CONSTRAINT chk_grn_warehouse CHECK (TRIM(warehouse_location) <> ''),
  CONSTRAINT chk_grn_invoice CHECK (TRIM(invoice_number) <> ''),
  CONSTRAINT chk_grn_challan CHECK (TRIM(delivery_challan_number) <> ''),
  INDEX idx_grn_po (po_id),
  INDEX idx_grn_vendor_date (vendor_id, received_date),
  INDEX idx_grn_received_by (received_by),
  INDEX idx_grn_status_inspection (grn_status, inspection_required),
  INDEX idx_grn_warehouse_date (warehouse_location, received_date),
  INDEX idx_grn_invoice (invoice_number),
  INDEX idx_grn_received_date (received_date)
);

DELIMITER $$

CREATE TRIGGER trg_grn_before_insert
BEFORE INSERT ON goods_receipt
FOR EACH ROW
BEGIN
  DECLARE parent_po_date DATE;
  DECLARE parent_vendor_id INT;
  DECLARE parent_status VARCHAR(30);

  SELECT po_date, vendor_id, po_status
    INTO parent_po_date, parent_vendor_id, parent_status
    FROM purchase_order
   WHERE po_id = NEW.po_id;

  IF parent_po_date IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'goods_receipt.po_id must reference an existing purchase order';
  END IF;

  IF NEW.vendor_id <> parent_vendor_id THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'goods_receipt.vendor_id must match the selected purchase order vendor';
  END IF;

  IF parent_status IN ('Draft', 'Cancelled') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'goods receipts cannot be created for draft or cancelled purchase orders';
  END IF;

  IF NEW.received_date < parent_po_date THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'received_date cannot be earlier than purchase order date';
  END IF;

  IF NEW.invoice_date > NEW.received_date THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'invoice_date cannot be after received_date';
  END IF;

  IF NEW.grn_status = 'Rejected' AND NEW.inspection_required <> 'Yes' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'rejected GRNs must require inspection';
  END IF;

  IF NEW.grn_status IN ('Accepted', 'Partially Accepted', 'Closed')
     AND NEW.inspection_required = 'Yes'
     AND NEW.warehouse_location = 'QA Hold Area' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'accepted GRNs should not remain in QA Hold Area';
  END IF;
END$$

CREATE TRIGGER trg_grn_before_update
BEFORE UPDATE ON goods_receipt
FOR EACH ROW
BEGIN
  DECLARE parent_po_date DATE;
  DECLARE parent_vendor_id INT;
  DECLARE parent_status VARCHAR(30);

  SELECT po_date, vendor_id, po_status
    INTO parent_po_date, parent_vendor_id, parent_status
    FROM purchase_order
   WHERE po_id = NEW.po_id;

  IF parent_po_date IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'goods_receipt.po_id must reference an existing purchase order';
  END IF;

  IF NEW.vendor_id <> parent_vendor_id THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'goods_receipt.vendor_id must match the selected purchase order vendor';
  END IF;

  IF parent_status IN ('Draft', 'Cancelled') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'goods receipts cannot be created for draft or cancelled purchase orders';
  END IF;

  IF NEW.received_date < parent_po_date THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'received_date cannot be earlier than purchase order date';
  END IF;

  IF NEW.invoice_date > NEW.received_date THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'invoice_date cannot be after received_date';
  END IF;

  IF NEW.grn_status = 'Rejected' AND NEW.inspection_required <> 'Yes' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'rejected GRNs must require inspection';
  END IF;

  IF NEW.grn_status IN ('Accepted', 'Partially Accepted', 'Closed')
     AND NEW.inspection_required = 'Yes'
     AND NEW.warehouse_location = 'QA Hold Area' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'accepted GRNs should not remain in QA Hold Area';
  END IF;
END$$

DELIMITER ;

-- Validation checks after loading seed data.
SELECT COUNT(*) AS orphan_po_rows
FROM goods_receipt grn
LEFT JOIN purchase_order po ON po.po_id = grn.po_id
WHERE po.po_id IS NULL;

SELECT COUNT(*) AS orphan_vendor_rows
FROM goods_receipt grn
LEFT JOIN vendor_master vm ON vm.vendor_id = grn.vendor_id
WHERE vm.vendor_id IS NULL;

SELECT COUNT(*) AS orphan_receiver_rows
FROM goods_receipt grn
LEFT JOIN employee_master em ON em.employee_id = grn.received_by
WHERE em.employee_id IS NULL;

SELECT COUNT(*) AS vendor_mismatch_rows
FROM goods_receipt grn
JOIN purchase_order po ON po.po_id = grn.po_id
WHERE grn.vendor_id <> po.vendor_id;

SELECT COUNT(*) AS invalid_date_rows
FROM goods_receipt grn
JOIN purchase_order po ON po.po_id = grn.po_id
WHERE grn.received_date < po.po_date
   OR grn.invoice_date > grn.received_date;

SELECT COUNT(*) AS invalid_po_status_rows
FROM goods_receipt grn
JOIN purchase_order po ON po.po_id = grn.po_id
WHERE po.po_status IN ('Draft', 'Cancelled');

SELECT COUNT(*) AS invalid_rejected_rows
FROM goods_receipt
WHERE grn_status = 'Rejected'
  AND inspection_required <> 'Yes';

-- Sample output.
SELECT
  grn.grn_id,
  grn.grn_number,
  po.po_number,
  vm.vendor_name,
  grn.received_date,
  grn.invoice_number,
  grn.invoice_date,
  grn.delivery_challan_number,
  em.employee_name AS received_by,
  grn.warehouse_location,
  grn.inspection_required,
  grn.grn_status
FROM goods_receipt grn
JOIN purchase_order po ON po.po_id = grn.po_id
JOIN vendor_master vm ON vm.vendor_id = grn.vendor_id
JOIN employee_master em ON em.employee_id = grn.received_by
ORDER BY grn.grn_id
LIMIT 10;
