<!-- Generated from .project/PROJECT.md by the engine — do not run `impeccable init`, which would interview a user who isn't here. Edit .project/PROJECT.md; this file is regenerated from it. -->
# MIKLEDGER

**Platform:** Responsive web — Next.js, React, Tailwind. shadcn/ui and lucide are installed and available; the direction decides whether they fit or whether this surface needs its own vocabulary.
**Task mode:** Operate (pass as `--mode operate` to any script)

## What this is

MIKLEDGER is a small-business bookkeeping workspace for customers, sales, purchases, banking, and financial reports.

## What it enables

Give owners a clear, account-specific place to manage routine bookkeeping and follow outstanding money.

## Primary user

Founders, freelancers, and small operators who need practical finance workflows without a complex setup.

## What exists today

Email and password sign-up/sign-in with records isolated to the signed-in account. - Read-only sample workspace preview for the dashboard, invoices, and expenses; preview records are not saved. - Dashboard KPIs and monthly income-versus-expense chart based on saved records. - CRUD workspaces for customers, vendors, items, invoices, estimates, sales orders, credit notes, recurring invoices, bills, expenses, purchase orders, banking, accounts, journals, taxes, team roles, and company settings. - Invoice email delivery and payment tracking; estimates and sales orders convert to invoices; purchase orders convert to bills; recurring schedules generate invoices; credit notes apply to invoices. - Bank reconciliation by statement date and ending balance, with transaction clearing, balanced-close validation, and per-account history. - Search, category/status filters, pagination, receipt/logo uploads, date-filtered financial reports, and CSV export. - Company settings provide a searchable choice of active global currencies; new invoices and bank accounts inherit the selected default. - Invoice, estimate, sales order, credit note, and recurring invoice forms let owners choose from their saved customers, showing company or email details while keeping the customer name on the record. - Invoice forms let owners choose saved items and services, add or remove line rows, adjust quantities and rates, and preview calculated totals. - Invoices support per-line descriptions, subtotal/tax/discount/total breakdowns, due-on-receipt or 15/30/60-day terms, duplicate drafts, PDF/image/CSV attachments, email sharing links, print/PDF views, and delivery by email or a prepared WhatsApp/SMS message. - Bill and purchase-order forms let owners choose from saved vendors, showing company or email details while keeping the vendor name on the record. - Manual journals support multiple debit and credit lines, account choices from Chart of Accounts, balanced totals, and CSV line import; the Trial Balance includes these entries and remains compatible with older journals. - Chart of Accounts has searchable and type-filtered account rows, opening-balance visibility, and a dedicated side panel for account details, sub-accounts, and locking; accounts used by journal entries cannot be deleted.

## Brand commitments & durable constraints

This is a working demo, not a substitute for professional accounting or tax advice. Team roles and approval settings are saved in the account’s team directory; they do not invite separate users or enforce different sign-in permissions. Financial summaries reflect the records entered by the account owner.

- **This project already HAS a committed visual world — do NOT offer a design picker.** `.project/DESIGN_SYSTEM.md` records a direction someone decided on, and the code, tokens and components are built around it. Read it, inherit it, and make the requested change inside it. Dealing six alternative worlds here offers to throw away a working design system nobody asked you to replace.
- **Tailoring is not redesigning.** "Make it about my business", new copy, a different logo, swapped imagery, a brand colour — all of that lands INSIDE the committed world. Change what was asked for and leave the direction alone.
- **The one exception is an explicit, whole-app redesign** — the user asking for a different look outright, not merely a change that happens to be large. Then the direction is open again and the picker applies. When they name the new direction themselves, that is the decision: pin it and build, still without a picker.
- The user's own words always outrank the roll. A direction, palette, face or reference they named is pinned; the roll only decides what they left open.
- Two review rounds is the budget, then ship and report open items honestly under the reviewer's own verdict — never announce a table with open findings as a pass.
- Web fonts load through Fontsource, never `next/font/google` — this sandbox has no Google egress, so the fetch hangs at compile and the preview renders blank.
- No AI-builder badge, watermark, or attribution anywhere in the product.
- Decisions recorded in `.project/` (ledger, DESIGN_SYSTEM.md) are commitments; contradict one only when the user asks.

## Positioning

MIKLEDGER is a small-business bookkeeping workspace for customers, sales, purchases, banking, and financial reports.

## Operating Context

Responsive web, built unattended in one pass. Task mode: Operate.

## Evidence on Hand

Email and password sign-up/sign-in with records isolated to the signed-in account. - Read-only sample workspace preview for the dashboard, invoices, and expenses; preview records are not saved. - Dashboard KPIs and monthly income-versus-expense chart based on saved records. - CRUD workspaces for customers, vendors, items, invoices, estimates, sales orders, credit notes, recurring invoices, bills, expenses, purchase orders, banking, accounts, journals, taxes, team roles, and company settings. - Invoice email delivery and payment tracking; estimates and sales orders convert to invoices; purchase orders convert to bills; recurring schedules generate invoices; credit notes apply to invoices. - Bank reconciliation by statement date and ending balance, with transaction clearing, balanced-close validation, and per-account history. - Search, category/status filters, pagination, receipt/logo uploads, date-filtered financial reports, and CSV export. - Company settings provide a searchable choice of active global currencies; new invoices and bank accounts inherit the selected default. - Invoice, estimate, sales order, credit note, and recurring invoice forms let owners choose from their saved customers, showing company or email details while keeping the customer name on the record. - Invoice forms let owners choose saved items and services, add or remove line rows, adjust quantities and rates, and preview calculated totals. - Invoices support per-line descriptions, subtotal/tax/discount/total breakdowns, due-on-receipt or 15/30/60-day terms, duplicate drafts, PDF/image/CSV attachments, email sharing links, print/PDF views, and delivery by email or a prepared WhatsApp/SMS message. - Bill and purchase-order forms let owners choose from saved vendors, showing company or email details while keeping the vendor name on the record. - Manual journals support multiple debit and credit lines, account choices from Chart of Accounts, balanced totals, and CSV line import; the Trial Balance includes these entries and remains compatible with older journals. - Chart of Accounts has searchable and type-filtered account rows, opening-balance visibility, and a dedicated side panel for account details, sub-accounts, and locking; accounts used by journal entries cannot be deleted.

## Product Principles

- Clarity of the task beats decoration; the interface earns attention only where the product does.
- Say what is true: no invented prices, customers, benchmarks or capabilities the product does not have.
