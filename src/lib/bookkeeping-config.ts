import type { RecordKind } from "@/lib/bookkeeping-types";

export type FieldType = "text" | "email" | "number" | "date" | "select" | "currency" | "textarea" | "checkbox" | "file";

export interface FormField {
  key: string;
  label: string;
  section?: string;
  type?: FieldType;
  placeholder?: string;
  required?: boolean;
  options?: readonly string[];
  help?: string;
}

export interface ModuleDefinition {
  slug: string;
  kind: RecordKind;
  label: string;
  plural: string;
  description: string;
  titleKey: string;
  columns: readonly string[];
  fields: readonly FormField[];
}

const statusOptions = ["Draft", "Sent", "Open", "Partially Paid", "Paid", "Overdue", "Cancelled"] as const;
const lineItemsField: FormField = {
  key: "lineItems",
  label: "Line items",
  type: "textarea",
  required: true,
  placeholder: "Description | quantity | rate\nMonthly bookkeeping | 1 | 250",
  help: "Enter one item per line, separated with a vertical bar. Totals calculate when saved.",
};
const expenseLineItemsField: FormField = {
  key: "lineItems",
  label: "Expense lines",
  type: "textarea",
  required: true,
  help: "Add a category and amount for each line.",
};

export const modules: readonly ModuleDefinition[] = [
  {
    slug: "customers", kind: "customers", label: "Customer", plural: "Customers",
    description: "People and businesses you invoice.", titleKey: "name",
    columns: ["name", "company", "email", "phone", "openingBalance"],
    fields: [
      { key: "name", label: "Display name", section: "Customer details", required: true },
      { key: "customerType", label: "Customer type", type: "select", options: ["Individual", "Business"] },
      { key: "firstName", label: "First name" },
      { key: "middleName", label: "Middle name" },
      { key: "lastName", label: "Last name" },
      { key: "company", label: "Company name" },
      { key: "email", label: "Email", type: "email", section: "Contact information" },
      { key: "phone", label: "Phone" },
      { key: "mobile", label: "Mobile" },
      { key: "website", label: "Website" },
      { key: "address", label: "Street address", type: "textarea", section: "Billing address" },
      { key: "addressLine2", label: "Address line 2" },
      { key: "city", label: "City" },
      { key: "state", label: "State / region" },
      { key: "postalCode", label: "ZIP / postal code" },
      { key: "country", label: "Country" },
      { key: "shippingAddress", label: "Street address", type: "textarea", section: "Shipping address" },
      { key: "shippingAddressLine2", label: "Address line 2" },
      { key: "shippingCity", label: "City" },
      { key: "shippingState", label: "State / region" },
      { key: "shippingPostalCode", label: "ZIP / postal code" },
      { key: "shippingCountry", label: "Country" },
      { key: "taxId", label: "Tax ID", section: "Tax and payment" },
      { key: "paymentTerms", label: "Payment terms", type: "select", options: ["Due on receipt", "15 days", "30 days", "60 days"] },
      { key: "openingBalance", label: "Opening balance", type: "number", section: "Opening balance", placeholder: "0.00" },
      { key: "openingBalanceDate", label: "As of", type: "date" },
      { key: "notes", label: "Notes", type: "textarea", section: "Notes" },
    ],
  },
  {
    slug: "vendors", kind: "vendors", label: "Vendor", plural: "Vendors",
    description: "Suppliers and service providers you pay.", titleKey: "name",
    columns: ["name", "company", "email", "phone", "openingBalance"],
    fields: [
      { key: "name", label: "Contact name", section: "Contact information", required: true },
      { key: "company", label: "Company" },
      { key: "email", label: "Email", type: "email" },
      { key: "emailCc", label: "CC" },
      { key: "emailBcc", label: "BCC" },
      { key: "phone", label: "Phone" },
      { key: "mobile", label: "Mobile" },
      { key: "fax", label: "Fax" },
      { key: "otherContact", label: "Other contact" },
      { key: "website", label: "Website" },
      { key: "address", label: "Street address", section: "Address" },
      { key: "addressLine2", label: "Address line 2" },
      { key: "city", label: "City" },
      { key: "state", label: "State / region" },
      { key: "postalCode", label: "ZIP / postal code" },
      { key: "country", label: "Country" },
      { key: "businessId", label: "Business ID", section: "Tax and purchasing" },
      { key: "taxId", label: "Sales tax ID" },
      { key: "paymentTerms", label: "Payment terms", type: "select", options: ["Due on receipt", "15 days", "30 days", "60 days"] },
      { key: "accountNumber", label: "Account number" },
      { key: "defaultExpenseAccount", label: "Default expense category", type: "select", help: "This category is prefilled on new bills from this vendor." },
      { key: "openingBalance", label: "Opening balance", type: "number", section: "Opening balance", placeholder: "0.00" },
      { key: "openingBalanceDate", label: "As of", type: "date" },
      { key: "notes", label: "Notes", type: "textarea", section: "Notes and attachments" },
      { key: "attachment", label: "Attachment", type: "file", help: "Attach a PDF, image, or CSV up to 10 MB." },
    ],
  },
  {
    slug: "items", kind: "items", label: "Item", plural: "Items & services",
    description: "Products and services used on sales and purchase documents.", titleKey: "name",
    columns: ["name", "sku", "itemType", "rate", "unit", "stock"],
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "sku", label: "SKU" },
      { key: "itemType", label: "Type", type: "select", options: ["Product", "Service"] },
      { key: "rate", label: "Rate", type: "number", required: true },
      { key: "unit", label: "Unit", placeholder: "hour, piece, month" },
      { key: "taxRate", label: "Tax rate (%)", type: "number" },
      { key: "stock", label: "Stock quantity", type: "number" },
    ],
  },
  {
    slug: "invoices", kind: "invoices", label: "Invoice", plural: "Invoices",
    description: "Create invoices, email them, and record customer payments.", titleKey: "invoiceNumber",
    columns: ["invoiceNumber", "customer", "issueDate", "dueDate", "amount", "paidAmount", "paymentMethod", "status"],
    fields: [
      { key: "invoiceNumber", label: "Invoice number", required: true },
      { key: "customer", label: "Customer", required: true },
      { key: "billingAddress", label: "Billing address", type: "textarea", section: "Customer addresses" },
      { key: "shippingAddress", label: "Shipping address", type: "textarea" },
      { key: "paymentTerms", label: "Payment terms", type: "select", required: true, options: ["Due on receipt", "15 days", "30 days", "60 days"] },
      { key: "paymentMethod", label: "Payment account", type: "select", options: ["Credit"], help: "Choose a Cash, Bank, or Credit card account from your Chart of Accounts, or leave it unpaid on credit." },
      { key: "issueDate", label: "Issue date", type: "date" },
      { key: "dueDate", label: "Due date", type: "date" },
      { key: "currency", label: "Currency", type: "currency" },
      { key: "exchangeRate", label: "Exchange rate", type: "number", placeholder: "1" },
      lineItemsField,
      { key: "taxRate", label: "Tax rate (%)", type: "number" },
      { key: "discount", label: "Discount amount", type: "number" },
      { key: "status", label: "Status", type: "select", options: statusOptions },
      { key: "attachment", label: "Attachment", type: "file", help: "Attach a PDF, image, or CSV up to 10 MB." },
    ],
  },
  {
    slug: "estimates", kind: "estimates", label: "Estimate", plural: "Estimates & quotes",
    description: "Prepare a quote, then convert it to an invoice when approved.", titleKey: "estimateNumber",
    columns: ["estimateNumber", "customer", "date", "expiryDate", "amount", "status"],
    fields: [
      { key: "estimateNumber", label: "Estimate number", required: true },
      { key: "customer", label: "Customer", required: true },
      { key: "date", label: "Date", type: "date" },
      { key: "expiryDate", label: "Expiry date", type: "date" },
      { key: "currency", label: "Currency", type: "currency" },
      { key: "exchangeRate", label: "Exchange rate", type: "number", placeholder: "1" },
      lineItemsField,
      { key: "taxRate", label: "Tax rate (%)", type: "number" },
      { key: "discount", label: "Discount amount", type: "number" },
      { key: "status", label: "Status", type: "select", options: ["Draft", "Sent", "Accepted", "Declined", "Converted"] },
      { key: "attachment", label: "Attachment", type: "file", help: "Attach a PDF, image, or CSV up to 10 MB." },
    ],
  },
  {
    slug: "sales-orders", kind: "sales-orders", label: "Sales order", plural: "Sales orders",
    description: "Track confirmed sales before they become invoices.", titleKey: "orderNumber",
    columns: ["orderNumber", "customer", "date", "deliveryDate", "amount", "status"],
    fields: [
      { key: "orderNumber", label: "Order number", required: true },
      { key: "customer", label: "Customer", required: true },
      { key: "date", label: "Order date", type: "date" },
      { key: "deliveryDate", label: "Delivery date", type: "date" },
      { key: "currency", label: "Currency", type: "currency" },
      { key: "exchangeRate", label: "Exchange rate", type: "number", placeholder: "1" },
      lineItemsField,
      { key: "taxRate", label: "Tax rate (%)", type: "number" },
      { key: "discount", label: "Discount amount", type: "number" },
      { key: "status", label: "Status", type: "select", options: ["Draft", "Confirmed", "Fulfilled", "Converted", "Cancelled"] },
      { key: "attachment", label: "Attachment", type: "file", help: "Attach a PDF, image, or CSV up to 10 MB." },
    ],
  },
  {
    slug: "credit-notes", kind: "credit-notes", label: "Credit note", plural: "Credit notes & refunds",
    description: "Apply a credit or refund against an invoice.", titleKey: "creditNumber",
    columns: ["creditNumber", "invoiceNumber", "customer", "date", "amount", "status"],
    fields: [
      { key: "creditNumber", label: "Credit note number", required: true },
      { key: "invoiceNumber", label: "Invoice number" },
      { key: "customer", label: "Customer" },
      { key: "date", label: "Date", type: "date" },
      { key: "currency", label: "Currency", type: "currency" },
      { key: "exchangeRate", label: "Exchange rate", type: "number", placeholder: "1" },
      lineItemsField,
      { key: "taxRate", label: "Tax rate (%)", type: "number" },
      { key: "discount", label: "Discount amount", type: "number" },
      { key: "amount", label: "Credit amount", type: "number", required: true },
      { key: "reason", label: "Reason", type: "textarea" },
      { key: "status", label: "Status", type: "select", options: ["Draft", "Applied", "Refunded"] },
      { key: "attachment", label: "Attachment", type: "file", help: "Attach a PDF, image, or CSV up to 10 MB." },
    ],
  },
  {
    slug: "recurring-invoices", kind: "recurring-invoices", label: "Recurring invoice", plural: "Recurring invoices",
    description: "Keep a schedule for repeat customer billing.", titleKey: "name",
    columns: ["name", "customer", "frequency", "nextDate", "amount", "status"],
    fields: [
      { key: "name", label: "Schedule name", required: true },
      { key: "customer", label: "Customer", required: true },
      { key: "frequency", label: "Frequency", type: "select", options: ["Weekly", "Monthly", "Quarterly", "Yearly"] },
      { key: "nextDate", label: "Next invoice date", type: "date" },
      lineItemsField,
      { key: "taxRate", label: "Tax rate (%)", type: "number" },
      { key: "status", label: "Status", type: "select", options: ["Active", "Paused"] },
    ],
  },
  {
    slug: "bills", kind: "bills", label: "Bill", plural: "Bills",
    description: "Record supplier bills and keep their payment status current.", titleKey: "billNumber",
    columns: ["billNumber", "vendor", "billDate", "dueDate", "category", "amount", "paymentMethod", "status"],
    fields: [
      { key: "billNumber", label: "Bill number", required: true },
      { key: "vendor", label: "Vendor", required: true },
      { key: "paymentMethod", label: "Payment account", type: "select", options: ["Credit"], help: "Choose a Cash, Bank, or Credit card account from your Chart of Accounts, or leave it unpaid on credit." },
      { key: "billDate", label: "Bill date", type: "date" },
      { key: "dueDate", label: "Due date", type: "date" },
      { key: "category", label: "Category" },
      { key: "description", label: "Description", type: "textarea" },
      { key: "amount", label: "Amount", type: "number", required: true },
      { key: "status", label: "Status", type: "select", options: ["Open", "Partially Paid", "Paid", "Overdue"] },
    ],
  },
  {
    slug: "expenses", kind: "expenses", label: "Expense", plural: "Expenses",
    description: "Capture spending by category and attach the receipt.", titleKey: "description",
    columns: ["expenseDate", "description", "payee", "category", "paymentAccount", "amount", "attachmentName"],
    fields: [
      { key: "payee", label: "Payee" },
      { key: "paymentAccount", label: "Payment account" },
      { key: "expenseDate", label: "Payment date", type: "date", required: true },
      { key: "paymentMethod", label: "Payment method", type: "select", options: ["Cash", "Check", "Credit card", "Bank transfer", "Other"] },
      { key: "referenceNumber", label: "Ref. no." },
      expenseLineItemsField,
      { key: "memo", label: "Memo", type: "textarea" },
      { key: "attachment", label: "Receipt attachment", type: "file", help: "PDF, image, or CSV up to 10 MB." },
    ],
  },
  {
    slug: "purchase-orders", kind: "purchase-orders", label: "Purchase order", plural: "Purchase orders",
    description: "Confirm vendor orders, receive products, and record purchases as bills or expenses.", titleKey: "poNumber",
    columns: ["poNumber", "vendor", "date", "expectedDate", "amount", "status"],
    fields: [
      { key: "poNumber", label: "PO number", required: true },
      { key: "vendor", label: "Vendor", required: true },
      { key: "date", label: "Date", type: "date" },
      { key: "expectedDate", label: "Expected date", type: "date" },
      { key: "currency", label: "Currency", type: "currency" },
      lineItemsField,
      { key: "taxRate", label: "Tax rate (%)", type: "number" },
    ],
  },
  {
    slug: "bank-accounts", kind: "bank-accounts", label: "Bank account", plural: "Banking",
    description: "Add bank and cash accounts, then use them on transactions.", titleKey: "name",
    columns: ["name", "accountType", "currency", "openingBalance", "institution"],
    fields: [
      { key: "name", label: "Account name", required: true },
      { key: "accountType", label: "Type", type: "select", options: ["Bank", "Cash", "Card", "Other"] },
      { key: "institution", label: "Bank or institution" },
      { key: "currency", label: "Currency", type: "currency" },
      { key: "openingBalance", label: "Opening balance", type: "number" },
    ],
  },
  {
    slug: "transactions", kind: "transactions", label: "Transaction", plural: "Transactions",
    description: "Record deposits and withdrawals, then match them during reconciliation.", titleKey: "description",
    columns: ["date", "description", "account", "type", "category", "amount", "matched"],
    fields: [
      { key: "date", label: "Date", type: "date", required: true },
      { key: "description", label: "Description", required: true },
      { key: "account", label: "Bank or cash account", required: true },
      { key: "type", label: "Direction", type: "select", required: true, options: ["Deposit", "Withdrawal"] },
      { key: "category", label: "Category" },
      { key: "amount", label: "Amount", type: "number", required: true },
      { key: "matched", label: "Matched", type: "checkbox" },
    ],
  },
  {
    slug: "bank-rules", kind: "bank-rules", label: "Bank rule", plural: "Bank rules",
    description: "Create rules to categorize transactions by a matching phrase.", titleKey: "name",
    columns: ["name", "contains", "category", "account", "enabled"],
    fields: [
      { key: "name", label: "Rule name", required: true },
      { key: "contains", label: "Description contains", required: true },
      { key: "category", label: "Assign category" },
      { key: "account", label: "Account" },
      { key: "enabled", label: "Rule enabled", type: "checkbox" },
    ],
  },
  {
    slug: "accounts", kind: "accounts", label: "Account", plural: "Chart of accounts",
    description: "Organize your books by asset, liability, equity, income, and expense.", titleKey: "name",
    columns: ["code", "name", "type", "openingBalance", "description"],
    fields: [
      { key: "code", label: "Account code", required: true },
      { key: "name", label: "Account name", required: true },
      { key: "type", label: "Account type", type: "select", options: ["Asset", "Liability", "Equity", "Income", "Expense"] },
      { key: "openingBalance", label: "Opening balance", type: "number" },
      { key: "description", label: "Description", type: "textarea" },
    ],
  },
  {
    slug: "journals", kind: "journals", label: "Journal", plural: "Manual journals",
    description: "Post balanced double-entry journals with a debit and a credit.", titleKey: "reference",
    columns: ["date", "reference", "debitAccount", "creditAccount", "amount", "memo"],
    fields: [
      { key: "date", label: "Date", type: "date", required: true },
      { key: "reference", label: "Reference", required: true },
      { key: "debitAccount", label: "Debit account", required: true },
      { key: "creditAccount", label: "Credit account", required: true },
      { key: "amount", label: "Amount", type: "number", required: true, help: "The same amount posts to debit and credit." },
      { key: "memo", label: "Memo", type: "textarea" },
    ],
  },
  {
    slug: "taxes", kind: "taxes", label: "Tax rate", plural: "Taxes",
    description: "Set up GST, VAT, and component rates used in summaries.", titleKey: "name",
    columns: ["name", "rate", "component", "jurisdiction", "enabled"],
    fields: [
      { key: "name", label: "Tax name", required: true },
      { key: "rate", label: "Rate (%)", type: "number", required: true },
      { key: "component", label: "Component", placeholder: "GST, CGST, SGST, VAT" },
      { key: "jurisdiction", label: "Jurisdiction" },
      { key: "enabled", label: "Tax enabled", type: "checkbox" },
    ],
  },
  {
    slug: "budgets", kind: "budgets", label: "Budget", plural: "Budgets",
    description: "Plan expected income and costs, then compare them with recorded results.", titleKey: "name",
    columns: ["name", "period", "startDate", "endDate", "description"],
    fields: [
      { key: "name", label: "Budget name", required: true },
      { key: "period", label: "Period", type: "select", options: ["Monthly", "Quarterly", "Annual", "Custom"] },
      { key: "startDate", label: "Start date", type: "date", required: true },
      { key: "endDate", label: "End date", type: "date", required: true },
      { key: "lines", label: "Budget lines", type: "textarea", required: true },
      { key: "description", label: "Description", type: "textarea" },
    ],
  },
  {
    slug: "team-members", kind: "team-members", label: "Team member", plural: "Users & roles",
    description: "Keep your team directory and role permissions organized.", titleKey: "name",
    columns: ["name", "email", "role", "enabled", "canApprove"],
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "email", label: "Email", type: "email", required: true },
      { key: "role", label: "Role", type: "select", options: ["Admin", "Accountant", "Sales", "Viewer"] },
      { key: "enabled", label: "Member enabled", type: "checkbox" },
      { key: "canApprove", label: "Can approve transactions", type: "checkbox" },
    ],
  },
  {
    slug: "settings", kind: "settings", label: "Company settings", plural: "Settings",
    description: "Set your company details, currency, fiscal year, and document emails.", titleKey: "companyName",
    columns: ["companyName", "currency", "fiscalYear", "invoicePrefix", "nextInvoiceNumber"],
    fields: [
      { key: "companyName", label: "Company name", required: true },
      { key: "logo", label: "Company logo", type: "file", help: "PNG, JPEG, WebP, or GIF." },
      { key: "address", label: "Business address", type: "textarea" },
      { key: "currency", label: "Default currency", type: "currency", required: true },
      { key: "fiscalYear", label: "Fiscal year starts", type: "select", options: ["January", "April", "July", "October"] },
      { key: "invoicePrefix", label: "Invoice number prefix", placeholder: "INV-" },
      { key: "nextInvoiceNumber", label: "Next invoice number", type: "number" },
      {
        key: "emailTemplate", label: "Invoice email template", type: "textarea",
        placeholder: "Hello {{customer}}, your invoice {{invoice}} for {{amount}} is ready. — {{company}}",
        help: "Available fields: {{customer}}, {{invoice}}, {{amount}}, {{company}}.",
      },
    ],
  },
];

export interface NavigationItem {
  slug: string;
  label: string;
  icon: string;
}

export interface NavigationGroup {
  label: string;
  items: NavigationItem[];
}

export const navigationGroups: NavigationGroup[] = [
  { label: "Overview", items: [{ slug: "dashboard", label: "Dashboard", icon: "LayoutDashboard" }] },
  {
    label: "Sales",
    items: [
      { slug: "customers", label: "Customers", icon: "Users" },
      { slug: "items", label: "Items & services", icon: "Package" },
      { slug: "invoices", label: "Invoices", icon: "FileText" },
      { slug: "estimates", label: "Estimates", icon: "FileCheck2" },
      { slug: "sales-orders", label: "Sales orders", icon: "ClipboardList" },
      { slug: "credit-notes", label: "Credit notes", icon: "Undo2" },
      { slug: "recurring-invoices", label: "Recurring invoices", icon: "Repeat2" },
    ],
  },
  {
    label: "Purchases",
    items: [
      { slug: "vendors", label: "Vendors", icon: "ContactRound" },
      { slug: "bills", label: "Bills", icon: "Receipt" },
      { slug: "expenses", label: "Expenses", icon: "WalletCards" },
      { slug: "purchase-orders", label: "Purchase orders", icon: "ShoppingCart" },
    ],
  },
  {
    label: "Accounts",
    items: [
      { slug: "bank-accounts", label: "Banking", icon: "Landmark" },
      { slug: "transactions", label: "Transactions", icon: "ArrowLeftRight" },
      { slug: "reconciliation", label: "Reconciliation", icon: "ListChecks" },
      { slug: "bank-rules", label: "Bank rules", icon: "ListFilter" },
      { slug: "accounts", label: "Chart of accounts", icon: "ListTree" },
      { slug: "journals", label: "Manual journals", icon: "BookOpenCheck" },
      { slug: "taxes", label: "Taxes", icon: "Percent" },
      { slug: "reports", label: "Reports", icon: "ChartNoAxesCombined" },
    ],
  },
  {
    label: "Organization",
    items: [
      { slug: "payroll", label: "Payroll", icon: "Banknote" },
      { slug: "team-members", label: "Users & roles", icon: "ShieldCheck" },
      { slug: "settings", label: "Settings", icon: "Settings2" },
      { slug: "budgets", label: "Budgets", icon: "BarChart3" },
    ],
  },
];

export function moduleBySlug(slug: string): ModuleDefinition | undefined {
  return modules.find((module) => module.slug === slug);
}
