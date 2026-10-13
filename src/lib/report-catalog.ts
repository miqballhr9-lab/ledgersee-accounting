/**
 * The reports list, in the QuickBooks Online categories. `ready: false`
 * reports are listed so people can see what is coming; they open once built.
 */

export type ReportEngine =
  | "pnl" | "bs" | "cf" | "pnl-detail" | "bs-detail" | "general-ledger" | "trial-balance"
  | "sales-by-customer" | "ar-ageing" | "ap-ageing" | "tax-summary" | "snapshot" | "budget-overview" | "budget-vs-actuals" | "list";

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
      { key: "audit-log", label: "Audit Log", description: "Who added, changed or deleted what, and when.", ready: true, engine: "list" },
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
      { key: "accounts-receivable-ageing-detail", label: "Accounts receivable ageing detail", description: "Each unpaid invoice, grouped by how late it is.", ready: true, engine: "list" },
      { key: "collections-report", label: "Collections Report", description: "Overdue invoices with customer contact details.", ready: true, engine: "list" },
      { key: "customer-balance-summary", label: "Customer Balance Summary", description: "What each customer owes.", ready: true, engine: "list" },
      { key: "customer-balance-detail", label: "Customer Balance Detail", description: "Each customer's open invoices and payments.", ready: true, engine: "list" },
      { key: "invoice-list", label: "Invoice List", description: "All invoices in a period.", ready: true, engine: "list" },
      { key: "open-invoices", label: "Open Invoices", description: "Invoices not yet fully paid.", ready: true, engine: "list" },
      { key: "customer-statement", label: "Customer Statements", description: "Each customer's invoices, payments and credits with a running balance.", ready: true, engine: "list" },
    ],
  },
  {
    key: "sales-and-customers",
    label: "Sales and customers",
    reports: [
      { key: "sales-by-customer-summary", label: "Sales by Customer Summary", description: "Total sales for each customer.", ready: true, engine: "sales-by-customer" },
      { key: "sales-by-customer-detail", label: "Sales by Customer Detail", description: "Each sale, grouped by customer.", ready: true, engine: "list" },
      { key: "sales-by-product-summary", label: "Sales by Product/Service Summary", description: "Quantity and sales for each item.", ready: true, engine: "list" },
      { key: "sales-by-product-detail", label: "Sales by Product/Service Detail", description: "Each sale, grouped by item.", ready: true, engine: "list" },
      { key: "estimates-by-customer", label: "Estimates by Customer", description: "Estimates, grouped by customer.", ready: true, engine: "list" },
      { key: "sales-order-list", label: "Sales Order List", description: "Sales orders and their status.", ready: true, engine: "list" },
      { key: "payment-method-list", label: "Payment Method List", description: "Payments received, by method.", ready: true, engine: "list" },
      { key: "customer-contact-list", label: "Customer Contact List", description: "Customer names, emails and phone numbers.", ready: true, engine: "list" },
    ],
  },
  {
    key: "what-you-owe",
    label: "What you owe",
    reports: [
      { key: "accounts-payable-ageing-summary", label: "Accounts payable ageing summary", description: "Unpaid supplier balances, grouped by how late they are.", ready: true, engine: "ap-ageing" },
      { key: "accounts-payable-ageing-detail", label: "Accounts payable ageing detail", description: "Each unpaid bill, grouped by how late it is.", ready: true, engine: "list" },
      { key: "supplier-balance-summary", label: "Supplier Balance Summary", description: "What you owe each supplier.", ready: true, engine: "list" },
      { key: "supplier-balance-detail", label: "Supplier Balance Detail", description: "Each supplier's open bills and payments.", ready: true, engine: "list" },
      { key: "unpaid-bills", label: "Unpaid Bills", description: "Bills not yet fully paid.", ready: true, engine: "list" },
      { key: "bill-payment-list", label: "Bill Payment List", description: "Bill payments in a period.", ready: true, engine: "list" },
    ],
  },
  {
    key: "expenses-and-suppliers",
    label: "Expenses and suppliers",
    reports: [
      { key: "expenses-by-supplier-summary", label: "Expenses by Supplier Summary", description: "What you spent with each supplier.", ready: true, engine: "list" },
      { key: "purchases-by-supplier-detail", label: "Purchases by Supplier Detail", description: "Each purchase, grouped by supplier.", ready: true, engine: "list" },
      { key: "purchases-by-product-detail", label: "Purchases by Product/Service Detail", description: "Each purchase, grouped by item.", ready: true, engine: "list" },
      { key: "open-purchase-order-list", label: "Open Purchase Order List", description: "Purchase orders not yet received.", ready: true, engine: "list" },
      { key: "transaction-list-by-supplier", label: "Transaction List by Supplier", description: "All transactions, grouped by supplier.", ready: true, engine: "list" },
      { key: "supplier-contact-list", label: "Supplier Contact List", description: "Supplier names, emails and phone numbers.", ready: true, engine: "list" },
    ],
  },
  {
    key: "sales-tax",
    label: "Sales tax",
    reports: [
      { key: "tax-summary", label: "Tax Summary", description: "Tax collected, tax paid and what is left to pay.", ready: true, engine: "tax-summary" },
      { key: "tax-detail", label: "Tax Detail", description: "Each transaction with tax on it.", ready: true, engine: "list" },
      soon("tax-exception", "Tax Exception", "Changes to transactions in periods already filed."),
      { key: "taxable-sales-summary", label: "Taxable Sales Summary", description: "Taxable and non-taxable sales.", ready: true, engine: "list" },
    ],
  },
  {
    key: "employees",
    label: "Employees",
    reports: [
      { key: "payroll-summary", label: "Payroll Summary", description: "Gross pay, deductions and net pay by month.", ready: true, engine: "list" },
      { key: "payroll-details", label: "Payroll Details", description: "Each salary entry.", ready: true, engine: "list" },
      { key: "payroll-tax-liability", label: "Payroll Tax Liability", description: "Tax withheld from salaries, by employee.", ready: true, engine: "list" },
      { key: "employee-details", label: "Employee Details", description: "Employee records and contact details.", ready: true, engine: "list" },
      { key: "attendance-summary", label: "Attendance Summary", description: "Days present, absent and on leave.", ready: true, engine: "list" },
      { key: "leave-summary", label: "Leave Summary", description: "Leave taken and remaining.", ready: true, engine: "list" },
      { key: "loans-outstanding", label: "Loans outstanding", description: "Employee loans and advances still to recover.", ready: true, engine: "list" },
    ],
  },
  {
    key: "for-my-accountant",
    label: "For my accountant",
    reports: [
      { key: "account-list", label: "Account List", description: "Your chart of accounts with balances.", ready: true, engine: "list" },
      { key: "general-ledger", label: "General Ledger", description: "Every transaction in every account, with running balances.", ready: true, engine: "general-ledger" },
      { key: "journal", label: "Journal", description: "Each transaction as debits and credits.", ready: true, engine: "list" },
      { key: "trial-balance", label: "Trial Balance", description: "Debit and credit balances of every account.", ready: true, engine: "trial-balance" },
      { key: "transaction-detail-by-account", label: "Transaction Detail by Account", description: "Transactions grouped by account.", ready: true, engine: "list" },
      { key: "transaction-list-by-date", label: "Transaction List by Date", description: "All transactions in date order.", ready: true, engine: "list" },
      { key: "recent-transactions", label: "Recent Transactions", description: "Transactions added in the last few days.", ready: true, engine: "list" },
      { key: "reconciliation-reports", label: "Reconciliation Reports", description: "Completed bank reconciliations.", ready: true, engine: "list" },
    ],
  },
  {
    key: "inventory",
    label: "Inventory",
    reports: [
      { key: "inventory-valuation-summary", label: "Inventory Valuation Summary", description: "Quantity on hand and value of each item.", ready: true, engine: "list" },
      { key: "inventory-valuation-detail", label: "Inventory Valuation Detail", description: "Stock movements and their value.", ready: true, engine: "list" },
      { key: "stock-take-worksheet", label: "Stock Take Worksheet", description: "A sheet for counting stock.", ready: true, engine: "list" },
      { key: "product-service-list", label: "Product/Service List", description: "Items with prices and costs.", ready: true, engine: "list" },
    ],
  },
];

export const allReports = reportCategories.flatMap((category) => category.reports.map((report) => ({ ...report, category: category.label })));

export function reportByKey(key: string) {
  return allReports.find((report) => report.key === key);
}

export const defaultFavourites = ["profit-and-loss", "balance-sheet", "accounts-receivable-ageing-summary", "sales-by-customer-summary"];
