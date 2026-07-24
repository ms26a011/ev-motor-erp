SELECT 'row_count' AS validation_check, COUNT(*) AS result
FROM bom_master;

SELECT 'orphan_parent_items' AS validation_check, COUNT(*) AS result
FROM bom_master bm
LEFT JOIN item_master im ON im.item_id = bm.parent_item_id
WHERE im.item_id IS NULL;

SELECT 'orphan_component_items' AS validation_check, COUNT(*) AS result
FROM bom_master bm
LEFT JOIN item_master im ON im.item_id = bm.component_item_id
WHERE im.item_id IS NULL;

SELECT 'bad_quantities' AS validation_check, COUNT(*) AS result
FROM bom_master
WHERE quantity_per_unit <= 0
   OR scrap_factor_percent < 0
   OR scrap_factor_percent > 25;

SELECT 'duplicate_parent_component_specs' AS validation_check, COUNT(*) AS result
FROM (
  SELECT parent_item_id, component_item_id, specification, COUNT(*) row_count
  FROM bom_master
  GROUP BY parent_item_id, component_item_id, specification
  HAVING COUNT(*) > 1
) duplicates;

SELECT bm.bom_code,
       parent.item_name AS parent_item,
       component.item_name AS component_item,
       bm.component_name,
       bm.component_category,
       bm.specification,
       bm.quantity_per_unit,
       bm.uom,
       bm.production_stage,
       bm.status
FROM bom_master bm
JOIN item_master parent ON parent.item_id = bm.parent_item_id
JOIN item_master component ON component.item_id = bm.component_item_id
ORDER BY bm.bom_id
LIMIT 10;
