import csv
import re
from collections import Counter, defaultdict
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEPARTMENTS = {
    "RMWH": {"department_id": 2, "location_id": "RMWH_STORE"},
    "STAT": {"department_id": 3, "location_id": "STAT_WIP"},
    "ROTR": {"department_id": 4, "location_id": "ROTR_WIP"},
    "ASMB": {"department_id": 5, "location_id": "ASMB_WIP"},
    "FGWH": {"department_id": 6, "location_id": "FGWH_STORE"},
}


def dec(value):
    try:
        return Decimal(str(value or "0"))
    except Exception:
        return Decimal("0")


def q3(value):
    return dec(value).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)


def q2(value):
    return dec(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def read_csv(path):
    with (ROOT / path).open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def load_items():
    items = {}
    for item_id, row in enumerate(read_csv("item_master_import.csv"), start=1):
        row["item_id"] = item_id
        items[item_id] = row
    return items


def load_item_stages():
    stages = defaultdict(Counter)
    for row in read_csv("bom_master.csv"):
        stages[int(row["component_item_id"])][row["production_stage"]] += 1
    return stages


def is_semi_finished(item_id, items):
    return items and item_id in items and items[item_id].get("category", "").strip().lower().replace("-", " ") == "semi finished goods"


def consuming_department(item_id, finished_goods, item_stages, items=None):
    if item_id in finished_goods:
        return "FGWH"
    if is_semi_finished(item_id, items):
        item_name = items[item_id]["item_name"].lower()
        return "STAT" if "stator" in item_name else "ROTR"

    stage_text = " ".join(item_stages.get(item_id, Counter()).elements()).lower()
    item_text = ""
    if items and item_id in items:
        item = items[item_id]
        item_text = " ".join([
            item.get("item_code", ""),
            item.get("item_name", ""),
            item.get("item_description", ""),
            item.get("category", ""),
        ]).lower()
    has_stator = "stator" in stage_text
    has_rotor = "rotor" in stage_text
    has_assembly = any(token in stage_text for token in ["final", "assembly", "testing", "packing"])

    if has_stator and not has_rotor and not has_assembly:
        return "STAT"
    if has_rotor and not has_stator and not has_assembly:
        return "ROTR"
    if has_stator:
        return "STAT"
    if has_rotor:
        return "ROTR"
    if "stator" in item_text or "copper wire" in item_text or "slot" in item_text or "varnish" in item_text:
        return "STAT"
    if "rotor" in item_text or "magnet" in item_text or "shaft" in item_text or "bearing" in item_text:
        return "ROTR"
    return "ASMB"


def map_location(value, item_id, finished_goods, item_stages, items=None):
    text = (value or "").lower()
    if any(token in text for token in ["dispatch", "finished goods", "fg store"]):
        return "FGWH"
    if any(token in text for token in ["raw material", "central warehouse"]):
        return "RMWH"
    if any(token in text for token in ["stator", "winding", "impregnation", "core stacking", "electrical store"]):
        return "STAT"
    if any(token in text for token in ["rotor", "magnet"]):
        return "ROTR"
    if any(token in text for token in ["assembly", "final", "packing", "end of line", "harness", "quality"]):
        return "ASMB"
    return consuming_department(item_id, finished_goods, item_stages, items)


def read_seed_move_order_items():
    csv_path = ROOT / "move_order_items.csv"
    if csv_path.exists():
        return [
            [
                row["mo_item_id"],
                row["mo_id"],
                row["item_id"],
                row["requested_quantity"],
                row["issued_quantity"],
                row["uom"],
                row["unit_cost"],
                row["line_amount"],
                row["source_location"],
                row["destination_location"],
                row["required_date"],
                row["movement_date"],
                row["remarks"],
            ]
            for row in read_csv("move_order_items.csv")
        ]

    sql_path = ROOT / "backend/sql/seed_move_order_items.sql"
    sql = sql_path.read_text(encoding="utf-8")
    rows = []
    for raw_values in re.findall(r"\((.*?)\)(?:,|;)", sql, flags=re.S):
        normalized_values = " ".join(raw_values.splitlines())
        row = next(csv.reader([normalized_values], quotechar="'", skipinitialspace=True))
        if row and row[0].strip().isdigit():
            rows.append(row)
    return rows


def add_delta(deltas, item_id, department_code, quantity):
    if department_code in DEPARTMENTS and quantity:
        deltas[(item_id, department_code)] += q3(quantity)


def build_inventory():
    items = load_items()
    finished_goods = {
        item_id
        for item_id, item in items.items()
        if item["category"].strip().lower() == "finished goods"
    }
    semi_finished_goods = {
        item_id
        for item_id, item in items.items()
        if item["category"].strip().lower().replace("-", " ") == "semi finished goods"
    }
    item_stages = load_item_stages()
    deltas = defaultdict(Decimal)
    reservations = defaultdict(Decimal)
    skipped = Counter()

    for row in read_csv("goods_receipt_items.csv"):
        item_id = int(row["item_id"])
        if item_id in finished_goods or item_id in semi_finished_goods or row["quality_status"] == "Rejected":
            skipped["invalid_or_rejected_grn"] += 1
            continue
        quantity = dec(row["accepted_quantity"]) or dec(row["received_quantity"])
        add_delta(deltas, item_id, "RMWH", quantity)

    move_headers = {
        int(row["move_order_id"]): row
        for row in read_csv("move_order.csv")
    }
    for values in read_seed_move_order_items():
        move_order_id = int(values[1])
        item_id = int(values[2])
        quantity = dec(values[4])
        source_location = values[8]
        destination_location = values[9]
        status = move_headers.get(move_order_id, {}).get("move_status", "")
        source_department = map_location(source_location, item_id, finished_goods, item_stages, items)
        destination_department = map_location(destination_location, item_id, finished_goods, item_stages, items)
        item_home_department = consuming_department(item_id, finished_goods, item_stages, items)
        if item_id not in finished_goods and item_id not in semi_finished_goods:
            if source_department != "RMWH":
                source_department = item_home_department
            if destination_department != "RMWH":
                destination_department = item_home_department

        if status in {"Requested", "Approved"} and item_id not in finished_goods:
            reservations[(item_id, source_department)] += quantity
            continue
        if status not in {"Completed", "In Transit"}:
            continue

        if item_id in finished_goods:
            if status == "Completed" and destination_department == "FGWH":
                add_delta(deltas, item_id, "FGWH", quantity)
            continue

        if source_department == "FGWH" or destination_department == "FGWH":
            skipped["non_fg_move_to_or_from_fgwh"] += 1
            continue
        if source_department != destination_department:
            add_delta(deltas, item_id, source_department, -quantity)
            if status == "Completed":
                add_delta(deltas, item_id, destination_department, quantity)

    consumable_statuses = {"Issued", "Consumed", "Partially Consumed", "Closed"}
    for row in read_csv("bom_consumption.csv"):
        if row["transaction_status"] not in consumable_statuses:
            continue
        item_id = int(row["consumed_item_id"])
        if item_id in finished_goods:
            skipped["fg_consumption_row"] += 1
            continue
        quantity = dec(row["actual_consumed_quantity"]) or dec(row["issued_quantity"])
        quantity = max(Decimal("0"), quantity - dec(row["returned_quantity"]))
        department = "ASMB" if item_id in semi_finished_goods else consuming_department(item_id, finished_goods, item_stages, items)
        add_delta(deltas, item_id, department, -quantity)

    for row in read_csv("finished_goods_receipt.csv"):
        item_id = int(row["finished_item_id"])
        if item_id not in finished_goods and item_id not in semi_finished_goods:
            skipped["invalid_or_rejected_fg_receipt"] += 1
            continue
        if row["inspection_status"] == "Rejected":
            skipped["invalid_or_rejected_fg_receipt"] += 1
            continue
        quantity = dec(row["accepted_quantity"]) or dec(row["received_quantity"])
        receipt_department = "FGWH" if item_id in finished_goods else consuming_department(item_id, finished_goods, item_stages, items)
        add_delta(deltas, item_id, receipt_department, quantity)

    dispatch_status = {
        int(row["dispatch_id"]): row["status"]
        for row in read_csv("backend/dispatch.csv")
    }
    for row in read_csv("backend/dispatch_items.csv"):
        if dispatch_status.get(int(row["dispatch_id"])) in {"Cancelled", "Returned"}:
            continue
        item_id = int(row["item_id"])
        if item_id not in finished_goods:
            skipped["non_fg_dispatch_item"] += 1
            continue
        add_delta(deltas, item_id, "FGWH", -dec(row["dispatched_quantity"]))

    rows = []
    for index, ((item_id, department_code), net_quantity) in enumerate(sorted(deltas.items()), start=1):
        item = items[item_id]
        shortage = abs(net_quantity) if net_quantity < 0 else Decimal("0")
        quantity_on_hand = max(Decimal("0"), net_quantity)
        reserved_quantity = min(quantity_on_hand, reservations.get((item_id, department_code), Decimal("0")))
        available_quantity = quantity_on_hand - reserved_quantity

        if quantity_on_hand == 0 and shortage == 0:
            continue

        stock_factor = {
            "RMWH": Decimal("1.00"),
            "STAT": Decimal("0.35"),
            "ROTR": Decimal("0.35"),
            "ASMB": Decimal("0.35"),
            "FGWH": Decimal("1.00"),
        }[department_code]
        reorder_level = q3(dec(item["reorder_level"]) * stock_factor)
        safety_stock = q3(dec(item["safety_stock"]) * stock_factor)
        max_stock = q3(max(dec(item["maximum_stock"]) * stock_factor, quantity_on_hand))
        inventory_value = q2(quantity_on_hand * dec(item["unit_cost"]))
        status = "Data Issue - Over Issued" if shortage else ("Below Reorder" if quantity_on_hand <= reorder_level else "Active")

        rows.append({
            "inventory_id": index,
            "balance_id": index,
            "item_id": item_id,
            "department_id": DEPARTMENTS[department_code]["department_id"],
            "location_id": DEPARTMENTS[department_code]["location_id"],
            "warehouse_location": DEPARTMENTS[department_code]["location_id"],
            "quantity_on_hand": f"{q3(quantity_on_hand)}",
            "reserved_quantity": f"{q3(reserved_quantity)}",
            "available_quantity": f"{q3(available_quantity)}",
            "reorder_level": f"{reorder_level}",
            "safety_stock": f"{safety_stock}",
            "max_stock": f"{max_stock}",
            "current_stock": f"{q3(quantity_on_hand)}",
            "inventory_value": f"{inventory_value}",
            "last_updated": "2026-07-08",
            "status": status,
            "data_issue_quantity": f"{q3(shortage)}",
        })
    return rows, skipped


def write_csv(rows):
    headers = [
        "inventory_id",
        "balance_id",
        "item_id",
        "department_id",
        "location_id",
        "warehouse_location",
        "quantity_on_hand",
        "reserved_quantity",
        "available_quantity",
        "reorder_level",
        "safety_stock",
        "max_stock",
        "current_stock",
        "inventory_value",
        "last_updated",
        "status",
        "data_issue_quantity",
    ]
    with (ROOT / "inventory_balance.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


def sql_value(value):
    if value is None or value == "":
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def write_seed_sql(rows):
    columns = [
        "balance_id",
        "item_id",
        "department_id",
        "location_id",
        "warehouse_location",
        "quantity_on_hand",
        "reserved_quantity",
        "available_quantity",
        "reorder_level",
        "safety_stock",
        "max_stock",
        "current_stock",
        "inventory_value",
        "last_updated",
        "status",
        "data_issue_quantity",
    ]
    lines = [
        "SET FOREIGN_KEY_CHECKS = 0;",
        "TRUNCATE TABLE inventory_balance;",
        "SET FOREIGN_KEY_CHECKS = 1;",
        "",
        "INSERT INTO inventory_balance",
        f"  ({', '.join(columns)})",
        "VALUES",
    ]
    values = []
    for row in rows:
        values.append("  (" + ", ".join(sql_value(row[column]) for column in columns) + ")")
    lines.append(",\n".join(values) + ";")
    (ROOT / "backend/sql/seed_inventory_balance.sql").write_text("\n".join(lines) + "\n", encoding="utf-8")


def print_summary(rows, skipped):
    by_department = Counter(row["warehouse_location"] for row in rows)
    total_value = sum(dec(row["inventory_value"]) for row in rows)
    issue_rows = sum(1 for row in rows if row["status"].startswith("Data Issue"))
    print("Inventory balance regenerated")
    print(f"records: {len(rows)}")
    print(f"department_counts: {dict(by_department)}")
    print(f"inventory_value: {q2(total_value)}")
    print(f"data_issue_records: {issue_rows}")
    print(f"skipped_source_rows: {dict(skipped)}")


def main():
    rows, skipped = build_inventory()
    write_csv(rows)
    write_seed_sql(rows)
    print_summary(rows, skipped)


if __name__ == "__main__":
    main()
