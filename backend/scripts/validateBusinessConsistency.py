import csv
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read_csv(path):
    with (ROOT / path).open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def parse_date(value):
    if not value:
        return None
    return date.fromisoformat(value[:10])


def main():
    issues = Counter()
    samples = defaultdict(list)

    items = {str(index): row for index, row in enumerate(read_csv("item_master_import.csv"), start=1)}
    item_ids = set(items)
    departments = {"1", "2", "3", "4", "5", "6"}

    pr = {row["pr_id"]: row for row in read_csv("purchase_requisition.csv")}
    po = {row["po_id"]: row for row in read_csv("purchase_order.csv")}
    grn = {row["grn_id"]: row for row in read_csv("goods_receipt.csv")}
    prod = {row["production_order_id"]: row for row in read_csv("production_order.csv")}
    poi = {row["production_order_item_id"]: row for row in read_csv("production_order_items.csv")}
    co = {row["co_id"]: row for row in read_csv("customer_order.csv")}
    dispatch = {row["dispatch_id"]: row for row in read_csv("backend/dispatch.csv")}

    for row in po.values():
        parent = pr.get(row["pr_id"])
        if parent and parse_date(parent["pr_date"]) and parse_date(row["po_date"]) and parse_date(parent["pr_date"]) > parse_date(row["po_date"]):
            issues["po_before_pr"] += 1
            samples["po_before_pr"].append(row["po_id"])

    for row in grn.values():
        parent = po.get(row["po_id"])
        if parent and parse_date(parent["po_date"]) and parse_date(row["received_date"]) and parse_date(parent["po_date"]) > parse_date(row["received_date"]):
            issues["grn_before_po"] += 1
            samples["grn_before_po"].append(row["grn_id"])

    for row in read_csv("goods_receipt_items.csv"):
        if row["item_id"] not in item_ids:
            issues["grn_item_invalid_item"] += 1

    for row in read_csv("move_order.csv"):
        if row["requested_by"] == "" or row["approved_by"] == "":
            issues["move_order_missing_employee"] += 1

    for row in read_csv("move_order_items.csv"):
        if row["item_id"] not in item_ids:
            issues["move_item_invalid_item"] += 1
        header = next((mo for mo in read_csv("move_order.csv") if mo["move_order_id"] == row["mo_id"]), None)
        if header and parse_date(row["movement_date"]) and parse_date(header["move_order_date"]) and parse_date(row["movement_date"]) < parse_date(header["move_order_date"]):
            issues["move_item_before_move_order"] += 1
            samples["move_item_before_move_order"].append(row["mo_item_id"])

    for row in prod.values():
        if row["finished_item_id"] not in item_ids:
            issues["production_invalid_item"] += 1
        if row["department_id"] not in departments:
            issues["production_invalid_department"] += 1
        if parse_date(row["actual_start_date"]) and parse_date(row["planned_start_date"]) and parse_date(row["actual_start_date"]) < parse_date(row["planned_start_date"]):
            issues["production_actual_before_planned"] += 1

    for row in poi.values():
        if row["item_id"] not in item_ids:
            issues["production_item_invalid_item"] += 1
        parent = prod.get(row["production_order_id"])
        if parent and row["item_id"] != parent["finished_item_id"]:
            issues["production_item_output_mismatch"] += 1

    for row in read_csv("bom_master.csv"):
        parent = items.get(row["parent_item_id"])
        component = items.get(row["component_item_id"])
        if not parent or not component:
            issues["bom_invalid_item_reference"] += 1
        if parent and parent["category"] == "Finished Goods" and row["production_stage"] in {"Stator Assembly", "Rotor Assembly"}:
            issues["fg_bom_direct_stator_rotor_raw_stage"] += 1

    for row in read_csv("bom_consumption.csv"):
        if row["finished_item_id"] not in item_ids or row["consumed_item_id"] not in item_ids:
            issues["consumption_invalid_item"] += 1
        parent = poi.get(row["production_order_item_id"])
        if parent and parse_date(row["consumption_date"]) and parse_date(parent["created_at"]) and parse_date(row["consumption_date"]) < parse_date(parent["created_at"]):
            issues["consumption_before_production_item"] += 1

    for row in read_csv("finished_goods_receipt.csv"):
        if row["finished_item_id"] not in item_ids:
            issues["receipt_invalid_item"] += 1
        parent = prod.get(row["production_order_id"])
        if parent and parse_date(parent["actual_start_date"]) and parse_date(row["receipt_date"]) and parse_date(parent["actual_start_date"]) > parse_date(row["receipt_date"]):
            issues["receipt_before_production"] += 1

    for row in dispatch.values():
        parent = co.get(row["co_id"])
        if parent and parse_date(parent["order_date"]) and parse_date(row["dispatch_date"]) and parse_date(parent["order_date"]) > parse_date(row["dispatch_date"]):
            issues["dispatch_before_customer_order"] += 1
            samples["dispatch_before_customer_order"].append(row["dispatch_id"])

    for row in read_csv("backend/dispatch_items.csv"):
        item = items.get(row["item_id"])
        if not item:
            issues["dispatch_invalid_item"] += 1
        elif item["category"] != "Finished Goods":
            issues["dispatch_non_finished_goods"] += 1

    print("ERP business consistency validation")
    print(f"issue_counts: {dict(sorted(issues.items()))}")
    print(f"sample_ids: {dict((key, value[:10]) for key, value in samples.items())}")


if __name__ == "__main__":
    main()
