"""
Inventory forecasting model for EV Motor ERP.

This script is designed as the modelling reference for the Inventory Analytics
module. It trains an item-wise demand forecast from stock movement history and
then calculates the five business outputs used by the ERP dashboard:

1. Consumption forecast
2. Stockout date forecast
3. Suggested reorder quantity
4. Order trigger date
5. Critical item risk score

RandomForestRegressor is used when scikit-learn is installed. If the ML
dependency is unavailable, the script falls back to a weighted moving-average
forecast so the output remains usable during local review.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import math
import os
from collections import defaultdict
from pathlib import Path

try:
    import pymysql
except ImportError as exc:  # pragma: no cover - environment guidance
    raise SystemExit("Install PyMySQL before running this script.") from exc

try:
    from sklearn.ensemble import RandomForestRegressor
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import mean_absolute_error
except ImportError:  # pragma: no cover - optional ML dependency
    RandomForestRegressor = None
    train_test_split = None
    mean_absolute_error = None


ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"


FORECAST_QUERY = """
SELECT
  im.item_id,
  im.item_code,
  im.item_name,
  im.category,
  im.uom,
  COALESCE(im.criticality, 'Low') AS criticality,
  COALESCE(im.reorder_level, 0) AS item_reorder_level,
  COALESCE(im.safety_stock, 0) AS item_safety_stock,
  COALESCE(pos.available_quantity, 0) AS available_quantity,
  COALESCE(pos.reorder_level, im.reorder_level, 0) AS reorder_level,
  COALESCE(pos.safety_stock, im.safety_stock, 0) AS safety_stock,
  COALESCE(open_po.open_po_quantity, 0) AS open_po_quantity,
  COALESCE(requirements.production_required_quantity, 0) AS production_required_quantity,
  COALESCE(requirements.pending_pr_quantity, 0) AS pending_pr_quantity,
  COALESCE(lead_time.lead_time_days, 7) AS lead_time_days
FROM item_master im
LEFT JOIN (
  SELECT
    ib.item_id,
    SUM(COALESCE(ib.available_quantity, ib.quantity_on_hand - ib.reserved_quantity, ib.current_stock, 0)) AS available_quantity,
    MAX(COALESCE(NULLIF(ib.reorder_level, 0), 0)) AS reorder_level,
    MAX(COALESCE(NULLIF(ib.safety_stock, 0), 0)) AS safety_stock
  FROM inventory_balance ib
  WHERE COALESCE(ib.status, 'Active') <> 'Inactive'
  GROUP BY ib.item_id
) pos ON pos.item_id = im.item_id
LEFT JOIN (
  SELECT
    poi.item_id,
    SUM(COALESCE(poi.pending_quantity, GREATEST(poi.ordered_quantity - poi.received_quantity, 0))) AS open_po_quantity
  FROM purchase_order_items poi
  JOIN purchase_order po ON po.po_id = poi.po_id
  WHERE poi.line_status IN ('Ordered', 'Partially Received')
    AND po.po_status IN ('Issued', 'Partially Received', 'Draft')
  GROUP BY poi.item_id
) open_po ON open_po.item_id = im.item_id
LEFT JOIN (
  SELECT
    item_id,
    SUM(production_required_quantity) AS production_required_quantity,
    SUM(pending_pr_quantity) AS pending_pr_quantity
  FROM (
    SELECT
      bm.component_item_id AS item_id,
      SUM(GREATEST(po.planned_quantity - COALESCE(po.produced_quantity, 0), 0) * bm.quantity_per_unit) AS production_required_quantity,
      0 AS pending_pr_quantity
    FROM production_order po
    JOIN bom_master bm ON bm.parent_item_id = po.finished_item_id
    WHERE po.production_status IN ('Planned', 'Released', 'In Progress', 'Partially Completed', 'On Hold')
      AND COALESCE(bm.status, 'Active') = 'Active'
    GROUP BY bm.component_item_id
    UNION ALL
    SELECT
      pri.item_id,
      0 AS production_required_quantity,
      SUM(pri.requested_quantity) AS pending_pr_quantity
    FROM purchase_requisition_items pri
    JOIN purchase_requisition pr ON pr.pr_id = pri.pr_id
    WHERE pri.status IN ('Pending', 'Approved')
      AND pr.status IN ('Pending', 'Approved', 'Submitted')
    GROUP BY pri.item_id
  ) demand
  GROUP BY item_id
) requirements ON requirements.item_id = im.item_id
LEFT JOIN (
  SELECT
    poi.item_id,
    ROUND(AVG(GREATEST(DATEDIFF(poi.expected_delivery_date, po.po_date), 1)), 0) AS lead_time_days
  FROM purchase_order_items poi
  JOIN purchase_order po ON po.po_id = poi.po_id
  WHERE poi.expected_delivery_date >= po.po_date
  GROUP BY poi.item_id
) lead_time ON lead_time.item_id = im.item_id
WHERE COALESCE(im.status, 'Active') <> 'Inactive'
"""


HISTORY_QUERY = """
SELECT
  item_id,
  transaction_date,
  SUM(COALESCE(quantity_out, 0)) AS quantity_out
FROM stock_transaction_log
WHERE transaction_date >= DATE_SUB(CURRENT_DATE, INTERVAL 365 DAY)
GROUP BY item_id, transaction_date
ORDER BY item_id, transaction_date
"""


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def connect():
    load_env(ENV_PATH)
    return pymysql.connect(
        host=os.getenv("DB_HOST", "localhost"),
        user=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASSWORD", ""),
        database=os.getenv("DB_NAME", "ev_motor_erp"),
        port=int(os.getenv("DB_PORT", "3306")),
        cursorclass=pymysql.cursors.DictCursor,
    )


def fetch_rows(connection, sql: str):
    with connection.cursor() as cursor:
        cursor.execute(sql)
        return cursor.fetchall()


def build_history(history_rows):
    by_item = defaultdict(dict)
    for row in history_rows:
        by_item[int(row["item_id"])][row["transaction_date"]] = float(row["quantity_out"] or 0)
    return by_item


def rolling_sum(series, current_date, days):
    start = current_date - dt.timedelta(days=days)
    return sum(value for date, value in series.items() if start <= date < current_date)


def build_training_examples(history_by_item, item_rows):
    item_lookup = {int(row["item_id"]): row for row in item_rows}
    examples = []
    targets = []
    for item_id, series in history_by_item.items():
        if len(series) < 45:
            continue
        dates = sorted(series)
        for current_date in dates[30:-30]:
            future_end = current_date + dt.timedelta(days=30)
            future_30 = sum(value for date, value in series.items() if current_date <= date < future_end)
            row = item_lookup.get(item_id)
            if not row:
                continue
            examples.append(features_for_item(row, series, current_date))
            targets.append(future_30)
    return examples, targets


def features_for_item(row, series, current_date):
    return [
        rolling_sum(series, current_date, 7),
        rolling_sum(series, current_date, 30),
        rolling_sum(series, current_date, 90),
        float(row["available_quantity"] or 0),
        float(row["reorder_level"] or 0),
        float(row["safety_stock"] or 0),
        float(row["open_po_quantity"] or 0),
        float(row["production_required_quantity"] or 0),
        float(row["pending_pr_quantity"] or 0),
        float(row["lead_time_days"] or 7),
        criticality_number(row["criticality"]),
        current_date.month,
    ]


def train_model(examples, targets):
    if RandomForestRegressor is None or len(examples) < 20:
        return None, None
    x_train, x_test, y_train, y_test = train_test_split(examples, targets, test_size=0.2, random_state=42)
    model = RandomForestRegressor(n_estimators=200, min_samples_leaf=2, random_state=42)
    model.fit(x_train, y_train)
    mae = mean_absolute_error(y_test, model.predict(x_test)) if x_test else None
    return model, mae


def weighted_baseline(series, row):
    today = dt.date.today()
    avg_7 = rolling_sum(series, today, 7) / 7
    avg_30 = rolling_sum(series, today, 30) / 30
    avg_90 = rolling_sum(series, today, 90) / 90
    production_daily = float(row["production_required_quantity"] or 0) / 30
    return max((avg_7 * 0.35) + (avg_30 * 0.3) + (avg_90 * 0.2) + (production_daily * 0.15), 0)


def score_items(item_rows, history_by_item, model):
    today = dt.date.today()
    scored = []
    for row in item_rows:
        item_id = int(row["item_id"])
        series = history_by_item.get(item_id, {})
        if model is not None:
            predicted_30 = max(float(model.predict([features_for_item(row, series, today)])[0]), 0)
            forecast_daily = predicted_30 / 30
            model_used = "RandomForestRegressor"
        else:
            forecast_daily = weighted_baseline(series, row)
            predicted_30 = forecast_daily * 30
            model_used = "WeightedMovingAverage"
        scored.append(make_forecast_row(row, forecast_daily, model_used))
    return sorted(scored, key=lambda item: item["risk_score"], reverse=True)


def make_forecast_row(row, forecast_daily, model_used):
    today = dt.date.today()
    available = float(row["available_quantity"] or 0)
    safety_stock = float(row["safety_stock"] or 0)
    open_po = float(row["open_po_quantity"] or 0)
    lead_time_days = int(float(row["lead_time_days"] or 7))
    stockout_days = available / forecast_daily if forecast_daily > 0 else None
    stockout_date = today + dt.timedelta(days=max(math.floor(stockout_days), 0)) if stockout_days is not None else None
    order_trigger_date = stockout_date - dt.timedelta(days=lead_time_days) if stockout_date else None
    reorder_quantity = max((forecast_daily * 30) + safety_stock - available - open_po, 0)
    risk_score = critical_item_risk_score(row["criticality"], available, forecast_daily, stockout_days, lead_time_days, reorder_quantity)
    return {
        "item_code": row["item_code"],
        "item_name": row["item_name"],
        "criticality": row["criticality"],
        "uom": row["uom"],
        "forecast_7d_consumption": round(forecast_daily * 7, 3),
        "forecast_15d_consumption": round(forecast_daily * 15, 3),
        "forecast_30d_consumption": round(forecast_daily * 30, 3),
        "forecast_60d_consumption": round(forecast_daily * 60, 3),
        "forecast_stockout_date": stockout_date.isoformat() if stockout_date else "",
        "forecast_reorder_quantity": round(reorder_quantity, 3),
        "forecast_order_trigger_date": order_trigger_date.isoformat() if order_trigger_date else "",
        "risk_score": risk_score,
        "model_used": model_used,
    }


def critical_item_risk_score(criticality, available, forecast_daily, stockout_days, lead_time_days, reorder_quantity):
    score = {"high": 35, "highly critical": 35, "critical": 35, "urgent": 35, "medium": 20, "semi critical": 20}.get(
        str(criticality or "").strip().lower(),
        8,
    )
    score += 25 if available <= 0 else max(0, 25 - min(available / max(forecast_daily, 1), 25))
    score += 0 if stockout_days is None else max(0, 25 - min(stockout_days, 25))
    score += min(max(lead_time_days, 0), 20) * 0.5
    score += 5 if reorder_quantity > 0 else 0
    return min(round(score), 100)


def criticality_number(value):
    text = str(value or "").strip().lower()
    if text in {"high", "highly critical", "critical", "urgent"}:
        return 3
    if text in {"medium", "semi critical", "semi-critical", "moderate"}:
        return 2
    return 1


def write_csv(rows, output_path: Path):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        output_path.write_text("", encoding="utf-8")
        return
    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description="Train and score EV Motor ERP inventory forecasts.")
    parser.add_argument("--output", default=str(ROOT / "inventory_forecast_output.csv"))
    parser.add_argument("--limit", type=int, default=50)
    args = parser.parse_args()

    connection = connect()
    try:
      item_rows = fetch_rows(connection, FORECAST_QUERY)
      history_rows = fetch_rows(connection, HISTORY_QUERY)
    finally:
      connection.close()

    history_by_item = build_history(history_rows)
    examples, targets = build_training_examples(history_by_item, item_rows)
    model, mae = train_model(examples, targets)
    scored = score_items(item_rows, history_by_item, model)[: args.limit]
    write_csv(scored, Path(args.output))

    print(f"Rows scored: {len(scored)}")
    print(f"Training examples: {len(examples)}")
    print(f"Model used: {'RandomForestRegressor' if model else 'WeightedMovingAverage'}")
    if mae is not None:
        print(f"Validation MAE: {mae:.3f}")
    print(f"Output: {args.output}")


if __name__ == "__main__":
    main()
