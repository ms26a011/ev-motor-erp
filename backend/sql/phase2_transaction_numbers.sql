-- Phase 2 transaction number support.
-- Existing unique columns in the current schema:
-- purchase_requisition.pr_number
-- purchase_order.po_number
-- goods_receipt.grn_number
-- move_order.mo_number
-- production_entry.production_number
-- customer_order.co_number
-- dispatch.dispatch_number

DELIMITER $$

CREATE PROCEDURE ensure_column_exists(
  IN table_name_param VARCHAR(64),
  IN column_name_param VARCHAR(64),
  IN column_definition_param VARCHAR(255)
)
BEGIN
  IF EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name_param
  ) AND NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name_param
      AND COLUMN_NAME = column_name_param
  ) THEN
    SET @alter_sql = CONCAT('ALTER TABLE `', table_name_param, '` ADD COLUMN `', column_name_param, '` ', column_definition_param);
    PREPARE stmt FROM @alter_sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE ensure_unique_index_exists(
  IN table_name_param VARCHAR(64),
  IN column_name_param VARCHAR(64),
  IN index_name_param VARCHAR(64)
)
BEGIN
  IF EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name_param
      AND COLUMN_NAME = column_name_param
  ) AND NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name_param
      AND INDEX_NAME = index_name_param
  ) THEN
    SET @index_sql = CONCAT('ALTER TABLE `', table_name_param, '` ADD UNIQUE INDEX `', index_name_param, '` (`', column_name_param, '`)');
    PREPARE stmt FROM @index_sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

CALL ensure_column_exists('inventory_balance', 'stock_inward_number', 'VARCHAR(30) NULL');
CALL ensure_unique_index_exists('inventory_balance', 'stock_inward_number', 'uq_inventory_balance_stock_inward_number');

CALL ensure_column_exists('stock_transaction_log', 'stock_transaction_number', 'VARCHAR(30) NULL');
CALL ensure_unique_index_exists('stock_transaction_log', 'stock_transaction_number', 'uq_stock_transaction_number');

CALL ensure_column_exists('production_consumption', 'bom_consumption_number', 'VARCHAR(30) NULL');
CALL ensure_unique_index_exists('production_consumption', 'bom_consumption_number', 'uq_bom_consumption_number');

CALL ensure_column_exists('vendor_invoice', 'invoice_number', 'VARCHAR(30) NULL');
CALL ensure_unique_index_exists('vendor_invoice', 'invoice_number', 'uq_vendor_invoice_number');

CALL ensure_column_exists('customer_invoice', 'invoice_number', 'VARCHAR(30) NULL');
CALL ensure_unique_index_exists('customer_invoice', 'invoice_number', 'uq_customer_invoice_number');

CALL ensure_column_exists('payment_tracking', 'payment_number', 'VARCHAR(30) NULL');
CALL ensure_unique_index_exists('payment_tracking', 'payment_number', 'uq_payment_number');

DROP PROCEDURE ensure_unique_index_exists;
DROP PROCEDURE ensure_column_exists;
