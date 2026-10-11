import type { AccountType } from "@/lib/account-types";

export interface StandardAccount {
  code: string;
  name: string;
  accountType: AccountType;
  detailType: string;
}

/**
 * A small-business starter chart, numbered by category (1xxx assets, 2xxx
 * liabilities, 3xxx equity, 4xxx income, 5xxx cost of sales, 6xxx–7xxx expenses).
 * Every detail type must exist in `accountDetailsByType` for its account type —
 * the server re-validates them before saving.
 */
export const standardAccounts: readonly StandardAccount[] = [
  { code: "1000", name: "Cash on hand", accountType: "Cash and cash equivalents", detailType: "Cash on hand" },
  { code: "1010", name: "Business bank account", accountType: "Cash and cash equivalents", detailType: "Bank" },
  { code: "1100", name: "Accounts receivable (A/R)", accountType: "Accounts receivable (A/R)", detailType: "Accounts receivable (A/R)" },
  { code: "1200", name: "Inventory", accountType: "Current assets", detailType: "Inventory" },
  { code: "1250", name: "Prepaid expenses", accountType: "Current assets", detailType: "Prepaid expenses" },
  { code: "1300", name: "Undeposited funds", accountType: "Current assets", detailType: "Undeposited funds" },
  { code: "1500", name: "Furniture and equipment", accountType: "Fixed assets", detailType: "Furniture and fixtures" },
  { code: "2000", name: "Accounts payable (A/P)", accountType: "Accounts payable (A/P)", detailType: "Accounts payable (A/P)" },
  { code: "2100", name: "Business credit card", accountType: "Credit card", detailType: "Credit card" },
  { code: "2200", name: "Sales tax payable", accountType: "Current liabilities", detailType: "Sales tax payable" },
  { code: "2300", name: "Payroll liabilities", accountType: "Current liabilities", detailType: "Payroll tax payable" },
  { code: "2700", name: "Loan payable", accountType: "Non-current liabilities", detailType: "Long-term debt" },
  { code: "3000", name: "Owner's equity", accountType: "Owner's equity", detailType: "Owner's equity" },
  { code: "3100", name: "Owner draws", accountType: "Owner's equity", detailType: "Owner draws" },
  { code: "3200", name: "Opening balance equity", accountType: "Owner's equity", detailType: "Opening balance equity" },
  { code: "3900", name: "Retained earnings", accountType: "Owner's equity", detailType: "Retained earnings" },
  { code: "4000", name: "Sales", accountType: "Income", detailType: "Sales of product income" },
  { code: "4100", name: "Service income", accountType: "Income", detailType: "Service/fee income" },
  { code: "4200", name: "Discounts given", accountType: "Income", detailType: "Discounts/refunds given" },
  { code: "4900", name: "Interest earned", accountType: "Other income", detailType: "Interest earned" },
  { code: "5000", name: "Cost of goods sold", accountType: "Cost of sales", detailType: "Cost of goods sold" },
  { code: "6000", name: "Advertising and marketing", accountType: "Expenses", detailType: "Advertising/promotional" },
  { code: "6010", name: "Bank charges and fees", accountType: "Expenses", detailType: "Bank charges" },
  { code: "6020", name: "Contract labor", accountType: "Expenses", detailType: "Contract labor" },
  { code: "6030", name: "Dues and subscriptions", accountType: "Expenses", detailType: "Dues and subscriptions" },
  { code: "6040", name: "Insurance", accountType: "Expenses", detailType: "Insurance" },
  { code: "6050", name: "Legal and professional fees", accountType: "Expenses", detailType: "Legal and professional fees" },
  { code: "6060", name: "Meals and entertainment", accountType: "Expenses", detailType: "Meals and entertainment" },
  { code: "6070", name: "Office supplies and software", accountType: "Expenses", detailType: "Office/general administrative expenses" },
  { code: "6080", name: "Rent or lease", accountType: "Expenses", detailType: "Rent or lease" },
  { code: "6090", name: "Repairs and maintenance", accountType: "Expenses", detailType: "Repair and maintenance" },
  { code: "6100", name: "Salaries and wages", accountType: "Expenses", detailType: "Payroll expenses" },
  { code: "6110", name: "Taxes and licenses", accountType: "Expenses", detailType: "Taxes paid" },
  { code: "6120", name: "Travel", accountType: "Expenses", detailType: "Travel" },
  { code: "6130", name: "Utilities", accountType: "Expenses", detailType: "Utilities" },
  { code: "6140", name: "Vehicle expenses", accountType: "Expenses", detailType: "Auto" },
  { code: "6900", name: "Other business expenses", accountType: "Expenses", detailType: "Other business expenses" },
  { code: "7000", name: "Depreciation", accountType: "Other expense", detailType: "Depreciation" },
  { code: "7100", name: "Exchange gain or loss", accountType: "Other expense", detailType: "Exchange gain or loss" },
];
