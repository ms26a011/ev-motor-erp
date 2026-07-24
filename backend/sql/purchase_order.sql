CREATE TABLE IF NOT EXISTS purchase_order (
  po_id INT AUTO_INCREMENT PRIMARY KEY,
  po_number VARCHAR(30) NOT NULL UNIQUE,
  pr_id INT NULL,
  vendor_id INT NOT NULL,
  department_id INT NOT NULL,
  po_date DATE NOT NULL,
  expected_delivery_date DATE NOT NULL,
  payment_terms VARCHAR(80) NOT NULL,
  delivery_terms VARCHAR(120) NOT NULL,
  billing_address VARCHAR(500) NOT NULL,
  shipping_address VARCHAR(500) NOT NULL,
  subtotal_amount DECIMAL(14, 2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(14, 2) NOT NULL DEFAULT 0,
  freight_charges DECIMAL(14, 2) NOT NULL DEFAULT 0,
  discount_amount DECIMAL(14, 2) NOT NULL DEFAULT 0,
  total_po_amount DECIMAL(14, 2)
    GENERATED ALWAYS AS (ROUND(subtotal_amount + tax_amount + freight_charges - discount_amount, 2)) STORED,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  po_status ENUM('Draft', 'Issued', 'Partially Received', 'Fully Received', 'Cancelled', 'Closed') NOT NULL DEFAULT 'Draft',
  approval_status ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending',
  approved_by INT NULL,
  approved_date DATE NULL,
  remarks VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_po_pr
    FOREIGN KEY (pr_id) REFERENCES purchase_requisition(pr_id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT fk_po_vendor
    FOREIGN KEY (vendor_id) REFERENCES vendor_master(vendor_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_po_department
    FOREIGN KEY (department_id) REFERENCES department_master(department_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_po_approved_by
    FOREIGN KEY (approved_by) REFERENCES employee_master(employee_id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT chk_po_dates CHECK (expected_delivery_date > po_date),
  CONSTRAINT chk_po_amounts CHECK (
    subtotal_amount >= 0
    AND tax_amount >= 0
    AND freight_charges >= 0
    AND discount_amount >= 0
    AND discount_amount <= subtotal_amount
  ),
  CONSTRAINT chk_po_currency CHECK (currency REGEXP '^[A-Z]{3}$'),
  INDEX idx_po_pr (pr_id),
  INDEX idx_po_vendor_date (vendor_id, po_date),
  INDEX idx_po_department_date (department_id, po_date),
  INDEX idx_po_status_delivery (po_status, expected_delivery_date),
  INDEX idx_po_approval (approval_status, approved_date),
  INDEX idx_po_monthly_trend (po_date, total_po_amount),
  INDEX idx_po_value (total_po_amount)
);

DELIMITER $$

CREATE TRIGGER trg_po_before_insert
BEFORE INSERT ON purchase_order
FOR EACH ROW
BEGIN
  DECLARE parent_pr_status VARCHAR(30);
  DECLARE parent_pr_date DATE;

  IF NEW.pr_id IS NOT NULL THEN
    SELECT status, pr_date
      INTO parent_pr_status, parent_pr_date
      FROM purchase_requisition
     WHERE pr_id = NEW.pr_id;

    IF parent_pr_status IS NULL THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'purchase_order.pr_id must reference an existing purchase requisition';
    END IF;

    IF parent_pr_status NOT IN ('Approved', 'Converted to PO') THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'purchase orders can only reference approved or converted purchase requisitions';
    END IF;

    IF NEW.po_date < parent_pr_date THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'po_date cannot be earlier than the referenced purchase requisition date';
    END IF;
  END IF;

  IF NEW.expected_delivery_date <= NEW.po_date THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'expected_delivery_date must be after po_date';
  END IF;

  IF NEW.approved_date IS NOT NULL AND NEW.approved_date < NEW.po_date THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'approved_date cannot be earlier than po_date';
  END IF;

  IF NEW.approval_status = 'Approved'
     AND (NEW.approved_by IS NULL OR NEW.approved_date IS NULL) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'approved purchase orders require approved_by and approved_date';
  END IF;

  IF NEW.po_status = 'Fully Received' AND NEW.approval_status <> 'Approved' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'fully received purchase orders must be approved';
  END IF;

  IF NEW.po_status = 'Cancelled' AND NEW.approval_status = 'Approved' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'cancelled purchase orders should not remain approved';
  END IF;

  IF NEW.po_status = 'Closed'
     AND NEW.approval_status <> 'Approved' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'closed purchase orders must be approved';
  END IF;
END$$

CREATE TRIGGER trg_po_before_update
BEFORE UPDATE ON purchase_order
FOR EACH ROW
BEGIN
  DECLARE parent_pr_status VARCHAR(30);
  DECLARE parent_pr_date DATE;

  IF NEW.pr_id IS NOT NULL THEN
    SELECT status, pr_date
      INTO parent_pr_status, parent_pr_date
      FROM purchase_requisition
     WHERE pr_id = NEW.pr_id;

    IF parent_pr_status IS NULL THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'purchase_order.pr_id must reference an existing purchase requisition';
    END IF;

    IF parent_pr_status NOT IN ('Approved', 'Converted to PO') THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'purchase orders can only reference approved or converted purchase requisitions';
    END IF;

    IF NEW.po_date < parent_pr_date THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'po_date cannot be earlier than the referenced purchase requisition date';
    END IF;
  END IF;

  IF NEW.expected_delivery_date <= NEW.po_date THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'expected_delivery_date must be after po_date';
  END IF;

  IF NEW.approved_date IS NOT NULL AND NEW.approved_date < NEW.po_date THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'approved_date cannot be earlier than po_date';
  END IF;

  IF NEW.approval_status = 'Approved'
     AND (NEW.approved_by IS NULL OR NEW.approved_date IS NULL) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'approved purchase orders require approved_by and approved_date';
  END IF;

  IF NEW.po_status = 'Fully Received' AND NEW.approval_status <> 'Approved' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'fully received purchase orders must be approved';
  END IF;

  IF NEW.po_status = 'Cancelled' AND NEW.approval_status = 'Approved' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'cancelled purchase orders should not remain approved';
  END IF;

  IF NEW.po_status = 'Closed'
     AND NEW.approval_status <> 'Approved' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'closed purchase orders must be approved';
  END IF;
END$$

DELIMITER ;

-- Validation checks after loading seed data.
SELECT COUNT(*) AS orphan_pr_rows
FROM purchase_order po
LEFT JOIN purchase_requisition pr ON pr.pr_id = po.pr_id
WHERE po.pr_id IS NOT NULL
  AND pr.pr_id IS NULL;

SELECT COUNT(*) AS orphan_vendor_rows
FROM purchase_order po
LEFT JOIN vendor_master vm ON vm.vendor_id = po.vendor_id
WHERE vm.vendor_id IS NULL;

SELECT COUNT(*) AS orphan_department_rows
FROM purchase_order po
LEFT JOIN department_master dm ON dm.department_id = po.department_id
WHERE dm.department_id IS NULL;

SELECT COUNT(*) AS orphan_approver_rows
FROM purchase_order po
LEFT JOIN employee_master em ON em.employee_id = po.approved_by
WHERE po.approved_by IS NOT NULL
  AND em.employee_id IS NULL;

SELECT COUNT(*) AS invalid_delivery_date_rows
FROM purchase_order
WHERE expected_delivery_date <= po_date;

SELECT COUNT(*) AS invalid_total_amount_rows
FROM purchase_order
WHERE total_po_amount <> ROUND(subtotal_amount + tax_amount + freight_charges - discount_amount, 2);

SELECT COUNT(*) AS invalid_approved_date_rows
FROM purchase_order
WHERE approved_date IS NOT NULL
  AND approved_date < po_date;

SELECT COUNT(*) AS invalid_cancelled_rows
FROM purchase_order
WHERE po_status = 'Cancelled'
  AND po_status = 'Fully Received';

SELECT COUNT(*) AS invalid_closed_rows
FROM purchase_order
WHERE po_status = 'Closed'
  AND approval_status <> 'Approved';

-- Sample output.
SELECT
  po.po_id,
  po.po_number,
  pr.pr_number,
  vm.vendor_name,
  dm.department_name,
  po.po_date,
  po.expected_delivery_date,
  po.subtotal_amount,
  po.tax_amount,
  po.freight_charges,
  po.discount_amount,
  po.total_po_amount,
  po.po_status,
  po.approval_status
FROM purchase_order po
LEFT JOIN purchase_requisition pr ON pr.pr_id = po.pr_id
JOIN vendor_master vm ON vm.vendor_id = po.vendor_id
JOIN department_master dm ON dm.department_id = po.department_id
ORDER BY po.po_id
LIMIT 10;
