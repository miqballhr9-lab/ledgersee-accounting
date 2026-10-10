import type { BookkeepingRecord } from "@/lib/bookkeeping-types";

export type PaymentAccountType = "Cash" | "Bank" | "Credit card";

export function paymentAccountType(account: Pick<BookkeepingRecord, "kind" | "data">): PaymentAccountType | null {
  if (account.kind !== "accounts" || account.data.locked === "true") return null;

  const detailType = account.data.detailType?.trim().toLowerCase();
  const accountType = account.data.accountType?.trim().toLowerCase();
  if (account.data.type === "Asset" && (detailType === "cash" || detailType === "cash on hand")) return "Cash";
  if (account.data.type === "Asset" && (accountType === "cash and cash equivalents" || detailType === "bank")) return "Bank";
  if (account.data.type === "Liability" && (accountType === "credit card" || detailType === "credit card")) return "Credit card";
  return null;
}

export function paymentAccountLabel(account: BookkeepingRecord): string {
  return `${paymentAccountType(account)} · ${account.data.name || "Unnamed account"}`;
}
