# EV Motor ERP Verification Checklist - 2026-07-25

Use this checklist for the July 25, 2026 verification pass.

## Local Setup

- Confirm MySQL is running.
- Confirm the database name is `ev_motor_erp`.
- Copy `backend/.env.example` to `backend/.env` if needed, then fill in the local database password.
- Copy `frontend/.env.example` to `frontend/.env` if needed.
- Start the app with `START_ERP_APP.bat`.
- Open `http://localhost:5173`.

## Login

- Use the full-access verification account:
  - Username: `EMP013`
  - Employee: Balavidhya S
  - Role: Section Head
- If the password was changed again, reset the account rather than trying to recover the old password. Passwords are stored as hashes.

## Smoke Checks

- Login succeeds and opens the dashboard.
- Sidebar loads all modules for the Section Head account.
- Dashboard metrics load without an error message.
- Department, Employee, Vendor, Item, and Customer master lists open.
- Purchase Requisition, Purchase Order, GRN, Move Order, Production Order, Sales Order, Dispatch, and Finance screens open.
- Create/view/edit flows still show forms with dropdowns where foreign keys are expected.
- Data Import opens and shows module templates/history.

## Access-Control Checks

- `EMP013` can access all modules.
- A department user account can access only mapped department modules.
- Direct URL access to unauthorized modules redirects or blocks correctly.

## GitHub Checks

- GitHub Actions `Basic verification` completes successfully.
- Frontend build passes.
- Backend entrypoint syntax check passes.
- No `.env`, `node_modules`, build output, or local logs are committed.
