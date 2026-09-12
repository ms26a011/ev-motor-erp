-- Inventory analytics views for dashboard and forecasting review.
-- Lead time is derived from purchase order history. If no PO history exists,
-- the first version uses a 7 day fallback until lead time becomes item/vendor master data.

CREATE OR REPLACE VIEW vw_inventory_analytics_base AS
WITH inventory_position AS (
  SELECT
    ib.item_id,
    SUM(COALESCE(ib.quantity_on_hand, ib.current_stock, 0)) AS quantity_on_hand,
    SUM(COALESCE(ib.reserved_quantity, 0)) AS reserved_quantity,
    SUM(COALESCE(ib.available_quantity, COALESCE(ib.quantity_on_hand, ib.current_stock, 0) - COALESCE(ib.reserved_quantity, 0))) AS available_quantity,
    MAX(COALESCE(NULLIF(ib.reorder_level, 0), im.reorder_level, 0)) AS reorder_level,
    MAX(COALESCE(NULLIF(ib.safety_stock, 0), im.safety_stock, 0)) AS safety_stock,
    SUM(COALESCE(ib.inventory_value, 0)) AS inventory_value
  FROM inventory_balance ib
  JOIN item_master im ON im.item_id = ib.item_id
  WHERE COALESCE(ib.status, 'Active') <> 'Inactive'
  GROUP BY ib.item_id
),
open_po AS (
  SELECT
    poi.item_id,
    SUM(COALESCE(poi.pending_quantity, GREATEST(poi.ordered_quantity - poi.received_quantity, 0))) AS open_po_quantity,
    MIN(poi.expected_delivery_date) AS next_po_delivery_date
  FROM purchase_order_items poi
  JOIN purchase_order po ON po.po_id = poi.po_id
  WHERE poi.line_status IN ('Ordered', 'Partially Received')
    AND po.po_status IN ('Issued', 'Partially Received', 'Draft')
    AND COALESCE(poi.pending_quantity, GREATEST(poi.ordered_quantity - poi.received_quantity, 0)) > 0
  GROUP BY poi.item_id
),
production_requirements AS (
  SELECT
    bm.component_item_id AS item_id,
    SUM(GREATEST(po.planned_quantity - COALESCE(po.produced_quantity, 0), 0)
      * bm.quantity_per_unit
      * (1 + COALESCE(bm.scrap_factor_percent, 0) / 100)) AS production_required_quantity,
    MIN(po.planned_start_date) AS earliest_production_required_date,
    COUNT(DISTINCT po.production_order_id) AS impacted_production_orders
  FROM production_order po
  JOIN bom_master bm ON bm.parent_item_id = po.finished_item_id
  WHERE po.production_status IN ('Planned', 'Released', 'In Progress', 'Partially Completed', 'On Hold')
    AND COALESCE(bm.status, 'Active') = 'Active'
    AND po.planned_start_date >= DATE_SUB(CURRENT_DATE, INTERVAL 30 DAY)
    AND (bm.effective_to IS NULL OR bm.effective_to >= CURRENT_DATE)
  GROUP BY bm.component_item_id
),
purchase_requirements AS (
  SELECT
    pri.item_id,
    SUM(pri.requested_quantity) AS pending_pr_quantity,
    MIN(pri.required_date) AS earliest_pr_required_date
  FROM purchase_requisition_items pri
  JOIN purchase_requisition pr ON pr.pr_id = pri.pr_id
  WHERE pri.status IN ('Pending', 'Approved')
    AND pr.status IN ('Pending', 'Approved', 'Submitted')
  GROUP BY pri.item_id
),
consumption_90 AS (
  SELECT
    item_id,
    SUM(COALESCE(quantity_out, 0)) / 90 AS avg_daily_consumption
  FROM stock_transaction_log
  WHERE transaction_date >= DATE_SUB(CURRENT_DATE, INTERVAL 90 DAY)
  GROUP BY item_id
),
lead_times AS (
  SELECT
    poi.item_id,
    ROUND(AVG(GREATEST(DATEDIFF(poi.expected_delivery_date, po.po_date), 1)), 0) AS lead_time_days
  FROM purchase_order_items poi
  JOIN purchase_order po ON po.po_id = poi.po_id
  WHERE poi.expected_delivery_date IS NOT NULL
    AND po.po_date IS NOT NULL
    AND poi.expected_delivery_date >= po.po_date
  GROUP BY poi.item_id
)
SELECT
  im.item_id,
  im.item_code,
  im.item_name,
  im.category,
  im.uom,
  COALESCE(im.criticality, 'Low') AS criticality,
  COALESCE(ip.quantity_on_hand, 0) AS quantity_on_hand,
  COALESCE(ip.reserved_quantity, 0) AS reserved_quantity,
  COALESCE(ip.available_quantity, 0) AS available_quantity,
  COALESCE(ip.reorder_level, im.reorder_level, 0) AS reorder_level,
  COALESCE(ip.safety_stock, im.safety_stock, 0) AS safety_stock,
  COALESCE(ip.inventory_value, 0) AS inventory_value,
  COALESCE(op.open_po_quantity, 0) AS open_po_quantity,
  op.next_po_delivery_date,
  COALESCE(pr.production_required_quantity, 0) AS production_required_quantity,
  COALESCE(pr.impacted_production_orders, 0) AS impacted_production_orders,
  COALESCE(pur.pending_pr_quantity, 0) AS pending_pr_quantity,
  LEAST(
    COALESCE(pr.earliest_production_required_date, '9999-12-31'),
    COALESCE(pur.earliest_pr_required_date, '9999-12-31')
  ) AS required_by_date,
  COALESCE(c90.avg_daily_consumption, 0) AS avg_daily_consumption,
  COALESCE(lt.lead_time_days, 7) AS lead_time_days,
  DATE_SUB(
    LEAST(
      COALESCE(pr.earliest_production_required_date, '9999-12-31'),
      COALESCE(pur.earliest_pr_required_date, '9999-12-31')
    ),
    INTERVAL COALESCE(lt.lead_time_days, 7) DAY
  ) AS order_by_date,
  GREATEST(
    COALESCE(pr.production_required_quantity, 0) + COALESCE(pur.pending_pr_quantity, 0),
    COALESCE(ip.reorder_level, im.reorder_level, 0) + COALESCE(ip.safety_stock, im.safety_stock, 0)
  ) AS planning_requirement_quantity,
  GREATEST(
    GREATEST(
      COALESCE(pr.production_required_quantity, 0) + COALESCE(pur.pending_pr_quantity, 0),
      COALESCE(ip.reorder_level, im.reorder_level, 0) + COALESCE(ip.safety_stock, im.safety_stock, 0)
    ) - COALESCE(ip.available_quantity, 0) - COALESCE(op.open_po_quantity, 0),
    0
  ) AS suggested_order_quantity,
  CASE
    WHEN COALESCE(c90.avg_daily_consumption, 0) > 0
    THEN ROUND(COALESCE(ip.available_quantity, 0) / c90.avg_daily_consumption, 1)
    ELSE NULL
  END AS days_of_cover
FROM item_master im
LEFT JOIN inventory_position ip ON ip.item_id = im.item_id
LEFT JOIN open_po op ON op.item_id = im.item_id
LEFT JOIN production_requirements pr ON pr.item_id = im.item_id
LEFT JOIN purchase_requirements pur ON pur.item_id = im.item_id
LEFT JOIN consumption_90 c90 ON c90.item_id = im.item_id
LEFT JOIN lead_times lt ON lt.item_id = im.item_id
WHERE COALESCE(im.status, 'Active') <> 'Inactive';

CREATE OR REPLACE VIEW vw_inventory_unavailable_items AS
SELECT *
FROM vw_inventory_analytics_base
WHERE available_quantity <= 0;

CREATE OR REPLACE VIEW vw_inventory_order_today AS
SELECT *
FROM vw_inventory_analytics_base
WHERE suggested_order_quantity > 0
  AND required_by_date <> '9999-12-31'
  AND order_by_date <= CURRENT_DATE;

CREATE OR REPLACE VIEW vw_inventory_criticality_counts AS
SELECT
  SUM(CASE WHEN LOWER(COALESCE(criticality, '')) IN ('high', 'highly critical', 'critical', 'urgent') THEN 1 ELSE 0 END) AS highly_critical_count,
  SUM(CASE WHEN LOWER(COALESCE(criticality, '')) IN ('medium', 'semi critical', 'semi-critical', 'moderate') THEN 1 ELSE 0 END) AS semi_critical_count,
  SUM(CASE WHEN LOWER(COALESCE(criticality, '')) NOT IN ('high', 'highly critical', 'critical', 'urgent', 'medium', 'semi critical', 'semi-critical', 'moderate') THEN 1 ELSE 0 END) AS low_critical_count
FROM vw_inventory_analytics_base;

CREATE OR REPLACE VIEW vw_inventory_stockout_risk AS
SELECT *
FROM vw_inventory_analytics_base
WHERE avg_daily_consumption > 0
  AND days_of_cover <= 30;

CREATE OR REPLACE VIEW vw_inventory_production_shortages AS
SELECT *
FROM vw_inventory_analytics_base
WHERE production_required_quantity > 0
  AND available_quantity + open_po_quantity < production_required_quantity;

CREATE OR REPLACE VIEW vw_inventory_open_po_coverage AS
SELECT *
FROM vw_inventory_analytics_base
WHERE open_po_quantity > 0
   OR production_required_quantity > 0
   OR pending_pr_quantity > 0;

CREATE OR REPLACE VIEW vw_inventory_excess_slow_moving AS
SELECT *
FROM vw_inventory_analytics_base
WHERE avg_daily_consumption = 0
  AND available_quantity > GREATEST(reorder_level * 2, safety_stock * 2, 0);
