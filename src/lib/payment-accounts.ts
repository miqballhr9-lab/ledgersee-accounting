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

export function paymentAccountLabel(account: Pick<BookkeepingRecord, "kind" | "data">): string {
  const type = paymentAccountType(account) ?? (isUndepositedFunds(account) ? "Undeposited funds" : "");
  const name = account.data.name || "Unnamed account";
  return type && type !== name ? `${type} · ${name}` : name;
}

/** QuickBooks' Undeposited funds: money received but not yet banked, moved to a bank with a bank deposit. */
export function isUndepositedFunds(account: Pick<BookkeepingRecord, "kind" | "data">) {
  return account.kind === "accounts" && account.data.locked !== "true" && account.data.type === "Asset" && /undeposited/i.test(`${account.data.detailType ?? ""} ${account.data.name ?? ""}`);
}

/** Where money received from a customer can go: a cash, bank or card account, or Undeposited funds. */
export function receivingAccountType(account: Pick<BookkeepingRecord, "kind" | "data">): PaymentAccountType | "Undeposited funds" | null {
  return paymentAccountType(account) ?? (isUndepositedFunds(account) ? "Undeposited funds" : null);
}
