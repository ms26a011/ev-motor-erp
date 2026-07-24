DELIMITER $$

CREATE PROCEDURE add_dispatch_column_if_missing(
  IN table_name_param VARCHAR(64),
  IN column_name_param VARCHAR(64),
  IN column_definition_param VARCHAR(255),
  IN after_column_param VARCHAR(64)
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name_param
      AND COLUMN_NAME = column_name_param
  ) THEN
    SET @alter_sql = CONCAT(
      'ALTER TABLE `',
      table_name_param,
      '` ADD COLUMN `',
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

CREATE PROCEDURE add_dispatch_index_if_missing(
  IN table_name_param VARCHAR(64),
  IN index_name_param VARCHAR(64),
  IN index_definition_param VARCHAR(255)
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name_param
      AND INDEX_NAME = index_name_param
  ) THEN
    SET @index_sql = CONCAT('CREATE INDEX `', index_name_param, '` ON `', table_name_param, '` ', index_definition_param);
    PREPARE stmt FROM @index_sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

CALL add_dispatch_column_if_missing('dispatch', 'customer_id', 'INT NULL', 'co_id');
CALL add_dispatch_column_if_missing('dispatch', 'source_location', 'VARCHAR(120) NULL', 'dispatch_date');
CALL add_dispatch_column_if_missing('dispatch', 'transport_mode', 'VARCHAR(30) NULL', 'source_location');
CALL add_dispatch_column_if_missing('dispatch', 'delivery_address', 'VARCHAR(500) NULL', 'transport_company');
CALL add_dispatch_column_if_missing('dispatch', 'city', 'VARCHAR(80) NULL', 'delivery_address');
CALL add_dispatch_column_if_missing('dispatch', 'state', 'VARCHAR(80) NULL', 'city');
CALL add_dispatch_column_if_missing('dispatch', 'expected_delivery_date', 'DATE NULL', 'state');
CALL add_dispatch_column_if_missing('dispatch', 'actual_delivery_date', 'DATE NULL', 'expected_delivery_date');

CALL add_dispatch_column_if_missing('dispatch_items', 'co_item_id', 'INT NULL', 'dispatch_id');
CALL add_dispatch_column_if_missing('dispatch_items', 'item_description', 'VARCHAR(255) NULL', 'item_id');
CALL add_dispatch_column_if_missing('dispatch_items', 'uom', 'VARCHAR(20) NULL', 'item_description');
CALL add_dispatch_column_if_missing('dispatch_items', 'ordered_quantity', 'INT NULL', 'uom');
CALL add_dispatch_column_if_missing('dispatch_items', 'unit_price', 'DECIMAL(14,2) NULL', 'dispatched_quantity');
CALL add_dispatch_column_if_missing('dispatch_items', 'line_amount', 'DECIMAL(14,2) NULL', 'unit_price');
CALL add_dispatch_column_if_missing('dispatch_items', 'batch_no', 'VARCHAR(80) NULL', 'line_amount');
CALL add_dispatch_column_if_missing('dispatch_items', 'serial_no', 'VARCHAR(80) NULL', 'batch_no');

SET @dispatch_customer_fk_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'dispatch'
    AND COLUMN_NAME = 'customer_id'
    AND REFERENCED_TABLE_NAME = 'customer_master'
);

SET @dispatch_customer_fk_sql = IF(
  @dispatch_customer_fk_exists = 0,
  'ALTER TABLE dispatch ADD CONSTRAINT fk_dispatch_customer FOREIGN KEY (customer_id) REFERENCES customer_master(customer_id)',
  'SELECT 1'
);
PREPARE stmt FROM @dispatch_customer_fk_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @dispatch_co_item_fk_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'dispatch_items'
    AND COLUMN_NAME = 'co_item_id'
    AND REFERENCED_TABLE_NAME = 'customer_order_items'
);

SET @dispatch_co_item_fk_sql = IF(
  @dispatch_co_item_fk_exists = 0,
  'ALTER TABLE dispatch_items ADD CONSTRAINT fk_dispatch_items_co_item FOREIGN KEY (co_item_id) REFERENCES customer_order_items(co_item_id)',
  'SELECT 1'
);
PREPARE stmt FROM @dispatch_co_item_fk_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CALL add_dispatch_index_if_missing('dispatch', 'idx_dispatch_customer_date', '(customer_id, dispatch_date)');
CALL add_dispatch_index_if_missing('dispatch', 'idx_dispatch_status_mode', '(status, transport_mode)');
CALL add_dispatch_index_if_missing('dispatch', 'idx_dispatch_expected_delivery', '(expected_delivery_date)');
CALL add_dispatch_index_if_missing('dispatch_items', 'idx_dispatch_items_co_item', '(co_item_id)');
CALL add_dispatch_index_if_missing('dispatch_items', 'idx_dispatch_items_item', '(item_id)');

DROP PROCEDURE add_dispatch_index_if_missing;
DROP PROCEDURE add_dispatch_column_if_missing;
