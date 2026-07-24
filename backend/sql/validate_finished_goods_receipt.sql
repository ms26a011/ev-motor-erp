SELECT 'row_count' AS validation_check, COUNT(*) AS result
FROM finished_goods_receipt;

SELECT 'orphan_production_order_items' AS validation_check, COUNT(*) AS result
FROM finished_goods_receipt fgr
LEFT JOIN production_order_items poi ON poi.production_order_item_id = fgr.production_order_item_id
WHERE poi.production_order_item_id IS NULL;

SELECT 'production_order_mismatch' AS validation_check, COUNT(*) AS result
FROM finished_goods_receipt fgr
JOIN production_order_items poi ON poi.production_order_item_id = fgr.production_order_item_id
WHERE fgr.production_order_id <> poi.production_order_id;

SELECT 'finished_item_mismatch' AS validation_check, COUNT(*) AS result
FROM finished_goods_receipt fgr
JOIN production_order_items poi ON poi.production_order_item_id = fgr.production_order_item_id
WHERE fgr.finished_item_id <> poi.item_id;

SELECT 'orphan_employees' AS validation_check, COUNT(*) AS result
FROM finished_goods_receipt fgr
LEFT JOIN employee_master em ON em.employee_id = fgr.received_by
WHERE em.employee_id IS NULL;

SELECT 'bad_quantities' AS validation_check, COUNT(*) AS result
FROM finished_goods_receipt
WHERE received_quantity <= 0
   OR accepted_quantity < 0
   OR rejected_quantity < 0
   OR (
      inspection_status = 'Pending Inspection'
      AND (accepted_quantity <> 0 OR rejected_quantity <> 0)
   )
   OR (
      inspection_status <> 'Pending Inspection'
      AND accepted_quantity + rejected_quantity <> received_quantity
   );

SELECT 'bad_receipt_dates' AS validation_check, COUNT(*) AS result
FROM finished_goods_receipt fgr
JOIN production_order po ON po.production_order_id = fgr.production_order_id
WHERE fgr.receipt_date < DATE(COALESCE(po.actual_start_date, po.planned_start_date));

SELECT fgr.fg_receipt_id,
       fgr.fg_receipt_number,
       po.production_order_number,
       im.item_name,
       fgr.received_quantity,
       fgr.accepted_quantity,
       fgr.rejected_quantity,
       fgr.uom,
       fgr.receipt_date,
       fgr.inspection_status,
       fgr.warehouse_location,
       fgr.batch_number,
       fgr.serial_number_start,
       fgr.serial_number_end
FROM finished_goods_receipt fgr
JOIN production_order po ON po.production_order_id = fgr.production_order_id
JOIN item_master im ON im.item_id = fgr.finished_item_id
ORDER BY fgr.fg_receipt_id
LIMIT 10;
