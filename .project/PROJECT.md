<!-- OWNER: Build (with the user) · READERS: every agent · READ THIS FIRST -->
# MIKLEDGER

**One-liner:** MIKLEDGER is a small-business bookkeeping and payroll workspace for customers, sales documents, purchases, banking, and financial reports.

## Goal
Give owners a clear, account-specific place to manage routine bookkeeping and follow outstanding money.

## Target users
Founders, freelancers, and small operators who need practical finance workflows without a complex setup.

## Status
- Stage: building
- Live URL: —
- Repo: —

## What exists today
<!-- Kept current by the Build agent after each build -->
- Email and password sign-up/sign-in with records isolated to the signed-in account.
- Read-only sample workspace preview for the dashboard, invoices, and expenses; preview records are not saved.
- Dashboard KPIs and monthly income-versus-expense chart based on saved records.
- CRUD workspaces for customers, vendors, items, invoices, estimates, sales orders, credit notes, recurring invoices, bills, expenses, purchase orders, banking, accounts, journals, taxes, team roles, and company settings.
- Bills have a dedicated payables workspace with outstanding and overdue totals, vendor/date/category visibility, status and category filters, CSV export, and direct edit, delete, and mark-paid actions.
- Invoice email delivery and payment tracking; estimates and sales orders convert to invoices; purchase orders convert to bills; recurring schedules generate invoices; credit notes apply to invoices.
- Bank reconciliation by statement date and ending balance, with transaction clearing, balanced-close validation, and per-account history.
- Search, category/status filters, pagination, receipt/logo uploads, searchable categorized financial reports with date filters and CSV export, plus saved budgets with Sales/Expenses/Payroll categories, matching account and transaction heads, Gross Salary actuals by payroll month, expected/actual variance, source-record drill-down, custom date ranges, copy, email sending, and category-aware CSV template import/export.
- Company settings provide a searchable choice of active global currencies; new invoices, sales documents, and bank accounts inherit the selected default.
- Invoice, estimate, sales order, credit note, and recurring invoice forms let owners choose from their saved customers, showing company or email details while keeping the customer name on the record.
- Invoice, estimate, sales order, and credit note forms let owners choose saved items and services, create a catalog item directly from an empty line, add or remove rows, edit per-line descriptions, adjust quantities and rates, and preview currency-aware tax, discount, and total calculations.
- Invoices, estimates, sales orders, and credit notes support saved items and services, PDF/image/CSV attachments, draft copies, public share links, print/PDF views, and delivery by email or a prepared WhatsApp/SMS message. Invoices and bills can use a selected Cash, Bank, or Credit card account from the Chart of Accounts, or remain unpaid on credit; invoices also support due-on-receipt or 15/30/60-day terms and payment tracking.
- Bill and purchase-order forms let owners choose from saved vendors, showing company or email details while keeping the vendor name on the record.
- Manual journals support multiple debit and credit lines, account choices from Chart of Accounts, balanced totals, and CSV line import; the Trial Balance includes these entries and remains compatible with older journals.
- Chart of Accounts has searchable and type-filtered account rows, grouped account types with matching detail choices, optional account numbers, subaccounts, dated opening balances with a balance-sheet preview, and account locking; accounts used by journal entries cannot be deleted.
- A back arrow in the workspace header returns to the previous page, with a dashboard fallback for directly opened sections.
- Monthly payroll records are saved per account with employee ID, email, joining date, CNIC, salary increments, attendance, allowances, Pakistan Tax Year 2027 salary-tax estimates, deductions, adjustments, descriptions, a Chart of Accounts payout account, and final payable salary; entries support search, edit, delete, next-month copy, printable salary slips, email delivery, custom date ranges, and CSV template import/export that updates matching employee/month rows.

## Constraints / must-nots
This is a working demo, not a substitute for professional accounting or tax advice. Team roles and approval settings are saved in the account’s team directory; they do not invite separate users or enforce different sign-in permissions. Financial summaries reflect the records entered by the account owner.
