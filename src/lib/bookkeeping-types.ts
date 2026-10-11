export const recordKinds = [
  "customers",
  "vendors",
  "items",
  "invoices",
  "estimates",
  "sales-orders",
  "credit-notes",
  "supplier-credits",
  "recurring-invoices",
  "bills",
  "expenses",
  "purchase-orders",
  "inventory-movements",
  "bank-accounts",
  "transactions",
  "bank-rules",
  "accounts",
  "journals",
  "taxes",
  "budgets",
  "payroll",
  "employees",
  "team-members",
  "settings",
  "payments",
  "reconciliations",
  "automation-settings",
  "automation-rules",
  "automation-log",
] as const;

export type RecordKind = (typeof recordKinds)[number];

export interface BookkeepingRecord {
  id: string;
  kind: RecordKind;
  data: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export function isRecordKind(value: string): value is RecordKind {
  return recordKinds.some((kind) => kind === value);
}
