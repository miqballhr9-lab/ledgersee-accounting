---
name: "workspace"
description: "Build a functional accounting web application inspired by Zoho Books, with a left sidebar navigation and a clean, professional business-software look. The UI should be in English (with Roman Urdu labels where natural if desired). Include these working modules, each with real create/read/edit/delete and stored data (persist in the browser or a backend): 1. Dashboard — KPI cards (total income, total expenses, net profit, receivables, payables) and a simple income-vs-expense chart. 2. Customers — list, add, edit, delete customers; contact details, opening balance. 3. Vendors — same for suppliers. 4. Items / Products & Services — name, SKU, rate, unit, tax, stock quantity. 5. Invoices — create invoices with line items, tax, discount, due date; statuses (Draft, Sent, Paid, Overdue, Partially Paid); record payments; convert from an estimate. 6. Estimates / Quotes — create and convert to invoice. 7. Sales Orders — create and convert to invoice. 8. Credit Notes / Refunds — apply against invoices. 9. Recurring Invoices — simple recurring invoice setup. 10. Bills (vendor bills) — record vendor bills, mark paid, and Expense tracking with attachments/categories. 11. Purchase Orders — create and convert to bill. 12. Banking — add bank/cash accounts, record deposits and withdrawals, a simple \"reconcile/match transaction\" view, and bank rules/categorization. 13. Chart of Accounts — asset/liability/income/expense/equity account types, manual journals (double-entry). 14. Taxes — configurable tax rates (e.g. GST/VAT with CGST/SGST breakdown), tax summary. 15. Reports — Profit & Loss, Balance Sheet, Cash Flow, Trial Balance, Sales by Customer, Expenses by Category, Accounts Receivable/Payable ageing, with date-range filters and export to CSV. 16. Multi-currency — at least a currency setting and exchange rate field on invoices. 17. Users & Roles — add team members with roles (Admin, Accountant, Sales, Viewer) and a permissions switch. 18. Settings — company profile (name, logo, address, currency, fiscal year), invoice numbering, and email templates. Also include: search and filter on every list, pagination, and a simple login/signup screen so data is per-account. Make it responsive. This is a demo/working app, not a production system — but every listed module must actually function end to end, not be a dead placeholder."
typography:
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, \"SF Mono\", Menlo, Consolas, \"Liberation Mono\", monospace"
rounded:
  sm: "calc(var(--radius) * 0.6)"
  md: "calc(var(--radius) * 0.8)"
  lg: "0.625rem"
  xl: "calc(var(--radius) * 1.4)"
  2xl: "calc(var(--radius) * 1.8)"
  3xl: "calc(var(--radius) * 2.2)"
  4xl: "calc(var(--radius) * 2.6)"
---

<!-- Generated from .project/DESIGN_SYSTEM.md + app/globals.css by the engine. Tokens above are normative and mirror the CSS; edit the CSS and DESIGN_SYSTEM.md, not this file. -->

## Overview

**No visual direction has been committed for workspace yet.** The project is still on the starter's placeholder palette — shadcn's default neutral, every colour zero-chroma — so it is deliberately NOT listed above as a token set to respect. Treat this project as greenfield: decide the world, then write the palette into `globals.css`, and this file will state it from the next turn onward.

## Colors

| Token | Value |

## Typography

- Headings:
- Body:

- Mono: `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`

## Layout

- Radius / shadow / spacing rhythm:
- Shared components:

## Shapes

Radii: `sm` calc(var(--radius) * 0.6), `md` calc(var(--radius) * 0.8), `lg` 0.625rem, `xl` calc(var(--radius) * 1.4), `2xl` calc(var(--radius) * 1.8), `3xl` calc(var(--radius) * 2.2), `4xl` calc(var(--radius) * 2.6)

## Do's and Don'ts

- Do load faces through Fontsource, not `next/font/google`.
- Do write the direction's palette into `globals.css` as the token block; keep the token NAMES, replace the values.
- Don't use gradient text, or a purple/violet gradient as the brand signal.
- Don't use bounce or elastic easing; real objects decelerate smoothly.
