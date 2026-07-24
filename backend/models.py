from sqlalchemy import Integer, MetaData, inspect

from database import engine

PHASE_ONE_MODULES = {
    "departments": {
        "title": "Department Master",
        "table": "department_master",
        "route": "/api/departments",
    },
    "employees": {
        "title": "Employee Master",
        "table": "employee_master",
        "route": "/api/employees",
        "dropdowns": {
            "department": "departments",
            "department_id": "departments",
            "dept_id": "departments",
            "department_code": "departments",
        },
    },
    "vendors": {
        "title": "Vendor Master",
        "table": "vendor_master",
        "route": "/api/vendors",
    },
    "items": {
        "title": "Item Master",
        "table": "item_master",
        "route": "/api/items",
        "dropdowns": {
            "vendor": "vendors",
            "vendor_id": "vendors",
            "vendor_code": "vendors",
        },
    },
    "customers": {
        "title": "Customer Master",
        "table": "customer_master",
        "route": "/api/customers",
    },
}

metadata = MetaData()
tables = {}


def reflect_phase_one_tables():
    metadata.clear()
    metadata.reflect(
        bind=engine,
        only=[module["table"] for module in PHASE_ONE_MODULES.values()],
    )
    tables.clear()
    for key, module in PHASE_ONE_MODULES.items():
        tables[key] = metadata.tables[module["table"]]


def get_table(module_key):
    if module_key not in tables:
        reflect_phase_one_tables()
    return tables[module_key]


def get_primary_key_column(table):
    primary_keys = list(table.primary_key.columns)
    if not primary_keys:
        raise ValueError(f"Table {table.name} does not have a primary key.")
    return primary_keys[0]


def is_auto_primary_key(column):
    if not column.primary_key:
        return False
    return column.autoincrement is True or (
        column.autoincrement == "auto" and isinstance(column.type, Integer)
    )


def get_column_metadata(module_key):
    table = get_table(module_key)
    inspector = inspect(engine)
    foreign_keys = inspector.get_foreign_keys(table.name)
    foreign_key_columns = {
        fk["constrained_columns"][0]: fk["referred_table"]
        for fk in foreign_keys
        if fk.get("constrained_columns") and fk.get("referred_table")
    }

    configured_dropdowns = PHASE_ONE_MODULES[module_key].get("dropdowns", {})
    table_to_module = {
        module["table"]: key for key, module in PHASE_ONE_MODULES.items()
    }

    columns = []
    primary_key_names = {column.name for column in table.primary_key.columns}
    for column in table.columns:
        referred_table = foreign_key_columns.get(column.name)
        dropdown_module = configured_dropdowns.get(column.name)
        if referred_table in table_to_module:
            dropdown_module = table_to_module[referred_table]

        columns.append(
            {
                "name": column.name,
                "type": str(column.type),
                "primary_key": column.name in primary_key_names,
                "required": (
                    not column.nullable
                    and (
                        column.name not in primary_key_names
                        or not is_auto_primary_key(column)
                    )
                    and column.default is None
                    and column.server_default is None
                ),
                "readonly": is_auto_primary_key(column),
                "dropdown_module": dropdown_module,
            }
        )
    return columns
