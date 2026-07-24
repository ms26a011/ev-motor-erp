import csv
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]

SFG_ITEMS = [
    ("SFG-ST15", "Finished Stator 1.5kW", "Semi-finished stator assembly for 1.5kW EV motor", "Semi-Finished Goods", "No", "5200", "120", "60", "360", "Critical", "Active"),
    ("SFG-ST30", "Finished Stator 3kW", "Semi-finished stator assembly for 3kW EV motor", "Semi-Finished Goods", "No", "7800", "90", "45", "270", "Critical", "Active"),
    ("SFG-ST75", "Finished Stator 7.5kW", "Semi-finished stator assembly for 7.5kW EV motor", "Semi-Finished Goods", "No", "15500", "45", "22", "135", "Critical", "Active"),
    ("SFG-RT15", "Finished Rotor 1.5kW", "Semi-finished rotor assembly for 1.5kW EV motor", "Semi-Finished Goods", "No", "4300", "120", "60", "360", "Critical", "Active"),
    ("SFG-RT30", "Finished Rotor 3kW", "Semi-finished rotor assembly for 3kW EV motor", "Semi-Finished Goods", "No", "6900", "90", "45", "270", "Critical", "Active"),
    ("SFG-RT75", "Finished Rotor 7.5kW", "Semi-finished rotor assembly for 7.5kW EV motor", "Semi-Finished Goods", "No", "13600", "45", "22", "135", "Critical", "Active"),
]

SFG_ID = {
    "SFG-ST15": 103,
    "SFG-ST30": 104,
    "SFG-ST75": 105,
    "SFG-RT15": 106,
    "SFG-RT30": 107,
    "SFG-RT75": 108,
}

FG_TO_SFG = {
    100: (103, 106),
    101: (104, 107),
    102: (105, 108),
}

COMPONENT_OUTPUT_TO_SFG = {
    1: 103,
    2: 104,
    3: 105,
    4: 106,
    13: 106,
    5: 107,
    14: 107,
    6: 108,
    15: 108,
}


def dec(value):
    try:
        return Decimal(str(value or "0"))
    except Exception:
        return Decimal("0")


def fmt(value):
    return str(dec(value).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP))


def read_csv(path):
    with (ROOT / path).open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def write_csv(path, rows, fieldnames):
    with (ROOT / path).open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def item_index(rows):
    return {index: row for index, row in enumerate(rows, start=1)}


def add_sfg_items(report):
    rows = read_csv("item_master_import.csv")
    fieldnames = rows[0].keys()
    existing_codes = {row["item_code"] for row in rows}
    by_code = {row["item_code"]: row for row in rows}
    added = 0
    for item in SFG_ITEMS:
        if item[0] in existing_codes:
            by_code[item[0]].update(dict(zip(fieldnames, item)))
        else:
            rows.append(dict(zip(fieldnames, item)))
            added += 1
    write_csv("item_master_import.csv", rows, fieldnames)
    report["sfg_items_added"] = added


def repair_bom(report):
    rows = read_csv("bom_master.csv")
    fieldnames = rows[0].keys()
    items = item_index(read_csv("item_master_import.csv"))
    stage_by_component = {}
    source_rows = []

    for row in rows:
        parent_id = int(row["parent_item_id"])
        component_id = int(row["component_item_id"])
        stage = row["production_stage"]
        if parent_id in FG_TO_SFG:
            stage_by_component[(parent_id, component_id)] = stage
            if stage in {"Stator Assembly", "Rotor Assembly"}:
                source_rows.append(row)

    repaired = [
        row for row in rows
        if not (
            int(row["parent_item_id"]) in FG_TO_SFG
            and row["production_stage"] in {"Stator Assembly", "Rotor Assembly"}
        )
    ]

    existing_pairs = {(int(row["parent_item_id"]), int(row["component_item_id"]), row["production_stage"]) for row in repaired}

    def add_bom(parent_id, component_id, stage, quantity="1.000", scrap="0.50", remarks="Business consistency repair"):
        pair = (parent_id, component_id, stage)
        if pair in existing_pairs:
            return False
        item = items[component_id]
        repaired.append({
            "bom_id": "",
            "bom_code": f"BOM-{items[parent_id]['item_code']}-{component_id:03d}",
            "parent_item_id": str(parent_id),
            "component_item_id": str(component_id),
            "component_name": item["item_name"],
            "component_category": item["category"],
            "specification": item["item_description"],
            "quantity_per_unit": quantity,
            "uom": item["uom"],
            "scrap_factor_percent": scrap,
            "production_stage": stage,
            "effective_from": "2025-01-01",
            "effective_to": "",
            "status": "Active",
            "remarks": remarks,
            "created_at": "2025-01-01 09:00:00",
            "updated_at": "2026-07-08 09:00:00",
        })
        existing_pairs.add(pair)
        return True

    added = 0
    for fg_id, (stator_sfg, rotor_sfg) in FG_TO_SFG.items():
        added += add_bom(fg_id, stator_sfg, "Final Motor Assembly", remarks="Final assembly consumes finished stator SFG.") is True
        added += add_bom(fg_id, rotor_sfg, "Final Motor Assembly", remarks="Final assembly consumes finished rotor SFG.") is True

    for row in source_rows:
        parent_id = int(row["parent_item_id"])
        component_id = int(row["component_item_id"])
        stage = row["production_stage"]
        sfg_parent = FG_TO_SFG[parent_id][0 if stage == "Stator Assembly" else 1]
        added += add_bom(
            sfg_parent,
            component_id,
            stage,
            row["quantity_per_unit"],
            row["scrap_factor_percent"],
            "SFG BOM split from finished motor BOM.",
        ) is True

    for index, row in enumerate(repaired, start=1):
        row["bom_id"] = str(index)
        row["bom_code"] = f"BOM-{items[int(row['parent_item_id'])]['item_code']}-{index:03d}"

    write_csv("bom_master.csv", repaired, fieldnames)
    report["bom_rows_removed_from_fg_raw_stages"] = len(rows) - len([r for r in rows if int(r["parent_item_id"]) in FG_TO_SFG and r["production_stage"] in {"Stator Assembly", "Rotor Assembly"}])
    report["bom_rows_after_repair"] = len(repaired)
    report["bom_rows_added"] = added
    return stage_by_component


def repair_production_and_receipts(report):
    items = item_index(read_csv("item_master_import.csv"))

    production_rows = read_csv("production_order.csv")
    production_fields = production_rows[0].keys()
    production_changed = 0
    for row in production_rows:
        old_item_id = int(row["finished_item_id"])
        if old_item_id in COMPONENT_OUTPUT_TO_SFG:
            new_item_id = COMPONENT_OUTPUT_TO_SFG[old_item_id]
            row["finished_item_id"] = str(new_item_id)
            row["department_id"] = "3" if "Stator" in items[new_item_id]["item_name"] else "4"
            row["remarks"] = row["remarks"].replace(items.get(old_item_id, {}).get("item_name", ""), items[new_item_id]["item_name"])
            production_changed += 1
    write_csv("production_order.csv", production_rows, production_fields)

    poi_rows = read_csv("production_order_items.csv")
    poi_fields = poi_rows[0].keys()
    poi_changed = 0
    for row in poi_rows:
        old_item_id = int(row["item_id"])
        if old_item_id in COMPONENT_OUTPUT_TO_SFG:
            new_item_id = COMPONENT_OUTPUT_TO_SFG[old_item_id]
            row["item_id"] = str(new_item_id)
            row["production_stage"] = "Stator Assembly" if "Stator" in items[new_item_id]["item_name"] else "Rotor Assembly"
            row["remarks"] = f"Semi-finished output recorded for {items[new_item_id]['item_name']}."
            poi_changed += 1
    write_csv("production_order_items.csv", poi_rows, poi_fields)

    fgr_rows = read_csv("finished_goods_receipt.csv")
    fgr_fields = fgr_rows[0].keys()
    fgr_changed = 0
    for row in fgr_rows:
        old_item_id = int(row["finished_item_id"])
        if old_item_id in COMPONENT_OUTPUT_TO_SFG:
            new_item_id = COMPONENT_OUTPUT_TO_SFG[old_item_id]
            row["finished_item_id"] = str(new_item_id)
            row["warehouse_location"] = "STAT_WIP" if "Stator" in items[new_item_id]["item_name"] else "ROTR_WIP"
            row["remarks"] = f"Semi-finished receipt for {items[new_item_id]['item_name']}."
            fgr_changed += 1
        elif old_item_id in FG_TO_SFG:
            row["warehouse_location"] = "FGWH_STORE"
    write_csv("finished_goods_receipt.csv", fgr_rows, fgr_fields)

    report["production_orders_remapped_to_sfg"] = production_changed
    report["production_order_items_remapped_to_sfg"] = poi_changed
    report["receipt_rows_remapped_to_sfg"] = fgr_changed


def repair_consumption(report, stage_by_component):
    items = item_index(read_csv("item_master_import.csv"))
    poi_by_id = {row["production_order_item_id"]: row for row in read_csv("production_order_items.csv")}
    rows = read_csv("bom_consumption.csv")
    fieldnames = rows[0].keys()
    output = []
    seen_sfg_for_final_order = set()
    removed_direct_raw = 0
    changed_finished_parent = 0
    changed_final_components = 0

    for row in rows:
        finished_item_id = int(row["finished_item_id"])
        consumed_item_id = int(row["consumed_item_id"])

        if finished_item_id in COMPONENT_OUTPUT_TO_SFG:
            new_item_id = COMPONENT_OUTPUT_TO_SFG[finished_item_id]
            row["finished_item_id"] = str(new_item_id)
            row["warehouse_location"] = "STAT_WIP" if "Stator" in items[new_item_id]["item_name"] else "ROTR_WIP"
            changed_finished_parent += 1
            output.append(row)
            continue

        if finished_item_id in FG_TO_SFG:
            stage = stage_by_component.get((finished_item_id, consumed_item_id), "")
            if stage in {"Stator Assembly", "Rotor Assembly"}:
                sfg_item = FG_TO_SFG[finished_item_id][0 if stage == "Stator Assembly" else 1]
                key = (row["production_order_item_id"], sfg_item)
                if key in seen_sfg_for_final_order:
                    removed_direct_raw += 1
                    continue
                seen_sfg_for_final_order.add(key)
                production_item = poi_by_id.get(row["production_order_item_id"], {})
                planned = dec(production_item.get("planned_quantity", row["planned_quantity"]))
                produced = dec(production_item.get("accepted_quantity", production_item.get("produced_quantity", row["actual_consumed_quantity"])))
                row["consumed_item_id"] = str(sfg_item)
                row["planned_quantity"] = fmt(planned)
                row["issued_quantity"] = fmt(produced)
                row["actual_consumed_quantity"] = fmt(produced)
                row["returned_quantity"] = "0.000"
                row["wastage_quantity"] = "0.000"
                row["uom"] = "No"
                row["warehouse_location"] = "ASMB_WIP"
                row["batch_number"] = f"{items[sfg_item]['item_code']}-{row['consumption_date']}-{row['production_order_item_id']}"
                row["remarks"] = f"Assembly consumption of {items[sfg_item]['item_name']}."
                changed_final_components += 1
            output.append(row)
            continue

        output.append(row)

    for index, row in enumerate(output, start=1):
        row["bom_consumption_id"] = str(index)

    write_csv("bom_consumption.csv", output, fieldnames)
    report["bom_consumption_parents_remapped_to_sfg"] = changed_finished_parent
    report["final_assembly_rows_changed_to_sfg"] = changed_final_components
    report["direct_raw_final_assembly_rows_removed"] = removed_direct_raw
    report["bom_consumption_rows_after_repair"] = len(output)


def add_sfg_move_orders(report):
    items = item_index(read_csv("item_master_import.csv"))
    consumption = defaultdict(Decimal)
    for row in read_csv("bom_consumption.csv"):
        item_id = int(row["consumed_item_id"])
        if item_id in SFG_ID.values() and int(row["finished_item_id"]) in FG_TO_SFG:
            consumption[item_id] += dec(row["actual_consumed_quantity"]) or dec(row["issued_quantity"])

    mo_rows = [row for row in read_csv("move_order.csv") if "SFG Transfer to Assembly" not in row["remarks"]]
    mo_fields = mo_rows[0].keys()
    moi_rows = [row for row in read_csv("move_order_items.csv") if "SFG transfer to assembly" not in row["remarks"]]
    moi_fields = moi_rows[0].keys()

    next_mo_id = max(int(row["move_order_id"]) for row in mo_rows) + 1
    next_item_id = max(int(row["mo_item_id"]) for row in moi_rows) + 1
    added = 0
    for sfg_item_id, qty in sorted(consumption.items()):
        if qty <= 0:
            continue
        source = "STAT_WIP" if "Stator" in items[sfg_item_id]["item_name"] else "ROTR_WIP"
        mo_rows.append({
            "move_order_id": str(next_mo_id),
            "move_order_number": f"MO-SFG-{next_mo_id:04d}",
            "move_order_date": "2025-04-01",
            "move_order_type": "Semi Finished Transfer",
            "source_location": source,
            "destination_location": "ASMB_WIP",
            "requested_by": "1",
            "approved_by": "1",
            "moved_by": "1",
            "reference_type": "Production Order",
            "reference_id": "",
            "priority": "High",
            "move_status": "Completed",
            "remarks": f"SFG Transfer to Assembly for {items[sfg_item_id]['item_name']}.",
            "created_at": "2025-04-01 09:00:00",
            "updated_at": "2025-04-01 15:00:00",
        })
        unit_cost = dec(items[sfg_item_id]["unit_cost"])
        moi_rows.append({
            "mo_item_id": str(next_item_id),
            "mo_id": str(next_mo_id),
            "item_id": str(sfg_item_id),
            "requested_quantity": fmt(qty),
            "issued_quantity": fmt(qty),
            "uom": "No",
            "unit_cost": str(unit_cost.quantize(Decimal("0.01"))),
            "line_amount": str((qty * unit_cost).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
            "source_location": source,
            "destination_location": "ASMB_WIP",
            "required_date": "2025-04-02",
            "movement_date": "2025-04-01",
            "remarks": f"SFG transfer to assembly for {items[sfg_item_id]['item_name']}.",
        })
        next_mo_id += 1
        next_item_id += 1
        added += 1

    write_csv("move_order.csv", mo_rows, mo_fields)
    write_csv("move_order_items.csv", moi_rows, moi_fields)
    report["sfg_move_orders_added"] = added


def repair_move_order_admin_fields(report):
    rows = read_csv("move_order.csv")
    fields = rows[0].keys()
    fixed_employee_refs = 0
    for row in rows:
        for column in ["requested_by", "approved_by", "moved_by"]:
            if not row[column]:
                row[column] = "1"
                fixed_employee_refs += 1
    write_csv("move_order.csv", rows, fields)

    by_id = {row["move_order_id"]: row for row in rows}
    item_rows = read_csv("move_order_items.csv")
    item_fields = item_rows[0].keys()
    fixed_dates = 0
    for row in item_rows:
        header = by_id.get(row["mo_id"])
        if header and row["movement_date"] < header["move_order_date"]:
            row["movement_date"] = header["move_order_date"]
            if row["required_date"] < row["movement_date"]:
                row["required_date"] = row["movement_date"]
            fixed_dates += 1
    write_csv("move_order_items.csv", item_rows, item_fields)

    report["move_order_employee_refs_filled"] = fixed_employee_refs
    report["move_order_item_dates_aligned"] = fixed_dates


def write_report(report):
    lines = [
        "# ERP Business Consistency Repair Report",
        "",
        "## Issues Found",
        "- Production orders and receipts used raw/component items as production outputs.",
        "- Final motor BOMs directly included stator/rotor raw materials instead of semi-finished stator and rotor assemblies.",
        "- Final assembly consumption directly consumed stator/rotor raw components.",
        "- Semi-finished stator/rotor movement into assembly was not explicit.",
        "",
        "## Issues Corrected",
    ]
    lines.extend(f"- {key}: {value}" for key, value in report.items())
    lines.extend([
        "",
        "## Assumptions Made",
        "- Existing raw/component output item IDs 1,2,3 map to finished stators 1.5kW, 3kW, 7.5kW.",
        "- Existing output item IDs 4/13, 5/14, 6/15 map to finished rotors 1.5kW, 3kW, 7.5kW.",
        "- Semi-finished stator/rotor receipts remain in the existing receipt file to preserve the ERP schema.",
        "- Final motors remain item IDs 100-102 and are the only dispatchable finished goods.",
        "",
        "## Remaining Limitations",
        "- Some historical rows remain flagged by inventory validation because the source data has over-issue patterns from earlier generated transactions.",
        "- This is kept as portfolio-level ERP data quality, not a full SAP-style production execution model.",
    ])
    (ROOT / "ERP_Business_Consistency_Report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    report = {}
    add_sfg_items(report)
    stage_by_component = repair_bom(report)
    repair_production_and_receipts(report)
    repair_consumption(report, stage_by_component)
    add_sfg_move_orders(report)
    repair_move_order_admin_fields(report)
    write_report(report)
    print("Business consistency repair complete")
    for key, value in report.items():
        print(f"{key}: {value}")


if __name__ == "__main__":
    main()
