/**
 * The reports list, in the QuickBooks Online categories. `ready: false`
 * reports are listed so people can see what is coming; they open once built.
 */

export type ReportEngine =
  | "pnl" | "bs" | "cf" | "pnl-detail" | "bs-detail" | "general-ledger" | "trial-balance"
  | "sales-by-customer" | "ar-ageing" | "ap-ageing" | "tax-summary" | "snapshot" | "budget-overview" | "budget-vs-actuals";

export interface ReportDefinition {
  key: string;
  label: string;
  description: string;
  ready: boolean;
  engine?: ReportEngine;
  /** Settings this report opens with. */
  defaults?: {
    columnsBy?: "total" | "months" | "quarters" | "customers";
    compare?: "py" | "pp";
    pctOfIncome?: boolean;
    period?: string;
  };
}

export interface ReportCategory {
  key: string;
  label: string;
  reports: ReportDefinition[];
}

const soon = (key: string, label: string, description: string): ReportDefinition => ({ key, label, description, ready: false });

export const reportCategories: ReportCategory[] = [
  {
    key: "business-overview",
    label: "Business overview",
    reports: [
      soon("audit-log", "Audit Log", "Who added, changed or deleted what, and when."),
      { key: "balance-sheet", label: "Balance Sheet", description: "What you own (assets), what you owe (liabilities) and what you invested (equity).", ready: true, engine: "bs" },
      { key: "balance-sheet-comparison", label: "Balance Sheet Comparison", description: "Your balance sheet today next to the same date last year.", ready: true, engine: "bs", defaults: { compare: "py" } },
      { key: "balance-sheet-detail", label: "Balance Sheet Detail", description: "Every transaction behind each balance sheet account.", ready: true, engine: "bs-detail" },
      { key: "business-snapshot", label: "Business Snapshot", description: "Income, expenses and balances at a glance.", ready: true, engine: "snapshot" },
      { key: "profit-and-loss", label: "Profit and Loss", description: "Income, expenses and net income for a period.", ready: true, engine: "pnl" },
      { key: "profit-and-loss-pct-income", label: "Profit and Loss as % of total income", description: "Each line as a share of total income.", ready: true, engine: "pnl", defaults: { pctOfIncome: true } },
      { key: "profit-and-loss-comparison", label: "Profit and Loss Comparison", description: "This period next to the same period last year.", ready: true, engine: "pnl", defaults: { compare: "py" } },
      { key: "profit-and-loss-detail", label: "Profit and Loss Detail", description: "Every income and expense transaction for the period.", ready: true, engine: "pnl-detail" },
      { key: "profit-and-loss-by-customer", label: "Profit and Loss by Customer", description: "Income and expenses split by customer.", ready: true, engine: "pnl", defaults: { columnsBy: "customers" } },
      { key: "profit-and-loss-by-month", label: "Profit and Loss by Month", description: "Each month in its own column.", ready: true, engine: "pnl", defaults: { columnsBy: "months" } },
      { key: "quarterly-profit-and-loss", label: "Quarterly Profit and Loss Summary", description: "Each quarter in its own column.", ready: true, engine: "pnl", defaults: { columnsBy: "quarters" } },
      { key: "statement-of-cash-flows", label: "Statement of Cash Flows", description: "Where cash came from and where it went.", ready: true, engine: "cf" },
      { key: "budget-overview", label: "Budget Overview", description: "The amounts set in each budget.", ready: true, engine: "budget-overview" },
      { key: "budget-vs-actuals", label: "Budget vs. Actuals", description: "Each budget next to what was actually recorded.", ready: true, engine: "budget-vs-actuals" },
    ],
  },
  {
    key: "who-owes-you",
    label: "Who owes you",
    reports: [
      { key: "accounts-receivable-ageing-summary", label: "Accounts receivable ageing summary", description: "Unpaid customer balances, grouped by how late they are.", ready: true, engine: "ar-ageing" },
      soon("accounts-receivable-ageing-detail", "Accounts receivable ageing detail", "Each unpaid invoice, grouped by how late it is."),
      soon("collections-report", "Collections Report", "Overdue invoices with customer contact details."),
      soon("customer-balance-summary", "Customer Balance Summary", "What each customer owes."),
      soon("customer-balance-detail", "Customer Balance Detail", "Each customer's open invoices and payments."),
      soon("invoice-list", "Invoice List", "All invoices in a period."),
      soon("open-invoices", "Open Invoices", "Invoices not yet fully paid."),
      soon("statement-list", "Statement List", "Customer statements sent."),
    ],
  },
  {
    key: "sales-and-customers",
    label: "Sales and customers",
    reports: [
      { key: "sales-by-customer-summary", label: "Sales by Customer Summary", description: "Total sales for each customer.", ready: true, engine: "sales-by-customer" },
      soon("sales-by-customer-detail", "Sales by Customer Detail", "Each sale, grouped by customer."),
      soon("sales-by-product-summary", "Sales by Product/Service Summary", "Quantity and sales for each item."),
      soon("sales-by-product-detail", "Sales by Product/Service Detail", "Each sale, grouped by item."),
      soon("estimates-by-customer", "Estimates by Customer", "Estimates, grouped by customer."),
      soon("sales-order-list", "Sales Order List", "Sales orders and their status."),
      soon("payment-method-list", "Payment Method List", "Payments received, by method."),
      soon("customer-contact-list", "Customer Contact List", "Customer names, emails and phone numbers."),
    ],
  },
  {
    key: "what-you-owe",
    label: "What you owe",
    reports: [
      { key: "accounts-payable-ageing-summary", label: "Accounts payable ageing summary", description: "Unpaid supplier balances, grouped by how late they are.", ready: true, engine: "ap-ageing" },
      soon("accounts-payable-ageing-detail", "Accounts payable ageing detail", "Each unpaid bill, grouped by how late it is."),
      soon("supplier-balance-summary", "Supplier Balance Summary", "What you owe each supplier."),
      soon("supplier-balance-detail", "Supplier Balance Detail", "Each supplier's open bills and payments."),
      soon("unpaid-bills", "Unpaid Bills", "Bills not yet fully paid."),
      soon("bill-payment-list", "Bill Payment List", "Bill payments in a period."),
    ],
  },
  {
    key: "expenses-and-suppliers",
    label: "Expenses and suppliers",
    reports: [
      soon("expenses-by-supplier-summary", "Expenses by Supplier Summary", "What you spent with each supplier."),
      soon("purchases-by-supplier-detail", "Purchases by Supplier Detail", "Each purchase, grouped by supplier."),
      soon("purchases-by-product-detail", "Purchases by Product/Service Detail", "Each purchase, grouped by item."),
      soon("open-purchase-order-list", "Open Purchase Order List", "Purchase orders not yet received."),
      soon("transaction-list-by-supplier", "Transaction List by Supplier", "All transactions, grouped by supplier."),
      soon("supplier-contact-list", "Supplier Contact List", "Supplier names, emails and phone numbers."),
    ],
  },
  {
    key: "sales-tax",
    label: "Sales tax",
    reports: [
      { key: "tax-summary", label: "Tax Summary", description: "Tax collected, tax paid and what is left to pay.", ready: true, engine: "tax-summary" },
      soon("tax-detail", "Tax Detail", "Each transaction with tax on it."),
      soon("tax-exception", "Tax Exception", "Changes to transactions in periods already filed."),
      soon("taxable-sales-summary", "Taxable Sales Summary", "Taxable and non-taxable sales."),
    ],
  },
  {
    key: "employees",
    label: "Employees",
    reports: [
      soon("payroll-summary", "Payroll Summary", "Gross pay, deductions and net pay by month."),
      soon("payroll-details", "Payroll Details", "Each salary entry."),
      soon("payroll-tax-liability", "Payroll Tax Liability", "Tax withheld from salaries, by employee."),
      soon("employee-details", "Employee Details", "Employee records and contact details."),
      soon("attendance-summary", "Attendance Summary", "Days present, absent and on leave."),
      soon("leave-summary", "Leave Summary", "Leave taken and remaining."),
      soon("loans-outstanding", "Loans outstanding", "Employee loans and advances still to recover."),
    ],
  },
  {
    key: "for-my-accountant",
    label: "For my accountant",
    reports: [
      soon("account-list", "Account List", "Your chart of accounts with balances."),
      { key: "general-ledger", label: "General Ledger", description: "Every transaction in every account, with running balances.", ready: true, engine: "general-ledger" },
      soon("journal", "Journal", "Each transaction as debits and credits."),
      { key: "trial-balance", label: "Trial Balance", description: "Debit and credit balances of every account.", ready: true, engine: "trial-balance" },
      soon("transaction-detail-by-account", "Transaction Detail by Account", "Transactions grouped by account."),
      soon("transaction-list-by-date", "Transaction List by Date", "All transactions in date order."),
      soon("recent-transactions", "Recent Transactions", "Transactions added in the last few days."),
      soon("reconciliation-reports", "Reconciliation Reports", "Completed bank reconciliations."),
    ],
  },
  {
    key: "inventory",
    label: "Inventory",
    reports: [
      soon("inventory-valuation-summary", "Inventory Valuation Summary", "Quantity on hand and value of each item."),
      soon("inventory-valuation-detail", "Inventory Valuation Detail", "Stock movements and their value."),
      soon("stock-take-worksheet", "Stock Take Worksheet", "A sheet for counting stock."),
      soon("product-service-list", "Product/Service List", "Items with prices and costs."),
    ],
  },
];

export const allReports = reportCategories.flatMap((category) => category.reports.map((report) => ({ ...report, category: category.label })));

export function reportByKey(key: string) {
  return allReports.find((report) => report.key === key);
}

export const defaultFavourites = ["profit-and-loss", "balance-sheet", "accounts-receivable-ageing-summary", "sales-by-customer-summary"];
