SELECT 'total_move_orders' AS validation_check, COUNT(*) AS result
FROM move_orders;

SELECT 'duplicate_move_order_no' AS validation_check, COUNT(*) AS result
FROM (
  SELECT move_order_no
  FROM move_orders
  GROUP BY move_order_no
  HAVING COUNT(*) > 1
) duplicates;

SELECT 'orphan_requested_employees' AS validation_check, COUNT(*) AS result
FROM move_orders mo
LEFT JOIN employee_master em ON em.employee_id = mo.requested_by_employee_id
WHERE em.employee_id IS NULL;

SELECT 'orphan_optional_employees' AS validation_check, COUNT(*) AS result
FROM move_orders mo
LEFT JOIN employee_master approver ON approver.employee_id = mo.approved_by_employee_id
LEFT JOIN employee_master issuer ON issuer.employee_id = mo.issued_by_employee_id
LEFT JOIN employee_master receiver ON receiver.employee_id = mo.received_by_employee_id
WHERE (mo.approved_by_employee_id IS NOT NULL AND approver.employee_id IS NULL)
   OR (mo.issued_by_employee_id IS NOT NULL AND issuer.employee_id IS NULL)
   OR (mo.received_by_employee_id IS NOT NULL AND receiver.employee_id IS NULL);

SELECT 'orphan_departments' AS validation_check, COUNT(*) AS result
FROM move_orders mo
LEFT JOIN department_master from_dept ON from_dept.department_id = mo.from_department_id
LEFT JOIN department_master to_dept ON to_dept.department_id = mo.to_department_id
WHERE from_dept.department_id IS NULL
   OR to_dept.department_id IS NULL;

SELECT 'invalid_required_dates' AS validation_check, COUNT(*) AS result
FROM move_orders
WHERE required_date IS NOT NULL
  AND required_date < move_order_date;

SELECT 'invalid_approval_state' AS validation_check, COUNT(*) AS result
FROM move_orders
WHERE (approved_by_employee_id IS NULL AND approved_date IS NOT NULL)
   OR (approved_by_employee_id IS NOT NULL AND approved_date IS NULL)
   OR (
     status IN ('Approved', 'Issued', 'Partially Received', 'Received')
     AND (approved_by_employee_id IS NULL OR approved_date IS NULL)
   );

SELECT move_order_id,
       move_order_no,
       move_order_date,
       move_order_type,
       priority,
       status,
       from_location,
       to_location
FROM move_orders
ORDER BY move_order_id
LIMIT 25;
