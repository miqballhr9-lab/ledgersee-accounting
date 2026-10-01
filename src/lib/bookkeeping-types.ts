export const recordKinds = [
  "customers",
  "vendors",
  "items",
  "invoices",
  "estimates",
  "sales-orders",
  "credit-notes",
  "recurring-invoices",
  "bills",
  "expenses",
  "purchase-orders",
  "bank-accounts",
  "transactions",
  "bank-rules",
  "accounts",
  "journals",
  "taxes",
  "team-members",
  "settings",
  "payments",
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
