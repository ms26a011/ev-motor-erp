import { query } from './db.js';

const INVENTORY_ANALYTICS_SQL = `
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
  ) AS suggested_order_quantity
FROM item_master im
LEFT JOIN inventory_position ip ON ip.item_id = im.item_id
LEFT JOIN open_po op ON op.item_id = im.item_id
LEFT JOIN production_requirements pr ON pr.item_id = im.item_id
LEFT JOIN purchase_requirements pur ON pur.item_id = im.item_id
LEFT JOIN consumption_90 c90 ON c90.item_id = im.item_id
LEFT JOIN lead_times lt ON lt.item_id = im.item_id
WHERE COALESCE(im.status, 'Active') <> 'Inactive'
`;

export async function getInventoryAnalytics() {
  const rows = (await query(INVENTORY_ANALYTICS_SQL)).map(normalizeRow);
  const allUnavailableItems = rows
    .filter((row) => row.available_quantity <= 0)
    .sort(sortByRisk);
  const allOrderTodayItems = rows
    .filter((row) => row.suggested_order_quantity > 0 && isDueToday(row.order_by_date))
    .sort((a, b) => dateValue(a.required_by_date) - dateValue(b.required_by_date) || sortByRisk(a, b));
  const allStockoutRiskItems = rows
    .filter((row) => row.avg_daily_consumption > 0 && row.days_of_cover !== null && row.days_of_cover <= 30)
    .sort((a, b) => a.days_of_cover - b.days_of_cover);
  const allProductionShortages = rows
    .filter((row) => row.production_required_quantity > 0 && row.available_quantity + row.open_po_quantity < row.production_required_quantity)
    .sort(sortByRisk);
  const allOpenPoCoverage = rows
    .filter((row) => row.open_po_quantity > 0 || row.production_required_quantity > 0 || row.pending_pr_quantity > 0)
    .sort((a, b) => b.open_po_quantity - a.open_po_quantity);
  const allExcessSlowMovingItems = rows
    .filter((row) => row.avg_daily_consumption === 0 && row.available_quantity > Math.max(row.reorder_level * 2, row.safety_stock * 2, 0))
    .sort((a, b) => b.inventory_value - a.inventory_value);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalActiveItems: rows.length,
      unavailableItems: allUnavailableItems.length,
      orderTodayItems: allOrderTodayItems.length,
      stockoutRiskItems: allStockoutRiskItems.length,
      productionShortageItems: allProductionShortages.length,
      excessSlowMovingItems: allExcessSlowMovingItems.length,
      openPoCoverageItems: allOpenPoCoverage.length,
      criticality: criticalityCounts(rows),
    },
    unavailableItems: limitRows(allUnavailableItems),
    orderTodayItems: limitRows(allOrderTodayItems),
    stockoutRiskItems: limitRows(allStockoutRiskItems),
    productionShortages: limitRows(allProductionShortages),
    openPoCoverage: limitRows(allOpenPoCoverage),
    excessSlowMovingItems: limitRows(allExcessSlowMovingItems),
  };
}

function limitRows(rows) {
  return rows.slice(0, 25);
}

function normalizeRow(row) {
  const availableQuantity = toNumber(row.available_quantity);
  const avgDailyConsumption = toNumber(row.avg_daily_consumption);
  const daysOfCover = avgDailyConsumption > 0 ? availableQuantity / avgDailyConsumption : null;
  return {
    ...row,
    quantity_on_hand: toNumber(row.quantity_on_hand),
    reserved_quantity: toNumber(row.reserved_quantity),
    available_quantity: availableQuantity,
    reorder_level: toNumber(row.reorder_level),
    safety_stock: toNumber(row.safety_stock),
    inventory_value: toNumber(row.inventory_value),
    open_po_quantity: toNumber(row.open_po_quantity),
    production_required_quantity: toNumber(row.production_required_quantity),
    impacted_production_orders: toNumber(row.impacted_production_orders),
    pending_pr_quantity: toNumber(row.pending_pr_quantity),
    avg_daily_consumption: avgDailyConsumption,
    lead_time_days: toNumber(row.lead_time_days),
    planning_requirement_quantity: toNumber(row.planning_requirement_quantity),
    suggested_order_quantity: toNumber(row.suggested_order_quantity),
    days_of_cover: daysOfCover === null ? null : Math.round(daysOfCover * 10) / 10,
    estimated_stockout_date: daysOfCover === null ? null : dateAfterDays(daysOfCover),
    risk_level: riskLevel(row.criticality, availableQuantity, daysOfCover, toNumber(row.suggested_order_quantity)),
  };
}

function criticalityCounts(rows) {
  return rows.reduce((acc, row) => {
    const normalized = normalizeCriticality(row.criticality);
    acc[normalized] += 1;
    return acc;
  }, { highlyCritical: 0, semiCritical: 0, lowCritical: 0 });
}

function normalizeCriticality(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['high', 'highly critical', 'critical', 'urgent'].includes(text)) return 'highlyCritical';
  if (['medium', 'semi critical', 'semi-critical', 'moderate'].includes(text)) return 'semiCritical';
  return 'lowCritical';
}

function riskLevel(criticality, availableQuantity, daysOfCover, suggestedOrderQuantity) {
  if (availableQuantity <= 0 || (suggestedOrderQuantity > 0 && normalizeCriticality(criticality) === 'highlyCritical')) {
    return 'High';
  }
  if ((daysOfCover !== null && daysOfCover <= 15) || suggestedOrderQuantity > 0) {
    return 'Medium';
  }
  return 'Low';
}

function sortByRisk(a, b) {
  const score = { High: 3, Medium: 2, Low: 1 };
  return (score[b.risk_level] || 0) - (score[a.risk_level] || 0)
    || b.suggested_order_quantity - a.suggested_order_quantity
    || a.available_quantity - b.available_quantity;
}

function isDueToday(value) {
  if (!value || String(value).startsWith('9999-12-31')) return false;
  const due = new Date(value);
  const today = new Date();
  due.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return due <= today;
}

function dateValue(value) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  return new Date(value).getTime();
}

function dateAfterDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + Math.max(Math.floor(days), 0));
  return date.toISOString().slice(0, 10);
}

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}
