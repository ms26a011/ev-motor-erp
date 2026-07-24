SELECT 'row_count' AS validation_check, COUNT(*) AS result
FROM production_order_items;

SELECT 'orphan_orders' AS validation_check, COUNT(*) AS result
FROM production_order_items poi
LEFT JOIN production_order po ON po.production_order_id = poi.production_order_id
WHERE po.production_order_id IS NULL;

SELECT 'orphan_items' AS validation_check, COUNT(*) AS result
FROM production_order_items poi
LEFT JOIN item_master im ON im.item_id = poi.item_id
WHERE im.item_id IS NULL;

SELECT 'bad_quantities' AS validation_check, COUNT(*) AS result
FROM production_order_items
WHERE planned_quantity <= 0
   OR produced_quantity < 0
   OR accepted_quantity < 0
   OR rejected_quantity < 0
   OR accepted_quantity + rejected_quantity <> produced_quantity
   OR produced_quantity > planned_quantity;

SELECT 'completed_without_acceptance' AS validation_check, COUNT(*) AS result
FROM production_order_items
WHERE line_status = 'Completed'
  AND accepted_quantity <= 0;

SELECT 'rejected_without_remarks' AS validation_check, COUNT(*) AS result
FROM production_order_items
WHERE line_status = 'Rejected'
  AND (remarks IS NULL OR TRIM(remarks) = '');

SELECT 'orders_without_output_lines' AS validation_check, COUNT(*) AS result
FROM production_order po
LEFT JOIN production_order_items poi ON poi.production_order_id = po.production_order_id
WHERE poi.production_order_item_id IS NULL;

SELECT poi.production_order_item_id,
       po.production_order_number,
       im.item_name,
       poi.planned_quantity,
       poi.produced_quantity,
       poi.accepted_quantity,
       poi.rejected_quantity,
       poi.uom,
       poi.production_stage,
       poi.line_status,
       poi.remarks
FROM production_order_items poi
JOIN production_order po ON po.production_order_id = poi.production_order_id
JOIN item_master im ON im.item_id = poi.item_id
ORDER BY poi.production_order_item_id
LIMIT 10;
