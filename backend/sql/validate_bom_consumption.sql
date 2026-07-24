SELECT 'row_count' AS validation_check, COUNT(*) AS result
FROM bom_consumption;

SELECT 'orphan_production_order_items' AS validation_check, COUNT(*) AS result
FROM bom_consumption bc
LEFT JOIN production_order_items poi ON poi.production_order_item_id = bc.production_order_item_id
WHERE poi.production_order_item_id IS NULL;

SELECT 'finished_item_mismatch' AS validation_check, COUNT(*) AS result
FROM bom_consumption bc
JOIN production_order_items poi ON poi.production_order_item_id = bc.production_order_item_id
WHERE bc.finished_item_id <> poi.item_id;

SELECT 'orphan_consumed_items' AS validation_check, COUNT(*) AS result
FROM bom_consumption bc
LEFT JOIN item_master im ON im.item_id = bc.consumed_item_id
WHERE im.item_id IS NULL;

SELECT 'orphan_employees' AS validation_check, COUNT(*) AS result
FROM bom_consumption bc
LEFT JOIN employee_master em ON em.employee_id = bc.consumed_by
WHERE em.employee_id IS NULL;

SELECT 'bad_quantities' AS validation_check, COUNT(*) AS result
FROM bom_consumption
WHERE planned_quantity <= 0
   OR issued_quantity < actual_consumed_quantity
   OR returned_quantity > issued_quantity
   OR wastage_quantity < 0
   OR returned_quantity + actual_consumed_quantity + wastage_quantity <> issued_quantity;

SELECT 'bad_consumption_dates' AS validation_check, COUNT(*) AS result
FROM bom_consumption bc
JOIN production_order_items poi ON poi.production_order_item_id = bc.production_order_item_id
JOIN production_order po ON po.production_order_id = poi.production_order_id
WHERE bc.consumption_date < DATE(COALESCE(po.actual_start_date, po.planned_start_date))
   OR bc.consumption_date > DATE(COALESCE(po.actual_end_date, po.planned_end_date));

SELECT bc.bom_consumption_id,
       po.production_order_number,
       finished.item_name AS finished_item,
       consumed.item_name AS consumed_item,
       bc.planned_quantity,
       bc.issued_quantity,
       bc.actual_consumed_quantity,
       bc.returned_quantity,
       bc.wastage_quantity,
       bc.uom,
       bc.warehouse_location,
       bc.batch_number,
       bc.consumption_date,
       bc.transaction_status
FROM bom_consumption bc
JOIN production_order_items poi ON poi.production_order_item_id = bc.production_order_item_id
JOIN production_order po ON po.production_order_id = poi.production_order_id
JOIN item_master finished ON finished.item_id = bc.finished_item_id
JOIN item_master consumed ON consumed.item_id = bc.consumed_item_id
ORDER BY bc.bom_consumption_id
LIMIT 10;
