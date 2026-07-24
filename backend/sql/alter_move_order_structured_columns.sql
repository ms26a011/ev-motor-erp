DELIMITER $$

CREATE PROCEDURE add_move_order_column_if_missing(
  IN column_name_param VARCHAR(64),
  IN column_definition_param VARCHAR(255),
  IN after_column_param VARCHAR(64)
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'move_order'
      AND COLUMN_NAME = column_name_param
  ) THEN
    SET @alter_sql = CONCAT(
      'ALTER TABLE move_order ADD COLUMN `',
      column_name_param,
      '` ',
      column_definition_param,
      ' AFTER `',
      after_column_param,
      '`'
    );
    PREPARE stmt FROM @alter_sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

CALL add_move_order_column_if_missing('move_order_type', 'VARCHAR(80) NULL', 'to_department_id');
CALL add_move_order_column_if_missing('priority', 'VARCHAR(20) NULL', 'move_order_type');
CALL add_move_order_column_if_missing('source_location', 'VARCHAR(120) NULL', 'priority');
CALL add_move_order_column_if_missing('destination_location', 'VARCHAR(120) NULL', 'source_location');
CALL add_move_order_column_if_missing('reason', 'VARCHAR(500) NULL', 'destination_location');
CALL add_move_order_column_if_missing('required_date', 'DATE NULL', 'reason');
CALL add_move_order_column_if_missing('received_by', 'INT NULL', 'issued_date');
CALL add_move_order_column_if_missing('received_date', 'DATE NULL', 'received_by');

DROP PROCEDURE add_move_order_column_if_missing;

SET @fk_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'move_order'
    AND COLUMN_NAME = 'received_by'
    AND REFERENCED_TABLE_NAME = 'employee_master'
);

SET @fk_sql = IF(
  @fk_exists = 0,
  'ALTER TABLE move_order ADD CONSTRAINT fk_move_order_received_by FOREIGN KEY (received_by) REFERENCES employee_master(employee_id)',
  'SELECT 1'
);
PREPARE stmt FROM @fk_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DELIMITER $$

CREATE PROCEDURE add_move_order_index_if_missing(
  IN index_name_param VARCHAR(64),
  IN index_definition_param VARCHAR(255)
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'move_order'
      AND INDEX_NAME = index_name_param
  ) THEN
    SET @index_sql = CONCAT('CREATE INDEX `', index_name_param, '` ON move_order ', index_definition_param);
    PREPARE stmt FROM @index_sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

CALL add_move_order_index_if_missing('idx_move_order_type_status', '(move_order_type, status)');
CALL add_move_order_index_if_missing('idx_move_order_priority_status', '(priority, status)');
CALL add_move_order_index_if_missing('idx_move_order_locations_structured', '(source_location, destination_location)');
CALL add_move_order_index_if_missing('idx_move_order_required_date', '(required_date)');
CALL add_move_order_index_if_missing('idx_move_order_received_by', '(received_by)');

DROP PROCEDURE add_move_order_index_if_missing;
