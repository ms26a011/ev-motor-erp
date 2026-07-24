SELECT 'row_count' AS validation_check, COUNT(*) AS result
FROM production_order;

SELECT 'orphan_customer_orders' AS validation_check, COUNT(*) AS result
FROM production_order po
LEFT JOIN customer_order co ON co.co_id = po.customer_order_id
WHERE po.customer_order_id IS NOT NULL
  AND co.co_id IS NULL;

SELECT 'orphan_items' AS validation_check, COUNT(*) AS result
FROM production_order po
LEFT JOIN item_master im ON im.item_id = po.finished_item_id
WHERE im.item_id IS NULL;

SELECT 'orphan_departments' AS validation_check, COUNT(*) AS result
FROM production_order po
LEFT JOIN department_master dm ON dm.department_id = po.department_id
WHERE dm.department_id IS NULL;

SELECT 'orphan_employees' AS validation_check, COUNT(*) AS result
FROM production_order po
LEFT JOIN employee_master creator ON creator.employee_id = po.created_by
LEFT JOIN employee_master approver ON approver.employee_id = po.approved_by
WHERE creator.employee_id IS NULL
   OR (po.approved_by IS NOT NULL AND approver.employee_id IS NULL);

SELECT 'bad_quantities' AS validation_check, COUNT(*) AS result
FROM production_order
WHERE planned_quantity <= 0
   OR produced_quantity < 0
   OR rejected_quantity < 0
   OR produced_quantity + rejected_quantity > planned_quantity;

SELECT 'bad_planned_dates' AS validation_check, COUNT(*) AS result
FROM production_order
WHERE planned_end_date <= planned_start_date;

SELECT 'bad_actual_dates' AS validation_check, COUNT(*) AS result
FROM production_order
WHERE actual_start_date IS NOT NULL
  AND actual_end_date IS NOT NULL
  AND actual_end_date < actual_start_date;

SELECT 'completed_missing_actual_dates' AS validation_check, COUNT(*) AS result
FROM production_order
WHERE production_status = 'Completed'
  AND (actual_start_date IS NULL OR actual_end_date IS NULL);

SELECT 'cancelled_with_output' AS validation_check, COUNT(*) AS result
FROM production_order
WHERE production_status = 'Cancelled'
  AND produced_quantity <> 0;

SELECT 'on_hold_without_remarks' AS validation_check, COUNT(*) AS result
FROM production_order
WHERE production_status = 'On Hold'
  AND (remarks IS NULL OR TRIM(remarks) = '');

SELECT 'make_to_order' AS validation_check, COUNT(*) AS result
FROM production_order
WHERE customer_order_id IS NOT NULL;

SELECT 'make_to_stock' AS validation_check, COUNT(*) AS result
FROM production_order
WHERE customer_order_id IS NULL;

SELECT po.production_order_id,
       po.production_order_number,
       co.co_number AS customer_order,
       im.item_name,
       dm.department_name,
       po.planned_quantity,
       po.produced_quantity,
       po.rejected_quantity,
       po.uom,
       po.planned_start_date,
       po.planned_end_date,
       po.priority,
       po.production_status
FROM production_order po
LEFT JOIN customer_order co ON co.co_id = po.customer_order_id
JOIN item_master im ON im.item_id = po.finished_item_id
JOIN department_master dm ON dm.department_id = po.department_id
ORDER BY po.production_order_id
LIMIT 10;
