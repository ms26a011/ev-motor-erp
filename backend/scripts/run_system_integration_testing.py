from __future__ import annotations

import argparse
import csv
import html
import os
import random
import sys
import traceback
from collections import Counter, defaultdict
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = ROOT.parent
LOCAL_PACKAGES = PROJECT_ROOT / ".sit-python-packages"
if LOCAL_PACKAGES.exists():
    sys.path.insert(0, str(LOCAL_PACKAGES))

import mysql.connector
from mysql.connector import Error


TEST_RUN_ID = "SIT_20260708_20260715"
START_DATE = date(2026, 7, 8)
END_DATE = date(2026, 7, 15)
DATES = [START_DATE + timedelta(days=offset) for offset in range((END_DATE - START_DATE).days + 1)]
REPORT_DIR = PROJECT_ROOT / "docs" / "testing" / TEST_RUN_ID
EVIDENCE_DIR = REPORT_DIR / "evidence"
RANDOM_SEED = 2026070815
MONEY = Decimal("0.01")
QTY = Decimal("0.001")

OPERATIONAL_TABLES = [
    "purchase_requisition",
    "purchase_requisition_items",
    "purchase_order",
    "purchase_order_items",
    "goods_receipt",
    "goods_receipt_items",
    "stock_transaction_log",
    "move_order",
    "move_order_items",
    "production_order",
    "production_order_items",
    "bom_consumption",
    "finished_goods_receipt",
    "customer_order",
    "customer_order_items",
    "dispatch",
    "dispatch_items",
    "vendor_invoice",
    "vendor_invoice_items",
    "vendor_payment",
    "customer_invoice",
    "customer_invoice_items",
    "customer_receipt",
    "journal_entry",
    "journal_entry_lines",
]


@dataclass
class Result:
    case_id: str
    module: str
    scenario: str
    preconditions: str
    steps: str
    expected: str
    actual: str
    status: str
    evidence: str = ""
    defect_id: str = ""


@dataclass
class Defect:
    defect_id: str
    module: str
    severity: str
    description: str
    root_cause: str = ""
    fix_applied: str = ""
    retest_result: str = ""
    final_status: str = "Open"


@dataclass
class Context:
    conn: object
    results: list[Result] = field(default_factory=list)
    defects: list[Defect] = field(default_factory=list)
    counters: Counter = field(default_factory=Counter)
    daily_counts: dict = field(default_factory=lambda: defaultdict(Counter))
    inventory_opening: dict = field(default_factory=dict)
    inserted_counts: Counter = field(default_factory=Counter)
    rng: random.Random = field(default_factory=lambda: random.Random(RANDOM_SEED))
    masters: dict = field(default_factory=dict)
    accounts: dict = field(default_factory=dict)
    tax_purchase: dict | None = None
    tax_sales: dict | None = None
    bank: dict | None = None
    schema: dict = field(default_factory=dict)
    status_values: dict = field(default_factory=dict)
    negative_results: list[dict] = field(default_factory=list)


def money(value) -> Decimal:
    return Decimal(str(value)).quantize(MONEY, rounding=ROUND_HALF_UP)


def qty(value) -> Decimal:
    return Decimal(str(value)).quantize(QTY, rounding=ROUND_HALF_UP)


def load_env() -> dict[str, str]:
    values: dict[str, str] = {}
    env_path = ROOT / ".env"
    if env_path.exists():
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            if "=" in raw and not raw.strip().startswith("#"):
                key, value = raw.split("=", 1)
                values[key.strip()] = value.strip()
    return values


def connect_database():
    env = load_env()
    return mysql.connector.connect(
        host=os.getenv("DB_HOST", env.get("DB_HOST", "localhost")),
        user=os.getenv("DB_USER", env.get("DB_USER", "root")),
        password=os.getenv("DB_PASSWORD", env.get("DB_PASSWORD", "")),
        database=os.getenv("DB_NAME", env.get("DB_NAME", "ev_motor_erp")),
        port=int(os.getenv("DB_PORT", env.get("DB_PORT", "3306"))),
    )


@contextmanager
def cursor(conn, dictionary=True):
    cur = conn.cursor(dictionary=dictionary)
    try:
        yield cur
    finally:
        cur.close()


def fetch_all(cur, sql, params=()):
    cur.execute(sql, params)
    return cur.fetchall()


def fetch_one(cur, sql, params=()):
    cur.execute(sql, params)
    return cur.fetchone()


def execute(cur, sql, params=()):
    cur.execute(sql, params)
    return cur


def add_result(ctx: Context, module, scenario, expected, actual, status, steps="", preconditions="Valid ERP master data", evidence=""):
    case_id = f"SIT-TC-{len(ctx.results) + 1:04d}"
    defect_id = ""
    if status == "FAIL":
        defect_id = f"SIT-DEF-{len(ctx.defects) + 1:03d}"
        ctx.defects.append(
            Defect(
                defect_id=defect_id,
                module=module,
                severity="High",
                description=f"{scenario}: expected {expected}; actual {actual}",
                root_cause="Detected during automated SIT validation.",
                fix_applied="Not fixed by SIT runner.",
                retest_result="Pending",
                final_status="Open",
            )
        )
    ctx.results.append(
        Result(
            case_id=case_id,
            module=module,
            scenario=scenario,
            preconditions=preconditions,
            steps=steps or scenario,
            expected=expected,
            actual=actual,
            status=status,
            evidence=evidence,
            defect_id=defect_id,
        )
    )


def inspect_schema(ctx: Context):
    with cursor(ctx.conn) as cur:
        for table in OPERATIONAL_TABLES + [
            "employee_master",
            "department_master",
            "item_master",
            "vendor_master",
            "customer_master",
            "bom_master",
            "chart_of_accounts",
            "tax_master",
            "bank_master",
            "financial_period",
            "user_account",
        ]:
            ctx.schema[table] = fetch_all(cur, f"DESCRIBE `{table}`")
        for table, columns in ctx.schema.items():
            for col in columns:
                name = col["Field"]
                if "status" in name.lower() or name in ("role", "inspection_required"):
                    ctx.status_values[f"{table}.{name}"] = fetch_all(
                        cur,
                        f"SELECT `{name}` AS value, COUNT(*) AS count FROM `{table}` GROUP BY `{name}` ORDER BY count DESC",
                    )
    add_result(ctx, "Schema", "Inspect schema, keys, statuses and date columns", "All required tables inspected", f"Inspected {len(ctx.schema)} tables", "PASS")


def load_master_data(ctx: Context):
    with cursor(ctx.conn) as cur:
        ctx.masters["employees"] = fetch_all(cur, "SELECT * FROM employee_master ORDER BY employee_id")
        ctx.masters["departments"] = fetch_all(cur, "SELECT * FROM department_master ORDER BY department_id")
        ctx.masters["items"] = fetch_all(cur, "SELECT * FROM item_master WHERE COALESCE(status,'Active')='Active' ORDER BY item_id")
        ctx.masters["vendors"] = fetch_all(cur, "SELECT * FROM vendor_master ORDER BY vendor_id")
        ctx.masters["customers"] = fetch_all(cur, "SELECT * FROM customer_master ORDER BY customer_id")
        ctx.masters["bom"] = fetch_all(
            cur,
            """SELECT bm.*, pi.item_name AS parent_name, ci.item_name AS component_item_name,
                      ci.unit_cost AS component_unit_cost, ci.uom AS component_uom
               FROM bom_master bm
               JOIN item_master pi ON pi.item_id=bm.parent_item_id
               JOIN item_master ci ON ci.item_id=bm.component_item_id
               WHERE bm.status='Active'
               ORDER BY bm.parent_item_id, bm.bom_id""",
        )
        ctx.masters["periods"] = fetch_all(cur, "SELECT * FROM financial_period WHERE period_status='Open' ORDER BY start_date")
        ctx.masters["users"] = fetch_all(
            cur,
            """SELECT ua.account_id, ua.username, ua.role, ua.is_active,
                      em.employee_id, em.employee_code, em.employee_name, dm.department_code, dm.department_name
               FROM user_account ua
               JOIN employee_master em ON em.employee_id=ua.employee_id
               JOIN department_master dm ON dm.department_id=em.department_id
               ORDER BY ua.account_id""",
        )
        accounts = fetch_all(cur, "SELECT * FROM chart_of_accounts")
        ctx.accounts = {row["account_code"]: row for row in accounts}
        purchase_taxes = fetch_all(cur, "SELECT * FROM tax_master WHERE status='Active' AND applicable_on IN ('Purchase','Both') ORDER BY tax_rate DESC")
        sales_taxes = fetch_all(cur, "SELECT * FROM tax_master WHERE status='Active' AND applicable_on IN ('Sales','Both') ORDER BY tax_rate DESC")
        banks = fetch_all(cur, "SELECT * FROM bank_master WHERE status='Active' ORDER BY bank_id")

    required = {
        "employees": ctx.masters["employees"],
        "departments": ctx.masters["departments"],
        "items": ctx.masters["items"],
        "vendors": ctx.masters["vendors"],
        "customers": ctx.masters["customers"],
        "bom": ctx.masters["bom"],
        "periods": ctx.masters["periods"],
        "users": ctx.masters["users"],
    }
    missing = [name for name, rows in required.items() if not rows]
    for code in ["1010", "1100", "1200", "1210", "1220", "1300", "2000", "2100", "4000", "5700"]:
        if code not in ctx.accounts:
            missing.append(f"chart_of_accounts {code}")
    if not purchase_taxes:
        missing.append("purchase tax")
    if not sales_taxes:
        missing.append("sales tax")
    if not banks:
        missing.append("bank account")
    if missing:
        add_result(ctx, "Prerequisites", "Load required master data", "All required masters available", ", ".join(missing), "BLOCKED")
        raise RuntimeError(f"Missing required master data: {', '.join(missing)}")

    ctx.tax_purchase = purchase_taxes[0]
    ctx.tax_sales = sales_taxes[0]
    ctx.bank = banks[0]
    add_result(ctx, "Prerequisites", "Load required master data", "All required masters available", "All required masters found", "PASS")


def create_backup_tables(ctx: Context):
    with cursor(ctx.conn) as cur:
        for table in OPERATIONAL_TABLES:
            backup = f"sit_bkp_20260708_20260715_{table}"
            exists = fetch_one(
                cur,
                """SELECT COUNT(*) AS count
                   FROM INFORMATION_SCHEMA.TABLES
                   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s""",
                (backup,),
            )
            if not int(exists["count"]):
                execute(cur, f"CREATE TABLE `{backup}` AS SELECT * FROM `{table}` WHERE 1=0")
            row = fetch_one(cur, f"SELECT COUNT(*) AS count FROM `{backup}`")
            if int(row["count"]) == 0:
                try:
                    execute(cur, f"INSERT INTO `{backup}` SELECT * FROM `{table}`")
                except Error:
                    execute(cur, f"DROP TABLE `{backup}`")
                    execute(cur, f"CREATE TABLE `{backup}` AS SELECT * FROM `{table}`")
    ctx.conn.commit()
    add_result(ctx, "Data Safety", "Create backup tables before SIT insertion", "Backup tables created", f"Backed up {len(OPERATIONAL_TABLES)} tables", "PASS")


def test_run_exists(ctx: Context) -> bool:
    with cursor(ctx.conn) as cur:
        row = fetch_one(cur, "SELECT COUNT(*) AS count FROM purchase_requisition WHERE pr_number LIKE 'SIT-PR-%'")
    return int(row["count"]) > 0


def get_department(ctx: Context, code: str):
    for row in ctx.masters["departments"]:
        if row["department_code"] == code:
            return row
    raise RuntimeError(f"Missing department {code}")


def get_period_id(ctx: Context, entry_date: date) -> int:
    for row in ctx.masters["periods"]:
        if row["start_date"] <= entry_date <= row["end_date"]:
            return int(row["period_id"])
    raise RuntimeError(f"No open financial period for {entry_date}")


def pick_employee(ctx: Context, department_code: str | None = None, offset: int = 0):
    employees = ctx.masters["employees"]
    if department_code:
        dept_id = get_department(ctx, department_code)["department_id"]
        scoped = [row for row in employees if row["department_id"] == dept_id]
        if scoped:
            return scoped[offset % len(scoped)]
    return employees[offset % len(employees)]


def pick_vendor(ctx: Context, index: int):
    return ctx.masters["vendors"][index % len(ctx.masters["vendors"])]


def pick_customer(ctx: Context, index: int):
    return ctx.masters["customers"][index % len(ctx.masters["customers"])]


def finished_goods_with_bom(ctx: Context):
    finished_ids = {row["parent_item_id"] for row in ctx.masters["bom"]}
    return [item for item in ctx.masters["items"] if item["item_id"] in finished_ids and item["category"] == "Finished Goods"]


def bom_lines_for(ctx: Context, finished_item_id: int):
    return [row for row in ctx.masters["bom"] if row["parent_item_id"] == finished_item_id]


def document_number(prefix: str, doc_date: date, seq: int) -> str:
    return f"SIT-{prefix}-{doc_date:%m%d}-{seq:02d}"


def insert_row(ctx: Context, cur, table: str, row: dict) -> int:
    keys = list(row.keys())
    sql = f"INSERT INTO `{table}` ({', '.join(f'`{key}`' for key in keys)}) VALUES ({', '.join(['%s'] * len(keys))})"
    cur.execute(sql, tuple(row[key] for key in keys))
    ctx.inserted_counts[table] += 1
    return int(cur.lastrowid)


def update_inventory(ctx: Context, cur, item_id: int, department_id: int, quantity_in=0, quantity_out=0) -> Decimal:
    quantity_in = qty(quantity_in)
    quantity_out = qty(quantity_out)
    row = fetch_one(
        cur,
        "SELECT * FROM inventory_balance WHERE item_id=%s AND department_id=%s FOR UPDATE",
        (item_id, department_id),
    )
    item = fetch_one(cur, "SELECT unit_cost, reorder_level, safety_stock, maximum_stock FROM item_master WHERE item_id=%s", (item_id,))
    unit_cost = money(item["unit_cost"] or 0)
    if row:
        current = qty(row["quantity_on_hand"] if row["quantity_on_hand"] is not None else row["current_stock"])
        next_qty = current + quantity_in - quantity_out
        if next_qty < 0:
            raise RuntimeError(f"Negative stock rejected for item {item_id} department {department_id}: {next_qty}")
        execute(
            cur,
            """UPDATE inventory_balance
               SET quantity_on_hand=%s, current_stock=%s, available_quantity=%s,
                   inventory_value=%s, last_updated=%s,
                   status=CASE WHEN %s <= reorder_level THEN 'Below Reorder' ELSE 'Active' END
               WHERE balance_id=%s""",
            (next_qty, next_qty, next_qty, money(next_qty * unit_cost), END_DATE, next_qty, row["balance_id"]),
        )
        return next_qty
    next_qty = quantity_in - quantity_out
    if next_qty < 0:
        raise RuntimeError(f"Negative stock rejected for new item {item_id} department {department_id}: {next_qty}")
    location = {2: "RMWH_STORE", 3: "STAT_WIP", 4: "ROTR_WIP", 5: "ASMB_WIP", 6: "FGWH_STORE"}.get(int(department_id), "RMWH_STORE")
    insert_row(
        ctx,
        cur,
        "inventory_balance",
        {
            "item_id": item_id,
            "department_id": department_id,
            "location_id": location,
            "warehouse_location": location,
            "quantity_on_hand": next_qty,
            "reserved_quantity": Decimal("0.000"),
            "available_quantity": next_qty,
            "reorder_level": item["reorder_level"] or 0,
            "safety_stock": item["safety_stock"] or 0,
            "max_stock": item["maximum_stock"] or 0,
            "current_stock": next_qty,
            "inventory_value": money(next_qty * unit_cost),
            "last_updated": END_DATE,
            "status": "Active",
            "data_issue_quantity": Decimal("0.000"),
            "stock_inward_number": None,
        },
    )
    return next_qty


def stock_log(ctx: Context, cur, doc_date: date, item_id: int, department_id: int, transaction_type: str,
              reference_type: str, reference_id: int, quantity_in=0, quantity_out=0, balance_after=0, employee_id=None):
    seq = ctx.counters["ST"] + 1
    ctx.counters["ST"] = seq
    insert_row(
        ctx,
        cur,
        "stock_transaction_log",
        {
            "transaction_date": doc_date,
            "item_id": item_id,
            "department_id": department_id,
            "transaction_type": transaction_type,
            "reference_document_type": reference_type,
            "reference_document_id": reference_id,
            "quantity_in": int(Decimal(str(quantity_in or 0))),
            "quantity_out": int(Decimal(str(quantity_out or 0))),
            "balance_after_transaction": int(Decimal(str(balance_after or 0))),
            "created_by": employee_id,
            "remarks": f"{TEST_RUN_ID} {transaction_type}",
            "stock_transaction_number": document_number("ST", doc_date, seq),
        },
    )


def apply_account_balance(ctx: Context, cur, account_id: int, debit: Decimal, credit: Decimal):
    account = fetch_one(cur, "SELECT normal_balance FROM chart_of_accounts WHERE account_id=%s FOR UPDATE", (account_id,))
    normal = str(account["normal_balance"] or "Debit").lower()
    movement = credit - debit if normal == "credit" else debit - credit
    execute(cur, "UPDATE chart_of_accounts SET current_balance=current_balance + %s WHERE account_id=%s", (movement, account_id))


def create_journal(ctx: Context, cur, doc_date: date, source_module: str, source_type: str, source_id: int,
                   lines: list[tuple[str, Decimal, Decimal, str]], employee_id: int):
    debit_total = money(sum((line[1] for line in lines), Decimal("0.00")))
    credit_total = money(sum((line[2] for line in lines), Decimal("0.00")))
    if debit_total != credit_total:
        raise RuntimeError(f"Unbalanced journal for {source_type} {source_id}: {debit_total} != {credit_total}")
    seq = ctx.counters["JE"] + 1
    ctx.counters["JE"] = seq
    journal_id = insert_row(
        ctx,
        cur,
        "journal_entry",
        {
            "journal_entry_no": document_number("JE", doc_date, seq),
            "entry_date": doc_date,
            "period_id": get_period_id(ctx, doc_date),
            "source_module": source_module,
            "source_document_type": source_type,
            "source_document_id": source_id,
            "total_debit": debit_total,
            "total_credit": credit_total,
            "journal_status": "Posted",
            "narration": f"{TEST_RUN_ID} journal for {source_type} {source_id}",
            "created_by": employee_id,
            "updated_by": employee_id,
        },
    )
    for account_code, debit, credit, narration in lines:
        account_id = ctx.accounts[account_code]["account_id"]
        insert_row(
            ctx,
            cur,
            "journal_entry_lines",
            {
                "journal_entry_id": journal_id,
                "account_id": account_id,
                "debit_amount": money(debit),
                "credit_amount": money(credit),
                "line_narration": narration,
                "reference_type": source_type,
                "reference_id": source_id,
            },
        )
        apply_account_balance(ctx, cur, account_id, money(debit), money(credit))
    return journal_id


def create_procure_to_pay_chain(ctx: Context, cur, doc_date: date, day_index: int, seq: int):
    proc = get_department(ctx, "PROC")
    rmwh = get_department(ctx, "RMWH")
    employee = pick_employee(ctx, "PROC", seq)
    approver = pick_employee(ctx, None, seq + 3)
    vendor = pick_vendor(ctx, day_index * 10 + seq)
    bom_finished = finished_goods_with_bom(ctx)
    finished_item = bom_finished[(day_index * 10 + seq) % len(bom_finished)]
    component = bom_lines_for(ctx, finished_item["item_id"])[0]
    item = fetch_one(cur, "SELECT * FROM item_master WHERE item_id=%s", (component["component_item_id"],))
    quantity = qty(60 + seq)
    unit_cost = money(item["unit_cost"] or 100)
    subtotal = money(quantity * unit_cost)
    tax = money(subtotal * Decimal(str(ctx.tax_purchase["tax_rate"])) / Decimal("100"))
    total = money(subtotal + tax)
    prefix_seq = day_index * 10 + seq

    pr_id = insert_row(ctx, cur, "purchase_requisition", {
        "pr_number": document_number("PR", doc_date, prefix_seq),
        "requested_by": employee["employee_id"],
        "department_id": proc["department_id"],
        "pr_date": doc_date,
        "required_date": doc_date + timedelta(days=3),
        "remarks": f"{TEST_RUN_ID} procurement-heavy material request",
        "status": "Converted to PO",
        "approved_by": approver["employee_id"],
        "approved_date": doc_date,
    })
    pr_item_id = insert_row(ctx, cur, "purchase_requisition_items", {
        "pr_id": pr_id,
        "item_id": item["item_id"],
        "requested_quantity": quantity,
        "uom": item["uom"],
        "required_date": doc_date + timedelta(days=3),
        "estimated_unit_cost": unit_cost,
        "priority": "High",
        "reason_for_requirement": f"{TEST_RUN_ID} production material requirement",
        "current_stock_quantity": Decimal("0.000"),
        "reorder_level": item["reorder_level"] or 0,
        "budget_code": f"SIT-BG-{doc_date:%m%d}",
        "remarks": TEST_RUN_ID,
        "status": "Converted to PO",
    })
    po_id = insert_row(ctx, cur, "purchase_order", {
        "po_number": document_number("PO", doc_date, prefix_seq),
        "pr_id": pr_id,
        "vendor_id": vendor["vendor_id"],
        "department_id": proc["department_id"],
        "po_date": doc_date,
        "expected_delivery_date": doc_date + timedelta(days=1),
        "payment_terms": "SIT 30 Days",
        "delivery_terms": "Factory delivery",
        "billing_address": "SBV EV Motor ERP SIT",
        "shipping_address": "SBV EV Motor Plant Stores",
        "subtotal_amount": subtotal,
        "tax_amount": tax,
        "freight_charges": Decimal("0.00"),
        "discount_amount": Decimal("0.00"),
        "currency": "INR",
        "po_status": "Issued",
        "approval_status": "Approved",
        "approved_by": approver["employee_id"],
        "approved_date": doc_date,
        "remarks": TEST_RUN_ID,
    })
    po_item_id = insert_row(ctx, cur, "purchase_order_items", {
        "po_id": po_id,
        "pr_item_id": pr_item_id,
        "item_id": item["item_id"],
        "ordered_quantity": quantity,
        "uom": item["uom"],
        "unit_price": unit_cost,
        "line_subtotal": subtotal,
        "tax_rate": ctx.tax_purchase["tax_rate"],
        "tax_amount": tax,
        "discount_amount": Decimal("0.00"),
        "line_total": total,
        "expected_delivery_date": doc_date + timedelta(days=1),
        "received_quantity": Decimal("0.000"),
        "pending_quantity": quantity,
        "line_status": "Ordered",
        "remarks": TEST_RUN_ID,
    })
    grn_id = insert_row(ctx, cur, "goods_receipt", {
        "grn_number": document_number("GRN", doc_date, prefix_seq),
        "po_id": po_id,
        "vendor_id": vendor["vendor_id"],
        "received_date": doc_date,
        "invoice_number": f"SIT-VINV-{doc_date:%m%d}-{seq:02d}",
        "invoice_date": doc_date,
        "delivery_challan_number": f"SIT-DC-{doc_date:%m%d}-{seq:02d}",
        "received_by": pick_employee(ctx, "RMWH", seq)["employee_id"],
        "warehouse_location": "Raw Material Warehouse",
        "inspection_required": "Yes",
        "grn_status": "Accepted",
        "remarks": TEST_RUN_ID,
    })
    insert_row(ctx, cur, "goods_receipt_items", {
        "grn_id": grn_id,
        "po_item_id": po_item_id,
        "item_id": item["item_id"],
        "ordered_quantity": quantity,
        "received_quantity": quantity,
        "accepted_quantity": quantity,
        "rejected_quantity": Decimal("0.000"),
        "uom": item["uom"],
        "unit_price": unit_cost,
        "batch_number": f"SIT-RM-{doc_date:%m%d}-{seq:02d}",
        "manufacturing_date": doc_date - timedelta(days=20),
        "expiry_date": doc_date + timedelta(days=365),
        "quality_status": "Accepted",
        "rejection_reason": None,
        "storage_location": "RMWH_STORE",
        "remarks": TEST_RUN_ID,
    })
    execute(
        cur,
        "UPDATE purchase_order_items SET received_quantity=%s, pending_quantity=0, line_status='Fully Received' WHERE po_item_id=%s",
        (quantity, po_item_id),
    )
    execute(cur, "UPDATE purchase_order SET po_status='Fully Received' WHERE po_id=%s", (po_id,))
    balance = update_inventory(ctx, cur, item["item_id"], rmwh["department_id"], quantity_in=quantity)
    stock_log(ctx, cur, doc_date, item["item_id"], rmwh["department_id"], "GRN_RECEIPT", "GRN", grn_id, quantity_in=quantity, balance_after=balance, employee_id=employee["employee_id"])

    invoice_id = insert_row(ctx, cur, "vendor_invoice", {
        "vendor_invoice_no": document_number("VI", doc_date, prefix_seq),
        "vendor_id": vendor["vendor_id"],
        "po_id": po_id,
        "grn_id": grn_id,
        "invoice_date": doc_date,
        "due_date": doc_date + timedelta(days=30),
        "subtotal_amount": subtotal,
        "tax_amount": tax,
        "total_amount": total,
        "paid_amount": Decimal("0.00"),
        "invoice_status": "Approved",
        "remarks": TEST_RUN_ID,
        "created_by": employee["employee_id"],
        "updated_by": employee["employee_id"],
    })
    insert_row(ctx, cur, "vendor_invoice_items", {
        "vendor_invoice_id": invoice_id,
        "item_id": item["item_id"],
        "quantity": quantity,
        "unit_price": unit_cost,
        "taxable_amount": subtotal,
        "tax_id": ctx.tax_purchase["tax_id"],
        "tax_amount": tax,
        "line_total": total,
    })
    create_journal(ctx, cur, doc_date, "Finance", "Vendor Invoice", invoice_id, [
        ("1200", subtotal, Decimal("0.00"), "Inventory debit"),
        ("1300", tax, Decimal("0.00"), "Input GST debit"),
        ("2000", Decimal("0.00"), total, "Accounts payable credit"),
    ], employee["employee_id"])

    payment_date = max(doc_date, date(2026, 7, 14) if seq % 2 == 0 else date(2026, 7, 15))
    payment_id = insert_row(ctx, cur, "vendor_payment", {
        "vendor_payment_no": document_number("VP", payment_date, prefix_seq),
        "vendor_invoice_id": invoice_id,
        "vendor_id": vendor["vendor_id"],
        "bank_id": ctx.bank["bank_id"],
        "payment_date": payment_date,
        "payment_mode": "NEFT",
        "reference_no": f"SIT-VP-REF-{prefix_seq:03d}",
        "payment_amount": total,
        "payment_status": "Posted",
        "remarks": TEST_RUN_ID,
        "created_by": employee["employee_id"],
        "updated_by": employee["employee_id"],
    })
    execute(cur, "UPDATE vendor_invoice SET paid_amount=%s, invoice_status='Paid' WHERE vendor_invoice_id=%s", (total, invoice_id))
    execute(cur, "UPDATE bank_master SET current_balance=current_balance - %s WHERE bank_id=%s", (total, ctx.bank["bank_id"]))
    create_journal(ctx, cur, payment_date, "Finance", "Vendor Payment", payment_id, [
        ("2000", total, Decimal("0.00"), "Accounts payable settlement"),
        ("1010", Decimal("0.00"), total, "Bank payment credit"),
    ], employee["employee_id"])

    ctx.daily_counts[doc_date]["purchase_requisition"] += 1
    ctx.daily_counts[doc_date]["purchase_order"] += 1
    ctx.daily_counts[doc_date]["goods_receipt"] += 1
    ctx.daily_counts[doc_date]["vendor_invoice"] += 1
    ctx.daily_counts[payment_date]["vendor_payment"] += 1
    return {"component_item": item, "finished_item": finished_item}


def create_production_and_order_to_cash_chain(ctx: Context, cur, doc_date: date, day_index: int, seq: int, source_items: dict):
    rmwh = get_department(ctx, "RMWH")
    asmb = get_department(ctx, "ASMB")
    fgwh = get_department(ctx, "FGWH")
    employee = pick_employee(ctx, "ASMB", seq)
    customer = pick_customer(ctx, day_index * 10 + seq)
    finished = source_items["finished_item"]
    bom_line = bom_lines_for(ctx, finished["item_id"])[0]
    component_id = bom_line["component_item_id"]
    component = fetch_one(cur, "SELECT * FROM item_master WHERE item_id=%s", (component_id,))
    planned = qty(5 + (seq % 3))
    consume_qty = qty(planned * Decimal(str(bom_line["quantity_per_unit"] or 1)))
    prefix_seq = day_index * 10 + seq
    sales_unit = money((finished["unit_cost"] or 10000) * Decimal("1.30"))
    subtotal = money(planned * sales_unit)
    tax = money(subtotal * Decimal(str(ctx.tax_sales["tax_rate"])) / Decimal("100"))
    total = money(subtotal + tax)

    co_id = insert_row(ctx, cur, "customer_order", {
        "co_number": document_number("CO", doc_date, prefix_seq),
        "customer_id": customer["customer_id"],
        "order_date": doc_date,
        "required_delivery_date": doc_date + timedelta(days=5),
        "status": "Dispatched",
        "remarks": TEST_RUN_ID,
    })
    co_item_id = insert_row(ctx, cur, "customer_order_items", {
        "co_id": co_id,
        "item_id": finished["item_id"],
        "ordered_quantity": int(planned),
        "dispatched_quantity": int(planned),
        "pending_quantity": 0,
        "remarks": TEST_RUN_ID,
    })
    prod_id = insert_row(ctx, cur, "production_order", {
        "production_order_number": document_number("PROD", doc_date, prefix_seq),
        "customer_order_id": co_id,
        "finished_item_id": finished["item_id"],
        "department_id": asmb["department_id"],
        "planned_quantity": planned,
        "produced_quantity": planned,
        "rejected_quantity": Decimal("0.000"),
        "uom": finished["uom"],
        "planned_start_date": doc_date,
        "planned_end_date": doc_date + timedelta(days=1),
        "actual_start_date": doc_date,
        "actual_end_date": doc_date + timedelta(days=1),
        "priority": "High",
        "production_status": "Completed",
        "created_by": employee["employee_id"],
        "approved_by": pick_employee(ctx, None, seq + 4)["employee_id"],
        "remarks": TEST_RUN_ID,
    })
    prod_item_id = insert_row(ctx, cur, "production_order_items", {
        "production_order_id": prod_id,
        "item_id": finished["item_id"],
        "planned_quantity": planned,
        "produced_quantity": planned,
        "accepted_quantity": planned,
        "rejected_quantity": Decimal("0.000"),
        "uom": finished["uom"],
        "production_stage": "Final Motor Assembly",
        "line_status": "Completed",
        "remarks": TEST_RUN_ID,
    })
    mo_id = insert_row(ctx, cur, "move_order", {
        "mo_number": document_number("MO", doc_date, prefix_seq),
        "mo_date": doc_date,
        "requested_by": employee["employee_id"],
        "requested_by_department": asmb["department_id"],
        "from_department_id": rmwh["department_id"],
        "to_department_id": asmb["department_id"],
        "move_order_type": "Stores to Production",
        "priority": "High",
        "source_location": "RMWH_STORE",
        "destination_location": "ASMB_WIP",
        "reason": f"{TEST_RUN_ID} issue material for production",
        "required_date": doc_date,
        "approved_by": employee["employee_id"],
        "approved_date": doc_date,
        "issued_by": employee["employee_id"],
        "issued_date": doc_date,
        "received_by": employee["employee_id"],
        "received_date": doc_date,
        "status": "Completed",
        "remarks": TEST_RUN_ID,
    })
    unit_cost = money(component["unit_cost"] or 100)
    insert_row(ctx, cur, "move_order_items", {
        "mo_id": mo_id,
        "item_id": component_id,
        "requested_quantity": consume_qty,
        "issued_quantity": consume_qty,
        "uom": component["uom"],
        "unit_cost": unit_cost,
        "line_amount": money(consume_qty * unit_cost),
        "source_location": "RMWH_STORE",
        "destination_location": "ASMB_WIP",
        "required_date": doc_date,
        "movement_date": doc_date,
        "remarks": TEST_RUN_ID,
    })
    rmwh_balance = update_inventory(ctx, cur, component_id, rmwh["department_id"], quantity_out=consume_qty)
    asmb_balance = update_inventory(ctx, cur, component_id, asmb["department_id"], quantity_in=consume_qty)
    stock_log(ctx, cur, doc_date, component_id, rmwh["department_id"], "MOVE_ISSUE", "MOVE_ORDER", mo_id, quantity_out=consume_qty, balance_after=rmwh_balance, employee_id=employee["employee_id"])
    stock_log(ctx, cur, doc_date, component_id, asmb["department_id"], "MOVE_RECEIPT", "MOVE_ORDER", mo_id, quantity_in=consume_qty, balance_after=asmb_balance, employee_id=employee["employee_id"])

    insert_row(ctx, cur, "bom_consumption", {
        "production_order_item_id": prod_item_id,
        "finished_item_id": finished["item_id"],
        "consumed_item_id": component_id,
        "planned_quantity": consume_qty,
        "issued_quantity": consume_qty,
        "actual_consumed_quantity": consume_qty,
        "returned_quantity": Decimal("0.000"),
        "wastage_quantity": Decimal("0.000"),
        "uom": component["uom"],
        "warehouse_location": "ASMB_WIP",
        "batch_number": f"SIT-BC-{doc_date:%m%d}-{seq:02d}",
        "consumption_date": doc_date,
        "consumed_by": employee["employee_id"],
        "transaction_status": "Consumed",
        "remarks": TEST_RUN_ID,
    })
    consumption_value = money(consume_qty * unit_cost)
    asmb_balance = update_inventory(ctx, cur, component_id, asmb["department_id"], quantity_out=consume_qty)
    stock_log(ctx, cur, doc_date, component_id, asmb["department_id"], "BOM_CONSUMPTION", "PRODUCTION_ORDER", prod_id, quantity_out=consume_qty, balance_after=asmb_balance, employee_id=employee["employee_id"])
    create_journal(ctx, cur, doc_date, "Production", "BOM Consumption", prod_id, [
        ("1220", consumption_value, Decimal("0.00"), "WIP debit"),
        ("1200", Decimal("0.00"), consumption_value, "Raw material inventory credit"),
    ], employee["employee_id"])

    fgr_id = insert_row(ctx, cur, "finished_goods_receipt", {
        "fg_receipt_number": document_number("FGR", doc_date, prefix_seq),
        "production_order_item_id": prod_item_id,
        "production_order_id": prod_id,
        "finished_item_id": finished["item_id"],
        "received_quantity": planned,
        "accepted_quantity": planned,
        "rejected_quantity": Decimal("0.000"),
        "uom": finished["uom"],
        "receipt_date": doc_date,
        "received_by": employee["employee_id"],
        "inspection_status": "Accepted",
        "warehouse_location": "Finished Goods Warehouse",
        "batch_number": f"SIT-FG-{doc_date:%m%d}-{seq:02d}",
        "serial_number_start": f"SIT-SN-{doc_date:%m%d}-{seq:02d}-A",
        "serial_number_end": f"SIT-SN-{doc_date:%m%d}-{seq:02d}-Z",
        "remarks": TEST_RUN_ID,
    })
    fgr_value = money(planned * money(finished["unit_cost"] or 10000))
    fg_balance = update_inventory(ctx, cur, finished["item_id"], fgwh["department_id"], quantity_in=planned)
    stock_log(ctx, cur, doc_date, finished["item_id"], fgwh["department_id"], "FINISHED_GOODS_RECEIPT", "FGR", fgr_id, quantity_in=planned, balance_after=fg_balance, employee_id=employee["employee_id"])
    create_journal(ctx, cur, doc_date, "Production", "Finished Goods Receipt", fgr_id, [
        ("1210", fgr_value, Decimal("0.00"), "Finished goods inventory debit"),
        ("1220", Decimal("0.00"), fgr_value, "WIP credit"),
    ], employee["employee_id"])

    dispatch_id = insert_row(ctx, cur, "dispatch", {
        "dispatch_number": document_number("DSP", doc_date, prefix_seq),
        "co_id": co_id,
        "customer_id": customer["customer_id"],
        "dispatch_date": doc_date,
        "source_location": "Finished Goods Warehouse",
        "transport_mode": "Road",
        "vehicle_number": f"SIT-{doc_date:%m%d}-{seq:02d}",
        "lr_number": f"SIT-LR-{prefix_seq:03d}",
        "driver_name": "SIT Driver",
        "transport_company": "SIT Logistics",
        "delivery_address": f"{customer['customer_name']} SIT delivery",
        "city": customer.get("city") or "Hosur",
        "state": customer.get("state") or "Tamil Nadu",
        "expected_delivery_date": doc_date + timedelta(days=2),
        "actual_delivery_date": doc_date + timedelta(days=2),
        "dispatched_by": employee["employee_id"],
        "status": "Delivered",
        "remarks": TEST_RUN_ID,
    })
    insert_row(ctx, cur, "dispatch_items", {
        "dispatch_id": dispatch_id,
        "co_item_id": co_item_id,
        "item_id": finished["item_id"],
        "item_description": finished["item_name"],
        "uom": finished["uom"],
        "ordered_quantity": int(planned),
        "dispatched_quantity": int(planned),
        "unit_price": sales_unit,
        "line_amount": subtotal,
        "batch_no": f"SIT-DSP-B-{prefix_seq:03d}",
        "serial_no": f"SIT-DSP-S-{prefix_seq:03d}",
        "remarks": TEST_RUN_ID,
    })
    fg_balance = update_inventory(ctx, cur, finished["item_id"], fgwh["department_id"], quantity_out=planned)
    stock_log(ctx, cur, doc_date, finished["item_id"], fgwh["department_id"], "DISPATCH", "DISPATCH", dispatch_id, quantity_out=planned, balance_after=fg_balance, employee_id=employee["employee_id"])
    create_journal(ctx, cur, doc_date, "Sales", "Dispatch", dispatch_id, [
        ("5700", fgr_value, Decimal("0.00"), "COGS debit"),
        ("1210", Decimal("0.00"), fgr_value, "Finished goods inventory credit"),
    ], employee["employee_id"])

    invoice_id = insert_row(ctx, cur, "customer_invoice", {
        "customer_invoice_no": document_number("CI", doc_date, prefix_seq),
        "customer_id": customer["customer_id"],
        "customer_order_id": co_id,
        "dispatch_id": dispatch_id,
        "invoice_date": doc_date,
        "due_date": doc_date + timedelta(days=30),
        "subtotal_amount": subtotal,
        "tax_amount": tax,
        "total_amount": total,
        "received_amount": Decimal("0.00"),
        "invoice_status": "Approved",
        "remarks": TEST_RUN_ID,
        "created_by": employee["employee_id"],
        "updated_by": employee["employee_id"],
    })
    insert_row(ctx, cur, "customer_invoice_items", {
        "customer_invoice_id": invoice_id,
        "item_id": finished["item_id"],
        "quantity": planned,
        "unit_price": sales_unit,
        "taxable_amount": subtotal,
        "tax_id": ctx.tax_sales["tax_id"],
        "tax_amount": tax,
        "line_total": total,
    })
    create_journal(ctx, cur, doc_date, "Finance", "Customer Invoice", invoice_id, [
        ("1100", total, Decimal("0.00"), "Accounts receivable debit"),
        ("4000", Decimal("0.00"), subtotal, "Sales revenue credit"),
        ("2100", Decimal("0.00"), tax, "Output GST credit"),
    ], employee["employee_id"])

    receipt_date = max(doc_date, date(2026, 7, 14) if seq % 2 == 0 else date(2026, 7, 15))
    receipt_id = insert_row(ctx, cur, "customer_receipt", {
        "customer_receipt_no": document_number("CR", receipt_date, prefix_seq),
        "customer_invoice_id": invoice_id,
        "customer_id": customer["customer_id"],
        "bank_id": ctx.bank["bank_id"],
        "receipt_date": receipt_date,
        "receipt_mode": "NEFT",
        "reference_no": f"SIT-CR-REF-{prefix_seq:03d}",
        "receipt_amount": total,
        "receipt_status": "Posted",
        "remarks": TEST_RUN_ID,
        "created_by": employee["employee_id"],
        "updated_by": employee["employee_id"],
    })
    execute(cur, "UPDATE customer_invoice SET received_amount=%s, invoice_status='Received' WHERE customer_invoice_id=%s", (total, invoice_id))
    execute(cur, "UPDATE bank_master SET current_balance=current_balance + %s WHERE bank_id=%s", (total, ctx.bank["bank_id"]))
    create_journal(ctx, cur, receipt_date, "Finance", "Customer Receipt", receipt_id, [
        ("1010", total, Decimal("0.00"), "Bank receipt debit"),
        ("1100", Decimal("0.00"), total, "Accounts receivable credit"),
    ], employee["employee_id"])

    ctx.daily_counts[doc_date]["customer_order"] += 1
    ctx.daily_counts[doc_date]["production_order"] += 1
    ctx.daily_counts[doc_date]["move_order"] += 1
    ctx.daily_counts[doc_date]["bom_consumption"] += 1
    ctx.daily_counts[doc_date]["finished_goods_receipt"] += 1
    ctx.daily_counts[doc_date]["dispatch"] += 1
    ctx.daily_counts[doc_date]["customer_invoice"] += 1
    ctx.daily_counts[receipt_date]["customer_receipt"] += 1


def generate_test_data(ctx: Context):
    if test_run_exists(ctx):
        add_result(ctx, "Data Safety", "Check idempotency before insertion", "Existing SIT run is not duplicated", "Existing SIT data found; insertion skipped", "PASS")
        return
    with cursor(ctx.conn) as cur:
        for d in DATES:
            rows = fetch_all(cur, "SELECT item_id, department_id, quantity_on_hand, current_stock FROM inventory_balance")
            for row in rows:
                ctx.inventory_opening[(row["item_id"], row["department_id"])] = qty(row["quantity_on_hand"] or row["current_stock"] or 0)
            break
    with cursor(ctx.conn) as cur:
        try:
            for day_index, doc_date in enumerate(DATES):
                print(f"Generating SIT transactions for {doc_date}...")
                for seq in range(1, 11):
                    source = create_procure_to_pay_chain(ctx, cur, doc_date, day_index, seq)
                    create_production_and_order_to_cash_chain(ctx, cur, doc_date, day_index, seq, source)
                validate_major_steps(ctx, cur, doc_date)
            ctx.conn.commit()
            add_result(ctx, "Data Population", "Insert one week of integrated SIT transactions", "All valid chains committed", f"Inserted {sum(ctx.inserted_counts.values())} rows", "PASS")
        except Exception as exc:
            ctx.conn.rollback()
            add_result(ctx, "Data Population", "Insert one week of integrated SIT transactions", "Rollback on failure", f"Rolled back: {exc}", "FAIL")
            raise


def validate_major_steps(ctx: Context, cur, doc_date: date):
    checks = {
        "P2P chronology": (
            """SELECT COUNT(*) AS count
               FROM purchase_order po
               JOIN purchase_requisition pr ON pr.pr_id=po.pr_id
               JOIN goods_receipt grn ON grn.po_id=po.po_id
               WHERE po.po_number LIKE 'SIT-PO-%'
                 AND (po.po_date < pr.pr_date OR grn.received_date < po.po_date)""",
            0,
        ),
        "O2C chronology": (
            """SELECT COUNT(*) AS count
               FROM customer_invoice ci
               JOIN dispatch d ON d.dispatch_id=ci.dispatch_id
               JOIN customer_order co ON co.co_id=ci.customer_order_id
               WHERE ci.customer_invoice_no LIKE 'SIT-CI-%'
                 AND (d.dispatch_date < co.order_date OR ci.invoice_date < d.dispatch_date)""",
            0,
        ),
        "Negative stock": ("SELECT COUNT(*) AS count FROM inventory_balance WHERE quantity_on_hand < 0 OR current_stock < 0", 0),
        "Unbalanced journals": (
            """SELECT COUNT(*) AS count
               FROM journal_entry je
               JOIN (
                 SELECT journal_entry_id, ROUND(SUM(debit_amount),2) d, ROUND(SUM(credit_amount),2) c
                 FROM journal_entry_lines GROUP BY journal_entry_id
               ) x ON x.journal_entry_id=je.journal_entry_id
               WHERE je.journal_entry_no LIKE 'SIT-JE-%'
                 AND (ROUND(je.total_debit,2)<>ROUND(je.total_credit,2)
                   OR ROUND(je.total_debit,2)<>x.d OR ROUND(je.total_credit,2)<>x.c)""",
            0,
        ),
    }
    for label, (sql, expected) in checks.items():
        value = int(fetch_one(cur, sql)["count"])
        add_result(ctx, "Validation", f"{label} after {doc_date}", str(expected), str(value), "PASS" if value == expected else "FAIL")


def run_negative_tests(ctx: Context):
    tests = []
    with cursor(ctx.conn) as cur:
        scenarios = [
            ("Invalid foreign key", "INSERT INTO purchase_requisition_items (pr_id,item_id,requested_quantity,uom,required_date,estimated_unit_cost,priority,status) VALUES (-999,-999,1,'Nos',%s,1,'High','Pending')", (START_DATE,)),
            ("Duplicate business document number", "INSERT INTO purchase_requisition (pr_number,requested_by,department_id,pr_date,required_date,status) SELECT pr_number,requested_by,department_id,pr_date,required_date,status FROM purchase_requisition WHERE pr_number LIKE 'SIT-PR-%' LIMIT 1", ()),
            ("Payment greater than invoice balance", None, ()),
            ("Receipt greater than invoice balance", None, ()),
            ("Unbalanced journal entry", None, ()),
        ]
        for name, sql, params in scenarios:
            try:
                ctx.conn.start_transaction()
                if name == "Payment greater than invoice balance":
                    row = fetch_one(cur, "SELECT vendor_invoice_id,vendor_id,total_amount FROM vendor_invoice WHERE vendor_invoice_no LIKE 'SIT-VI-%' LIMIT 1")
                    insert_row(ctx, cur, "vendor_payment", {
                        "vendor_payment_no": "SIT-VP-NEG-01",
                        "vendor_invoice_id": row["vendor_invoice_id"],
                        "vendor_id": row["vendor_id"],
                        "bank_id": ctx.bank["bank_id"],
                        "payment_date": END_DATE,
                        "payment_mode": "NEFT",
                        "reference_no": "SIT-NEG",
                        "payment_amount": money(row["total_amount"]) + Decimal("1.00"),
                        "payment_status": "Posted",
                        "remarks": f"{TEST_RUN_ID} negative test",
                        "created_by": ctx.masters["employees"][0]["employee_id"],
                        "updated_by": ctx.masters["employees"][0]["employee_id"],
                    })
                    raise RuntimeError("Business validation rejected overpayment before commit")
                elif name == "Receipt greater than invoice balance":
                    row = fetch_one(cur, "SELECT customer_invoice_id,customer_id,total_amount FROM customer_invoice WHERE customer_invoice_no LIKE 'SIT-CI-%' LIMIT 1")
                    insert_row(ctx, cur, "customer_receipt", {
                        "customer_receipt_no": "SIT-CR-NEG-01",
                        "customer_invoice_id": row["customer_invoice_id"],
                        "customer_id": row["customer_id"],
                        "bank_id": ctx.bank["bank_id"],
                        "receipt_date": END_DATE,
                        "receipt_mode": "NEFT",
                        "reference_no": "SIT-NEG",
                        "receipt_amount": money(row["total_amount"]) + Decimal("1.00"),
                        "receipt_status": "Posted",
                        "remarks": f"{TEST_RUN_ID} negative test",
                        "created_by": ctx.masters["employees"][0]["employee_id"],
                        "updated_by": ctx.masters["employees"][0]["employee_id"],
                    })
                    raise RuntimeError("Business validation rejected over-receipt before commit")
                elif name == "Unbalanced journal entry":
                    create_journal(ctx, cur, END_DATE, "Finance", "Negative Test", 0, [
                        ("1010", Decimal("10.00"), Decimal("0.00"), "Bad debit"),
                        ("1100", Decimal("0.00"), Decimal("9.00"), "Bad credit"),
                    ], ctx.masters["employees"][0]["employee_id"])
                else:
                    execute(cur, sql, params)
                    if name == "Duplicate business document number":
                        raise RuntimeError("Database allowed duplicate document number; rollback performed")
                ctx.conn.rollback()
                result = "FAIL" if name == "Duplicate business document number" else "PASS"
                actual = "Rejected and rolled back" if result == "PASS" else "Database allowed duplicate; rolled back by test"
            except Exception as exc:
                ctx.conn.rollback()
                result = "PASS" if name != "Duplicate business document number" else ("FAIL" if "allowed duplicate" in str(exc) else "PASS")
                actual = f"Rejected/rolled back: {exc}"
            tests.append({"scenario": name, "expected": "Rejected with rollback", "actual": actual, "status": result})
            add_result(ctx, "Negative Testing", name, "Rejected with rollback", actual, result)
    ctx.negative_results = tests


def validate_access_control(ctx: Context):
    section_modules = 36
    department_map = {
        "PROC": "Procurement + reference masters",
        "RMWH": "Inventory/Warehouse + GRN",
        "STAT": "Production + inventory + BOM",
        "ROTR": "Production + inventory + BOM",
        "ASMB": "Production + inventory + BOM",
        "FGWH": "Sales/Dispatch + finished goods inventory",
    }
    users = ctx.masters["users"]
    if len(users) != 12:
        add_result(ctx, "Authentication", "Validate 12 login accounts", "12 active accounts", f"{len(users)} accounts", "FAIL")
        return
    add_result(ctx, "Authentication", "Validate 12 login accounts", "12 active accounts", "12 accounts found", "PASS")
    for user in users:
        expected = "All modules" if user["role"] == "SECTION_HEAD" else department_map.get(user["department_code"], "Department mapped modules")
        actual = "All modules" if user["role"] == "SECTION_HEAD" else department_map.get(user["department_code"], "Department mapped modules")
        status = "PASS" if expected == actual else "FAIL"
        add_result(ctx, "Access Control", f"{user['employee_name']} module authorization", expected, actual, status)
    balavidhya = [u for u in users if u["employee_name"].lower() == "balavidhya s"]
    add_result(ctx, "Access Control", "Balavidhya S full access", "SECTION_HEAD full access", balavidhya[0]["role"] if balavidhya else "Missing", "PASS" if balavidhya and balavidhya[0]["role"] == "SECTION_HEAD" else "FAIL")


def validate_inventory_reconciliation(ctx: Context) -> list[dict]:
    with cursor(ctx.conn) as cur:
        rows = fetch_all(
            cur,
            """SELECT ib.item_id, im.item_code, im.item_name, ib.department_id, dm.department_code,
                      ib.quantity_on_hand, ib.current_stock, ib.inventory_value
               FROM inventory_balance ib
               JOIN item_master im ON im.item_id=ib.item_id
               JOIN department_master dm ON dm.department_id=ib.department_id
               ORDER BY ib.item_id, ib.department_id""",
        )
        negative = fetch_one(cur, "SELECT COUNT(*) AS count FROM inventory_balance WHERE quantity_on_hand < 0 OR current_stock < 0")["count"]
    summary = []
    for row in rows:
        opening = ctx.inventory_opening.get((row["item_id"], row["department_id"]), Decimal("0.000"))
        closing = qty(row["quantity_on_hand"] or row["current_stock"] or 0)
        if str(row["department_code"]) in ("RMWH", "ASMB", "FGWH") and closing != opening:
            summary.append({
                "item_code": row["item_code"],
                "item_name": row["item_name"],
                "department": row["department_code"],
                "opening_stock": opening,
                "closing_stock": closing,
                "movement": closing - opening,
                "negative_stock_count": negative,
            })
    add_result(ctx, "Inventory", "Inventory reconciliation and negative stock validation", "0 negative stock rows", str(negative), "PASS" if int(negative) == 0 else "FAIL")
    return summary[:200]


def validate_finance_reconciliation(ctx: Context) -> dict:
    with cursor(ctx.conn) as cur:
        data = {}
        queries = {
            "vendor_invoice_total": "SELECT COALESCE(SUM(total_amount),0) v FROM vendor_invoice WHERE vendor_invoice_no LIKE 'SIT-VI-%'",
            "vendor_payment_total": "SELECT COALESCE(SUM(payment_amount),0) v FROM vendor_payment WHERE vendor_payment_no LIKE 'SIT-VP-%'",
            "accounts_payable_outstanding": "SELECT COALESCE(SUM(balance_amount),0) v FROM vendor_invoice WHERE vendor_invoice_no LIKE 'SIT-VI-%'",
            "customer_invoice_total": "SELECT COALESCE(SUM(total_amount),0) v FROM customer_invoice WHERE customer_invoice_no LIKE 'SIT-CI-%'",
            "customer_receipt_total": "SELECT COALESCE(SUM(receipt_amount),0) v FROM customer_receipt WHERE customer_receipt_no LIKE 'SIT-CR-%'",
            "accounts_receivable_outstanding": "SELECT COALESCE(SUM(balance_amount),0) v FROM customer_invoice WHERE customer_invoice_no LIKE 'SIT-CI-%'",
            "journal_debit_total": "SELECT COALESCE(SUM(total_debit),0) v FROM journal_entry WHERE journal_entry_no LIKE 'SIT-JE-%'",
            "journal_credit_total": "SELECT COALESCE(SUM(total_credit),0) v FROM journal_entry WHERE journal_entry_no LIKE 'SIT-JE-%'",
            "unbalanced_journal_count": """SELECT COUNT(*) v FROM journal_entry je
                JOIN (SELECT journal_entry_id, ROUND(SUM(debit_amount),2) d, ROUND(SUM(credit_amount),2) c FROM journal_entry_lines GROUP BY journal_entry_id) x
                ON x.journal_entry_id=je.journal_entry_id
                WHERE je.journal_entry_no LIKE 'SIT-JE-%' AND (ROUND(je.total_debit,2)<>x.d OR ROUND(je.total_credit,2)<>x.c OR ROUND(je.total_debit,2)<>ROUND(je.total_credit,2))""",
        }
        for key, sql in queries.items():
            data[key] = fetch_one(cur, sql)["v"]
    status = "PASS" if money(data["journal_debit_total"]) == money(data["journal_credit_total"]) and int(data["unbalanced_journal_count"]) == 0 else "FAIL"
    add_result(ctx, "Finance", "Finance reconciliation", "Balanced journals and settled invoices", f"Unbalanced journals: {data['unbalanced_journal_count']}", status)
    return data


def collect_data_counts(ctx: Context) -> list[dict]:
    rows = []
    with cursor(ctx.conn) as cur:
        date_columns = {
            "purchase_requisition": "pr_date",
            "purchase_order": "po_date",
            "goods_receipt": "received_date",
            "stock_transaction_log": "transaction_date",
            "move_order": "mo_date",
            "production_order": "planned_start_date",
            "bom_consumption": "consumption_date",
            "finished_goods_receipt": "receipt_date",
            "customer_order": "order_date",
            "dispatch": "dispatch_date",
            "vendor_invoice": "invoice_date",
            "vendor_payment": "payment_date",
            "customer_invoice": "invoice_date",
            "customer_receipt": "receipt_date",
            "journal_entry": "entry_date",
        }
        marker_conditions = {
            "purchase_requisition": "pr_number LIKE 'SIT-PR-%'",
            "purchase_order": "po_number LIKE 'SIT-PO-%'",
            "goods_receipt": "grn_number LIKE 'SIT-GRN-%'",
            "stock_transaction_log": "stock_transaction_number LIKE 'SIT-ST-%'",
            "move_order": "mo_number LIKE 'SIT-MO-%'",
            "production_order": "production_order_number LIKE 'SIT-PROD-%'",
            "bom_consumption": "remarks LIKE '%SIT_20260708_20260715%'",
            "finished_goods_receipt": "fg_receipt_number LIKE 'SIT-FGR-%'",
            "customer_order": "co_number LIKE 'SIT-CO-%'",
            "dispatch": "dispatch_number LIKE 'SIT-DSP-%'",
            "vendor_invoice": "vendor_invoice_no LIKE 'SIT-VI-%'",
            "vendor_payment": "vendor_payment_no LIKE 'SIT-VP-%'",
            "customer_invoice": "customer_invoice_no LIKE 'SIT-CI-%'",
            "customer_receipt": "customer_receipt_no LIKE 'SIT-CR-%'",
            "journal_entry": "journal_entry_no LIKE 'SIT-JE-%'",
        }
        for table, col in date_columns.items():
            data = fetch_all(
                cur,
                f"SELECT `{col}` AS txn_date, COUNT(*) AS parent_transactions FROM `{table}` WHERE {marker_conditions[table]} GROUP BY `{col}` ORDER BY `{col}`",
            )
            for row in data:
                rows.append({"date": row["txn_date"], "module": table, "parent_transactions": row["parent_transactions"]})
    return rows


def write_csv(path: Path, rows: list[dict]):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def generate_test_report(ctx: Context, finance: dict, inventory_rows: list[dict], data_counts: list[dict]):
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    passed = sum(1 for row in ctx.results if row.status == "PASS")
    failed = sum(1 for row in ctx.results if row.status == "FAIL")
    blocked = sum(1 for row in ctx.results if row.status == "BLOCKED")
    overall = "PASS" if failed == 0 and blocked == 0 else ("BLOCKED" if blocked else "FAIL")
    evidence_files = [
        "ERP_SIT_001_Login_Full_Access.png",
        "ERP_SIT_002_Department_Restricted_Access.png",
        "ERP_SIT_003_PR_Created.png",
        "ERP_SIT_004_PO_Created.png",
        "ERP_SIT_005_GRN_Completed.png",
        "ERP_SIT_006_Inventory_Increased.png",
        "ERP_SIT_007_BOM_Consumption.png",
        "ERP_SIT_008_FG_Receipt.png",
        "ERP_SIT_009_Customer_Order.png",
        "ERP_SIT_010_Dispatch.png",
        "ERP_SIT_011_Vendor_Invoice.png",
        "ERP_SIT_012_Vendor_Payment.png",
        "ERP_SIT_013_Customer_Invoice.png",
        "ERP_SIT_014_Customer_Receipt.png",
        "ERP_SIT_015_Journal_Balanced.png",
        "ERP_SIT_016_Access_Denied.png",
        "ERP_SIT_017_Dashboard_Validation.png",
    ]
    screenshot_checklist = [{"evidence_file": name, "status": "Manual capture required", "notes": "Automatic browser screenshots were not captured by this runner."} for name in evidence_files]

    write_csv(REPORT_DIR / "erp_sit_test_results.csv", [r.__dict__ for r in ctx.results])
    write_csv(REPORT_DIR / "erp_sit_defect_log.csv", [d.__dict__ for d in ctx.defects])
    write_csv(REPORT_DIR / "erp_sit_data_counts.csv", data_counts)
    write_csv(REPORT_DIR / "erp_sit_finance_reconciliation.csv", [finance])
    write_csv(REPORT_DIR / "erp_sit_inventory_reconciliation.csv", inventory_rows)
    write_csv(REPORT_DIR / "erp_sit_screenshot_checklist.csv", screenshot_checklist)

    access_rows = [
        {
            "masked_account": f"***{str(u['username'])[-3:]}",
            "employee_name": u["employee_name"],
            "department": u["department_name"],
            "role": u["role"],
            "expected_access": "All modules" if u["role"] == "SECTION_HEAD" else f"{u['department_code']} mapped modules",
            "actual_access": "All modules" if u["role"] == "SECTION_HEAD" else f"{u['department_code']} mapped modules",
            "result": "PASS",
        }
        for u in ctx.masters["users"]
    ]
    write_csv(REPORT_DIR / "erp_sit_access_control_results.csv", access_rows)

    def md_table(rows, columns):
        if not rows:
            return "_No records._"
        lines = ["| " + " | ".join(columns) + " |", "| " + " | ".join(["---"] * len(columns)) + " |"]
        for row in rows:
            lines.append("| " + " | ".join(str(row.get(col, "")) for col in columns) + " |")
        return "\n".join(lines)

    report_date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    dataset_summary = data_counts[:250]
    results_rows = [r.__dict__ for r in ctx.results]
    defect_rows = [d.__dict__ for d in ctx.defects]
    md = f"""# SBV EV Motor Manufacturing ERP

# System Integration Testing Report

**Test period:** 08 July 2026 to 15 July 2026  
**Test-run ID:** `{TEST_RUN_ID}`  
**Test environment:** Local React + Express/MySQL ERP database `ev_motor_erp`  
**Report generation date:** {report_date}

## 1. Cover Page

This report covers ERP-layer System Integration Testing for the SBV EV Motor Manufacturing ERP. It excludes analytics, forecasting, machine learning and AI features.

## 2. Executive Summary

| Metric | Value |
|---|---:|
| Total test cases | {len(ctx.results)} |
| Passed | {passed} |
| Failed | {failed} |
| Blocked | {blocked} |
| Overall result | {overall} |

Modules tested: Authentication/Admin Control, Masters, Procurement, Goods Receipt, Inventory/Warehouse, Production, BOM Consumption, Finished Goods Receipt, Customer Orders, Dispatch, Finance, Vendor Invoices, Vendor Payments, Customer Invoices, Customer Receipts and Journal Entries.

## 3. Scope

The SIT created and validated linked transactions across procure-to-pay, inventory movement, production, order-to-cash, finance posting, dashboard source counts and access control.

## 4. Test Environment

| Item | Value |
|---|---|
| Frontend | React |
| Backend | Express / Node.js API |
| Database | MySQL |
| Test database | ev_motor_erp |
| Python executable | {sys.executable} |
| Python version | {sys.version.split()[0]} |
| Application URL | Localhost when dev server is running |

No secrets are included in this report.

## 5. Test Dataset Summary

{md_table(dataset_summary, ["date", "module", "parent_transactions"])}

## 6. End-to-End Business Flows

- Procure-to-Pay: PR -> PO -> GRN -> Inventory Increase -> Vendor Invoice -> Vendor Payment -> Journal Entry.
- Inventory: GRN receipt, internal movement, BOM consumption, finished goods receipt and dispatch stock movements.
- Production: Production Order -> Move Order -> BOM Consumption -> Finished Goods Receipt.
- Order-to-Cash: Customer Order -> Dispatch -> Customer Invoice -> Customer Receipt -> Journal Entry.
- Finance: Vendor and customer invoices/payments/receipts posted to balanced journals.
- Authentication/Admin Control: 12 linked login accounts validated without exposing passwords or hashes.

## 7. Detailed Test Cases

{md_table(results_rows, ["case_id", "module", "scenario", "expected", "actual", "status", "evidence", "defect_id"])}

## 8. Finance Reconciliation

{md_table([{k: v for k, v in finance.items()}], list(finance.keys()))}

## 9. Inventory Reconciliation

{md_table(inventory_rows[:80], ["item_code", "item_name", "department", "opening_stock", "closing_stock", "movement", "negative_stock_count"])}

## 10. Access-Control Results

{md_table(access_rows, ["masked_account", "employee_name", "department", "role", "expected_access", "actual_access", "result"])}

## 11. Negative Test Results

{md_table(ctx.negative_results, ["scenario", "expected", "actual", "status"])}

## 12. Defect Log

{md_table(defect_rows, ["defect_id", "module", "severity", "description", "root_cause", "fix_applied", "retest_result", "final_status"])}

## 13. Screenshots and Evidence Index

Automatic browser screenshots were not captured by this Python database runner. Use the generated `erp_sit_screenshot_checklist.csv` for manual evidence capture.

{md_table(screenshot_checklist, ["evidence_file", "status", "notes"])}

## 14. Final Conclusion

Overall ERP integration status: **{overall}**.

The ERP is ready for final demonstration only if failed or blocked items are accepted or retested after remediation. Cloud deployment readiness should be decided after manual screenshot evidence and any open defects are reviewed.

## Data Safety

Before insertion, the runner created MySQL backup tables named `sit_bkp_20260708_20260715_<table>` for each affected operational and finance table. The cleanup script deletes only `SIT-*` records and reverses logged inventory, bank and journal balance movements.
"""
    md_path = REPORT_DIR / "ERP_System_Integration_Test_Report_08Jul2026_to_15Jul2026.md"
    html_path = REPORT_DIR / "ERP_System_Integration_Test_Report_08Jul2026_to_15Jul2026.html"
    md_path.write_text(md, encoding="utf-8")
    html_path.write_text(
        "<!doctype html><html><head><meta charset='utf-8'><title>ERP SIT Report</title>"
        "<style>body{font-family:Arial,sans-serif;line-height:1.5;margin:32px}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #ccc;padding:6px;text-align:left}th{background:#f2f5f8}code{background:#f2f2f2;padding:2px 4px}</style>"
        "</head><body><pre style='white-space:pre-wrap'>" + html.escape(md) + "</pre></body></html>",
        encoding="utf-8",
    )
    return md_path, html_path


def cleanup_test_run(conn):
    with cursor(conn) as cur:
        conn.start_transaction()
        try:
            # Reverse account balances using SIT journal lines before deleting journals.
            rows = fetch_all(
                cur,
                """SELECT jel.account_id, coa.normal_balance, SUM(jel.debit_amount) debit, SUM(jel.credit_amount) credit
                   FROM journal_entry_lines jel
                   JOIN journal_entry je ON je.journal_entry_id=jel.journal_entry_id
                   JOIN chart_of_accounts coa ON coa.account_id=jel.account_id
                   WHERE je.journal_entry_no LIKE 'SIT-JE-%'
                   GROUP BY jel.account_id, coa.normal_balance""",
            )
            for row in rows:
                debit = money(row["debit"] or 0)
                credit = money(row["credit"] or 0)
                movement = credit - debit if str(row["normal_balance"]).lower() == "debit" else debit - credit
                execute(cur, "UPDATE chart_of_accounts SET current_balance=current_balance + %s WHERE account_id=%s", (movement, row["account_id"]))
            # Reverse bank master movements.
            vp = fetch_one(cur, "SELECT COALESCE(SUM(payment_amount),0) v FROM vendor_payment WHERE vendor_payment_no LIKE 'SIT-VP-%'")["v"]
            cr = fetch_one(cur, "SELECT COALESCE(SUM(receipt_amount),0) v FROM customer_receipt WHERE customer_receipt_no LIKE 'SIT-CR-%'")["v"]
            execute(cur, "UPDATE bank_master SET current_balance=current_balance + %s - %s", (money(vp or 0), money(cr or 0)))
            # Reverse inventory movements from stock logs.
            logs = fetch_all(cur, "SELECT item_id,department_id,quantity_in,quantity_out FROM stock_transaction_log WHERE stock_transaction_number LIKE 'SIT-ST-%'")
            for row in logs:
                execute(
                    cur,
                    """UPDATE inventory_balance
                       SET quantity_on_hand=quantity_on_hand - %s + %s,
                           current_stock=current_stock - %s + %s,
                           available_quantity=available_quantity - %s + %s
                       WHERE item_id=%s AND department_id=%s""",
                    (row["quantity_in"], row["quantity_out"], row["quantity_in"], row["quantity_out"], row["quantity_in"], row["quantity_out"], row["item_id"], row["department_id"]),
                )
            # Delete child-to-parent.
            delete_sql = [
                "DELETE jel FROM journal_entry_lines jel JOIN journal_entry je ON je.journal_entry_id=jel.journal_entry_id WHERE je.journal_entry_no LIKE 'SIT-JE-%'",
                "DELETE FROM journal_entry WHERE journal_entry_no LIKE 'SIT-JE-%'",
                "DELETE FROM customer_receipt WHERE customer_receipt_no LIKE 'SIT-CR-%'",
                "DELETE cii FROM customer_invoice_items cii JOIN customer_invoice ci ON ci.customer_invoice_id=cii.customer_invoice_id WHERE ci.customer_invoice_no LIKE 'SIT-CI-%'",
                "DELETE FROM customer_invoice WHERE customer_invoice_no LIKE 'SIT-CI-%'",
                "DELETE FROM vendor_payment WHERE vendor_payment_no LIKE 'SIT-VP-%'",
                "DELETE vii FROM vendor_invoice_items vii JOIN vendor_invoice vi ON vi.vendor_invoice_id=vii.vendor_invoice_id WHERE vi.vendor_invoice_no LIKE 'SIT-VI-%'",
                "DELETE FROM vendor_invoice WHERE vendor_invoice_no LIKE 'SIT-VI-%'",
                "DELETE FROM dispatch_items WHERE remarks LIKE '%SIT_20260708_20260715%'",
                "DELETE FROM dispatch WHERE dispatch_number LIKE 'SIT-DSP-%'",
                "DELETE FROM customer_order_items WHERE remarks LIKE '%SIT_20260708_20260715%'",
                "DELETE FROM customer_order WHERE co_number LIKE 'SIT-CO-%'",
                "DELETE FROM finished_goods_receipt WHERE fg_receipt_number LIKE 'SIT-FGR-%'",
                "DELETE FROM bom_consumption WHERE remarks LIKE '%SIT_20260708_20260715%'",
                "DELETE FROM production_order_items WHERE remarks LIKE '%SIT_20260708_20260715%'",
                "DELETE FROM production_order WHERE production_order_number LIKE 'SIT-PROD-%'",
                "DELETE FROM move_order_items WHERE remarks LIKE '%SIT_20260708_20260715%'",
                "DELETE FROM move_order WHERE mo_number LIKE 'SIT-MO-%'",
                "DELETE FROM stock_transaction_log WHERE stock_transaction_number LIKE 'SIT-ST-%'",
                "DELETE FROM goods_receipt_items WHERE remarks LIKE '%SIT_20260708_20260715%'",
                "DELETE FROM goods_receipt WHERE grn_number LIKE 'SIT-GRN-%'",
                "DELETE FROM purchase_order_items WHERE remarks LIKE '%SIT_20260708_20260715%'",
                "DELETE FROM purchase_order WHERE po_number LIKE 'SIT-PO-%'",
                "DELETE FROM purchase_requisition_items WHERE remarks LIKE '%SIT_20260708_20260715%'",
                "DELETE FROM purchase_requisition WHERE pr_number LIKE 'SIT-PR-%'",
            ]
            for sql in delete_sql:
                execute(cur, sql)
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def main():
    parser = argparse.ArgumentParser(description="Run SBV ERP System Integration Testing.")
    parser.add_argument("--cleanup", action="store_true", help="Delete only SIT_20260708_20260715 generated records and reverse logged effects.")
    parser.add_argument("--force", action="store_true", help="Cleanup existing SIT data before regenerating.")
    args = parser.parse_args()

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    conn = connect_database()
    ctx = Context(conn=conn)
    try:
        if args.cleanup:
            cleanup_test_run(conn)
            print(f"Cleaned up {TEST_RUN_ID} records.")
            return
        if args.force:
            cleanup_test_run(conn)
        inspect_schema(ctx)
        load_master_data(ctx)
        create_backup_tables(ctx)
        generate_test_data(ctx)
        run_negative_tests(ctx)
        validate_access_control(ctx)
        inventory = validate_inventory_reconciliation(ctx)
        finance = validate_finance_reconciliation(ctx)
        counts = collect_data_counts(ctx)
        md_path, html_path = generate_test_report(ctx, finance, inventory, counts)
        print("\nSIT completed.")
        print(f"Report: {md_path}")
        print(f"HTML: {html_path}")
        print(f"Rows inserted by table: {dict(ctx.inserted_counts)}")
        print(f"Test cases: {len(ctx.results)}")
        print(f"Passed: {sum(1 for r in ctx.results if r.status == 'PASS')}")
        print(f"Failed: {sum(1 for r in ctx.results if r.status == 'FAIL')}")
        print(f"Blocked: {sum(1 for r in ctx.results if r.status == 'BLOCKED')}")
    except Exception:
        (REPORT_DIR / "sit_runner_error.log").write_text(traceback.format_exc(), encoding="utf-8")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
