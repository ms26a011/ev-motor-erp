CREATE TABLE IF NOT EXISTS purchase_requisition_items (
  pr_item_id INT AUTO_INCREMENT PRIMARY KEY,
  pr_id INT NOT NULL,
  item_id INT NOT NULL,
  requested_quantity DECIMAL(14, 3) NOT NULL,
  uom VARCHAR(20) NOT NULL,
  required_date DATE NOT NULL,
  estimated_unit_cost DECIMAL(14, 2) NOT NULL DEFAULT 0,
  estimated_total_cost DECIMAL(14, 2)
    GENERATED ALWAYS AS (ROUND(requested_quantity * estimated_unit_cost, 2)) STORED,
  priority ENUM('Low', 'Medium', 'High', 'Urgent') NOT NULL DEFAULT 'Medium',
  reason_for_requirement VARCHAR(255) NOT NULL,
  current_stock_quantity DECIMAL(14, 3) NOT NULL DEFAULT 0,
  reorder_level DECIMAL(14, 3) NOT NULL DEFAULT 0,
  budget_code VARCHAR(30) NULL,
  remarks VARCHAR(255) NULL,
  status ENUM('Pending', 'Approved', 'Rejected', 'Converted to PO', 'Cancelled') NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pr_items_pr
    FOREIGN KEY (pr_id) REFERENCES purchase_requisition(pr_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_pr_items_item
    FOREIGN KEY (item_id) REFERENCES item_master(item_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT chk_pr_items_requested_quantity CHECK (requested_quantity > 0),
  CONSTRAINT chk_pr_items_unit_cost CHECK (estimated_unit_cost >= 0),
  CONSTRAINT chk_pr_items_stock CHECK (current_stock_quantity >= 0),
  CONSTRAINT chk_pr_items_reorder CHECK (reorder_level >= 0),
  CONSTRAINT chk_pr_items_uom CHECK (TRIM(uom) <> ''),
  INDEX idx_pr_items_pr (pr_id),
  INDEX idx_pr_items_item (item_id),
  INDEX idx_pr_items_required_date (required_date),
  INDEX idx_pr_items_priority_status (priority, status),
  INDEX idx_pr_items_stockout (item_id, current_stock_quantity, reorder_level),
  INDEX idx_pr_items_budget (budget_code),
  INDEX idx_pr_items_value (estimated_total_cost)
);

DELIMITER $$

CREATE TRIGGER trg_pr_items_before_insert
BEFORE INSERT ON purchase_requisition_items
FOR EACH ROW
BEGIN
  DECLARE parent_pr_date DATE;

  SELECT pr_date
    INTO parent_pr_date
    FROM purchase_requisition
   WHERE pr_id = NEW.pr_id;

  IF parent_pr_date IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'purchase_requisition_items.pr_id must reference an existing purchase requisition';
  END IF;

  IF NEW.required_date < parent_pr_date THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'required_date cannot be earlier than the parent purchase requisition date';
  END IF;

  IF NEW.current_stock_quantity < NEW.reorder_level
     AND NEW.priority NOT IN ('High', 'Urgent') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'priority must be High or Urgent when current stock is below reorder level';
  END IF;
END$$

CREATE TRIGGER trg_pr_items_before_update
BEFORE UPDATE ON purchase_requisition_items
FOR EACH ROW
BEGIN
  DECLARE parent_pr_date DATE;

  SELECT pr_date
    INTO parent_pr_date
    FROM purchase_requisition
   WHERE pr_id = NEW.pr_id;

  IF parent_pr_date IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'purchase_requisition_items.pr_id must reference an existing purchase requisition';
  END IF;

  IF NEW.required_date < parent_pr_date THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'required_date cannot be earlier than the parent purchase requisition date';
  END IF;

  IF NEW.current_stock_quantity < NEW.reorder_level
     AND NEW.priority NOT IN ('High', 'Urgent') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'priority must be High or Urgent when current stock is below reorder level';
  END IF;
END$$

DELIMITER ;

-- Validation checks after loading seed data.
SELECT COUNT(*) AS orphan_pr_rows
FROM purchase_requisition_items pri
LEFT JOIN purchase_requisition pr ON pr.pr_id = pri.pr_id
WHERE pr.pr_id IS NULL;

SELECT COUNT(*) AS orphan_item_rows
FROM purchase_requisition_items pri
LEFT JOIN item_master im ON im.item_id = pri.item_id
WHERE im.item_id IS NULL;

SELECT COUNT(*) AS invalid_quantity_rows
FROM purchase_requisition_items
WHERE requested_quantity <= 0;

SELECT COUNT(*) AS invalid_total_cost_rows
FROM purchase_requisition_items
WHERE estimated_total_cost <> ROUND(requested_quantity * estimated_unit_cost, 2);

SELECT COUNT(*) AS invalid_required_date_rows
FROM purchase_requisition_items pri
JOIN purchase_requisition pr ON pr.pr_id = pri.pr_id
WHERE pri.required_date < pr.pr_date;

SELECT COUNT(*) AS invalid_stock_priority_rows
FROM purchase_requisition_items
WHERE current_stock_quantity < reorder_level
  AND priority NOT IN ('High', 'Urgent');

-- Sample output.
SELECT
  pri.pr_item_id,
  pr.pr_number,
  im.item_code,
  im.item_name,
  pri.requested_quantity,
  pri.uom,
  pri.required_date,
  pri.estimated_unit_cost,
  pri.estimated_total_cost,
  pri.priority,
  pri.current_stock_quantity,
  pri.reorder_level,
  pri.status
FROM purchase_requisition_items pri
JOIN purchase_requisition pr ON pr.pr_id = pri.pr_id
JOIN item_master im ON im.item_id = pri.item_id
ORDER BY pri.pr_item_id
LIMIT 10;
