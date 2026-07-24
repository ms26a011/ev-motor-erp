# EV Motor Manufacturing ERP

Full-stack ERP web application for EV motor manufacturing, using a React.js frontend and a Node.js backend. Phase 1 includes CRUD screens and APIs for:

- Department Master
- Employee Master
- Vendor Master
- Item Master
- Customer Master

Phase 2 adds transaction modules for procurement, inventory, production, sales, quality, and finance.

The backend reflects the existing MySQL tables at startup. It does not create, drop, or modify database tables.
This build is mapped to the existing Phase 2 header/item tables already present in `ev_motor_erp`.

## Project Structure

```text
ev-motor-erp-fullstack/
  backend/
    src/
      config.js
      crud.js
      db.js
      metadata.js
      modules.js
      server.js
      transactions.js
    package.json
    .env.example
  frontend/
    src/
      App.jsx
      main.jsx
      api/
      components/
      pages/
      styles/
    package.json
    .env.example
  START_ERP_APP.bat
  README.md
```

## Database

Use the existing MySQL database:

```text
ev_motor_erp
```

Required Phase 1 tables:

- `department_master`
- `employee_master`
- `vendor_master`
- `item_master`
- `customer_master`

Mapped Phase 2 tables:

- `purchase_requisition`
- `purchase_requisition_items`
- `purchase_order`
- `purchase_order_items`
- `goods_receipt`
- `goods_receipt_items`
- `inventory_balance`
- `stock_transaction_log`
- `move_order`
- `move_order_items`
- `production_entry`
- `production_consumption`
- `customer_order`
- `customer_order_items`
- `dispatch`
- `dispatch_items`

The database currently does not contain finance or quality tables for `quality_inspection`, `vendor_invoice`, `customer_invoice`, or `payment_tracking`.

Auto-generated transaction numbers use:

```text
PREFIX + YYYYMMDD + 4-digit daily running serial
```

Examples: `PR202606300001`, `PO202606300001`, `GRN202606300001`, `SI202606300001`, `PROD202606300001`, `FGR202606300001`, `SO202606300001`, `DSP202606300001`.

The backend generates these numbers before insert. Users do not enter transaction numbers manually. Existing manually entered records remain valid.

Optional number columns and unique indexes for tables that did not already have them are supplied in:

```text
backend/sql/phase2_transaction_numbers.sql
```

Bulk import history tables are supplied in:

```text
backend/sql/import_module.sql
```

## Backend Setup

1. Open a terminal in `backend`.
2. Install dependencies.

```bash
npm install
```

3. Create `.env` from `.env.example`.

```text
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password_here
DB_NAME=ev_motor_erp
DB_PORT=3306
PORT=8000
```

4. Start Node.js.

```bash
npm run dev
```

Backend URL:

```text
http://localhost:8000
```

## Frontend Setup

1. Open a terminal in `frontend`.
2. Install dependencies.

```bash
npm install
```

3. Create `.env` from `.env.example`.

```text
VITE_API_BASE_URL=http://localhost:8000/api
```

4. Start React.

```bash
npm run dev
```

Frontend URL:

```text
http://localhost:5173
```

## Phase 1 API Routes

Each module supports:

- `GET /api/{module}`
- `GET /api/{module}/{id}`
- `POST /api/{module}`
- `PUT /api/{module}/{id}`
- `DELETE /api/{module}/{id}`

Available module keys:

- `departments`
- `employees`
- `vendors`
- `items`
- `customers`

## Phase 2 API Routes

Each Phase 2 module uses the same CRUD route pattern:

- `GET /api/{module}`
- `GET /api/{module}/{id}`
- `POST /api/{module}`
- `PUT /api/{module}/{id}`
- `DELETE /api/{module}/{id}`

Available Phase 2 module keys:

- `purchaseRequisitions`
- `purchaseRequisitionItems`
- `purchaseOrders`
- `purchaseOrderItems`
- `grns`
- `grnItems`
- `stockInwards`
- `stockTransactions`
- `stockIssues`
- `stockIssueItems`
- `productionOrders`
- `bomConsumptions`
- `finishedGoodsReceipts`
- `salesOrders`
- `salesOrderItems`
- `dispatches`
- `dispatchItems`

## Phase 2 Transaction Logic

- GRN status `Received`, `Accepted`, `Posted`, or `Completed` increases stock using `goods_receipt_items`.
- Move order status `Issued`, `Completed`, or `Closed` decreases stock using `move_order_items`.
- Production entry status `Completed`, `Posted`, or `Received` increases finished goods stock.
- Dispatch status `Dispatched`, `Completed`, or `Closed` decreases stock using `dispatch_items`.
- Stock movements are recorded in `stock_transaction_log`.
- Current balances are stored in `inventory_balance`.
- Negative stock is prevented by checking `inventory_balance` before outbound movements.
- Transaction numbers are generated in `backend/src/transactionNumbers.js` and protected with database-level unique indexes.

## Phase 2 Test Flow

1. Confirm Phase 1 master data exists for departments, employees, vendors, items, and customers.
2. Start the backend and frontend.
3. Create a Purchase Requisition and its PR Items, then create a Purchase Order and PO Items.
4. Create a GRN and GRN Items, then set GRN status to `Received` or `Accepted`; stock balance should increase.
5. Create a Move Order and Move Order Items, then set status to `Issued`; stock should decrease.
6. Create a Production Entry with status `Completed`; finished goods stock should increase.
7. Create a Customer Order and Dispatch with Dispatch Items, then set dispatch status to `Dispatched`; stock should decrease.

Utility routes:

- `GET /api/modules`
- `GET /api/dashboard`
- `GET /api/{module}/lookup`

## Bulk Data Import

Use the **Data Import** menu to import CSV or Excel `.xlsx` files.

Import features:

- Per-table sample CSV templates.
- Upload and preview before import.
- Validation summary for valid, skipped, and failed rows.
- Valid rows are imported; duplicates are skipped.
- Error report download as CSV.
- Import history with file name, table name, imported/skipped/failed counts, user, and status.
- Transaction numbers are generated by the backend during import, using the same auto-numbering logic as manual entry.

The first worksheet is used for `.xlsx` files. Header names should match database column names; code-based references such as `item_code`, `vendor_code`, `customer_code`, `employee_code`, and `department_code` are also resolved where supported.

## Notes

- The app reads table and column metadata from MySQL, so forms and tables follow the actual database columns.
- Employee forms use department dropdowns when the department column name is detected.
- Item forms use vendor dropdowns when the vendor column name is detected.
- MySQL foreign keys are also detected and converted into dropdown fields when they point to Phase 1 tables.
- `START_ERP_APP.bat` starts the Node backend and the React frontend together.
