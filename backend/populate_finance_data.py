import os
import re
import sys
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
LOCAL_PACKAGES = BASE_DIR / ".python-packages"
if LOCAL_PACKAGES.exists():
    sys.path.insert(0, str(LOCAL_PACKAGES))

try:
    import mysql.connector
    from mysql.connector import Error

    DB_DRIVER = "mysql.connector"
except ImportError:
    import pymysql

    Error = pymysql.MySQLError
    DB_DRIVER = "pymysql"


DB_NAME = "ev_motor_erp"
START_DATE = date(2025, 4, 1)
END_DATE = date(2026, 3, 31)
LATEST_INVOICE_DATE = END_DATE - timedelta(days=60)
MONEY = Decimal("0.01")
QTY = Decimal("0.001")
VENDOR_INVOICE_COUNT = 5000
VENDOR_INVOICE_ITEM_COUNT = 12000
VENDOR_PAYMENT_COUNT = 4000
CUSTOMER_INVOICE_COUNT = 4500
CUSTOMER_INVOICE_ITEM_COUNT = 10000
CUSTOMER_RECEIPT_COUNT = 3800

FINANCE_TABLES = [
    "chart_of_accounts",
    "tax_master",
    "bank_master",
    "financial_period",
    "vendor_invoice",
    "vendor_invoice_items",
    "vendor_payment",
    "customer_invoice",
    "customer_invoice_items",
    "customer_receipt",
    "journal_entry",
    "journal_entry_lines",
]

DOC_SEQUENCES = {}


def load_env_file():
    env_path = BASE_DIR / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def connect_db():
    load_env_file()
    config = {
        "host": os.getenv("DB_HOST", "localhost"),
        "user": os.getenv("DB_USER", "root"),
        "password": os.getenv("DB_PASSWORD", ""),
        "database": os.getenv("DB_NAME", DB_NAME),
        "port": int(os.getenv("DB_PORT", "3306")),
    }
    if DB_DRIVER == "mysql.connector":
        return mysql.connector.connect(**config)
    return pymysql.connect(**config, cursorclass=pymysql.cursors.DictCursor, autocommit=False)


def money(value):
    return Decimal(str(value)).quantize(MONEY, rounding=ROUND_HALF_UP)


def qty(value):
    return Decimal(str(value)).quantize(QTY, rounding=ROUND_HALF_UP)


def finance_date(index, step_days=3):
    return START_DATE + timedelta(days=(index * step_days) % ((LATEST_INVOICE_DATE - START_DATE).days + 1))


def table_is_empty(cursor, table_name):
    cursor.execute(f"SELECT COUNT(*) AS row_count FROM {table_name}")
    return int(cursor.fetchone()["row_count"]) == 0


def get_existing_ids(cursor):
    ids = {}
    queries = {
        "vendors": "SELECT vendor_id FROM vendor_master ORDER BY vendor_id",
        "items": "SELECT item_id FROM item_master ORDER BY item_id",
        "customers": "SELECT customer_id FROM customer_master ORDER BY customer_id",
        "employees": "SELECT employee_id FROM employee_master ORDER BY employee_id",
        "purchase_orders": "SELECT po_id FROM purchase_order ORDER BY po_id",
        "goods_receipts": "SELECT grn_id FROM goods_receipt ORDER BY grn_id",
        "customer_orders": "SELECT co_id FROM customer_order ORDER BY co_id",
        "dispatches": "SELECT dispatch_id FROM dispatch ORDER BY dispatch_id",
    }
    for key, sql in queries.items():
        cursor.execute(sql)
        ids[key] = [list(row.values())[0] for row in cursor.fetchall()]
        if not ids[key]:
            raise RuntimeError(f"No records found in required table for {key}.")
    return ids


def get_columns(cursor, table_name):
    cursor.execute(f"DESCRIBE {table_name}")
    return {row["Field"] for row in cursor.fetchall()}


def generate_doc_number(cursor, table_name, column_name, prefix, doc_date=None):
    year = (doc_date or date.today()).year
    key = (table_name, column_name, prefix, year)
    if key not in DOC_SEQUENCES:
        pattern = f"{prefix}-{year}-%"
        cursor.execute(
            f"SELECT {column_name} AS doc_no FROM {table_name} "
            f"WHERE {column_name} LIKE %s ORDER BY {column_name} DESC LIMIT 1",
            (pattern,),
        )
        row = cursor.fetchone()
        sequence = 0
        if row and row["doc_no"]:
            match = re.search(r"(\d+)$", row["doc_no"])
            if match:
                sequence = int(match.group(1))
        DOC_SEQUENCES[key] = sequence

    while True:
        DOC_SEQUENCES[key] += 1
        doc_no = f"{prefix}-{year}-{DOC_SEQUENCES[key]:04d}"
        cursor.execute(
            f"SELECT COUNT(*) AS row_count FROM {table_name} WHERE {column_name} = %s",
            (doc_no,),
        )
        if int(cursor.fetchone()["row_count"]) == 0:
            return doc_no


def fetch_one_id(cursor, table_name, id_column, where_column, value):
    cursor.execute(
        f"SELECT {id_column} AS id_value FROM {table_name} WHERE {where_column} = %s",
        (value,),
    )
    row = cursor.fetchone()
    if not row:
        raise RuntimeError(f"Missing {table_name}.{where_column} = {value}")
    return row["id_value"]


def get_account_ids(cursor):
    cursor.execute("SELECT account_id, account_code FROM chart_of_accounts")
    rows = cursor.fetchall()
    account_ids = {row["account_code"]: row["account_id"] for row in rows}
    required_codes = ["1010", "1100", "1200", "1300", "2000", "2100", "4000"]
    missing = [code for code in required_codes if code not in account_ids]
    if missing:
        raise RuntimeError(f"Missing required chart_of_accounts codes: {', '.join(missing)}")
    return account_ids


def get_tax_ids(cursor):
    cursor.execute("SELECT tax_id, tax_code, tax_rate, applicable_on FROM tax_master")
    rows = cursor.fetchall()
    input_taxes = [row for row in rows if row["applicable_on"] in ("Purchase", "Both")]
    output_taxes = [row for row in rows if row["applicable_on"] in ("Sales", "Both")]
    if not input_taxes or not output_taxes:
        raise RuntimeError("tax_master must contain purchase and sales taxes.")
    return input_taxes, output_taxes


def get_bank_ids(cursor):
    cursor.execute("SELECT bank_id FROM bank_master ORDER BY bank_id")
    bank_ids = [row["bank_id"] for row in cursor.fetchall()]
    if not bank_ids:
        raise RuntimeError("bank_master must contain at least one bank.")
    return bank_ids


def get_period_id(cursor, entry_date):
    cursor.execute(
        """
        SELECT period_id
        FROM financial_period
        WHERE %s BETWEEN start_date AND end_date
        ORDER BY start_date
        LIMIT 1
        """,
        (entry_date,),
    )
    row = cursor.fetchone()
    if not row:
        raise RuntimeError(f"No financial period found for {entry_date}.")
    return row["period_id"]


def select_first_employee(cursor):
    cursor.execute("SELECT employee_id FROM employee_master ORDER BY employee_id LIMIT 1")
    row = cursor.fetchone()
    return row["employee_id"] if row else None


def populate_chart_of_accounts(cursor, employee_id):
    if not table_is_empty(cursor, "chart_of_accounts"):
        print("chart_of_accounts already has data. Skipping master insert.")
        return 0

    accounts = [
        ("1000", "Cash", "Asset", "Cash and Cash Equivalents", "Debit", "Physical cash balance"),
        ("1010", "Bank", "Asset", "Bank and Cash Equivalents", "Debit", "Primary operating bank account"),
        ("1100", "Accounts Receivable", "Asset", "Trade Receivables", "Debit", "Amounts receivable from customers"),
        ("1200", "Raw Material Inventory", "Asset", "Inventory", "Debit", "Raw materials and bought-out components"),
        ("1210", "Finished Goods Inventory", "Asset", "Inventory", "Debit", "Finished EV motor inventory"),
        ("1220", "Work In Process Inventory", "Asset", "Inventory", "Debit", "WIP inventory in production"),
        ("1300", "Input GST", "Asset", "GST Receivable", "Debit", "GST input tax credit"),
        ("1400", "Advance to Vendors", "Asset", "Advances", "Debit", "Vendor advances"),
        ("1500", "Plant and Machinery", "Asset", "Fixed Assets", "Debit", "Factory plant and machinery"),
        ("2000", "Accounts Payable", "Liability", "Trade Payables", "Credit", "Amounts payable to vendors"),
        ("2100", "Output GST", "Liability", "GST Payable", "Credit", "GST output tax liability"),
        ("2200", "Advance from Customers", "Liability", "Advances", "Credit", "Customer advances"),
        ("2300", "Duties and Taxes Payable", "Liability", "Statutory Payables", "Credit", "Other statutory dues payable"),
        ("3000", "Owner Equity / Capital", "Equity", "Capital", "Credit", "Owner capital introduced"),
        ("4000", "Sales Revenue", "Revenue", "Operating Revenue", "Credit", "EV motor sales revenue"),
        ("4100", "Scrap Sales Revenue", "Revenue", "Other Operating Revenue", "Credit", "Sale of scrap and recoveries"),
        ("5000", "Purchase Expense", "Expense", "Direct Expense", "Debit", "Material purchase expense"),
        ("5010", "Freight Inward Expense", "Expense", "Procurement Cost", "Debit", "Freight and logistics on purchases"),
        ("5020", "Packing Material Expense", "Expense", "Direct Expense", "Debit", "Packing material consumed"),
        ("5100", "Salary Expense", "Expense", "Employee Cost", "Debit", "Factory and office salary cost"),
        ("5200", "Electricity Expense", "Expense", "Factory Overheads", "Debit", "Power and electricity cost"),
        ("5300", "Maintenance Expense", "Expense", "Factory Overheads", "Debit", "Plant maintenance cost"),
        ("5400", "Depreciation Expense", "Expense", "Non Cash Expense", "Debit", "Depreciation on fixed assets"),
        ("5500", "Bank Charges", "Expense", "Finance Cost", "Debit", "Bank fees and charges"),
        ("5600", "Interest Expense", "Expense", "Finance Cost", "Debit", "Interest and borrowing cost"),
    ]
    cursor.executemany(
        """
        INSERT INTO chart_of_accounts
        (account_code, account_name, account_type, account_sub_type, normal_balance,
         opening_balance, current_balance, status, description, created_by, updated_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, 'Active', %s, %s, %s)
        """,
        [
            (
                code,
                name,
                account_type,
                sub_type,
                normal_balance,
                Decimal("0.00"),
                Decimal("0.00"),
                description,
                employee_id,
                employee_id,
            )
            for code, name, account_type, sub_type, normal_balance, description in accounts
        ],
    )
    print("Inserted 25 chart_of_accounts records.")
    return len(accounts)


def populate_tax_master(cursor, employee_id):
    if not table_is_empty(cursor, "tax_master"):
        print("tax_master already has data. Skipping master insert.")
        return 0

    taxes = [
        ("GST-IN-0", "Input GST 0%", "Input", Decimal("0.00"), "Purchase"),
        ("GST-IN-5", "Input GST 5%", "Input", Decimal("5.00"), "Purchase"),
        ("GST-IN-12", "Input GST 12%", "Input", Decimal("12.00"), "Purchase"),
        ("GST-IN-18", "Input GST 18%", "Input", Decimal("18.00"), "Purchase"),
        ("GST-OUT-0", "Output GST 0%", "Output", Decimal("0.00"), "Sales"),
        ("GST-OUT-5", "Output GST 5%", "Output", Decimal("5.00"), "Sales"),
        ("GST-OUT-12", "Output GST 12%", "Output", Decimal("12.00"), "Sales"),
        ("GST-OUT-18", "Output GST 18%", "Output", Decimal("18.00"), "Sales"),
    ]
    cursor.executemany(
        """
        INSERT INTO tax_master
        (tax_code, tax_name, tax_type, tax_rate, applicable_on, status, description, created_by, updated_by)
        VALUES (%s, %s, %s, %s, %s, 'Active', %s, %s, %s)
        """,
        [
            (
                code,
                name,
                tax_type,
                rate,
                applicable_on,
                f"{name} for {applicable_on.lower()} transactions",
                employee_id,
                employee_id,
            )
            for code, name, tax_type, rate, applicable_on in taxes
        ],
    )
    print("Inserted 8 tax_master records.")
    return len(taxes)


def populate_financial_period(cursor, employee_id):
    if not table_is_empty(cursor, "financial_period"):
        print("financial_period already has data. Skipping master insert.")
        return 0

    periods = []
    current = date(2025, 4, 1)
    for _ in range(24):
        if current.month == 12:
            next_month = date(current.year + 1, 1, 1)
        else:
            next_month = date(current.year, current.month + 1, 1)
        end_date = next_month - timedelta(days=1)
        financial_year_start = current.year if current.month >= 4 else current.year - 1
        financial_year = f"FY {financial_year_start}-{str(financial_year_start + 1)[-2:]}"
        period_code = current.strftime("%b-%Y").upper()
        periods.append(
            (
                period_code,
                financial_year,
                current.strftime("%B %Y"),
                current,
                end_date,
                "Open",
                employee_id,
                employee_id,
            )
        )
        current = next_month

    cursor.executemany(
        """
        INSERT INTO financial_period
        (period_code, financial_year, period_name, start_date, end_date, period_status, created_by, updated_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        periods,
    )
    print("Inserted 24 financial_period records.")
    return len(periods)


def populate_bank_master(cursor, employee_id, account_ids):
    if not table_is_empty(cursor, "bank_master"):
        print("bank_master already has data. Skipping master insert.")
        return 0

    bank_account_id = account_ids["1010"]
    banks = [
        ("BANK-HDFC-001", "HDFC Bank", "Hosur Industrial Estate", "50200011000123", "HDFC0001234", "Current", Decimal("1500000.00")),
        ("BANK-ICICI-001", "ICICI Bank", "Bengaluru Peenya", "012305000456", "ICIC0000123", "Current", Decimal("750000.00")),
        ("BANK-SBI-001", "State Bank of India", "Hosur Main", "33789012345", "SBIN0002456", "Cash Credit", Decimal("1200000.00")),
        ("BANK-AXIS-001", "Axis Bank", "Chennai Ambattur", "918020045612345", "UTIB0000678", "Current", Decimal("500000.00")),
    ]
    cursor.executemany(
        """
        INSERT INTO bank_master
        (bank_account_code, bank_name, branch_name, account_number, ifsc_code, account_type,
         opening_balance, current_balance, linked_account_id, status, created_by, updated_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'Active', %s, %s)
        """,
        [
            (
                code,
                name,
                branch,
                account_no,
                ifsc,
                account_type,
                opening_balance,
                opening_balance,
                bank_account_id,
                employee_id,
                employee_id,
            )
            for code, name, branch, account_no, ifsc, account_type, opening_balance in banks
        ],
    )
    print("Inserted 4 bank_master records.")
    return len(banks)


def fetch_vendor_sources(cursor):
    cursor.execute(
        """
        SELECT grn.grn_id, grn.po_id, grn.vendor_id, grn.received_date
        FROM goods_receipt grn
        JOIN purchase_order po ON po.po_id = grn.po_id
        JOIN goods_receipt_items gri ON gri.grn_id = grn.grn_id
        WHERE grn.received_date BETWEEN %s AND %s
          AND COALESCE(gri.accepted_quantity, gri.received_quantity) > 0
        GROUP BY grn.grn_id, grn.po_id, grn.vendor_id, grn.received_date
        ORDER BY grn.received_date, grn.grn_id
        """,
        (START_DATE, LATEST_INVOICE_DATE),
    )
    sources = cursor.fetchall()
    if not sources:
        raise RuntimeError("Need at least one goods_receipt record with usable receipt items before 2026-01-30.")
    return sources


def fetch_vendor_source_items(cursor, grn_id, item_count):
    cursor.execute(
        """
        SELECT gri.item_id,
               COALESCE(NULLIF(gri.accepted_quantity, 0), NULLIF(gri.received_quantity, 0), 1) AS quantity,
               COALESCE(NULLIF(gri.unit_price, 0), NULLIF(im.unit_cost, 0), 100) AS unit_price
        FROM goods_receipt_items gri
        JOIN item_master im ON im.item_id = gri.item_id
        WHERE gri.grn_id = %s
          AND COALESCE(gri.accepted_quantity, gri.received_quantity) > 0
        ORDER BY gri.grn_item_id
        LIMIT %s
        """,
        (grn_id, item_count),
    )
    rows = cursor.fetchall()
    if not rows:
        raise RuntimeError(f"GRN {grn_id} does not have usable receipt items.")
    while len(rows) < item_count:
        rows.append(dict(rows[len(rows) % len(rows)]))
    return rows


def fetch_customer_sources(cursor):
    cursor.execute(
        """
        SELECT d.dispatch_id, d.co_id, COALESCE(d.customer_id, co.customer_id) AS customer_id, d.dispatch_date
        FROM dispatch d
        JOIN customer_order co ON co.co_id = d.co_id
        JOIN dispatch_items di ON di.dispatch_id = d.dispatch_id
        WHERE d.dispatch_date BETWEEN %s AND %s
          AND COALESCE(d.customer_id, co.customer_id) IS NOT NULL
          AND di.dispatched_quantity > 0
        GROUP BY d.dispatch_id, d.co_id, COALESCE(d.customer_id, co.customer_id), d.dispatch_date
        ORDER BY d.dispatch_date, d.dispatch_id
        """,
        (START_DATE, LATEST_INVOICE_DATE),
    )
    sources = cursor.fetchall()
    if not sources:
        raise RuntimeError("Need at least one dispatch record with usable dispatch items before 2026-01-30.")
    return sources


def fetch_customer_source_items(cursor, dispatch_id, item_count):
    cursor.execute(
        """
        SELECT di.item_id,
               COALESCE(NULLIF(di.dispatched_quantity, 0), 1) AS quantity,
               COALESCE(NULLIF(di.unit_price, 0), NULLIF(im.unit_cost, 0), 25000) AS unit_price
        FROM dispatch_items di
        JOIN item_master im ON im.item_id = di.item_id
        WHERE di.dispatch_id = %s
          AND di.dispatched_quantity > 0
        ORDER BY
          CASE WHEN LOWER(COALESCE(im.category, '')) LIKE '%%finished%%' THEN 0 ELSE 1 END,
          di.dispatch_item_id
        LIMIT %s
        """,
        (dispatch_id, item_count),
    )
    rows = cursor.fetchall()
    if not rows:
        raise RuntimeError(f"Dispatch {dispatch_id} does not have usable dispatch items.")
    while len(rows) < item_count:
        rows.append(dict(rows[len(rows) % len(rows)]))
    return rows


def calculate_items(source_items, taxes):
    generated_items = []
    subtotal = Decimal("0.00")
    tax_total = Decimal("0.00")
    for index, source in enumerate(source_items):
        tax = taxes[index % len(taxes)]
        quantity = qty(source["quantity"])
        unit_price = money(source["unit_price"])
        taxable_amount = money(quantity * unit_price)
        tax_amount = money(taxable_amount * Decimal(str(tax["tax_rate"])) / Decimal("100"))
        line_total = money(taxable_amount + tax_amount)
        subtotal += taxable_amount
        tax_total += tax_amount
        generated_items.append(
            {
                "item_id": source["item_id"],
                "quantity": quantity,
                "unit_price": unit_price,
                "taxable_amount": taxable_amount,
                "tax_id": tax["tax_id"],
                "tax_amount": tax_amount,
                "line_total": line_total,
            }
        )
    return generated_items, money(subtotal), money(tax_total), money(subtotal + tax_total)


def populate_vendor_invoices_and_items(cursor, employee_id, input_taxes):
    sources = fetch_vendor_sources(cursor)
    invoices = []

    for index in range(VENDOR_INVOICE_COUNT):
        source = sources[index % len(sources)]
        item_count = 3 if index < (VENDOR_INVOICE_ITEM_COUNT - VENDOR_INVOICE_COUNT * 2) else 2
        invoice_date = max(source["received_date"], finance_date(index, 3))
        due_date = invoice_date + timedelta(days=30 + (index % 4) * 7)
        items, subtotal, tax_amount, total_amount = calculate_items(
            fetch_vendor_source_items(cursor, source["grn_id"], item_count),
            input_taxes,
        )
        invoice_no = generate_doc_number(cursor, "vendor_invoice", "vendor_invoice_no", "VI", invoice_date)
        if index < VENDOR_PAYMENT_COUNT:
            status = "Paid" if index % 5 == 0 else "Partially Paid"
        else:
            status = ["Approved", "Draft", "Cancelled"][index % 3]
        cursor.execute(
            """
            INSERT INTO vendor_invoice
            (vendor_invoice_no, vendor_id, po_id, grn_id, invoice_date, due_date,
             subtotal_amount, tax_amount, total_amount, paid_amount, invoice_status,
             remarks, created_by, updated_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 0.00, %s, %s, %s, %s)
            """,
            (
                invoice_no,
                source["vendor_id"],
                source["po_id"],
                source["grn_id"],
                invoice_date,
                due_date,
                subtotal,
                tax_amount,
                total_amount,
                status,
                f"Generated finance invoice from GRN {source['grn_id']}",
                employee_id,
                employee_id,
            ),
        )
        invoice_id = cursor.lastrowid
        for item in items:
            cursor.execute(
                """
                INSERT INTO vendor_invoice_items
                (vendor_invoice_id, item_id, quantity, unit_price, taxable_amount,
                 tax_id, tax_amount, line_total)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    invoice_id,
                    item["item_id"],
                    item["quantity"],
                    item["unit_price"],
                    item["taxable_amount"],
                    item["tax_id"],
                    item["tax_amount"],
                    item["line_total"],
                ),
            )
        invoices.append(
            {
                "vendor_invoice_id": invoice_id,
                "vendor_id": source["vendor_id"],
                "invoice_date": invoice_date,
                "total_amount": total_amount,
                "invoice_status": status,
            }
        )

    print(f"Inserted {VENDOR_INVOICE_COUNT} vendor_invoice records.")
    print(f"Inserted {VENDOR_INVOICE_ITEM_COUNT} vendor_invoice_items records.")
    return invoices


def populate_vendor_payments(cursor, employee_id, bank_ids, invoices):
    payable_invoices = invoices[:VENDOR_PAYMENT_COUNT]
    payments = []
    for index, invoice in enumerate(payable_invoices):
        if invoice["invoice_status"] == "Paid":
            amount = invoice["total_amount"]
            invoice_status = "Paid"
        else:
            ratio = Decimal("0.40") + Decimal(index % 4) * Decimal("0.10")
            amount = money(invoice["total_amount"] * ratio)
            invoice_status = "Partially Paid"
        payment_date = invoice["invoice_date"] + timedelta(days=7 + (index % 5) * 4)
        payment_no = generate_doc_number(cursor, "vendor_payment", "vendor_payment_no", "VP", payment_date)
        cursor.execute(
            """
            INSERT INTO vendor_payment
            (vendor_payment_no, vendor_invoice_id, vendor_id, bank_id, payment_date,
             payment_mode, reference_no, payment_amount, payment_status, remarks,
             created_by, updated_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'Posted', %s, %s, %s)
            """,
            (
                payment_no,
                invoice["vendor_invoice_id"],
                invoice["vendor_id"],
                bank_ids[index % len(bank_ids)],
                payment_date,
                ["NEFT", "RTGS", "IMPS", "Cheque"][index % 4],
                f"UTR-VP-{payment_date:%Y%m%d}-{index + 1:04d}",
                amount,
                f"Generated vendor payment for invoice {invoice['vendor_invoice_id']}",
                employee_id,
                employee_id,
            ),
        )
        payment_id = cursor.lastrowid
        cursor.execute(
            """
            UPDATE vendor_invoice
            SET paid_amount = %s, invoice_status = %s, updated_by = %s
            WHERE vendor_invoice_id = %s
            """,
            (amount, invoice_status, employee_id, invoice["vendor_invoice_id"]),
        )
        payments.append(
            {
                "vendor_payment_id": payment_id,
                "payment_date": payment_date,
                "payment_amount": amount,
            }
        )
    print(f"Inserted {VENDOR_PAYMENT_COUNT} vendor_payment records.")
    return payments


def populate_customer_invoices_and_items(cursor, employee_id, output_taxes):
    sources = fetch_customer_sources(cursor)
    invoices = []

    for index in range(CUSTOMER_INVOICE_COUNT):
        source = sources[index % len(sources)]
        item_count = 3 if index < (CUSTOMER_INVOICE_ITEM_COUNT - CUSTOMER_INVOICE_COUNT * 2) else 2
        invoice_date = max(source["dispatch_date"], finance_date(index, 3))
        due_date = invoice_date + timedelta(days=30 + (index % 4) * 7)
        items, subtotal, tax_amount, total_amount = calculate_items(
            fetch_customer_source_items(cursor, source["dispatch_id"], item_count),
            output_taxes,
        )
        invoice_no = generate_doc_number(cursor, "customer_invoice", "customer_invoice_no", "CI", invoice_date)
        if index < CUSTOMER_RECEIPT_COUNT:
            status = "Received" if index % 5 == 0 else "Partially Received"
        else:
            status = ["Approved", "Draft", "Cancelled"][index % 3]
        cursor.execute(
            """
            INSERT INTO customer_invoice
            (customer_invoice_no, customer_id, customer_order_id, dispatch_id, invoice_date,
             due_date, subtotal_amount, tax_amount, total_amount, received_amount,
             invoice_status, remarks, created_by, updated_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 0.00, %s, %s, %s, %s)
            """,
            (
                invoice_no,
                source["customer_id"],
                source["co_id"],
                source["dispatch_id"],
                invoice_date,
                due_date,
                subtotal,
                tax_amount,
                total_amount,
                status,
                f"Generated finance invoice from dispatch {source['dispatch_id']}",
                employee_id,
                employee_id,
            ),
        )
        invoice_id = cursor.lastrowid
        for item in items:
            cursor.execute(
                """
                INSERT INTO customer_invoice_items
                (customer_invoice_id, item_id, quantity, unit_price, taxable_amount,
                 tax_id, tax_amount, line_total)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    invoice_id,
                    item["item_id"],
                    item["quantity"],
                    item["unit_price"],
                    item["taxable_amount"],
                    item["tax_id"],
                    item["tax_amount"],
                    item["line_total"],
                ),
            )
        invoices.append(
            {
                "customer_invoice_id": invoice_id,
                "customer_id": source["customer_id"],
                "invoice_date": invoice_date,
                "total_amount": total_amount,
                "invoice_status": status,
            }
        )

    print(f"Inserted {CUSTOMER_INVOICE_COUNT} customer_invoice records.")
    print(f"Inserted {CUSTOMER_INVOICE_ITEM_COUNT} customer_invoice_items records.")
    return invoices


def populate_customer_receipts(cursor, employee_id, bank_ids, invoices):
    receivable_invoices = invoices[:CUSTOMER_RECEIPT_COUNT]
    receipts = []
    for index, invoice in enumerate(receivable_invoices):
        if invoice["invoice_status"] == "Received":
            amount = invoice["total_amount"]
            invoice_status = "Received"
        else:
            ratio = Decimal("0.35") + Decimal(index % 4) * Decimal("0.10")
            amount = money(invoice["total_amount"] * ratio)
            invoice_status = "Partially Received"
        receipt_date = invoice["invoice_date"] + timedelta(days=6 + (index % 5) * 4)
        receipt_no = generate_doc_number(cursor, "customer_receipt", "customer_receipt_no", "CR", receipt_date)
        cursor.execute(
            """
            INSERT INTO customer_receipt
            (customer_receipt_no, customer_invoice_id, customer_id, bank_id, receipt_date,
             receipt_mode, reference_no, receipt_amount, receipt_status, remarks,
             created_by, updated_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'Posted', %s, %s, %s)
            """,
            (
                receipt_no,
                invoice["customer_invoice_id"],
                invoice["customer_id"],
                bank_ids[index % len(bank_ids)],
                receipt_date,
                ["NEFT", "RTGS", "IMPS", "Cheque"][index % 4],
                f"UTR-CR-{receipt_date:%Y%m%d}-{index + 1:04d}",
                amount,
                f"Generated customer receipt for invoice {invoice['customer_invoice_id']}",
                employee_id,
                employee_id,
            ),
        )
        receipt_id = cursor.lastrowid
        cursor.execute(
            """
            UPDATE customer_invoice
            SET received_amount = %s, invoice_status = %s, updated_by = %s
            WHERE customer_invoice_id = %s
            """,
            (amount, invoice_status, employee_id, invoice["customer_invoice_id"]),
        )
        receipts.append(
            {
                "customer_receipt_id": receipt_id,
                "receipt_date": receipt_date,
                "receipt_amount": amount,
            }
        )
    print(f"Inserted {CUSTOMER_RECEIPT_COUNT} customer_receipt records.")
    return receipts


def create_journal_entry(cursor, employee_id, account_ids, source_type, source_id, entry_date, lines):
    total_debit = money(sum((line["debit"] for line in lines), Decimal("0.00")))
    total_credit = money(sum((line["credit"] for line in lines), Decimal("0.00")))
    if total_debit != total_credit:
        raise RuntimeError(f"Unbalanced journal entry for {source_type} {source_id}")

    period_id = get_period_id(cursor, entry_date)
    prefix_map = {
        "Vendor Invoice": "JE-VI",
        "Vendor Payment": "JE-VP",
        "Customer Invoice": "JE-CI",
        "Customer Receipt": "JE-CR",
    }
    journal_no = generate_doc_number(
        cursor,
        "journal_entry",
        "journal_entry_no",
        prefix_map[source_type],
        entry_date,
    )
    cursor.execute(
        """
        INSERT INTO journal_entry
        (journal_entry_no, entry_date, period_id, source_module, source_document_type,
         source_document_id, total_debit, total_credit, journal_status, narration,
         created_by, updated_by)
        VALUES (%s, %s, %s, 'Finance', %s, %s, %s, %s, 'Posted', %s, %s, %s)
        """,
        (
            journal_no,
            entry_date,
            period_id,
            source_type,
            source_id,
            total_debit,
            total_credit,
            f"Auto generated journal for {source_type} {source_id}",
            employee_id,
            employee_id,
        ),
    )
    journal_id = cursor.lastrowid

    for line in lines:
        if line["debit"] == Decimal("0.00") and line["credit"] == Decimal("0.00"):
            continue
        cursor.execute(
            """
            INSERT INTO journal_entry_lines
            (journal_entry_id, account_id, debit_amount, credit_amount,
             line_narration, reference_type, reference_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                journal_id,
                line["account_id"],
                line["debit"],
                line["credit"],
                line["narration"],
                source_type,
                source_id,
            ),
        )
    return journal_id


def populate_journal_entries(cursor, employee_id, account_ids):
    created = 0
    created_lines = 0

    cursor.execute(
        """
        SELECT vendor_invoice_id, invoice_date, subtotal_amount, tax_amount, total_amount
        FROM vendor_invoice
        ORDER BY vendor_invoice_id
        """
    )
    for row in cursor.fetchall():
        lines = [
            {
                "account_id": account_ids["1200"],
                "debit": money(row["subtotal_amount"]),
                "credit": Decimal("0.00"),
                "narration": "Raw material inventory debit",
            },
            {
                "account_id": account_ids["2000"],
                "debit": Decimal("0.00"),
                "credit": money(row["total_amount"]),
                "narration": "Accounts payable credit",
            },
        ]
        if money(row["tax_amount"]) > 0:
            lines.insert(
                1,
                {
                    "account_id": account_ids["1300"],
                    "debit": money(row["tax_amount"]),
                    "credit": Decimal("0.00"),
                    "narration": "Input GST debit",
                },
            )
        journal_id = create_journal_entry(
            cursor,
            employee_id,
            account_ids,
            "Vendor Invoice",
            row["vendor_invoice_id"],
            row["invoice_date"],
            lines,
        )
        created += 1
        created_lines += len([line for line in lines if line["debit"] > 0 or line["credit"] > 0])

    cursor.execute(
        """
        SELECT vendor_payment_id, payment_date, payment_amount
        FROM vendor_payment
        ORDER BY vendor_payment_id
        """
    )
    for row in cursor.fetchall():
        amount = money(row["payment_amount"])
        journal_id = create_journal_entry(
            cursor,
            employee_id,
            account_ids,
            "Vendor Payment",
            row["vendor_payment_id"],
            row["payment_date"],
            [
                {
                    "account_id": account_ids["2000"],
                    "debit": amount,
                    "credit": Decimal("0.00"),
                    "narration": "Accounts payable settlement",
                },
                {
                    "account_id": account_ids["1010"],
                    "debit": Decimal("0.00"),
                    "credit": amount,
                    "narration": "Bank payment credit",
                },
            ],
        )
        created += 1
        created_lines += 2

    cursor.execute(
        """
        SELECT customer_invoice_id, invoice_date, subtotal_amount, tax_amount, total_amount
        FROM customer_invoice
        ORDER BY customer_invoice_id
        """
    )
    for row in cursor.fetchall():
        lines = [
            {
                "account_id": account_ids["1100"],
                "debit": money(row["total_amount"]),
                "credit": Decimal("0.00"),
                "narration": "Accounts receivable debit",
            },
            {
                "account_id": account_ids["4000"],
                "debit": Decimal("0.00"),
                "credit": money(row["subtotal_amount"]),
                "narration": "Sales revenue credit",
            },
        ]
        if money(row["tax_amount"]) > 0:
            lines.append(
                {
                    "account_id": account_ids["2100"],
                    "debit": Decimal("0.00"),
                    "credit": money(row["tax_amount"]),
                    "narration": "Output GST credit",
                }
            )
        journal_id = create_journal_entry(
            cursor,
            employee_id,
            account_ids,
            "Customer Invoice",
            row["customer_invoice_id"],
            row["invoice_date"],
            lines,
        )
        created += 1
        created_lines += len([line for line in lines if line["debit"] > 0 or line["credit"] > 0])

    cursor.execute(
        """
        SELECT customer_receipt_id, receipt_date, receipt_amount
        FROM customer_receipt
        ORDER BY customer_receipt_id
        """
    )
    for row in cursor.fetchall():
        amount = money(row["receipt_amount"])
        journal_id = create_journal_entry(
            cursor,
            employee_id,
            account_ids,
            "Customer Receipt",
            row["customer_receipt_id"],
            row["receipt_date"],
            [
                {
                    "account_id": account_ids["1010"],
                    "debit": amount,
                    "credit": Decimal("0.00"),
                    "narration": "Bank receipt debit",
                },
                {
                    "account_id": account_ids["1100"],
                    "debit": Decimal("0.00"),
                    "credit": amount,
                    "narration": "Accounts receivable settlement",
                },
            ],
        )
        created += 1
        created_lines += 2

    print(f"Inserted {created} journal_entry records.")
    print(f"Inserted {created_lines} journal_entry_lines records.")
    return created


def validate_results(cursor):
    print("\nValidation summary:")
    for table_name in FINANCE_TABLES:
        cursor.execute(f"SELECT COUNT(*) AS row_count FROM {table_name}")
        print(f"{table_name}: {cursor.fetchone()['row_count']}")

    validations = {
        "unbalanced_journal_entries": """
            SELECT COUNT(*) AS result
            FROM journal_entry je
            LEFT JOIN (
              SELECT journal_entry_id,
                     ROUND(SUM(debit_amount), 2) AS line_debit,
                     ROUND(SUM(credit_amount), 2) AS line_credit
              FROM journal_entry_lines
              GROUP BY journal_entry_id
            ) jel ON jel.journal_entry_id = je.journal_entry_id
            WHERE ROUND(je.total_debit, 2) <> ROUND(je.total_credit, 2)
               OR ROUND(je.total_debit, 2) <> COALESCE(jel.line_debit, -1)
               OR ROUND(je.total_credit, 2) <> COALESCE(jel.line_credit, -1)
        """,
        "vendor_payments_exceeding_invoice_total": """
            SELECT COUNT(*) AS result
            FROM (
              SELECT vi.vendor_invoice_id, vi.total_amount, COALESCE(SUM(vp.payment_amount), 0) AS paid
              FROM vendor_invoice vi
              LEFT JOIN vendor_payment vp ON vp.vendor_invoice_id = vi.vendor_invoice_id
              GROUP BY vi.vendor_invoice_id, vi.total_amount
              HAVING paid > vi.total_amount
            ) x
        """,
        "customer_receipts_exceeding_invoice_total": """
            SELECT COUNT(*) AS result
            FROM (
              SELECT ci.customer_invoice_id, ci.total_amount, COALESCE(SUM(cr.receipt_amount), 0) AS received
              FROM customer_invoice ci
              LEFT JOIN customer_receipt cr ON cr.customer_invoice_id = ci.customer_invoice_id
              GROUP BY ci.customer_invoice_id, ci.total_amount
              HAVING received > ci.total_amount
            ) x
        """,
        "vendor_invoices_with_invalid_vendor_id": """
            SELECT COUNT(*) AS result
            FROM vendor_invoice vi
            LEFT JOIN vendor_master vm ON vm.vendor_id = vi.vendor_id
            WHERE vm.vendor_id IS NULL
        """,
        "customer_invoices_with_invalid_customer_id": """
            SELECT COUNT(*) AS result
            FROM customer_invoice ci
            LEFT JOIN customer_master cm ON cm.customer_id = ci.customer_id
            WHERE cm.customer_id IS NULL
        """,
        "journal_entry_lines_without_matching_journal_entry": """
            SELECT COUNT(*) AS result
            FROM journal_entry_lines jel
            LEFT JOIN journal_entry je ON je.journal_entry_id = jel.journal_entry_id
            WHERE je.journal_entry_id IS NULL
        """,
        "journal_entry_lines_without_matching_account_id": """
            SELECT COUNT(*) AS result
            FROM journal_entry_lines jel
            LEFT JOIN chart_of_accounts coa ON coa.account_id = jel.account_id
            WHERE coa.account_id IS NULL
        """,
    }
    for label, sql in validations.items():
        cursor.execute(sql)
        print(f"{label}: {cursor.fetchone()['result']}")


def assert_finance_transactions_empty(cursor):
    transaction_tables = [
        "vendor_invoice",
        "vendor_invoice_items",
        "vendor_payment",
        "customer_invoice",
        "customer_invoice_items",
        "customer_receipt",
        "journal_entry",
        "journal_entry_lines",
    ]
    non_empty = [table for table in transaction_tables if not table_is_empty(cursor, table)]
    if non_empty:
        raise RuntimeError(
            "Finance transaction tables already contain data: "
            + ", ".join(non_empty)
            + ". Clear or archive those rows before running this population script."
        )


def main():
    conn = None
    cursor = None
    try:
        conn = connect_db()
        if DB_DRIVER == "mysql.connector":
            conn.autocommit = False
        else:
            conn.autocommit(False)
        if DB_DRIVER == "mysql.connector":
            cursor = conn.cursor(dictionary=True)
        else:
            cursor = conn.cursor()

        print(f"Connected to MySQL database {os.getenv('DB_NAME', DB_NAME)} using {DB_DRIVER}.")
        get_existing_ids(cursor)
        assert_finance_transactions_empty(cursor)

        employee_id = select_first_employee(cursor)
        populate_chart_of_accounts(cursor, employee_id)
        conn.commit()

        account_ids = get_account_ids(cursor)
        populate_tax_master(cursor, employee_id)
        conn.commit()

        populate_financial_period(cursor, employee_id)
        conn.commit()

        account_ids = get_account_ids(cursor)
        populate_bank_master(cursor, employee_id, account_ids)
        conn.commit()

        input_taxes, output_taxes = get_tax_ids(cursor)
        bank_ids = get_bank_ids(cursor)

        vendor_invoices = populate_vendor_invoices_and_items(cursor, employee_id, input_taxes)
        conn.commit()

        populate_vendor_payments(cursor, employee_id, bank_ids, vendor_invoices)
        conn.commit()

        customer_invoices = populate_customer_invoices_and_items(cursor, employee_id, output_taxes)
        conn.commit()

        populate_customer_receipts(cursor, employee_id, bank_ids, customer_invoices)
        conn.commit()

        account_ids = get_account_ids(cursor)
        populate_journal_entries(cursor, employee_id, account_ids)
        conn.commit()

        validate_results(cursor)
        print("\nFinance data population completed successfully.")

    except Error as exc:
        if conn:
            conn.rollback()
        print(f"MySQL error: {exc}")
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        print(f"Error: {exc}")
        raise
    finally:
        if cursor:
            cursor.close()
        if conn and (
            (hasattr(conn, "is_connected") and conn.is_connected())
            or (not hasattr(conn, "is_connected") and getattr(conn, "open", False))
        ):
            conn.close()


if __name__ == "__main__":
    main()
