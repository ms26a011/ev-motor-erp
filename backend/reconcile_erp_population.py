from __future__ import annotations

import csv
import sys
from datetime import timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent / ".python-packages"
if PACKAGE_DIR.exists():
    sys.path.insert(0, str(PACKAGE_DIR))

import pymysql


BASE_DIR = Path(__file__).resolve().parent
BACKUP_DIR = BASE_DIR / "generated_transaction_backups"


def read_env() -> dict[str, str]:
    values: dict[str, str] = {}
    for line in (BASE_DIR / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return {
        "host": values.get("DB_HOST", "localhost"),
        "user": values.get("DB_USER", "root"),
        "password": values.get("DB_PASSWORD", ""),
        "database": values.get("DB_NAME", "ev_motor_erp"),
        "port": values.get("DB_PORT", "3306"),
    }


def money(value) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def qty(value) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)


def append_csv(table: str, rows: list[dict]) -> None:
    if not rows:
        return
    path = BACKUP_DIR / f"{table}.csv"
    exists = path.exists() and path.stat().st_size > 0
    with path.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        if not exists:
            writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    cfg = read_env()
    conn = pymysql.connect(
        host=cfg["host"],
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        port=int(cfg["port"]),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
    )
    added_grns: list[dict] = []
    added_grn_items: list[dict] = []
    added_dispatch_items: list[dict] = []
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS c FROM goods_receipt_items")
            needed_gri = max(0, 4500 - int(cur.fetchone()["c"]))
            cur.execute("SELECT COALESCE(MAX(grn_item_id), 0) AS max_id FROM goods_receipt_items")
            grn_item_id = int(cur.fetchone()["max_id"])
            if needed_gri:
                cur.execute("SELECT COALESCE(MAX(grn_id), 0) AS max_id FROM goods_receipt")
                grn_id = int(cur.fetchone()["max_id"])
                cur.execute(
                    """
                    SELECT poi.po_item_id, poi.item_id, poi.ordered_quantity, poi.received_quantity,
                           poi.pending_quantity, poi.uom, poi.unit_price,
                           MIN(grn.grn_id) AS grn_id, MIN(grn.received_date) AS received_date
                    FROM purchase_order_items poi
                    JOIN purchase_order po ON po.po_id = poi.po_id
                    JOIN goods_receipt grn ON grn.po_id = po.po_id
                    WHERE poi.pending_quantity > 0
                      AND po.po_status NOT IN ('Draft', 'Cancelled')
                      AND po.approval_status = 'Approved'
                      AND po.po_status NOT IN ('Draft', 'Cancelled')
                      AND po.approval_status = 'Approved'
                      AND grn.grn_status = 'Accepted'
                    GROUP BY poi.po_item_id, poi.item_id, poi.ordered_quantity, poi.received_quantity,
                             poi.pending_quantity, poi.uom, poi.unit_price
                    ORDER BY poi.po_item_id
                    LIMIT %s
                    """,
                    (needed_gri,),
                )
                for row in cur.fetchall():
                    grn_item_id += 1
                    received = qty(row["pending_quantity"])
                    new_received = qty(Decimal(str(row["received_quantity"] or 0)) + received)
                    record = {
                        "grn_item_id": grn_item_id,
                        "grn_id": row["grn_id"],
                        "po_item_id": row["po_item_id"],
                        "item_id": row["item_id"],
                        "ordered_quantity": qty(row["ordered_quantity"]),
                        "received_quantity": received,
                        "accepted_quantity": received,
                        "rejected_quantity": Decimal("0.000"),
                        "uom": row["uom"],
                        "unit_price": money(row["unit_price"]),
                        "batch_number": f"RM-TOP-{grn_item_id:07d}",
                        "manufacturing_date": row["received_date"] - timedelta(days=45),
                        "expiry_date": row["received_date"] + timedelta(days=365),
                        "quality_status": "Accepted",
                        "rejection_reason": None,
                        "storage_location": "Central Stores",
                        "remarks": "Reconciled GRN item generated from open PO balance.",
                    }
                    added_grn_items.append(record)
                    cur.execute(
                        """
                        INSERT INTO goods_receipt_items
                        (grn_item_id, grn_id, po_item_id, item_id, ordered_quantity, received_quantity,
                         accepted_quantity, rejected_quantity, uom, unit_price, batch_number,
                         manufacturing_date, expiry_date, quality_status, rejection_reason, storage_location, remarks)
                        VALUES
                        (%(grn_item_id)s, %(grn_id)s, %(po_item_id)s, %(item_id)s, %(ordered_quantity)s,
                         %(received_quantity)s, %(accepted_quantity)s, %(rejected_quantity)s, %(uom)s,
                         %(unit_price)s, %(batch_number)s, %(manufacturing_date)s, %(expiry_date)s,
                         %(quality_status)s, %(rejection_reason)s, %(storage_location)s, %(remarks)s)
                        """,
                        record,
                    )
                    cur.execute(
                        """
                        UPDATE purchase_order_items
                        SET received_quantity=%s, pending_quantity=0, line_status='Fully Received'
                        WHERE po_item_id=%s
                        """,
                        (new_received, row["po_item_id"]),
                    )
                    cur.execute(
                        """
                        UPDATE inventory_balance ib
                        SET ib.current_stock = ib.current_stock + %s, ib.last_updated = CURDATE()
                        WHERE ib.item_id=%s AND ib.department_id=3
                        LIMIT 1
                        """,
                        (received, row["item_id"]),
                    )
            remaining_gri = max(0, needed_gri - len(added_grn_items))
            if remaining_gri:
                cur.execute(
                    """
                    SELECT poi.po_item_id, poi.item_id, poi.ordered_quantity, poi.received_quantity,
                           poi.pending_quantity, poi.uom, poi.unit_price,
                           po.po_id, po.vendor_id, po.po_date, po.expected_delivery_date
                    FROM purchase_order_items poi
                    JOIN purchase_order po ON po.po_id = poi.po_id
                    WHERE poi.pending_quantity > 0
                      AND po.po_status NOT IN ('Draft', 'Cancelled')
                      AND po.approval_status = 'Approved'
                    ORDER BY poi.po_item_id
                    LIMIT %s
                    """,
                    (remaining_gri,),
                )
                for row in cur.fetchall():
                    grn_id += 1
                    grn_item_id += 1
                    received_date = max(row["expected_delivery_date"], row["po_date"] + timedelta(days=7))
                    grn = {
                        "grn_id": grn_id,
                        "grn_number": f"GRN-{received_date.year}-{grn_id:04d}",
                        "po_id": row["po_id"],
                        "vendor_id": row["vendor_id"],
                        "received_date": received_date,
                        "invoice_number": f"INV-TOP-{grn_id:06d}",
                        "invoice_date": received_date - timedelta(days=1),
                        "delivery_challan_number": f"DC-TOP-{grn_id:06d}",
                        "received_by": 1,
                        "warehouse_location": "Central Stores",
                        "inspection_required": "Yes",
                        "grn_status": "Accepted",
                        "remarks": "Reconciled goods receipt for open PO balance.",
                    }
                    received = qty(row["pending_quantity"])
                    new_received = qty(Decimal(str(row["received_quantity"] or 0)) + received)
                    item = {
                        "grn_item_id": grn_item_id,
                        "grn_id": grn_id,
                        "po_item_id": row["po_item_id"],
                        "item_id": row["item_id"],
                        "ordered_quantity": qty(row["ordered_quantity"]),
                        "received_quantity": received,
                        "accepted_quantity": received,
                        "rejected_quantity": Decimal("0.000"),
                        "uom": row["uom"],
                        "unit_price": money(row["unit_price"]),
                        "batch_number": f"RM-TOP-{grn_item_id:07d}",
                        "manufacturing_date": received_date - timedelta(days=45),
                        "expiry_date": received_date + timedelta(days=365),
                        "quality_status": "Accepted",
                        "rejection_reason": None,
                        "storage_location": "Central Stores",
                        "remarks": "Reconciled GRN item generated from open PO balance.",
                    }
                    added_grns.append(grn)
                    added_grn_items.append(item)
                    cur.execute(
                        """
                        INSERT INTO goods_receipt
                        (grn_id, grn_number, po_id, vendor_id, received_date, invoice_number,
                         invoice_date, delivery_challan_number, received_by, warehouse_location,
                         inspection_required, grn_status, remarks)
                        VALUES
                        (%(grn_id)s, %(grn_number)s, %(po_id)s, %(vendor_id)s, %(received_date)s,
                         %(invoice_number)s, %(invoice_date)s, %(delivery_challan_number)s,
                         %(received_by)s, %(warehouse_location)s, %(inspection_required)s,
                         %(grn_status)s, %(remarks)s)
                        """,
                        grn,
                    )
                    cur.execute(
                        """
                        INSERT INTO goods_receipt_items
                        (grn_item_id, grn_id, po_item_id, item_id, ordered_quantity, received_quantity,
                         accepted_quantity, rejected_quantity, uom, unit_price, batch_number,
                         manufacturing_date, expiry_date, quality_status, rejection_reason, storage_location, remarks)
                        VALUES
                        (%(grn_item_id)s, %(grn_id)s, %(po_item_id)s, %(item_id)s, %(ordered_quantity)s,
                         %(received_quantity)s, %(accepted_quantity)s, %(rejected_quantity)s, %(uom)s,
                         %(unit_price)s, %(batch_number)s, %(manufacturing_date)s, %(expiry_date)s,
                         %(quality_status)s, %(rejection_reason)s, %(storage_location)s, %(remarks)s)
                        """,
                        item,
                    )
                    cur.execute(
                        """
                        UPDATE purchase_order_items
                        SET received_quantity=%s, pending_quantity=0, line_status='Fully Received'
                        WHERE po_item_id=%s
                        """,
                        (new_received, row["po_item_id"]),
                    )
                    cur.execute(
                        """
                        UPDATE inventory_balance ib
                        SET ib.current_stock = ib.current_stock + %s, ib.last_updated = CURDATE()
                        WHERE ib.item_id=%s AND ib.department_id=3
                        LIMIT 1
                        """,
                        (received, row["item_id"]),
                    )

            cur.execute("SELECT COUNT(*) AS c FROM dispatch_items")
            needed_di = max(0, 5000 - int(cur.fetchone()["c"]))
            cur.execute("SELECT COALESCE(MAX(dispatch_item_id), 0) AS max_id FROM dispatch_items")
            dispatch_item_id = int(cur.fetchone()["max_id"])
            used_pairs = set()
            if needed_di:
                cur.execute("SELECT dispatch_id, co_item_id FROM dispatch_items")
                used_pairs = {(int(r["dispatch_id"]), int(r["co_item_id"])) for r in cur.fetchall()}
                cur.execute(
                    """
                    SELECT d.dispatch_id, d.co_id, coi.co_item_id, coi.item_id, coi.ordered_quantity,
                           coi.dispatched_quantity, coi.pending_quantity, im.item_name, im.uom, im.unit_cost
                    FROM dispatch d
                    JOIN customer_order_items coi ON coi.co_id = d.co_id
                    JOIN item_master im ON im.item_id = coi.item_id
                    WHERE d.status <> 'Cancelled' AND coi.pending_quantity > 0
                    ORDER BY d.dispatch_id, coi.co_item_id
                    """
                )
                pending_left: dict[int, Decimal] = {}
                dispatched_now: dict[int, Decimal] = {}
                for row in cur.fetchall():
                    if len(added_dispatch_items) >= needed_di:
                        break
                    pair = (int(row["dispatch_id"]), int(row["co_item_id"]))
                    if pair in used_pairs:
                        continue
                    remaining = pending_left.setdefault(
                        int(row["co_item_id"]), qty(row["pending_quantity"])
                    )
                    if remaining <= 0:
                        continue
                    qdispatch = min(remaining, Decimal("7.000"))
                    pending_left[int(row["co_item_id"])] = remaining - qdispatch
                    dispatched_now[int(row["co_item_id"])] = dispatched_now.get(
                        int(row["co_item_id"]), Decimal("0.000")
                    ) + qdispatch
                    dispatch_item_id += 1
                    unit_price = money(Decimal(str(row["unit_cost"] or 1)) * Decimal("1.25"))
                    record = {
                        "dispatch_item_id": dispatch_item_id,
                        "dispatch_id": row["dispatch_id"],
                        "co_item_id": row["co_item_id"],
                        "item_id": row["item_id"],
                        "item_description": row["item_name"],
                        "uom": row["uom"],
                        "ordered_quantity": qty(row["ordered_quantity"]),
                        "dispatched_quantity": qdispatch,
                        "unit_price": unit_price,
                        "line_amount": money(qdispatch * unit_price),
                        "batch_no": f"FG-TOP-{dispatch_item_id:07d}",
                        "serial_no": f"SN-TOP-{dispatch_item_id:07d}",
                        "remarks": "Reconciled dispatch item from open customer order balance.",
                    }
                    added_dispatch_items.append(record)
                    used_pairs.add(pair)
                    cur.execute(
                        """
                        INSERT INTO dispatch_items
                        (dispatch_item_id, dispatch_id, co_item_id, item_id, item_description, uom,
                         ordered_quantity, dispatched_quantity, unit_price, line_amount, batch_no, serial_no, remarks)
                        VALUES
                        (%(dispatch_item_id)s, %(dispatch_id)s, %(co_item_id)s, %(item_id)s,
                         %(item_description)s, %(uom)s, %(ordered_quantity)s, %(dispatched_quantity)s,
                         %(unit_price)s, %(line_amount)s, %(batch_no)s, %(serial_no)s, %(remarks)s)
                        """,
                        record,
                    )
                for co_item_id, shipped in dispatched_now.items():
                    cur.execute(
                        """
                        UPDATE customer_order_items
                        SET dispatched_quantity = dispatched_quantity + %s,
                            pending_quantity = pending_quantity - %s
                        WHERE co_item_id=%s
                        """,
                        (shipped, shipped, co_item_id),
                    )

            checks = {
                "orphan_grn_items": "SELECT COUNT(*) c FROM goods_receipt_items gri LEFT JOIN goods_receipt grn ON grn.grn_id=gri.grn_id WHERE grn.grn_id IS NULL",
                "orphan_dispatch_items": "SELECT COUNT(*) c FROM dispatch_items di LEFT JOIN dispatch d ON d.dispatch_id=di.dispatch_id WHERE d.dispatch_id IS NULL",
                "dispatch_over_order": "SELECT COUNT(*) c FROM (SELECT di.co_item_id, SUM(di.dispatched_quantity) dq, MAX(coi.ordered_quantity) oq FROM dispatch_items di JOIN customer_order_items coi ON coi.co_item_id=di.co_item_id GROUP BY di.co_item_id HAVING dq > oq) x",
                "negative_stock": "SELECT COUNT(*) c FROM inventory_balance WHERE current_stock < 0",
                "grn_amount_mismatch": "SELECT COUNT(*) c FROM goods_receipt_items WHERE received_quantity <= 0 OR accepted_quantity < 0",
                "dispatch_amount_mismatch": "SELECT COUNT(*) c FROM dispatch_items WHERE ABS(line_amount - ROUND(dispatched_quantity * unit_price, 2)) > 0.05",
            }
            errors = {}
            for name, sql in checks.items():
                cur.execute(sql)
                value = int(cur.fetchone()["c"])
                if value:
                    errors[name] = value
            if errors:
                raise RuntimeError(f"Validation failed: {errors}")
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    append_csv("goods_receipt", added_grns)
    append_csv("goods_receipt_items", added_grn_items)
    append_csv("dispatch_items", added_dispatch_items)

    conn = pymysql.connect(
        host=cfg["host"],
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        port=int(cfg["port"]),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )
    try:
        with conn.cursor() as cur:
            for table in [
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
            ]:
                cur.execute(f"SELECT COUNT(*) AS c FROM {table}")
                print(f"{table}: {cur.fetchone()['c']}")
    finally:
        conn.close()

    print(f"Added GRN rows: {len(added_grns)}")
    print(f"Added GRN item rows: {len(added_grn_items)}")
    print(f"Added dispatch item rows: {len(added_dispatch_items)}")


if __name__ == "__main__":
    main()
