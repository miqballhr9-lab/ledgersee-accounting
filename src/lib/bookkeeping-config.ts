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
      { key: "priceAdjustment", label: "Price rule (%)", type: "number", help: "Changes every product and service price for this customer, e.g. -10 for 10% off (wholesale) or 5 for 5% more." },
      { key: "openingBalance", label: "Opening balance", type: "number", section: "Opening balance", placeholder: "0.00" },
      { key: "openingBalanceDate", label: "As of", type: "date" },
      { key: "notes", label: "Notes", type: "textarea", section: "Notes and attachments" },
      { key: "attachment", label: "Attachment", type: "file", help: "Attach a PDF, image, or CSV up to 10 MB." },
    ],
  },
  {
    slug: "vendors", kind: "vendors", label: "Supplier", plural: "Suppliers",
    description: "People and businesses you buy from.", titleKey: "name",
    columns: ["name", "company", "email", "phone", "openingBalance"],
    fields: [
      { key: "name", label: "Display name", section: "Supplier details", required: true },
      { key: "supplierType", label: "Supplier type", type: "select", options: ["Individual", "Business"] },
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
      { key: "track1099", label: "Track payments for 1099", type: "checkbox", help: "US contractors: their cash and bank payments show on the 1099 contractor reports." },
      { key: "paymentTerms", label: "Payment terms", type: "select", options: ["Due on receipt", "15 days", "30 days", "60 days"] },
      { key: "defaultExpenseAccount", label: "Default expense category", type: "select", help: "This category is prefilled on new bills from this supplier." },
      { key: "openingBalance", label: "Opening balance", type: "number", section: "Opening balance", placeholder: "0.00" },
      { key: "openingBalanceDate", label: "As of", type: "date" },
      { key: "notes", label: "Notes", type: "textarea", section: "Notes and attachments" },
      { key: "attachment", label: "Attachment", type: "file", help: "Attach a PDF, image, or CSV up to 10 MB." },
    ],
  },
  {
    slug: "items", kind: "items", label: "Item", plural: "Items & services",
    description: "Products and services used on sales and purchase documents.", titleKey: "name",
    columns: ["name", "sku", "itemType", "rate", "cost", "qtyOnHand"],
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "category", label: "Category", help: "Group products and services, e.g. Hardware, Services." },
      { key: "sku", label: "SKU" },
      { key: "itemType", label: "Type", type: "select", options: ["Inventory", "Non-inventory", "Service", "Bundle"], help: "Inventory items track quantity on hand and cost of goods sold; non-inventory and services don’t. A bundle sells several items together." },
      { key: "rate", label: "Sales price / rate", type: "number", required: true },
      { key: "unit", label: "Unit", placeholder: "piece, box, hour" },
      { key: "taxRate", label: "Tax rate (%)", type: "number" },
      { key: "cost", label: "Purchase cost", type: "number", section: "Purchasing", placeholder: "0.00", help: "Used for opening stock and when stock is received without a bill." },
      { key: "openingQty", label: "Initial quantity on hand", type: "number", section: "Inventory", placeholder: "0", help: "Inventory items only. Stock you already have before using MIK LEDGER." },
      { key: "openingDate", label: "As of date", type: "date", section: "Inventory" },
      { key: "reorderPoint", label: "Reorder point", type: "number", section: "Inventory", placeholder: "0", help: "Shows as low stock when the quantity on hand reaches this." },
      { key: "incomeAccountId", label: "Income account", type: "select", options: [], section: "Accounting", help: "Where sales of this item are recorded. Sales when left empty." },
      { key: "expenseAccountId", label: "Expense account", type: "select", options: [], section: "Accounting", help: "Cost of goods sold for inventory; the purchase expense for other items. Cost of goods sold when left empty." },
      { key: "assetAccountId", label: "Inventory asset account", type: "select", options: [], section: "Accounting", help: "Inventory items only. Where the value of stock on hand sits." },
      { key: "bundleItems", label: "Products/services in this bundle", type: "textarea", section: "Bundle" },
      { key: "showComponents", label: "Display bundle components when printing or sending transactions", type: "checkbox", section: "Bundle" },
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
      { key: "notes", label: "Message on invoice", type: "textarea", help: "Printed on the document for the customer." },
      { key: "className", label: "Class", help: "QuickBooks-style class, e.g. a department or line of business. Reports can split by it." },
      { key: "location", label: "Location", help: "Branch or location, e.g. Lahore or Karachi. Reports can split by it." },
      { key: "project", label: "Project", help: "The project this belongs to; see Project Profitability." },
      { key: "tags", label: "Tags", help: "Comma separated, e.g. Lahore branch, Project A. Search by tag to find and total these." },
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
      { key: "notes", label: "Message on estimate", type: "textarea", help: "Printed on the document for the customer." },
      { key: "tags", label: "Tags", help: "Comma separated, e.g. Lahore branch, Project A. Search by tag to find and total these." },
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
      { key: "notes", label: "Message on sales order", type: "textarea", help: "Printed on the document for the customer." },
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
      { key: "className", label: "Class", help: "QuickBooks-style class, e.g. a department or line of business. Reports can split by it." },
      { key: "location", label: "Location", help: "Branch or location, e.g. Lahore or Karachi. Reports can split by it." },
      { key: "project", label: "Project", help: "The project this belongs to; see Project Profitability." },
      { key: "tags", label: "Tags", help: "Comma separated, e.g. Lahore branch, Project A. Search by tag to find and total these." },
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
      { key: "vendor", label: "Supplier", required: true },
      { key: "billDate", label: "Bill date", type: "date", required: true },
      { key: "paymentTerms", label: "Terms", type: "select", options: ["Due on receipt", "15 days", "30 days", "60 days"] },
      { key: "billNumber", label: "Bill no.", required: true },
      { key: "dueDate", label: "Due date", type: "date" },
      { ...expenseLineItemsField, label: "Bill lines" },
      { key: "taxRate", label: "Tax rate (%)", type: "number" },
      { key: "discount", label: "Discount amount", type: "number" },
      { key: "memo", label: "Memo", type: "textarea" },
      { key: "className", label: "Class", help: "QuickBooks-style class, e.g. a department or line of business. Reports can split by it." },
      { key: "location", label: "Location", help: "Branch or location, e.g. Lahore or Karachi. Reports can split by it." },
      { key: "project", label: "Project", help: "The project this belongs to; see Project Profitability." },
      { key: "tags", label: "Tags", help: "Comma separated, e.g. Lahore branch, Project A. Search by tag to find and total these." },
      { key: "attachment", label: "Attachment", type: "file", help: "PDF, image, or CSV up to 10 MB." },
    ],
  },
  {
    slug: "expenses", kind: "expenses", label: "Expense", plural: "Expenses",
    description: "Capture spending by category and attach the receipt.", titleKey: "description",
    columns: ["expenseDate", "description", "payee", "category", "paymentAccount", "amount", "attachmentName"],
    fields: [
      { key: "payee", label: "Payee" },
      { key: "expenseDate", label: "Expense date", type: "date", required: true },
      { key: "referenceNumber", label: "Ref. no." },
      expenseLineItemsField,
      { key: "taxRate", label: "Tax rate (%)", type: "number" },
      { key: "discount", label: "Discount amount", type: "number" },
      { key: "memo", label: "Memo", type: "textarea" },
      { key: "className", label: "Class", help: "QuickBooks-style class, e.g. a department or line of business. Reports can split by it." },
      { key: "location", label: "Location", help: "Branch or location, e.g. Lahore or Karachi. Reports can split by it." },
      { key: "project", label: "Project", help: "The project this belongs to; see Project Profitability." },
      { key: "tags", label: "Tags", help: "Comma separated, e.g. Lahore branch, Project A. Search by tag to find and total these." },
      { key: "attachment", label: "Receipt attachment", type: "file", help: "PDF, image, or CSV up to 10 MB." },
    ],
  },
  {
    slug: "supplier-credits", kind: "supplier-credits", label: "Credit note", plural: "Credit notes",
    description: "Record credits and refunds from suppliers and apply them to their bills.", titleKey: "creditNumber",
    columns: ["creditNumber", "vendor", "date", "billNumber", "amount", "refundAccountName", "status"],
    fields: [
      { key: "vendor", label: "Supplier", required: true },
      { key: "billNumber", label: "Apply to bill no.", help: "The supplier bill this credit reduces. Apply it from the list once saved." },
      { key: "date", label: "Credit date", type: "date", required: true },
      { key: "creditNumber", label: "Credit no.", required: true },
      { ...expenseLineItemsField, label: "Credit lines" },
      { key: "taxRate", label: "Tax rate (%)", type: "number" },
      { key: "discount", label: "Discount amount", type: "number" },
      { key: "memo", label: "Memo", type: "textarea" },
      { key: "className", label: "Class", help: "QuickBooks-style class, e.g. a department or line of business. Reports can split by it." },
      { key: "location", label: "Location", help: "Branch or location, e.g. Lahore or Karachi. Reports can split by it." },
      { key: "project", label: "Project", help: "The project this belongs to; see Project Profitability." },
      { key: "attachment", label: "Attachment", type: "file", help: "PDF, image, or CSV up to 10 MB." },
    ],
  },
  {
    slug: "purchase-orders", kind: "purchase-orders", label: "Purchase order", plural: "Purchase orders",
    description: "Confirm supplier orders, receive products, and record purchases as bills or expenses.", titleKey: "poNumber",
    columns: ["poNumber", "vendor", "date", "expectedDate", "amount", "status"],
    fields: [
      { key: "vendor", label: "Supplier", required: true },
      { key: "currency", label: "Currency", type: "currency" },
      { key: "date", label: "PO date", type: "date", required: true },
      { key: "expectedDate", label: "Expected date", type: "date" },
      { key: "poNumber", label: "PO no.", required: true },
      { ...lineItemsField, label: "PO lines" },
      { key: "taxRate", label: "Tax rate (%)", type: "number" },
      { key: "discount", label: "Discount amount", type: "number" },
      { key: "memo", label: "Memo", type: "textarea" },
      { key: "attachment", label: "Attachment", type: "file", help: "PDF, image, or CSV up to 10 MB." },
    ],
  },
  {
    slug: "time-activities", kind: "time-activities", label: "Time activity", plural: "Time",
    description: "Hours worked for customers. Billable time can be put on an invoice: select the entries, then Create invoice.", titleKey: "description",
    columns: ["date", "employee", "customer", "service", "hours", "rate", "status"],
    fields: [
      { key: "date", label: "Date", type: "date", required: true },
      { key: "employee", label: "Name", required: true, help: "The employee or contractor who did the work." },
      { key: "customer", label: "Customer" },
      { key: "service", label: "Service", placeholder: "e.g. Consulting" },
      { key: "description", label: "Description", type: "textarea" },
      { key: "hours", label: "Hours", type: "number", required: true, placeholder: "e.g. 2.5" },
      { key: "billable", label: "Billable", type: "checkbox" },
      { key: "rate", label: "Rate per hour", type: "number" },
      { key: "status", label: "Status", type: "select", options: ["Unbilled", "Billed", "Not billable"] },
    ],
  },
  {
    slug: "delayed-charges", kind: "delayed-charges", label: "Delayed charge", plural: "Delayed charges",
    description: "Charges and credits to put on a customer's next invoice. They don't touch your books until invoiced: select them, then Create invoice.", titleKey: "service",
    columns: ["date", "customer", "chargeType", "service", "amount", "status"],
    fields: [
      { key: "date", label: "Date", type: "date", required: true },
      { key: "customer", label: "Customer", required: true },
      { key: "chargeType", label: "Type", type: "select", options: ["Charge", "Credit"], help: "A credit lowers the invoice it goes on." },
      { key: "service", label: "Product or service", required: true, placeholder: "e.g. Extra site visit" },
      { key: "description", label: "Description", type: "textarea" },
      { key: "quantity", label: "Qty", type: "number", placeholder: "1" },
      { key: "rate", label: "Rate", type: "number", required: true },
      { key: "amount", label: "Amount", type: "number", help: "Worked out from the quantity and rate." },
      { key: "status", label: "Status", type: "select", options: ["Open", "Closed"] },
    ],
  },
  {
    slug: "mileage", kind: "mileage", label: "Trip", plural: "Mileage",
    description: "Business trips by vehicle, with the distance and its value at your rate per km, for claims and tax.", titleKey: "purpose",
    columns: ["date", "vehicle", "purpose", "fromPlace", "toPlace", "distance", "amount"],
    fields: [
      { key: "date", label: "Trip date", type: "date", required: true },
      { key: "vehicle", label: "Vehicle", required: true, placeholder: "e.g. Suzuki Cultus LEB-1234" },
      { key: "purpose", label: "Purpose", required: true, placeholder: "e.g. Client visit" },
      { key: "tripType", label: "Type", type: "select", options: ["Business", "Personal"] },
      { key: "fromPlace", label: "Start point" },
      { key: "toPlace", label: "End point" },
      { key: "distance", label: "Distance (km)", type: "number", required: true },
      { key: "rate", label: "Rate per km", type: "number", help: "The value of each business km, e.g. your fuel allowance rate." },
      { key: "amount", label: "Value", type: "number", help: "Worked out as distance × rate when saved." },
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
      { key: "type", label: "Direction", type: "select", required: true, options: ["Deposit", "Withdrawal", "Transfer"] },
      { key: "toAccount", label: "Transfer to", help: "For a transfer: the bank, cash or card account the money went to." },
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
      { key: "className", label: "Class", help: "QuickBooks-style class, e.g. a department or line of business. Reports can split by it." },
      { key: "location", label: "Location", help: "Branch or location, e.g. Lahore or Karachi. Reports can split by it." },
      { key: "project", label: "Project", help: "The project this belongs to; see Project Profitability." },
    ],
  },
  {
    slug: "taxes", kind: "taxes", label: "Tax rate", plural: "Taxes",
    description: "Sales tax, GST and VAT rates offered on invoices and bills, and how each one is reported. Tax setup installs your country's rates.", titleKey: "name",
    columns: ["name", "rate", "type", "appliesTo", "jurisdiction", "enabled"],
    fields: [
      { key: "name", label: "Tax name", required: true },
      { key: "rate", label: "Rate (%)", type: "number", required: true },
      { key: "type", label: "Type", type: "select", options: ["Standard", "Reduced", "Zero-rated", "Exempt", "Further tax", "Withholding", "Provincial services"], help: "Decides which line of the tax return it is reported on." },
      { key: "appliesTo", label: "Used on", type: "select", options: ["Both", "Sales", "Purchases"] },
      { key: "component", label: "Component", placeholder: "GST, VAT, PST" },
      { key: "jurisdiction", label: "Authority / jurisdiction" },
      { key: "isDefault", label: "Default rate for new documents", type: "checkbox" },
      { key: "enabled", label: "Tax enabled", type: "checkbox" },
      { key: "note", label: "Note", type: "textarea" },
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
    slug: "employees", kind: "employees", label: "Employee", plural: "Employees",
    description: "Your employees, their work and private details, and what payroll pays them.", titleKey: "name",
    columns: ["name", "designation", "department", "email", "mobile", "status"],
    fields: [
      { key: "name", label: "Employee's name", required: true, placeholder: "Full name", section: "Employee" },
      { key: "designation", label: "Job position", placeholder: "Job title", section: "Employee" },
      { key: "email", label: "Work email", type: "email", placeholder: "employee@example.com", section: "Employee" },
      { key: "mobile", label: "Work mobile", placeholder: "+92 300 1234567", section: "Employee" },
      { key: "workPhone", label: "Work phone", section: "Employee" },
      { key: "department", label: "Department", section: "Employee" },
      { key: "manager", label: "Manager", section: "Employee" },
      { key: "workLocation", label: "Work location", section: "Work information" },
      { key: "joiningDate", label: "Joining date", type: "date", section: "Work information" },
      { key: "cnic", label: "Identification no. (CNIC)", placeholder: "12345-1234567-1", section: "Private information" },
      { key: "dateOfBirth", label: "Date of birth", type: "date", section: "Private information" },
      { key: "address", label: "Private address", type: "textarea", section: "Private information" },
      { key: "emergencyContact", label: "Emergency contact", section: "Private information" },
      { key: "emergencyPhone", label: "Emergency phone", section: "Private information" },
      { key: "bankName", label: "Bank", placeholder: "e.g. Meezan Bank", section: "Private information" },
      { key: "bankAccountTitle", label: "Account title", placeholder: "Name on the bank account", section: "Private information" },
      { key: "bankAccountNumber", label: "Bank account number / IBAN", placeholder: "PK36 SCBL 0000 0011 2345 6702", section: "Private information" },
      { key: "employeeId", label: "Employee ID", placeholder: "EMP-001", section: "HR settings", help: "Given automatically when left empty." },
      { key: "employeeType", label: "Employee type", type: "select", options: ["Employee", "Worker", "Student", "Trainee", "Contractor", "Freelancer"], section: "HR settings" },
      { key: "status", label: "Status", type: "select", options: ["Active", "Inactive"], section: "HR settings" },
      { key: "baseSalary", label: "Wage (monthly)", type: "number", section: "HR settings", help: "Used when this employee is added to payroll." },
      { key: "paymentAccountId", label: "Salary paid from", type: "select", options: [], section: "HR settings", help: "Optional. The Cash, Bank or Credit card account used to pay this employee." },
      { key: "socialDeduction", label: "EOBI / PF per month", type: "number", help: "Withheld from each salary for EOBI or the provident fund." },
      { key: "overtimeRate", label: "Overtime rate per hour", type: "number", help: "Pays overtime hours from attendance on the salary sheet." },
      { key: "kioskPin", label: "Kiosk PIN", placeholder: "e.g. 4821", help: "Asked for when checking in or out at the attendance kiosk." },
      { key: "coach", label: "Coach", help: "Who guides this employee day to day." },
      { key: "workSchedule", label: "Working hours", type: "select", options: ["Standard 40 hours/week", "Standard 48 hours/week (6 days)", "Part time 20 hours/week", "Flexible hours"] },
      { key: "tags", label: "Tags", help: "Comma separated, e.g. Sales team, Remote." },
      { key: "photo", label: "Photo" },
      { key: "skills", label: "Skills", type: "textarea", help: "One per line as Skill: Level, e.g. Excel: Expert." },
      { key: "resume", label: "Resume", type: "textarea", help: "Experience and education, one line each, e.g. 2020–2023 Accountant at ABC Ltd." },
      { key: "notes", label: "Notes", type: "textarea", section: "HR settings" },
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
    label: "CRM",
    items: [
      { slug: "crm", label: "CRM home", icon: "Gauge" },
      { slug: "crm/leads", label: "Leads", icon: "UserPlus" },
      { slug: "crm/contacts", label: "Contacts", icon: "Contact" },
      { slug: "crm/accounts", label: "Accounts", icon: "Building2" },
      { slug: "crm/deals", label: "Deals", icon: "Handshake" },
      { slug: "crm/activities", label: "Activities", icon: "CalendarCheck" },
      { slug: "crm/campaigns", label: "Campaigns", icon: "Megaphone" },
      { slug: "crm/cases", label: "Cases", icon: "LifeBuoy" },
      { slug: "crm/solutions", label: "Solutions", icon: "BookOpen" },
      { slug: "crm/workflows", label: "Workflow rules", icon: "Workflow" },
    ],
  },
  {
    label: "Sales",
    items: [
      { slug: "sales", label: "All sales", icon: "ReceiptText" },
      { slug: "customers", label: "Customers", icon: "Users" },
      { slug: "items", label: "Items & services", icon: "Package" },
      { slug: "invoices", label: "Invoices", icon: "FileText" },
      { slug: "estimates", label: "Estimates", icon: "FileCheck2" },
      { slug: "sales-orders", label: "Sales orders", icon: "ClipboardList" },
      { slug: "time-activities", label: "Time", icon: "Clock" },
      { slug: "delayed-charges", label: "Delayed charges", icon: "HandCoins" },
      { slug: "credit-notes", label: "Credit notes", icon: "Undo2" },
      { slug: "recurring-invoices", label: "Recurring invoices", icon: "Repeat2" },
    ],
  },
  {
    label: "Purchases",
    items: [
      { slug: "vendors", label: "Suppliers", icon: "ContactRound" },
      { slug: "bills", label: "Bills", icon: "Receipt" },
      { slug: "expenses", label: "Expenses", icon: "WalletCards" },
      { slug: "mileage", label: "Mileage", icon: "Car" },
      { slug: "purchase-orders", label: "Purchase orders", icon: "ShoppingCart" },
      { slug: "supplier-credits", label: "Credit notes", icon: "Undo2" },
    ],
  },
  {
    label: "Inventory",
    items: [{ slug: "inventory", label: "Inventory", icon: "Boxes" }],
  },
  {
    label: "Accounts",
    items: [
      { slug: "bank-accounts", label: "Banking", icon: "Landmark" },
      { slug: "transactions", label: "Transactions", icon: "ArrowLeftRight" },
      { slug: "deposits", label: "Bank deposits", icon: "PiggyBank" },
      { slug: "reconciliation", label: "Reconciliation", icon: "ListChecks" },
      { slug: "bank-rules", label: "Bank rules", icon: "ListFilter" },
      { slug: "accounts", label: "Chart of accounts", icon: "ListTree" },
      { slug: "journals", label: "Manual journals", icon: "BookOpenCheck" },
      { slug: "recurring", label: "Recurring transactions", icon: "Repeat" },
      { slug: "taxes", label: "Taxes", icon: "Percent" },
      { slug: "tax-setup", label: "Tax setup", icon: "Globe" },
      { slug: "tax-returns", label: "Tax returns", icon: "FileSpreadsheet" },
      { slug: "reports", label: "Reports", icon: "ChartNoAxesCombined" },
    ],
  },
  {
    label: "HRM",
    items: [
      { slug: "hr", label: "HRM apps", icon: "Gauge" },
      { slug: "employees", label: "Employees", icon: "Users" },
      { slug: "hr/departments", label: "Departments", icon: "Network" },
      { slug: "hr/org-chart", label: "Org chart", icon: "Network" },
      { slug: "hr/contracts", label: "Contracts", icon: "FileBadge" },
      { slug: "hr/onboarding", label: "Onboarding", icon: "ListChecks" },
      { slug: "hr/departures", label: "Departures", icon: "LogOut" },
      { slug: "hr/check-in", label: "Check in / out", icon: "Clock" },
      { slug: "hr/attendances", label: "Attendances", icon: "Clock" },
      { slug: "hr/my-time-off", label: "My Time Off", icon: "CalendarDays" },
      { slug: "hr/time-off", label: "Time off", icon: "CalendarDays" },
      { slug: "hr/allocations", label: "Allocations", icon: "CalendarCheck" },
      { slug: "hr/time-off-types", label: "Time off types", icon: "CalendarCog" },
      { slug: "hr/public-holidays", label: "Public holidays", icon: "PartyPopper" },
      { slug: "hr/job-positions", label: "Job positions", icon: "BriefcaseBusiness" },
      { slug: "hr/applications", label: "Applications", icon: "UserSearch" },
      { slug: "hr/appraisals", label: "Appraisals", icon: "Star" },
      { slug: "hr/goals", label: "Goals", icon: "Star" },
      { slug: "hr/expenses", label: "Expenses", icon: "ReceiptText" },
      { slug: "hr/documents", label: "Documents", icon: "FileBadge" },
    ],
  },
  {
    label: "Payroll",
    items: [
      { slug: "payroll", label: "Payroll", icon: "Banknote" },
      { slug: "hr/salary-attachments", label: "Salary attachments", icon: "HandCoins" },
    ],
  },
  {
    label: "My portal",
    items: [{ slug: "my", label: "My HR portal", icon: "UserRound" }],
  },
  {
    label: "Budgets",
    items: [{ slug: "budgets", label: "Budgets", icon: "BarChart3" }],
  },
  {
    label: "Organization",
    items: [
      { slug: "team-members", label: "Users & roles", icon: "ShieldCheck" },
      { slug: "automation", label: "Automation", icon: "Bot" },
      { slug: "settings", label: "Settings", icon: "Settings2" },
    ],
  },
];

/** A sales receipt, as in QuickBooks: an invoice paid in full on the spot and deposited to an account. */
export function salesReceiptModule(): ModuleDefinition | undefined {
  const invoices = moduleBySlug("invoices");
  if (!invoices) return undefined;
  const labels: Record<string, string> = { invoiceNumber: "Sales receipt no.", issueDate: "Sales receipt date", paymentMethod: "Deposit to", notes: "Message on sales receipt" };
  return {
    ...invoices,
    label: "Sales receipt",
    plural: "Sales receipts",
    description: "Record a sale paid in full at the time of sale.",
    fields: invoices.fields
      .filter((field) => !["paymentTerms", "dueDate", "status", "shippingAddress"].includes(field.key))
      .map((field) => (labels[field.key] ? { ...field, label: labels[field.key], ...(field.key === "paymentMethod" ? { required: true, help: "The Cash, Bank or Credit card account the money went into." } : {}) } : field)),
  };
}

export function moduleBySlug(slug: string): ModuleDefinition | undefined {
  return modules.find((module) => module.slug === slug);
}

/** Kinds that take custom fields (Settings > Advanced), as in QuickBooks. */
export const customFieldKinds = ["customers", "vendors", "items", "invoices", "estimates", "sales-orders", "credit-notes", "purchase-orders"] as const;

/** The settings key holding a kind's custom field names, comma separated. */
export function customFieldSettingKey(kind: string) {
  return `customFields${kind.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join("")}`;
}

/** A module with the business's custom fields added after its own fields. */
export function withCustomFields(module: ModuleDefinition, settings: Record<string, string> | undefined): ModuleDefinition {
  if (!customFieldKinds.includes(module.kind as (typeof customFieldKinds)[number])) return module;
  const names = (settings?.[customFieldSettingKey(module.kind)] ?? "").split(",").map((name) => name.trim()).filter(Boolean).slice(0, 10);
  if (!names.length) return module;
  const extra: FormField[] = names.map((label) => ({ key: `cf${label.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\s+/).map((word) => word[0].toUpperCase() + word.slice(1)).join("").slice(0, 40) || "Field"}`, label, help: "Custom field" }));
  const known = new Set(module.fields.map((field) => field.key));
  return { ...module, fields: [...module.fields, ...extra.filter((field) => !known.has(field.key))] };
}
