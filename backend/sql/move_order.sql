DROP TABLE IF EXISTS move_order_items;
DROP TABLE IF EXISTS production_consumption;
DROP TABLE IF EXISTS move_order;

CREATE TABLE move_order (
  move_order_id INT AUTO_INCREMENT PRIMARY KEY,
  move_order_number VARCHAR(40) NOT NULL UNIQUE,
  move_order_date DATE NOT NULL,
  move_order_type ENUM(
    'Raw Material Transfer',
    'Production Issue Transfer',
    'Semi-Finished Transfer',
    'Finished Goods Transfer',
    'QA Hold Transfer',
    'Rejection Transfer',
    'Dispatch Staging Transfer'
  ) NOT NULL,
  source_location VARCHAR(120) NOT NULL,
  destination_location VARCHAR(120) NOT NULL,
  requested_by INT NOT NULL,
  approved_by INT NULL,
  moved_by INT NULL,
  reference_type ENUM('Production Order', 'Finished Goods Receipt', 'Customer Order', 'Dispatch', 'Manual Transfer') NOT NULL DEFAULT 'Manual Transfer',
  reference_id INT NULL,
  priority ENUM('Low', 'Medium', 'High', 'Urgent') NOT NULL DEFAULT 'Medium',
  move_status ENUM('Draft', 'Requested', 'Approved', 'In Transit', 'Completed', 'Cancelled', 'Rejected') NOT NULL DEFAULT 'Draft',
  remarks VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_move_order_requested_by
    FOREIGN KEY (requested_by) REFERENCES employee_master(employee_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_move_order_approved_by
    FOREIGN KEY (approved_by) REFERENCES employee_master(employee_id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT fk_move_order_moved_by
    FOREIGN KEY (moved_by) REFERENCES employee_master(employee_id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT chk_move_order_locations CHECK (source_location <> destination_location),
  INDEX idx_move_order_date_type (move_order_date, move_order_type),
  INDEX idx_move_order_status_priority (move_status, priority),
  INDEX idx_move_order_source_destination (source_location, destination_location),
  INDEX idx_move_order_reference (reference_type, reference_id),
  INDEX idx_move_order_requested_by (requested_by),
  INDEX idx_move_order_approved_by (approved_by),
  INDEX idx_move_order_moved_by (moved_by)
);

DELIMITER $$

DROP TRIGGER IF EXISTS trg_move_order_before_insert$$
DROP TRIGGER IF EXISTS trg_move_order_before_update$$

CREATE TRIGGER trg_move_order_before_insert
BEFORE INSERT ON move_order
FOR EACH ROW
BEGIN
  DECLARE ref_count INT DEFAULT 0;

  IF NEW.source_location = NEW.destination_location THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'source_location and destination_location cannot be the same';
  END IF;

  IF NEW.move_status IN ('Approved', 'In Transit', 'Completed')
     AND NEW.approved_by IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'approved, in transit, and completed move orders require approved_by';
  END IF;

  IF NEW.move_status IN ('In Transit', 'Completed')
     AND NEW.moved_by IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'in transit and completed move orders require moved_by';
  END IF;

  IF NEW.move_status IN ('Cancelled', 'Rejected')
     AND (NEW.remarks IS NULL OR TRIM(NEW.remarks) = '') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'cancelled or rejected move orders require remarks';
  END IF;

  IF NEW.move_order_type = 'Dispatch Staging Transfer'
     AND NOT (NEW.source_location = 'Finished Goods Store' AND NEW.destination_location = 'Dispatch Staging Area') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'dispatch staging transfers should move from Finished Goods Store to Dispatch Staging Area';
  END IF;

  IF NEW.move_order_type = 'QA Hold Transfer'
     AND NEW.destination_location <> 'QA Hold Area' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'QA hold transfers must move to QA Hold Area';
  END IF;

  IF NEW.move_order_type = 'Rejection Transfer'
     AND NEW.destination_location <> 'Rejection Bay' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'rejection transfers must move to Rejection Bay';
  END IF;

  IF NEW.move_order_type = 'Production Issue Transfer'
     AND NEW.destination_location NOT IN ('Production Line 1', 'Production Line 2') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'production issue transfers should move to a production line';
  END IF;

  IF NEW.reference_type = 'Production Order' THEN
    SELECT COUNT(*) INTO ref_count FROM production_order WHERE production_order_id = NEW.reference_id;
  ELSEIF NEW.reference_type = 'Finished Goods Receipt' THEN
    SELECT COUNT(*) INTO ref_count FROM finished_goods_receipt WHERE fg_receipt_id = NEW.reference_id;
  ELSEIF NEW.reference_type = 'Customer Order' THEN
    SELECT COUNT(*) INTO ref_count FROM customer_order WHERE co_id = NEW.reference_id;
  ELSEIF NEW.reference_type = 'Dispatch' THEN
    SELECT COUNT(*) INTO ref_count FROM dispatch WHERE dispatch_id = NEW.reference_id;
  ELSEIF NEW.reference_type = 'Manual Transfer' THEN
    SET ref_count = IF(NEW.reference_id IS NULL, 1, 0);
  END IF;

  IF ref_count = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'reference_id must match the selected reference_type';
  END IF;
END$$

CREATE TRIGGER trg_move_order_before_update
BEFORE UPDATE ON move_order
FOR EACH ROW
BEGIN
  DECLARE ref_count INT DEFAULT 0;

  IF NEW.source_location = NEW.destination_location THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'source_location and destination_location cannot be the same';
  END IF;

  IF NEW.move_status IN ('Approved', 'In Transit', 'Completed')
     AND NEW.approved_by IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'approved, in transit, and completed move orders require approved_by';
  END IF;

  IF NEW.move_status IN ('In Transit', 'Completed')
     AND NEW.moved_by IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'in transit and completed move orders require moved_by';
  END IF;

  IF NEW.move_status IN ('Cancelled', 'Rejected')
     AND (NEW.remarks IS NULL OR TRIM(NEW.remarks) = '') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'cancelled or rejected move orders require remarks';
  END IF;

  IF NEW.move_order_type = 'Dispatch Staging Transfer'
     AND NOT (NEW.source_location = 'Finished Goods Store' AND NEW.destination_location = 'Dispatch Staging Area') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'dispatch staging transfers should move from Finished Goods Store to Dispatch Staging Area';
  END IF;

  IF NEW.move_order_type = 'QA Hold Transfer'
     AND NEW.destination_location <> 'QA Hold Area' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'QA hold transfers must move to QA Hold Area';
  END IF;

  IF NEW.move_order_type = 'Rejection Transfer'
     AND NEW.destination_location <> 'Rejection Bay' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'rejection transfers must move to Rejection Bay';
  END IF;

  IF NEW.move_order_type = 'Production Issue Transfer'
     AND NEW.destination_location NOT IN ('Production Line 1', 'Production Line 2') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'production issue transfers should move to a production line';
  END IF;

  IF NEW.reference_type = 'Production Order' THEN
    SELECT COUNT(*) INTO ref_count FROM production_order WHERE production_order_id = NEW.reference_id;
  ELSEIF NEW.reference_type = 'Finished Goods Receipt' THEN
    SELECT COUNT(*) INTO ref_count FROM finished_goods_receipt WHERE fg_receipt_id = NEW.reference_id;
  ELSEIF NEW.reference_type = 'Customer Order' THEN
    SELECT COUNT(*) INTO ref_count FROM customer_order WHERE co_id = NEW.reference_id;
  ELSEIF NEW.reference_type = 'Dispatch' THEN
    SELECT COUNT(*) INTO ref_count FROM dispatch WHERE dispatch_id = NEW.reference_id;
  ELSEIF NEW.reference_type = 'Manual Transfer' THEN
    SET ref_count = IF(NEW.reference_id IS NULL, 1, 0);
  END IF;

  IF ref_count = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'reference_id must match the selected reference_type';
  END IF;
END$$

DELIMITER ;
