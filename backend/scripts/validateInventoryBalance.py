import csv
from collections import Counter, defaultdict
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEPARTMENT_CODES = {
    "2": "RMWH",
    "3": "STAT",
    "4": "ROTR",
    "5": "ASMB",
    "6": "FGWH",
}


def dec(value):
    try:
        return Decimal(str(value or "0"))
    except Exception:
        return Decimal("0")


def read_csv(path):
    with (ROOT / path).open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def main():
    items = {}
    for item_id, row in enumerate(read_csv("item_master_import.csv"), start=1):
        items[str(item_id)] = row

    rows = read_csv("inventory_balance.csv")
    by_department = Counter()
    value_by_item = defaultdict(Decimal)
    negative = []
    flagged = []
    below_reorder = []
    fg_wrong = []
    sfg_wrong = []
    raw_wrong = []
    orphaned = []
    formula_errors = []

    for row in rows:
        item = items.get(row["item_id"])
        department_code = DEPARTMENT_CODES.get(row["department_id"])
        quantity_on_hand = dec(row["quantity_on_hand"])
        reserved_quantity = dec(row["reserved_quantity"])
        available_quantity = dec(row["available_quantity"])
        reorder_level = dec(row["reorder_level"])
        inventory_value = dec(row["inventory_value"])

        if item and department_code:
            by_department[department_code] += 1
            value_by_item[item["item_code"]] += inventory_value
        else:
            orphaned.append(row)
            continue

        if quantity_on_hand < 0 or available_quantity < 0:
            negative.append(row)
        if row["status"].startswith("Data Issue"):
            flagged.append(row)
        if available_quantity <= reorder_level:
            below_reorder.append(row)
        if item["category"] == "Finished Goods" and department_code != "FGWH":
            fg_wrong.append(row)
        if item["category"].replace("-", " ") == "Semi Finished Goods":
            item_name = item["item_name"].lower()
            allowed = {"STAT", "ASMB"} if "stator" in item_name else {"ROTR", "ASMB"}
            if department_code not in allowed:
                sfg_wrong.append(row)
        if item["category"] != "Finished Goods" and department_code == "FGWH":
            raw_wrong.append(row)
        expected_value = (quantity_on_hand * dec(item["unit_cost"])).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if available_quantity != quantity_on_hand - reserved_quantity or inventory_value != expected_value:
            formula_errors.append(row)

    top_values = sorted(value_by_item.items(), key=lambda item: item[1], reverse=True)[:5]

    print("Inventory balance validation")
    print(f"department_wise_inventory_count: {dict(sorted(by_department.items()))}")
    print(f"top_5_item_values: {[(code, str(value.quantize(Decimal('0.01')))) for code, value in top_values]}")
    print(f"negative_stock_records: {len(negative)}")
    print(f"flagged_over_issue_records: {len(flagged)}")
    print(f"items_below_reorder_level: {len(below_reorder)}")
    print(f"finished_goods_wrongly_outside_fgwh: {len(fg_wrong)}")
    print(f"semi_finished_goods_wrong_location: {len(sfg_wrong)}")
    print(f"raw_materials_wrongly_in_fgwh: {len(raw_wrong)}")
    print(f"invalid_item_or_department_records: {len(orphaned)}")
    print(f"formula_errors: {len(formula_errors)}")


if __name__ == "__main__":
    main()
