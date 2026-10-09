<!-- OWNER: Build (with the user) · READERS: every agent · READ THIS FIRST -->
# MIKLEDGER

**One-liner:** MIKLEDGER is a small-business bookkeeping workspace for customers, sales, purchases, banking, and financial reports.

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
- Invoice email delivery and payment tracking; estimates and sales orders convert to invoices; purchase orders convert to bills; recurring schedules generate invoices; credit notes apply to invoices.
- Bank reconciliation by statement date and ending balance, with transaction clearing, balanced-close validation, and per-account history.
- Search, category/status filters, pagination, receipt/logo uploads, date-filtered financial reports, and CSV export.
- Company settings provide a searchable choice of active global currencies; new invoices and bank accounts inherit the selected default.
- Invoice, estimate, sales order, credit note, and recurring invoice forms let owners choose from their saved customers, showing company or email details while keeping the customer name on the record.
- Invoice forms let owners choose saved items and services, add or remove line rows, adjust quantities and rates, and preview calculated totals.
- Invoices support per-line descriptions, subtotal/tax/discount/total breakdowns, due-on-receipt or 15/30/60-day terms, duplicate drafts, email sharing links, and print/PDF views.
- Bill and purchase-order forms let owners choose from saved vendors, showing company or email details while keeping the vendor name on the record.
- Manual journals support multiple debit and credit lines, account choices from Chart of Accounts, balanced totals, and CSV line import; the Trial Balance includes these entries and remains compatible with older journals.
- Chart of Accounts has searchable and type-filtered account rows, opening-balance visibility, and a dedicated side panel for account details, sub-accounts, and locking; accounts used by journal entries cannot be deleted.

## Constraints / must-nots
This is a working demo, not a substitute for professional accounting or tax advice. Team roles and approval settings are saved in the account’s team directory; they do not invite separate users or enforce different sign-in permissions. Financial summaries reflect the records entered by the account owner.
