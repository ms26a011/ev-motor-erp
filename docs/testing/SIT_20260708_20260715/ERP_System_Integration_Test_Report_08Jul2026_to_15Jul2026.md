# SBV EV Motor Manufacturing ERP

# System Integration Testing Report

**Test period:** 08 July 2026 to 15 July 2026  
**Test-run ID:** `SIT_20260708_20260715`  
**Test environment:** Local React + Express/MySQL ERP database `ev_motor_erp`  
**Report generation date:** 2026-07-15 14:43:04

## 1. Cover Page

This report covers ERP-layer System Integration Testing for the SBV EV Motor Manufacturing ERP. It excludes analytics, forecasting, machine learning and AI features.

## 2. Executive Summary

| Metric | Value |
|---|---:|
| Total test cases | 57 |
| Passed | 57 |
| Failed | 0 |
| Blocked | 0 |
| Overall result | PASS |

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
| Python executable | C:\Users\sbvid\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe |
| Python version | 3.12.13 |
| Application URL | Localhost when dev server is running |

No secrets are included in this report.

## 5. Test Dataset Summary

| date | module | parent_transactions |
| --- | --- | --- |
| 2026-07-08 | purchase_requisition | 10 |
| 2026-07-09 | purchase_requisition | 10 |
| 2026-07-10 | purchase_requisition | 10 |
| 2026-07-11 | purchase_requisition | 10 |
| 2026-07-12 | purchase_requisition | 10 |
| 2026-07-13 | purchase_requisition | 10 |
| 2026-07-14 | purchase_requisition | 10 |
| 2026-07-15 | purchase_requisition | 10 |
| 2026-07-08 | purchase_order | 10 |
| 2026-07-09 | purchase_order | 10 |
| 2026-07-10 | purchase_order | 10 |
| 2026-07-11 | purchase_order | 10 |
| 2026-07-12 | purchase_order | 10 |
| 2026-07-13 | purchase_order | 10 |
| 2026-07-14 | purchase_order | 10 |
| 2026-07-15 | purchase_order | 10 |
| 2026-07-08 | goods_receipt | 10 |
| 2026-07-09 | goods_receipt | 10 |
| 2026-07-10 | goods_receipt | 10 |
| 2026-07-11 | goods_receipt | 10 |
| 2026-07-12 | goods_receipt | 10 |
| 2026-07-13 | goods_receipt | 10 |
| 2026-07-14 | goods_receipt | 10 |
| 2026-07-15 | goods_receipt | 10 |
| 2026-07-08 | stock_transaction_log | 60 |
| 2026-07-09 | stock_transaction_log | 60 |
| 2026-07-10 | stock_transaction_log | 60 |
| 2026-07-11 | stock_transaction_log | 60 |
| 2026-07-12 | stock_transaction_log | 60 |
| 2026-07-13 | stock_transaction_log | 60 |
| 2026-07-14 | stock_transaction_log | 60 |
| 2026-07-15 | stock_transaction_log | 60 |
| 2026-07-08 | move_order | 10 |
| 2026-07-09 | move_order | 10 |
| 2026-07-10 | move_order | 10 |
| 2026-07-11 | move_order | 10 |
| 2026-07-12 | move_order | 10 |
| 2026-07-13 | move_order | 10 |
| 2026-07-14 | move_order | 10 |
| 2026-07-15 | move_order | 10 |
| 2026-07-08 | production_order | 10 |
| 2026-07-09 | production_order | 10 |
| 2026-07-10 | production_order | 10 |
| 2026-07-11 | production_order | 10 |
| 2026-07-12 | production_order | 10 |
| 2026-07-13 | production_order | 10 |
| 2026-07-14 | production_order | 10 |
| 2026-07-15 | production_order | 10 |
| 2026-07-08 | bom_consumption | 10 |
| 2026-07-09 | bom_consumption | 10 |
| 2026-07-10 | bom_consumption | 10 |
| 2026-07-11 | bom_consumption | 10 |
| 2026-07-12 | bom_consumption | 10 |
| 2026-07-13 | bom_consumption | 10 |
| 2026-07-14 | bom_consumption | 10 |
| 2026-07-15 | bom_consumption | 10 |
| 2026-07-08 | finished_goods_receipt | 10 |
| 2026-07-09 | finished_goods_receipt | 10 |
| 2026-07-10 | finished_goods_receipt | 10 |
| 2026-07-11 | finished_goods_receipt | 10 |
| 2026-07-12 | finished_goods_receipt | 10 |
| 2026-07-13 | finished_goods_receipt | 10 |
| 2026-07-14 | finished_goods_receipt | 10 |
| 2026-07-15 | finished_goods_receipt | 10 |
| 2026-07-08 | customer_order | 10 |
| 2026-07-09 | customer_order | 10 |
| 2026-07-10 | customer_order | 10 |
| 2026-07-11 | customer_order | 10 |
| 2026-07-12 | customer_order | 10 |
| 2026-07-13 | customer_order | 10 |
| 2026-07-14 | customer_order | 10 |
| 2026-07-15 | customer_order | 10 |
| 2026-07-08 | dispatch | 10 |
| 2026-07-09 | dispatch | 10 |
| 2026-07-10 | dispatch | 10 |
| 2026-07-11 | dispatch | 10 |
| 2026-07-12 | dispatch | 10 |
| 2026-07-13 | dispatch | 10 |
| 2026-07-14 | dispatch | 10 |
| 2026-07-15 | dispatch | 10 |
| 2026-07-08 | vendor_invoice | 10 |
| 2026-07-09 | vendor_invoice | 10 |
| 2026-07-10 | vendor_invoice | 10 |
| 2026-07-11 | vendor_invoice | 10 |
| 2026-07-12 | vendor_invoice | 10 |
| 2026-07-13 | vendor_invoice | 10 |
| 2026-07-14 | vendor_invoice | 10 |
| 2026-07-15 | vendor_invoice | 10 |
| 2026-07-14 | vendor_payment | 35 |
| 2026-07-15 | vendor_payment | 45 |
| 2026-07-08 | customer_invoice | 10 |
| 2026-07-09 | customer_invoice | 10 |
| 2026-07-10 | customer_invoice | 10 |
| 2026-07-11 | customer_invoice | 10 |
| 2026-07-12 | customer_invoice | 10 |
| 2026-07-13 | customer_invoice | 10 |
| 2026-07-14 | customer_invoice | 10 |
| 2026-07-15 | customer_invoice | 10 |
| 2026-07-14 | customer_receipt | 35 |
| 2026-07-15 | customer_receipt | 45 |
| 2026-07-08 | journal_entry | 50 |
| 2026-07-09 | journal_entry | 50 |
| 2026-07-10 | journal_entry | 50 |
| 2026-07-11 | journal_entry | 50 |
| 2026-07-12 | journal_entry | 50 |
| 2026-07-13 | journal_entry | 50 |
| 2026-07-14 | journal_entry | 120 |
| 2026-07-15 | journal_entry | 140 |

## 6. End-to-End Business Flows

- Procure-to-Pay: PR -> PO -> GRN -> Inventory Increase -> Vendor Invoice -> Vendor Payment -> Journal Entry.
- Inventory: GRN receipt, internal movement, BOM consumption, finished goods receipt and dispatch stock movements.
- Production: Production Order -> Move Order -> BOM Consumption -> Finished Goods Receipt.
- Order-to-Cash: Customer Order -> Dispatch -> Customer Invoice -> Customer Receipt -> Journal Entry.
- Finance: Vendor and customer invoices/payments/receipts posted to balanced journals.
- Authentication/Admin Control: 12 linked login accounts validated without exposing passwords or hashes.

## 7. Detailed Test Cases

| case_id | module | scenario | expected | actual | status | evidence | defect_id |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SIT-TC-0001 | Schema | Inspect schema, keys, statuses and date columns | All required tables inspected | Inspected 36 tables | PASS |  |  |
| SIT-TC-0002 | Prerequisites | Load required master data | All required masters available | All required masters found | PASS |  |  |
| SIT-TC-0003 | Data Safety | Create backup tables before SIT insertion | Backup tables created | Backed up 25 tables | PASS |  |  |
| SIT-TC-0004 | Validation | P2P chronology after 2026-07-08 | 0 | 0 | PASS |  |  |
| SIT-TC-0005 | Validation | O2C chronology after 2026-07-08 | 0 | 0 | PASS |  |  |
| SIT-TC-0006 | Validation | Negative stock after 2026-07-08 | 0 | 0 | PASS |  |  |
| SIT-TC-0007 | Validation | Unbalanced journals after 2026-07-08 | 0 | 0 | PASS |  |  |
| SIT-TC-0008 | Validation | P2P chronology after 2026-07-09 | 0 | 0 | PASS |  |  |
| SIT-TC-0009 | Validation | O2C chronology after 2026-07-09 | 0 | 0 | PASS |  |  |
| SIT-TC-0010 | Validation | Negative stock after 2026-07-09 | 0 | 0 | PASS |  |  |
| SIT-TC-0011 | Validation | Unbalanced journals after 2026-07-09 | 0 | 0 | PASS |  |  |
| SIT-TC-0012 | Validation | P2P chronology after 2026-07-10 | 0 | 0 | PASS |  |  |
| SIT-TC-0013 | Validation | O2C chronology after 2026-07-10 | 0 | 0 | PASS |  |  |
| SIT-TC-0014 | Validation | Negative stock after 2026-07-10 | 0 | 0 | PASS |  |  |
| SIT-TC-0015 | Validation | Unbalanced journals after 2026-07-10 | 0 | 0 | PASS |  |  |
| SIT-TC-0016 | Validation | P2P chronology after 2026-07-11 | 0 | 0 | PASS |  |  |
| SIT-TC-0017 | Validation | O2C chronology after 2026-07-11 | 0 | 0 | PASS |  |  |
| SIT-TC-0018 | Validation | Negative stock after 2026-07-11 | 0 | 0 | PASS |  |  |
| SIT-TC-0019 | Validation | Unbalanced journals after 2026-07-11 | 0 | 0 | PASS |  |  |
| SIT-TC-0020 | Validation | P2P chronology after 2026-07-12 | 0 | 0 | PASS |  |  |
| SIT-TC-0021 | Validation | O2C chronology after 2026-07-12 | 0 | 0 | PASS |  |  |
| SIT-TC-0022 | Validation | Negative stock after 2026-07-12 | 0 | 0 | PASS |  |  |
| SIT-TC-0023 | Validation | Unbalanced journals after 2026-07-12 | 0 | 0 | PASS |  |  |
| SIT-TC-0024 | Validation | P2P chronology after 2026-07-13 | 0 | 0 | PASS |  |  |
| SIT-TC-0025 | Validation | O2C chronology after 2026-07-13 | 0 | 0 | PASS |  |  |
| SIT-TC-0026 | Validation | Negative stock after 2026-07-13 | 0 | 0 | PASS |  |  |
| SIT-TC-0027 | Validation | Unbalanced journals after 2026-07-13 | 0 | 0 | PASS |  |  |
| SIT-TC-0028 | Validation | P2P chronology after 2026-07-14 | 0 | 0 | PASS |  |  |
| SIT-TC-0029 | Validation | O2C chronology after 2026-07-14 | 0 | 0 | PASS |  |  |
| SIT-TC-0030 | Validation | Negative stock after 2026-07-14 | 0 | 0 | PASS |  |  |
| SIT-TC-0031 | Validation | Unbalanced journals after 2026-07-14 | 0 | 0 | PASS |  |  |
| SIT-TC-0032 | Validation | P2P chronology after 2026-07-15 | 0 | 0 | PASS |  |  |
| SIT-TC-0033 | Validation | O2C chronology after 2026-07-15 | 0 | 0 | PASS |  |  |
| SIT-TC-0034 | Validation | Negative stock after 2026-07-15 | 0 | 0 | PASS |  |  |
| SIT-TC-0035 | Validation | Unbalanced journals after 2026-07-15 | 0 | 0 | PASS |  |  |
| SIT-TC-0036 | Data Population | Insert one week of integrated SIT transactions | All valid chains committed | Inserted 4082 rows | PASS |  |  |
| SIT-TC-0037 | Negative Testing | Invalid foreign key | Rejected with rollback | Rejected/rolled back: 1644 (45000): purchase_requisition_items.pr_id must reference an existing purchase requisition | PASS |  |  |
| SIT-TC-0038 | Negative Testing | Duplicate business document number | Rejected with rollback | Rejected/rolled back: 1062 (23000): Duplicate entry 'SIT-PR-0708-01' for key 'purchase_requisition.pr_number' | PASS |  |  |
| SIT-TC-0039 | Negative Testing | Payment greater than invoice balance | Rejected with rollback | Rejected/rolled back: Business validation rejected overpayment before commit | PASS |  |  |
| SIT-TC-0040 | Negative Testing | Receipt greater than invoice balance | Rejected with rollback | Rejected/rolled back: Business validation rejected over-receipt before commit | PASS |  |  |
| SIT-TC-0041 | Negative Testing | Unbalanced journal entry | Rejected with rollback | Rejected/rolled back: Unbalanced journal for Negative Test 0: 10.00 != 9.00 | PASS |  |  |
| SIT-TC-0042 | Authentication | Validate 12 login accounts | 12 active accounts | 12 accounts found | PASS |  |  |
| SIT-TC-0043 | Access Control | Raja module authorization | Procurement + reference masters | Procurement + reference masters | PASS |  |  |
| SIT-TC-0044 | Access Control | Priya module authorization | Inventory/Warehouse + GRN | Inventory/Warehouse + GRN | PASS |  |  |
| SIT-TC-0045 | Access Control | Varshini module authorization | Production + inventory + BOM | Production + inventory + BOM | PASS |  |  |
| SIT-TC-0046 | Access Control | Karthik module authorization | Production + inventory + BOM | Production + inventory + BOM | PASS |  |  |
| SIT-TC-0047 | Access Control | Gokul module authorization | Production + inventory + BOM | Production + inventory + BOM | PASS |  |  |
| SIT-TC-0048 | Access Control | Harish module authorization | Sales/Dispatch + finished goods inventory | Sales/Dispatch + finished goods inventory | PASS |  |  |
| SIT-TC-0049 | Access Control | Balavidhya S module authorization | All modules | All modules | PASS |  |  |
| SIT-TC-0050 | Access Control | Ramesh module authorization | All modules | All modules | PASS |  |  |
| SIT-TC-0051 | Access Control | Reshma module authorization | All modules | All modules | PASS |  |  |
| SIT-TC-0052 | Access Control | Abitha module authorization | All modules | All modules | PASS |  |  |
| SIT-TC-0053 | Access Control | Lolita module authorization | All modules | All modules | PASS |  |  |
| SIT-TC-0054 | Access Control | Farooq module authorization | All modules | All modules | PASS |  |  |
| SIT-TC-0055 | Access Control | Balavidhya S full access | SECTION_HEAD full access | SECTION_HEAD | PASS |  |  |
| SIT-TC-0056 | Inventory | Inventory reconciliation and negative stock validation | 0 negative stock rows | 0 | PASS |  |  |
| SIT-TC-0057 | Finance | Finance reconciliation | Balanced journals and settled invoices | Unbalanced journals: 0 | PASS |  |  |

## 8. Finance Reconciliation

| vendor_invoice_total | vendor_payment_total | accounts_payable_outstanding | customer_invoice_total | customer_receipt_total | accounts_receivable_outstanding | journal_debit_total | journal_credit_total | unbalanced_journal_count |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 18467354.00 | 18467354.00 | 0.00 | 34084713.00 | 34084713.00 | 0.00 | 150985534.00 | 150985534.00 | 0 |

## 9. Inventory Reconciliation

| item_code | item_name | department | opening_stock | closing_stock | movement | negative_stock_count |
| --- | --- | --- | --- | --- | --- | --- |
| MEC007 | Housing 1.5 kW | RMWH | 354.816 | 1901.816 | 1547.000 | 0 |
| MEC008 | Housing 3 kW | RMWH | 0.000 | 1611.000 | 1611.000 | 0 |
| MEC009 | Housing 7.5 kW | RMWH | 0.000 | 1602.000 | 1602.000 | 0 |

## 10. Access-Control Results

| masked_account | employee_name | department | role | expected_access | actual_access | result |
| --- | --- | --- | --- | --- | --- | --- |
| ***001 | Raja | Procurement | DEPARTMENT_USER | PROC mapped modules | PROC mapped modules | PASS |
| ***003 | Priya | Raw Material Warehouse | DEPARTMENT_USER | RMWH mapped modules | RMWH mapped modules | PASS |
| ***005 | Varshini | Stator Manufacturing | DEPARTMENT_USER | STAT mapped modules | STAT mapped modules | PASS |
| ***007 | Karthik | Rotor Manufacturing | DEPARTMENT_USER | ROTR mapped modules | ROTR mapped modules | PASS |
| ***009 | Gokul | Assembly | DEPARTMENT_USER | ASMB mapped modules | ASMB mapped modules | PASS |
| ***011 | Harish | Finished Goods Warehouse | DEPARTMENT_USER | FGWH mapped modules | FGWH mapped modules | PASS |
| ***013 | Balavidhya S | Procurement | SECTION_HEAD | All modules | All modules | PASS |
| ***002 | Ramesh | Raw Material Warehouse | SECTION_HEAD | All modules | All modules | PASS |
| ***004 | Reshma | Procurement | SECTION_HEAD | All modules | All modules | PASS |
| ***006 | Abitha | Stator Manufacturing | SECTION_HEAD | All modules | All modules | PASS |
| ***008 | Lolita | Rotor Manufacturing | SECTION_HEAD | All modules | All modules | PASS |
| ***010 | Farooq | Assembly | SECTION_HEAD | All modules | All modules | PASS |

## 11. Negative Test Results

| scenario | expected | actual | status |
| --- | --- | --- | --- |
| Invalid foreign key | Rejected with rollback | Rejected/rolled back: 1644 (45000): purchase_requisition_items.pr_id must reference an existing purchase requisition | PASS |
| Duplicate business document number | Rejected with rollback | Rejected/rolled back: 1062 (23000): Duplicate entry 'SIT-PR-0708-01' for key 'purchase_requisition.pr_number' | PASS |
| Payment greater than invoice balance | Rejected with rollback | Rejected/rolled back: Business validation rejected overpayment before commit | PASS |
| Receipt greater than invoice balance | Rejected with rollback | Rejected/rolled back: Business validation rejected over-receipt before commit | PASS |
| Unbalanced journal entry | Rejected with rollback | Rejected/rolled back: Unbalanced journal for Negative Test 0: 10.00 != 9.00 | PASS |

## 12. Defect Log

_No records._

## 13. Screenshots and Evidence Index

Automatic browser screenshots were not captured by this Python database runner. Use the generated `erp_sit_screenshot_checklist.csv` for manual evidence capture.

| evidence_file | status | notes |
| --- | --- | --- |
| ERP_SIT_001_Login_Full_Access.png | Manual capture required | Automatic browser screenshots were not captured by this runner. |
| ERP_SIT_002_Department_Restricted_Access.png | Manual capture required | Automatic browser screenshots were not captured by this runner. |
| ERP_SIT_003_PR_Created.png | Manual capture required | Automatic browser screenshots were not captured by this runner. |
| ERP_SIT_004_PO_Created.png | Manual capture required | Automatic browser screenshots were not captured by this runner. |
| ERP_SIT_005_GRN_Completed.png | Manual capture required | Automatic browser screenshots were not captured by this runner. |
| ERP_SIT_006_Inventory_Increased.png | Manual capture required | Automatic browser screenshots were not captured by this runner. |
| ERP_SIT_007_BOM_Consumption.png | Manual capture required | Automatic browser screenshots were not captured by this runner. |
| ERP_SIT_008_FG_Receipt.png | Manual capture required | Automatic browser screenshots were not captured by this runner. |
| ERP_SIT_009_Customer_Order.png | Manual capture required | Automatic browser screenshots were not captured by this runner. |
| ERP_SIT_010_Dispatch.png | Manual capture required | Automatic browser screenshots were not captured by this runner. |
| ERP_SIT_011_Vendor_Invoice.png | Manual capture required | Automatic browser screenshots were not captured by this runner. |
| ERP_SIT_012_Vendor_Payment.png | Manual capture required | Automatic browser screenshots were not captured by this runner. |
| ERP_SIT_013_Customer_Invoice.png | Manual capture required | Automatic browser screenshots were not captured by this runner. |
| ERP_SIT_014_Customer_Receipt.png | Manual capture required | Automatic browser screenshots were not captured by this runner. |
| ERP_SIT_015_Journal_Balanced.png | Manual capture required | Automatic browser screenshots were not captured by this runner. |
| ERP_SIT_016_Access_Denied.png | Manual capture required | Automatic browser screenshots were not captured by this runner. |
| ERP_SIT_017_Dashboard_Validation.png | Manual capture required | Automatic browser screenshots were not captured by this runner. |

## 14. Final Conclusion

Overall ERP integration status: **PASS**.

The ERP is ready for final demonstration only if failed or blocked items are accepted or retested after remediation. Cloud deployment readiness should be decided after manual screenshot evidence and any open defects are reviewed.

## Data Safety

Before insertion, the runner created MySQL backup tables named `sit_bkp_20260708_20260715_<table>` for each affected operational and finance table. The cleanup script deletes only `SIT-*` records and reverses logged inventory, bank and journal balance movements.
