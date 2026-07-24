"""
Populate the EV motor ERP with large, linked transaction datasets.

The script reads existing masters from MySQL, generates transaction data in
business-flow order, exports CSV backups, validates the rows, then inserts them
inside one transaction. If validation or insertion fails, the database is rolled
back and an error log is written.
"""

from __future__ import annotations

import os
import sys
import traceback
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

LOCAL_PACKAGES = Path(__file__).resolve().parent / ".python-packages"
if LOCAL_PACKAGES.exists():
    sys.path.insert(0, str(LOCAL_PACKAGES))

import numpy as np
import pandas as pd
import pymysql
from faker import Faker
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL


ROOT = Path(__file__).resolve().parent
BACKUP_DIR = ROOT / "generated_transaction_backups"
ERROR_LOG = ROOT / "populate_erp_transactions_error.log"

TARGETS = {
    "purchase_requisition": 3000,
    "purchase_requisition_items": 6000,
    "purchase_order": 2500,
    "purchase_order_items": 5000,
    "goods_receipt": 2200,
    "goods_receipt_items": 4500,
    "customer_order": 3000,
    "customer_order_items": 6000,
    "production_order": 2500,
    "production_order_items": 2500,
    "bom_consumption": 5000,
    "finished_goods_receipt": 2200,
    "move_order": 3000,
    "move_order_items": 6000,
    "dispatch": 2500,
    "dispatch_items": 5000,
}

TABLE_ORDER = [
    "purchase_requisition",
    "purchase_requisition_items",
    "purchase_order",
    "purchase_order_items",
    "goods_receipt",
    "goods_receipt_items",
    "customer_order",
    "customer_order_items",
    "production_order",
    "production_order_items",
    "bom_consumption",
    "finished_goods_receipt",
    "move_order",
    "move_order_items",
    "dispatch",
    "dispatch_items",
]


def money(value: float | Decimal) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def qty(value: float | Decimal) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)


def dt(value: date | datetime | str) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()


def dstr(value: date | datetime | str | None) -> str | None:
    if value is None or pd.isna(value):
        return None
    return dt(value).isoformat()


def doc(prefix: str, doc_date: date, seq: int) -> str:
    return f"{prefix}-{doc_date.year}-{seq:04d}"


def read_env() -> dict[str, str | int]:
    env = {}
    env_file = ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                key, value = line.split("=", 1)
                env[key.strip()] = value.strip()
    return {
        "host": os.getenv("DB_HOST", env.get("DB_HOST", "localhost")),
        "user": os.getenv("DB_USER", env.get("DB_USER", "root")),
        "password": os.getenv("DB_PASSWORD", env.get("DB_PASSWORD", "your_password_here")),
        "database": os.getenv("DB_NAME", env.get("DB_NAME", "ev_motor_erp")),
        "port": int(os.getenv("DB_PORT", env.get("DB_PORT", 3306))),
    }


def engine_url(cfg: dict[str, str | int]) -> str:
    return URL.create(
        "mysql+pymysql",
        username=str(cfg["user"]),
        password=str(cfg["password"]),
        host=str(cfg["host"]),
        port=int(cfg["port"]),
        database=str(cfg["database"]),
        query={"charset": "utf8mb4"},
    )


def table_df(engine, table: str) -> pd.DataFrame:
    return pd.read_sql(text(f"SELECT * FROM `{table}`"), engine)


def max_id(df: pd.DataFrame, column: str) -> int:
    if df.empty:
        return 0
    return int(pd.to_numeric(df[column], errors="coerce").fillna(0).max())


def need(current_count: int, target: int) -> int:
    return max(0, target - int(current_count))


def insert_rows(cursor, table: str, rows: list[dict]) -> None:
    if not rows:
        return
    columns = list(rows[0].keys())
    sql = (
        f"INSERT INTO `{table}` ({', '.join(f'`{c}`' for c in columns)}) "
        f"VALUES ({', '.join(['%s'] * len(columns))})"
    )
    values = [tuple(row.get(col) for col in columns) for row in rows]
    cursor.executemany(sql, values)


def export_csv(generated: dict[str, list[dict]]) -> None:
    BACKUP_DIR.mkdir(exist_ok=True)
    for table, rows in generated.items():
        if not rows:
            continue
        pd.DataFrame(rows).to_csv(BACKUP_DIR / f"{table}.csv", index=False, encoding="utf-8")


def fiscal_dates(rng: np.random.Generator, n: int) -> list[date]:
    start = date(2024, 4, 1)
    end = date(2026, 7, 1)
    span = (end - start).days
    return [start + timedelta(days=int(rng.integers(0, span + 1))) for _ in range(n)]


def choose_qty(item: pd.Series, rng: np.random.Generator) -> Decimal:
    category = str(item["category"])
    uom = str(item["uom"])
    name = str(item["item_name"]).lower()
    if category == "Finished Goods":
        return qty(int(rng.integers(5, 61)))
    if "copper wire" in name:
        return qty(int(rng.integers(10, 201)))
    if category == "Core Components":
        return qty(int(rng.integers(50, 501)))
    if category == "Bearings":
        return qty(int(rng.integers(5, 101)))
    if category == "Fasteners":
        return qty(int(rng.integers(20, 501)))
    if uom == "m":
        return qty(int(rng.integers(20, 501)))
    if uom == "ml":
        return qty(int(rng.integers(5000, 100001)))
    if uom == "g":
        return qty(int(rng.integers(1000, 30001)))
    if uom == "Set":
        return qty(int(rng.integers(5, 81)))
    return qty(int(rng.integers(5, 251)))


def main() -> None:
    fake = Faker("en_IN")
    Faker.seed(42)
    rng = np.random.default_rng(42)
    cfg = read_env()
    engine = create_engine(engine_url(cfg))

    masters = {
        "items": table_df(engine, "item_master"),
        "vendors": table_df(engine, "vendor_master"),
        "customers": table_df(engine, "customer_master"),
        "employees": table_df(engine, "employee_master"),
        "departments": table_df(engine, "department_master"),
        "bom": table_df(engine, "bom_master"),
        "inventory": table_df(engine, "inventory_balance"),
    }
    current = {table: table_df(engine, table) for table in TABLE_ORDER}

    active_items = masters["items"][masters["items"]["status"].fillna("Active").eq("Active")].copy()
    purchase_items = active_items[active_items["category"].ne("Finished Goods")].reset_index(drop=True)
    finished_items = active_items[active_items["category"].eq("Finished Goods")].reset_index(drop=True)
    if purchase_items.empty or finished_items.empty:
        raise RuntimeError("Item master must contain active purchase items and finished goods.")

    employees = masters["employees"].copy().reset_index(drop=True)
    departments = masters["departments"].copy().reset_index(drop=True)
    vendors = masters["vendors"].copy().reset_index(drop=True)
    customers = masters["customers"].copy().reset_index(drop=True)
    bom = masters["bom"][masters["bom"]["status"].astype(str).eq("Active")].copy()
    bom_by_finished = {int(k): v.reset_index(drop=True) for k, v in bom.groupby("parent_item_id")}

    ids = {
        "pr": max_id(current["purchase_requisition"], "pr_id"),
        "pr_item": max_id(current["purchase_requisition_items"], "pr_item_id"),
        "po": max_id(current["purchase_order"], "po_id"),
        "po_item": max_id(current["purchase_order_items"], "po_item_id"),
        "grn": max_id(current["goods_receipt"], "grn_id"),
        "grn_item": max_id(current["goods_receipt_items"], "grn_item_id"),
        "co": max_id(current["customer_order"], "co_id"),
        "co_item": max_id(current["customer_order_items"], "co_item_id"),
        "prod": max_id(current["production_order"], "production_order_id"),
        "prod_item": max_id(current["production_order_items"], "production_order_item_id"),
        "bom_cons": max_id(current["bom_consumption"], "bom_consumption_id"),
        "fgr": max_id(current["finished_goods_receipt"], "fg_receipt_id"),
        "mo": max_id(current["move_order"], "mo_id"),
        "mo_item": max_id(current["move_order_items"], "mo_item_id"),
        "dispatch": max_id(current["dispatch"], "dispatch_id"),
        "dispatch_item": max_id(current["dispatch_items"], "dispatch_item_id"),
        "balance": max_id(masters["inventory"], "balance_id"),
    }
    initial_ids = ids.copy()

    generated = {table: [] for table in TABLE_ORDER}
    generated["production_order_items"] = []
    generated_balances: list[dict] = []

    pr_add = need(len(current["purchase_requisition"]), TARGETS["purchase_requisition"])
    pri_add = need(len(current["purchase_requisition_items"]), TARGETS["purchase_requisition_items"])
    po_add = need(len(current["purchase_order"]), TARGETS["purchase_order"])
    poi_add = need(len(current["purchase_order_items"]), TARGETS["purchase_order_items"])
    grn_add = need(len(current["goods_receipt"]), TARGETS["goods_receipt"])
    gri_add = need(len(current["goods_receipt_items"]), TARGETS["goods_receipt_items"])
    co_add = need(len(current["customer_order"]), TARGETS["customer_order"])
    coi_add = need(len(current["customer_order_items"]), TARGETS["customer_order_items"])
    prod_add = need(len(current["production_order"]), TARGETS["production_order"])
    prod_item_add = need(len(current["production_order_items"]), TARGETS["production_order_items"])
    bom_add = need(len(current["bom_consumption"]), TARGETS["bom_consumption"])
    fgr_add = need(len(current["finished_goods_receipt"]), TARGETS["finished_goods_receipt"])
    mo_add = need(len(current["move_order"]), TARGETS["move_order"])
    moi_add = need(len(current["move_order_items"]), TARGETS["move_order_items"])
    disp_add = need(len(current["dispatch"]), TARGETS["dispatch"])
    dispi_add = need(len(current["dispatch_items"]), TARGETS["dispatch_items"])

    # PR -> PR Items
    pr_dates = sorted(fiscal_dates(rng, pr_add))
    for i in range(pr_add):
        ids["pr"] += 1
        emp = employees.iloc[i % len(employees)]
        dept_id = int(emp["department_id"])
        pr_date = pr_dates[i]
        approved = i % 10 != 0
        generated["purchase_requisition"].append({
            "pr_id": ids["pr"],
            "pr_number": doc("PR", pr_date, ids["pr"]),
            "requested_by": int(emp["employee_id"]),
            "department_id": dept_id,
            "pr_date": dstr(pr_date),
            "required_date": dstr(pr_date + timedelta(days=int(rng.integers(3, 21)))),
            "remarks": "Generated material requisition for EV motor manufacturing.",
            "status": "Approved" if approved else "Converted to PO",
            "approved_by": int(employees.iloc[(i + 3) % len(employees)]["employee_id"]),
            "approved_date": dstr(pr_date + timedelta(days=1)),
        })

    pr_pool = generated["purchase_requisition"]
    for i in range(pri_add):
        ids["pr_item"] += 1
        pr = pr_pool[i % len(pr_pool)]
        item = purchase_items.iloc[i % len(purchase_items)]
        q = choose_qty(item, rng)
        cost = money(item["unit_cost"] or 1)
        reorder_level = qty(item["reorder_level"] or 0)
        current_stock = Decimal("0.000")
        generated["purchase_requisition_items"].append({
            "pr_item_id": ids["pr_item"],
            "pr_id": pr["pr_id"],
            "item_id": int(item["item_id"]),
            "requested_quantity": q,
            "uom": item["uom"],
            "required_date": pr["required_date"],
            "estimated_unit_cost": cost,
            "priority": "Urgent" if i % 4 == 0 else "High",
            "reason_for_requirement": f"Required for {item['category']} consumption plan.",
            "current_stock_quantity": current_stock,
            "reorder_level": reorder_level,
            "budget_code": f"BG-{dt(pr['pr_date']).year}-{(i % 12) + 1:02d}",
            "remarks": "Generated PR item.",
            "status": "Converted to PO",
        })

    # PO -> PO Items -> GRN -> GRN Items
    pr_items_by_pr = defaultdict(list)
    for row in generated["purchase_requisition_items"]:
        pr_items_by_pr[row["pr_id"]].append(row)
    po_source_prs = [pr for pr in pr_pool if pr["pr_id"] in pr_items_by_pr][:po_add]
    if len(po_source_prs) < po_add:
        po_source_prs = (po_source_prs * ((po_add // max(1, len(po_source_prs))) + 1))[:po_add]

    po_item_candidates = []
    for i, pr in enumerate(po_source_prs):
        ids["po"] += 1
        vendor = vendors.iloc[i % len(vendors)]
        po_date = dt(pr["pr_date"]) + timedelta(days=int(rng.integers(1, 8)))
        exp_date = po_date + timedelta(days=int(rng.integers(5, 24)))
        pr_lines = pr_items_by_pr[pr["pr_id"]]
        remaining_items = max(1, poi_add - len(generated["purchase_order_items"]) - len(po_item_candidates))
        remaining_pos = max(1, po_add - i)
        lines_this_po = min(len(pr_lines), max(1, int(np.ceil(remaining_items / remaining_pos))))
        selected = [pr_lines[(i + j) % len(pr_lines)] for j in range(lines_this_po)]
        subtotal = Decimal("0.00")
        line_cache = []
        for pr_item in selected:
            ids["po_item"] += 1
            item = active_items.loc[active_items["item_id"].eq(pr_item["item_id"])].iloc[0]
            ordered = pr_item["requested_quantity"]
            unit_price = money(Decimal(str(item["unit_cost"] or 1)) * Decimal(str(1 + ((i % 5) * 0.015))))
            line_sub = money(ordered * unit_price)
            tax = money(line_sub * Decimal("0.18"))
            line_total = money(line_sub + tax)
            subtotal += line_sub
            line_cache.append({
                "po_item_id": ids["po_item"],
                "po_id": ids["po"],
                "pr_item_id": pr_item["pr_item_id"],
                "item_id": int(pr_item["item_id"]),
                "ordered_quantity": ordered,
                "uom": pr_item["uom"],
                "unit_price": unit_price,
                "line_subtotal": line_sub,
                "tax_rate": Decimal("18.00"),
                "tax_amount": tax,
                "discount_amount": Decimal("0.00"),
                "line_total": line_total,
                "expected_delivery_date": dstr(exp_date),
                "received_quantity": Decimal("0.000"),
                "pending_quantity": ordered,
                "line_status": "Ordered",
                "remarks": "Generated PO item from PR item.",
            })
        tax_amount = money(subtotal * Decimal("0.18"))
        freight = money(500 + (i % 20) * 75)
        generated["purchase_order"].append({
            "po_id": ids["po"],
            "po_number": doc("PO", po_date, ids["po"]),
            "pr_id": pr["pr_id"],
            "vendor_id": int(vendor["vendor_id"]),
            "department_id": pr["department_id"],
            "po_date": dstr(po_date),
            "expected_delivery_date": dstr(exp_date),
            "payment_terms": ["30 Days", "45 Days", "60 Days"][i % 3],
            "delivery_terms": "Door delivery to factory stores",
            "billing_address": "EV Motor Plant, Accounts Payable, Hosur",
            "shipping_address": "EV Motor Plant Central Stores, Hosur",
            "subtotal_amount": subtotal,
            "tax_amount": tax_amount,
            "freight_charges": freight,
            "discount_amount": Decimal("0.00"),
            "currency": "INR",
            "po_status": "Issued",
            "approval_status": "Approved",
            "approved_by": int(employees.iloc[(i + 4) % len(employees)]["employee_id"]),
            "approved_date": dstr(po_date),
            "remarks": "Generated purchase order from approved PR.",
        })
        generated["purchase_order_items"].extend(line_cache)
        po_item_candidates.extend(line_cache)
        if len(generated["purchase_order_items"]) >= poi_add:
            break
    generated["purchase_order_items"] = generated["purchase_order_items"][:poi_add]

    po_by_id = {row["po_id"]: row for row in generated["purchase_order"]}
    po_items_for_grn = generated["purchase_order_items"][:gri_add]
    grn_groups = defaultdict(list)
    for line in po_items_for_grn:
        grn_groups[line["po_id"]].append(line)
    for i, (po_id, lines) in enumerate(list(grn_groups.items())[:grn_add]):
        ids["grn"] += 1
        po = po_by_id[po_id]
        rec_date = dt(po["po_date"]) + timedelta(days=int(rng.integers(5, 21)))
        generated["goods_receipt"].append({
            "grn_id": ids["grn"],
            "grn_number": doc("GRN", rec_date, ids["grn"]),
            "po_id": po_id,
            "vendor_id": po["vendor_id"],
            "received_date": dstr(rec_date),
            "invoice_number": f"INV-{ids['grn']:06d}",
            "invoice_date": dstr(rec_date - timedelta(days=1)),
            "delivery_challan_number": f"DC-{ids['grn']:06d}",
            "received_by": int(employees.iloc[i % len(employees)]["employee_id"]),
            "warehouse_location": ["Central Stores", "Raw Material Warehouse", "Electrical Store"][i % 3],
            "inspection_required": "Yes",
            "grn_status": "Accepted",
            "remarks": "Generated goods receipt.",
        })
        for line in lines:
            ids["grn_item"] += 1
            received = line["ordered_quantity"]
            generated["goods_receipt_items"].append({
                "grn_item_id": ids["grn_item"],
                "grn_id": ids["grn"],
                "po_item_id": line["po_item_id"],
                "item_id": line["item_id"],
                "ordered_quantity": line["ordered_quantity"],
                "received_quantity": received,
                "accepted_quantity": received,
                "rejected_quantity": Decimal("0.000"),
                "uom": line["uom"],
                "unit_price": line["unit_price"],
                "batch_number": f"RM-{ids['grn_item']:07d}",
                "manufacturing_date": dstr(rec_date - timedelta(days=int(rng.integers(20, 120)))),
                "expiry_date": dstr(rec_date + timedelta(days=365)),
                "quality_status": "Accepted",
                "rejection_reason": None,
                "storage_location": "Central Stores",
                "remarks": "Generated accepted GRN item.",
            })
            if len(generated["goods_receipt_items"]) >= gri_add:
                break
        if len(generated["goods_receipt_items"]) >= gri_add:
            break

    # Customer Order -> Items
    co_dates = sorted(fiscal_dates(rng, co_add))
    for i in range(co_add):
        ids["co"] += 1
        cust = customers.iloc[i % len(customers)]
        co_date = co_dates[i]
        generated["customer_order"].append({
            "co_id": ids["co"],
            "co_number": doc("CO", co_date, ids["co"]),
            "customer_id": int(cust["customer_id"]),
            "order_date": dstr(co_date),
            "required_delivery_date": dstr(co_date + timedelta(days=int(rng.integers(10, 36)))),
            "status": "Confirmed",
            "remarks": "Generated customer order for finished motor supply.",
        })
    for i in range(coi_add):
        ids["co_item"] += 1
        co = generated["customer_order"][i % len(generated["customer_order"])]
        item = finished_items.iloc[i % len(finished_items)]
        ordered = int(rng.integers(5, 61))
        generated["customer_order_items"].append({
            "co_item_id": ids["co_item"],
            "co_id": co["co_id"],
            "item_id": int(item["item_id"]),
            "ordered_quantity": ordered,
            "dispatched_quantity": 0,
            "pending_quantity": ordered,
            "remarks": "Generated customer order item.",
        })

    # Production Order -> Production Order Item -> BOM Consumption -> FGR
    co_items = generated["customer_order_items"]
    for i in range(prod_add):
        ids["prod"] += 1
        coi = co_items[i % len(co_items)]
        item = finished_items.loc[finished_items["item_id"].eq(coi["item_id"])].iloc[0]
        co = generated["customer_order"][(coi["co_id"] - generated["customer_order"][0]["co_id"]) % len(generated["customer_order"])]
        start = dt(co["order_date"]) + timedelta(days=int(rng.integers(2, 10)))
        end = start + timedelta(days=int(rng.integers(3, 12)))
        produced = qty(max(1, int(coi["ordered_quantity"]) - int(rng.integers(0, 3))))
        rejected = qty(int(rng.integers(0, 2)))
        planned = qty(produced + rejected + int(rng.integers(1, 5)))
        generated["production_order"].append({
            "production_order_id": ids["prod"],
            "production_order_number": doc("PROD", start, ids["prod"]),
            "customer_order_id": coi["co_id"],
            "finished_item_id": int(item["item_id"]),
            "department_id": 5,
            "planned_quantity": planned,
            "produced_quantity": produced,
            "rejected_quantity": rejected,
            "uom": item["uom"],
            "planned_start_date": dstr(start),
            "planned_end_date": dstr(end),
            "actual_start_date": dstr(start),
            "actual_end_date": dstr(end),
            "priority": ["Low", "Medium", "High", "Urgent"][i % 4],
            "production_status": "Completed",
            "created_by": int(employees.iloc[i % len(employees)]["employee_id"]),
            "approved_by": int(employees.iloc[(i + 2) % len(employees)]["employee_id"]),
            "remarks": "Generated production order.",
        })
        if len(generated["production_order_items"]) < prod_item_add:
            ids["prod_item"] += 1
            generated["production_order_items"].append({
                "production_order_item_id": ids["prod_item"],
                "production_order_id": ids["prod"],
                "item_id": int(item["item_id"]),
                "planned_quantity": planned,
                "produced_quantity": produced + rejected,
                "accepted_quantity": produced,
                "rejected_quantity": rejected,
                "uom": item["uom"],
                "production_stage": "Final Motor Assembly",
                "line_status": "Completed",
                "remarks": "Generated production output line.",
            })

    for i, poi in enumerate(generated["production_order_items"]):
        if len(generated["bom_consumption"]) >= bom_add:
            break
        finished_id = int(poi["item_id"])
        lines = bom_by_finished.get(finished_id)
        if lines is None or lines.empty:
            continue
        prod = generated["production_order"][(poi["production_order_id"] - generated["production_order"][0]["production_order_id"]) % len(generated["production_order"])]
        for j in range(2):
            if len(generated["bom_consumption"]) >= bom_add:
                break
            bom_line = lines.iloc[(i + j) % len(lines)]
            ids["bom_cons"] += 1
            planned = qty(Decimal(str(bom_line["quantity_per_unit"])) * Decimal(str(poi["produced_quantity"])))
            waste = qty(planned * Decimal("0.02"))
            actual = qty(planned)
            issued = qty(actual + waste)
            generated["bom_consumption"].append({
                "bom_consumption_id": ids["bom_cons"],
                "production_order_item_id": poi["production_order_item_id"],
                "finished_item_id": finished_id,
                "consumed_item_id": int(bom_line["component_item_id"]),
                "planned_quantity": planned,
                "issued_quantity": issued,
                "actual_consumed_quantity": actual,
                "returned_quantity": Decimal("0.000"),
                "wastage_quantity": waste,
                "uom": bom_line["uom"],
                "warehouse_location": "Production Issue Store",
                "batch_number": f"BC-{ids['bom_cons']:07d}",
                "consumption_date": prod["actual_start_date"],
                "consumed_by": int(employees.iloc[(i + j) % len(employees)]["employee_id"]),
                "transaction_status": "Consumed",
                "remarks": "Generated BOM consumption from active BOM.",
            })

    for i, poi in enumerate(generated["production_order_items"][:fgr_add]):
        ids["fgr"] += 1
        prod = generated["production_order"][(poi["production_order_id"] - generated["production_order"][0]["production_order_id"]) % len(generated["production_order"])]
        receipt_date = dt(prod["actual_end_date"]) + timedelta(days=1)
        received = qty(poi["accepted_quantity"])
        generated["finished_goods_receipt"].append({
            "fg_receipt_id": ids["fgr"],
            "fg_receipt_number": doc("FGR", receipt_date, ids["fgr"]),
            "production_order_item_id": poi["production_order_item_id"],
            "production_order_id": poi["production_order_id"],
            "finished_item_id": poi["item_id"],
            "received_quantity": received,
            "accepted_quantity": received,
            "rejected_quantity": Decimal("0.000"),
            "uom": poi["uom"],
            "receipt_date": dstr(receipt_date),
            "received_by": int(employees.iloc[i % len(employees)]["employee_id"]),
            "inspection_status": "Accepted",
            "warehouse_location": "Finished Goods Warehouse",
            "batch_number": f"FG-{ids['fgr']:07d}",
            "serial_number_start": f"SN{ids['fgr']:07d}A",
            "serial_number_end": f"SN{ids['fgr']:07d}Z",
            "remarks": "Generated finished goods receipt.",
        })

    # Move Orders -> Move Order Items
    move_types = [
        ("Stores to Production", 3, 5, "Central Warehouse", "Production Line"),
        ("Production to Quality", 5, 5, "Production Line", "Quality Inspection"),
        ("Production to Finished Goods", 5, 6, "Assembly", "FG Store"),
        ("Finished Goods to Dispatch", 6, 6, "FG Store", "Dispatch Dock"),
        ("Stores to Maintenance", 3, 5, "Maintenance Store", "Maintenance Bay"),
        ("Return to Stores", 5, 3, "Assembly Surplus", "Central Warehouse"),
    ]
    for i in range(mo_add):
        ids["mo"] += 1
        typ, from_dept, to_dept, src, dst = move_types[i % len(move_types)]
        mo_date = date(2024, 4, 1) + timedelta(days=i % 820)
        emp = employees.iloc[i % len(employees)]
        approved = i % 5 != 0
        generated["move_order"].append({
            "mo_id": ids["mo"],
            "mo_number": doc("MO", mo_date, ids["mo"]),
            "mo_date": dstr(mo_date),
            "requested_by": int(emp["employee_id"]),
            "requested_by_department": int(emp["department_id"]),
            "from_department_id": from_dept,
            "to_department_id": to_dept,
            "move_order_type": typ,
            "priority": ["Low", "Medium", "High", "Urgent"][i % 4],
            "source_location": src,
            "destination_location": dst,
            "reason": f"{typ} for motor manufacturing operations.",
            "required_date": dstr(mo_date + timedelta(days=1 + (i % 5))),
            "approved_by": int(employees.iloc[(i + 3) % len(employees)]["employee_id"]) if approved else None,
            "approved_date": dstr(mo_date) if approved else None,
            "issued_by": int(employees.iloc[(i + 4) % len(employees)]["employee_id"]) if approved else None,
            "issued_date": dstr(mo_date) if approved else None,
            "received_by": int(employees.iloc[(i + 5) % len(employees)]["employee_id"]) if approved else None,
            "received_date": dstr(mo_date + timedelta(days=1)) if approved else None,
            "status": "Received" if approved else "Pending Approval",
            "remarks": "Generated internal movement.",
        })
    move_item_pools = {
        "Finished Goods to Dispatch": finished_items,
        "Production to Finished Goods": finished_items,
        "Stores to Maintenance": purchase_items[purchase_items["category"].isin(["Bearings", "Fasteners", "Consumables", "Electronic Components"])],
        "Return to Stores": purchase_items,
        "Production to Quality": purchase_items[purchase_items["category"].isin(["Core Components", "Mechanical Components", "Electronic Components"])],
        "Stores to Production": purchase_items,
    }
    mo_item_used = defaultdict(set)
    mo_item_cursor = defaultdict(int)
    for i in range(moi_add):
        ids["mo_item"] += 1
        mo = generated["move_order"][i % len(generated["move_order"])]
        pool = move_item_pools[mo["move_order_type"]]
        cursor_index = mo_item_cursor[mo["mo_id"]]
        item = None
        for offset in range(len(pool)):
            candidate = pool.iloc[(cursor_index + offset) % len(pool)]
            if int(candidate["item_id"]) not in mo_item_used[mo["mo_id"]]:
                item = candidate
                mo_item_cursor[mo["mo_id"]] = cursor_index + offset + 1
                mo_item_used[mo["mo_id"]].add(int(candidate["item_id"]))
                break
        if item is None:
            continue
        q = choose_qty(item, rng)
        unit_cost = money(item["unit_cost"] or 1)
        generated["move_order_items"].append({
            "mo_item_id": ids["mo_item"],
            "mo_id": mo["mo_id"],
            "item_id": int(item["item_id"]),
            "requested_quantity": q,
            "issued_quantity": q,
            "uom": item["uom"],
            "unit_cost": unit_cost,
            "line_amount": money(q * unit_cost),
            "source_location": mo["source_location"],
            "destination_location": mo["destination_location"],
            "required_date": mo["required_date"],
            "movement_date": mo["mo_date"],
            "remarks": f"Generated move order item for {item['item_name']}.",
        })

    # Dispatch -> Dispatch Items
    latest_fgr_by_co = defaultdict(lambda: date(2024, 4, 1))
    prod_by_id = {row["production_order_id"]: row for row in generated["production_order"]}
    for row in generated["finished_goods_receipt"]:
        prod = prod_by_id.get(row["production_order_id"])
        if prod and prod["customer_order_id"]:
            latest_fgr_by_co[prod["customer_order_id"]] = max(
                latest_fgr_by_co[prod["customer_order_id"]],
                dt(row["receipt_date"]),
            )
    dispatch_source_items = generated["customer_order_items"]
    shipped_by_co_item = defaultdict(int)
    for i in range(disp_add):
        ids["dispatch"] += 1
        coi = dispatch_source_items[i % len(dispatch_source_items)]
        co = generated["customer_order"][(coi["co_id"] - generated["customer_order"][0]["co_id"]) % len(generated["customer_order"])]
        cust = customers.loc[customers["customer_id"].eq(co["customer_id"])].iloc[0]
        disp_floor = max(dt(co["order_date"]) + timedelta(days=15), latest_fgr_by_co[co["co_id"]])
        disp_date = disp_floor + timedelta(days=1 + (i % 10))
        status = "Delivered" if i % 10 < 7 else ("In Transit" if i % 10 < 9 else "Partially Delivered")
        mode = ["Road", "Road", "Road", "Courier", "Customer Pickup", "Rail"][i % 6]
        generated["dispatch"].append({
            "dispatch_id": ids["dispatch"],
            "dispatch_number": doc("DISP", disp_date, ids["dispatch"]),
            "co_id": co["co_id"],
            "customer_id": co["customer_id"],
            "dispatch_date": dstr(disp_date),
            "source_location": "Finished Goods Warehouse",
            "transport_mode": mode,
            "vehicle_number": f"TN {10 + i % 80:02d} AB {1000 + i % 9000:04d}",
            "lr_number": f"LR-{ids['dispatch']:07d}",
            "driver_name": fake.name(),
            "transport_company": ["VRL Logistics", "TCI Freight", "Safexpress", "Gati KWE"][i % 4],
            "delivery_address": f"{cust['customer_name']}, {cust['city']}, {cust['state']}",
            "city": cust["city"],
            "state": cust["state"],
            "expected_delivery_date": dstr(disp_date + timedelta(days=2 + (i % 7))),
            "actual_delivery_date": dstr(disp_date + timedelta(days=3 + (i % 7))) if status == "Delivered" else None,
            "dispatched_by": int(employees.iloc[i % len(employees)]["employee_id"]),
            "status": status,
            "remarks": "Generated dispatch document.",
        })
    dispatch_attempts = 0
    i = 0
    while len(generated["dispatch_items"]) < dispi_add and dispatch_attempts < dispi_add * 12:
        dispatch_attempts += 1
        ids["dispatch_item"] += 1
        dispatch = generated["dispatch"][i % len(generated["dispatch"])]
        co_items_for_order = [x for x in dispatch_source_items if x["co_id"] == dispatch["co_id"]]
        coi = co_items_for_order[i % len(co_items_for_order)]
        remaining = int(coi["ordered_quantity"]) - shipped_by_co_item[coi["co_item_id"]]
        if remaining <= 0:
            i += 1
            continue
        item = finished_items.loc[finished_items["item_id"].eq(coi["item_id"])].iloc[0]
        qdispatch = min(remaining, int(rng.integers(1, 8)))
        shipped_by_co_item[coi["co_item_id"]] += qdispatch
        unit_price = money(Decimal(str(item["unit_cost"] or 1)) * Decimal("1.25"))
        generated["dispatch_items"].append({
            "dispatch_item_id": ids["dispatch_item"],
            "dispatch_id": dispatch["dispatch_id"],
            "co_item_id": coi["co_item_id"],
            "item_id": int(item["item_id"]),
            "item_description": item["item_name"],
            "uom": item["uom"],
            "ordered_quantity": int(coi["ordered_quantity"]),
            "dispatched_quantity": qdispatch,
            "unit_price": unit_price,
            "line_amount": money(Decimal(qdispatch) * unit_price),
            "batch_no": f"FG-DISP-{ids['dispatch_item']:07d}",
            "serial_no": f"SN-DISP-{ids['dispatch_item']:07d}",
            "remarks": "Generated dispatch item.",
        })
        i += 1
    for row in generated["customer_order_items"]:
        shipped = shipped_by_co_item[row["co_item_id"]]
        row["dispatched_quantity"] = shipped
        row["pending_quantity"] = int(row["ordered_quantity"]) - shipped

    export_csv(generated)

    validation_errors = []
    if len(generated["purchase_requisition"]) != pr_add:
        validation_errors.append("PR generation count mismatch")
    if any(Decimal(str(r["line_amount"])) != money(Decimal(str(r["issued_quantity"])) * Decimal(str(r["unit_cost"]))) for r in generated["move_order_items"]):
        validation_errors.append("Move order item amount mismatch")
    if any(Decimal(str(r["line_amount"])) != money(Decimal(str(r["dispatched_quantity"])) * Decimal(str(r["unit_price"]))) for r in generated["dispatch_items"]):
        validation_errors.append("Dispatch item amount mismatch")
    if any(r["pending_quantity"] < 0 for r in generated["customer_order_items"]):
        validation_errors.append("Negative customer order pending quantity")
    if validation_errors:
        raise RuntimeError("; ".join(validation_errors))

    connection = pymysql.connect(
        host=cfg["host"],
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        port=int(cfg["port"]),
        charset="utf8mb4",
        autocommit=False,
    )
    try:
        with connection.cursor() as cursor:
            for table in TABLE_ORDER:
                insert_rows(cursor, table, generated[table])
            # Update generated customer order item dispatch quantities after dispatch items are known.
            for row in generated["customer_order_items"]:
                cursor.execute(
                    "UPDATE customer_order_items SET dispatched_quantity=%s, pending_quantity=%s WHERE co_item_id=%s",
                    (row["dispatched_quantity"], row["pending_quantity"], row["co_item_id"]),
                )
            # Update PO line receipt status after GRN items are accepted.
            received_by_po_item = defaultdict(Decimal)
            for grn_line in generated["goods_receipt_items"]:
                received_by_po_item[grn_line["po_item_id"]] += Decimal(str(grn_line["received_quantity"]))
            for row in generated["purchase_order_items"]:
                received = received_by_po_item.get(row["po_item_id"], Decimal("0.000"))
                pending = max(Decimal("0.000"), Decimal(str(row["ordered_quantity"])) - received)
                status = "Fully Received" if pending == 0 else ("Partially Received" if received > 0 else "Ordered")
                cursor.execute(
                    "UPDATE purchase_order_items SET received_quantity=%s, pending_quantity=%s, line_status=%s WHERE po_item_id=%s",
                    (received, pending, status, row["po_item_id"]),
                )
            # Logical stock balance: create/update per item and department touched by generated data.
            stock_delta = defaultdict(Decimal)
            for r in generated["goods_receipt_items"]:
                stock_delta[(r["item_id"], 3)] += Decimal(str(r["accepted_quantity"]))
            for r in generated["bom_consumption"]:
                stock_delta[(r["consumed_item_id"], 3)] -= Decimal(str(r["issued_quantity"]))
            for r in generated["finished_goods_receipt"]:
                stock_delta[(r["finished_item_id"], 6)] += Decimal(str(r["accepted_quantity"]))
            for r in generated["move_order_items"]:
                mo = next(x for x in generated["move_order"] if x["mo_id"] == r["mo_id"])
                stock_delta[(r["item_id"], mo["from_department_id"])] -= Decimal(str(r["issued_quantity"]))
                stock_delta[(r["item_id"], mo["to_department_id"])] += Decimal(str(r["issued_quantity"]))
            for r in generated["dispatch_items"]:
                stock_delta[(r["item_id"], 6)] -= Decimal(str(r["dispatched_quantity"]))
            for (item_id, department_id), delta in stock_delta.items():
                cursor.execute(
                    "SELECT balance_id, current_stock FROM inventory_balance WHERE item_id=%s AND department_id=%s LIMIT 1 FOR UPDATE",
                    (item_id, department_id),
                )
                existing = cursor.fetchone()
                if existing:
                    next_stock = int(max(0, Decimal(str(existing[1] or 0)) + delta))
                    cursor.execute(
                        "UPDATE inventory_balance SET current_stock=%s, last_updated=CURDATE() WHERE balance_id=%s",
                        (next_stock, existing[0]),
                    )
                else:
                    ids["balance"] += 1
                    cursor.execute(
                        "INSERT INTO inventory_balance (balance_id, item_id, department_id, current_stock, last_updated, stock_inward_number) VALUES (%s,%s,%s,%s,CURDATE(),NULL)",
                        (ids["balance"], item_id, department_id, int(max(0, delta))),
                    )

            checks = validation_queries(cursor, initial_ids)
            errors = {name: value for name, value in checks.items() if name.startswith("error_") and value}
            if errors:
                raise RuntimeError(f"Validation failed before commit: {errors}")
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()

    with engine.connect() as con:
        summary = {table: con.execute(text(f"SELECT COUNT(*) FROM `{table}`")).scalar() for table in TABLE_ORDER}
    print("Import committed successfully.")
    print("CSV backups:", BACKUP_DIR)
    print("Final table counts:")
    for table, count in summary.items():
        print(f"  {table}: {count}")


def validation_queries(cursor, initial_ids: dict[str, int]) -> dict[str, int]:
    queries = {
        "error_orphan_pr_items": "SELECT COUNT(*) FROM purchase_requisition_items pri LEFT JOIN purchase_requisition pr ON pr.pr_id=pri.pr_id WHERE pr.pr_id IS NULL",
        "error_orphan_po_items": "SELECT COUNT(*) FROM purchase_order_items poi LEFT JOIN purchase_order po ON po.po_id=poi.po_id WHERE po.po_id IS NULL",
        "error_orphan_grn_items": "SELECT COUNT(*) FROM goods_receipt_items gri LEFT JOIN goods_receipt grn ON grn.grn_id=gri.grn_id WHERE grn.grn_id IS NULL",
        "error_item_ids_missing": "SELECT COUNT(*) FROM purchase_order_items poi LEFT JOIN item_master im ON im.item_id=poi.item_id WHERE im.item_id IS NULL",
        "error_customer_ids_missing": "SELECT COUNT(*) FROM customer_order co LEFT JOIN customer_master cm ON cm.customer_id=co.customer_id WHERE cm.customer_id IS NULL",
        "error_vendor_ids_missing": "SELECT COUNT(*) FROM purchase_order po LEFT JOIN vendor_master vm ON vm.vendor_id=po.vendor_id WHERE vm.vendor_id IS NULL",
        "error_dispatch_over_order": "SELECT COUNT(*) FROM (SELECT di.co_item_id, SUM(di.dispatched_quantity) dq, MAX(coi.ordered_quantity) oq FROM dispatch_items di JOIN customer_order_items coi ON coi.co_item_id=di.co_item_id GROUP BY di.co_item_id HAVING dq > oq) x",
        "error_po_over_pr": "SELECT COUNT(*) FROM purchase_order_items poi JOIN purchase_requisition_items pri ON pri.pr_item_id=poi.pr_item_id WHERE poi.ordered_quantity > pri.requested_quantity",
        "error_negative_stock": "SELECT COUNT(*) FROM inventory_balance WHERE current_stock < 0",
        "error_invalid_purchase_dates": f"SELECT COUNT(*) FROM purchase_order po JOIN purchase_requisition pr ON pr.pr_id=po.pr_id JOIN goods_receipt grn ON grn.po_id=po.po_id WHERE po.po_id > {int(initial_ids['po'])} AND NOT (pr.pr_date < po.po_date AND po.po_date < grn.received_date)",
        "error_invalid_sales_dates": f"SELECT COUNT(*) FROM customer_order co JOIN production_order po ON po.customer_order_id=co.co_id JOIN finished_goods_receipt fgr ON fgr.production_order_id=po.production_order_id JOIN dispatch d ON d.co_id=co.co_id WHERE co.co_id > {int(initial_ids['co'])} AND NOT (co.order_date < po.planned_start_date AND po.planned_start_date <= fgr.receipt_date AND fgr.receipt_date <= d.dispatch_date)",
        "error_po_amount_mismatch": "SELECT COUNT(*) FROM purchase_order_items WHERE ABS(line_total - ROUND(line_subtotal + tax_amount - discount_amount, 2)) > 0.05",
        "error_dispatch_amount_mismatch": "SELECT COUNT(*) FROM dispatch_items WHERE ABS(line_amount - ROUND(dispatched_quantity * unit_price, 2)) > 0.05",
    }
    out = {}
    for name, sql in queries.items():
        cursor.execute(sql)
        out[name] = int(cursor.fetchone()[0])
    return out


if __name__ == "__main__":
    try:
        main()
    except Exception:
        ERROR_LOG.write_text(traceback.format_exc(), encoding="utf-8")
        print(f"Population failed. See {ERROR_LOG}")
        raise
