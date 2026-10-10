export const accountTypeGroups = [
  {
    category: "Asset",
    heading: "ASSET",
    accountTypes: [
      "Cash and cash equivalents",
      "Accounts receivable (A/R)",
      "Current assets",
      "Fixed assets",
      "Non-current assets",
    ],
  },
  {
    category: "Liability",
    heading: "LIABILITY",
    accountTypes: [
      "Credit card",
      "Accounts payable (A/P)",
      "Current liabilities",
      "Non-current liabilities",
    ],
  },
  {
    category: "Equity",
    heading: "EQUITY",
    accountTypes: ["Owner's equity"],
  },
  {
    category: "Income",
    heading: "INCOME",
    accountTypes: ["Income", "Other income"],
  },
  {
    category: "Expense",
    heading: "EXPENSE",
    accountTypes: ["Cost of sales", "Expenses", "Other expense"],
  },
] as const;

export type AccountCategory = (typeof accountTypeGroups)[number]["category"];
export type AccountType = (typeof accountTypeGroups)[number]["accountTypes"][number];

export const accountDetailsByType = {
  "Cash and cash equivalents": [
    "Bank",
    "Cash on hand",
    "Client trust account",
    "Money market",
    "Rents held in trust",
    "Savings",
    "Other cash and cash equivalents",
  ],
  "Accounts receivable (A/R)": ["Accounts receivable (A/R)"],
  "Current assets": [
    "Allowance for bad debts",
    "Development costs",
    "Employee cash advances",
    "Inventory",
    "Investments - short-term",
    "Loans to officers",
    "Loans to others",
    "Other current assets",
    "Prepaid expenses",
    "Undeposited funds",
  ],
  "Fixed assets": [
    "Accumulated depreciation",
    "Buildings",
    "Furniture and fixtures",
    "Land",
    "Leasehold improvements",
    "Machinery and equipment",
    "Vehicles",
    "Other fixed assets",
  ],
  "Non-current assets": [
    "Accumulated amortization",
    "Goodwill",
    "Intangible assets",
    "Long-term investments",
    "Security deposits",
    "Other non-current assets",
  ],
  "Credit card": ["Credit card"],
  "Accounts payable (A/P)": ["Accounts payable (A/P)"],
  "Current liabilities": [
    "Current portion of long-term debt",
    "Line of credit",
    "Loan payable",
    "Payroll clearing",
    "Payroll tax payable",
    "Sales tax payable",
    "Short-term loans payable",
    "Other current liabilities",
  ],
  "Non-current liabilities": [
    "Long-term debt",
    "Notes payable",
    "Shareholder notes payable",
    "Other non-current liabilities",
  ],
  "Owner's equity": [
    "Opening balance equity",
    "Owner's equity",
    "Owner draws",
    "Partner contributions",
    "Partner distributions",
    "Retained earnings",
    "Shareholder equity",
  ],
  Income: [
    "Sales of product income",
    "Service/fee income",
    "Discounts/refunds given",
    "Other primary income",
  ],
  "Other income": [
    "Dividend income",
    "Interest earned",
    "Other investment income",
    "Other miscellaneous income",
  ],
  "Cost of sales": [
    "Cost of goods sold",
    "Cost of labor - COS",
    "Equipment rental - COS",
    "Freight and delivery - COS",
    "Supplies and materials - COS",
  ],
  Expenses: [
    "Advertising/promotional",
    "Auto",
    "Bad debts",
    "Bank charges",
    "Charitable contributions",
    "Commissions and fees",
    "Contract labor",
    "Depreciation",
    "Dues and subscriptions",
    "Employee benefits",
    "Entertainment",
    "Insurance",
    "Interest paid",
    "Legal and professional fees",
    "Meals and entertainment",
    "Office/general administrative expenses",
    "Payroll expenses",
    "Rent or lease",
    "Repair and maintenance",
    "Supplies",
    "Taxes paid",
    "Travel",
    "Utilities",
    "Other business expenses",
  ],
  "Other expense": [
    "Amortization",
    "Depreciation",
    "Exchange gain or loss",
    "Penalties and settlements",
    "Other miscellaneous expense",
  ],
} as const satisfies Record<AccountType, readonly string[]>;

export function accountCategoryForType(accountType: string): AccountCategory | "" {
  return accountTypeGroups.find((group) =>
    group.accountTypes.some((option) => option === accountType),
  )?.category ?? "";
}

export function accountTypesForCategory(category: string): readonly AccountType[] {
  return accountTypeGroups.find((group) => group.category === category)?.accountTypes ?? [];
}

export function accountDetailsForType(accountType: string): readonly string[] {
  return accountDetailsByType[accountType as AccountType] ?? [];
}

export function inferAccountType(category: string, legacyDetailType: string): AccountType | "" {
  const detail = legacyDetailType.trim().toLowerCase().replace(/[’‘]/g, "'");

  if (category === "Asset") {
    if (["bank", "cash", "cash on hand"].includes(detail)) return "Cash and cash equivalents";
    if (detail.includes("receivable")) return "Accounts receivable (A/R)";
    if (detail === "fixed assets") return "Fixed assets";
    if (detail === "other assets") return "Non-current assets";
    return "Current assets";
  }
  if (category === "Liability") {
    if (detail === "credit card") return "Credit card";
    if (detail.includes("payable")) return "Accounts payable (A/P)";
    if (detail.includes("long-term")) return "Non-current liabilities";
    return "Current liabilities";
  }
  if (category === "Equity") return "Owner's equity";
  if (category === "Income") return detail === "other income" ? "Other income" : "Income";
  if (category === "Expense") {
    if (detail.includes("cost of goods") || detail === "cost of sales") return "Cost of sales";
    if (detail === "other expenses" || detail === "other expense") return "Other expense";
    return "Expenses";
  }
  return "";
}

export function migrateDetailType(accountType: string, legacyDetailType: string): string {
  const details = accountDetailsForType(accountType);
  const normalizedLegacyDetail = legacyDetailType.trim().toLowerCase().replace(/[’‘]/g, "'");
  const exactMatch = details.find((detail) => detail.toLowerCase() === normalizedLegacyDetail);
  if (exactMatch) return exactMatch;

  const legacyMap: Record<string, string> = {
    cash: "Cash on hand",
    "accounts receivable": "Accounts receivable (A/R)",
    "accounts payable": "Accounts payable (A/P)",
    "other current assets": "Other current assets",
    "fixed assets": "Other fixed assets",
    "other assets": "Other non-current assets",
    "long-term liabilities": "Other non-current liabilities",
    "owner's equity": "Owner's equity",
    sales: "Sales of product income",
    "service income": "Service/fee income",
    "other income": "Other miscellaneous income",
    advertising: "Advertising/promotional",
    "cost of goods sold": "Cost of goods sold",
    "office expenses": "Office/general administrative expenses",
    "payroll expenses": "Payroll expenses",
    travel: "Travel",
    "other expenses": "Other business expenses",
  };

  const migratedDetail = legacyMap[normalizedLegacyDetail];
  if (migratedDetail && details.includes(migratedDetail)) return migratedDetail;
  return details[0] ?? "";
}
