SELECT 'row_count' AS validation_check, COUNT(*) AS result
FROM move_order;

SELECT 'same_source_destination' AS validation_check, COUNT(*) AS result
FROM move_order
WHERE source_location = destination_location;

SELECT 'orphan_requested_by' AS validation_check, COUNT(*) AS result
FROM move_order mo
LEFT JOIN employee_master em ON em.employee_id = mo.requested_by
WHERE em.employee_id IS NULL;

SELECT 'orphan_approved_or_moved_by' AS validation_check, COUNT(*) AS result
FROM move_order mo
LEFT JOIN employee_master approver ON approver.employee_id = mo.approved_by
LEFT JOIN employee_master mover ON mover.employee_id = mo.moved_by
WHERE (mo.approved_by IS NOT NULL AND approver.employee_id IS NULL)
   OR (mo.moved_by IS NOT NULL AND mover.employee_id IS NULL);

SELECT 'completed_missing_people' AS validation_check, COUNT(*) AS result
FROM move_order
WHERE move_status = 'Completed'
  AND (approved_by IS NULL OR moved_by IS NULL);

SELECT 'cancelled_rejected_without_remarks' AS validation_check, COUNT(*) AS result
FROM move_order
WHERE move_status IN ('Cancelled', 'Rejected')
  AND (remarks IS NULL OR TRIM(remarks) = '');

SELECT 'bad_type_locations' AS validation_check, COUNT(*) AS result
FROM move_order
WHERE (move_order_type = 'Dispatch Staging Transfer' AND NOT (source_location = 'Finished Goods Store' AND destination_location = 'Dispatch Staging Area'))
   OR (move_order_type = 'QA Hold Transfer' AND destination_location <> 'QA Hold Area')
   OR (move_order_type = 'Rejection Transfer' AND destination_location <> 'Rejection Bay')
   OR (move_order_type = 'Production Issue Transfer' AND destination_location NOT IN ('Production Line 1', 'Production Line 2'));

SELECT move_order_id,
       move_order_number,
       move_order_date,
       move_order_type,
       source_location,
       destination_location,
       reference_type,
       reference_id,
       priority,
       move_status
FROM move_order
ORDER BY move_order_id
LIMIT 10;
