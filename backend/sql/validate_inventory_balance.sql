-- Department-wise inventory record count and value.
SELECT
  dm.department_code,
  COUNT(*) AS inventory_records,
  ROUND(SUM(ib.quantity_on_hand), 3) AS total_quantity_on_hand,
  ROUND(SUM(ib.inventory_value), 2) AS total_inventory_value
FROM inventory_balance ib
JOIN department_master dm ON dm.department_id = ib.department_id
GROUP BY dm.department_code
ORDER BY dm.department_code;

-- Item-wise inventory value.
SELECT
  im.item_code,
  im.item_name,
  ROUND(SUM(ib.quantity_on_hand), 3) AS quantity_on_hand,
  ROUND(SUM(ib.inventory_value), 2) AS inventory_value
FROM inventory_balance ib
JOIN item_master im ON im.item_id = ib.item_id
GROUP BY im.item_code, im.item_name
ORDER BY inventory_value DESC;

-- Negative stock records or deliberately flagged over-issued records.
SELECT *
FROM inventory_balance
WHERE quantity_on_hand < 0
   OR available_quantity < 0
   OR status LIKE 'Data Issue%';

-- Items below reorder level.
SELECT
  ib.balance_id,
  im.item_code,
  dm.department_code,
  ib.quantity_on_hand,
  ib.available_quantity,
  ib.reorder_level,
  ib.status
FROM inventory_balance ib
JOIN item_master im ON im.item_id = ib.item_id
JOIN department_master dm ON dm.department_id = ib.department_id
WHERE ib.available_quantity <= ib.reorder_level
ORDER BY dm.department_code, im.item_code;

-- Finished goods wrongly placed outside FGWH.
SELECT ib.*
FROM inventory_balance ib
JOIN item_master im ON im.item_id = ib.item_id
JOIN department_master dm ON dm.department_id = ib.department_id
WHERE im.category = 'Finished Goods'
  AND dm.department_code <> 'FGWH';

-- Raw materials and bought-out components wrongly placed in FGWH.
SELECT ib.*
FROM inventory_balance ib
JOIN item_master im ON im.item_id = ib.item_id
JOIN department_master dm ON dm.department_id = ib.department_id
WHERE im.category <> 'Finished Goods'
  AND dm.department_code = 'FGWH';

-- Inventory records without valid item or department.
SELECT ib.*
FROM inventory_balance ib
LEFT JOIN item_master im ON im.item_id = ib.item_id
LEFT JOIN department_master dm ON dm.department_id = ib.department_id
WHERE im.item_id IS NULL
   OR dm.department_id IS NULL;

-- Formula checks.
SELECT ib.*
FROM inventory_balance ib
JOIN item_master im ON im.item_id = ib.item_id
WHERE ib.available_quantity <> ib.quantity_on_hand - ib.reserved_quantity
   OR ib.current_stock <> ib.quantity_on_hand
   OR ROUND(ib.inventory_value, 2) <> ROUND(ib.quantity_on_hand * im.unit_cost, 2);
