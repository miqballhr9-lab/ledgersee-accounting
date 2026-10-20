import "server-only";

import { listBookkeepingRecordGroups } from "@/app/actions";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import { accountCategoryForType } from "@/lib/account-types";
import { requireUser, type WorkspaceUser } from "@/lib/auth";
import { paymentAccountType } from "@/lib/payment-accounts";
import { canWriteKind } from "@/lib/permissions";
import { standardAccounts } from "@/lib/standard-accounts";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { hrKinds } from "@/lib/crm-config";
import { odooHrData } from "@/lib/hr-status";
import { syncAttachmentRepayments } from "@/lib/hr-rules";
import { weekendDays } from "@/lib/weekend";

/** Everything the HR screens show, loaded in one query. */
export async function loadHrData() {
  const me = await requireUser();
  await ensurePaymentAccounts(me);
  // Bring salary attachments up to date with the deductions already in payroll.
  await syncAttachmentRepayments(me.id);
  const groups = await listBookkeepingRecordGroups([...hrKinds, "employees", "payroll", "crm-notes", "team-members", "settings", "accounts"]);
  const store: Record<string, BookkeepingRecord[]> = {};
  for (const [kind, records] of Object.entries(groups)) {
    // Older records show their state under its Odoo name.
    if (kind !== "team-members" && kind !== "settings") store[kind] = (records ?? []).map((record) => ({ ...record, data: odooHrData(kind, record.data) }));
  }
  const teamNames = (groups["team-members"] ?? [])
    .filter((member) => member.data.enabled !== "false")
    .map((member) => member.data.name?.trim() ?? "")
    .filter(Boolean);
  return {
    store,
    me: me.name,
    owners: [...new Set([me.workspaceName, me.name, ...teamNames])],
    currency: groups.settings?.[0]?.data.currency || "USD",
    recruitmentStages: groups.settings?.[0]?.data.recruitmentStages ?? "",
    weekend: weekendDays(groups.settings?.[0]?.data.weekendDays),
    today: businessToday(groups.settings?.[0]?.data.timeZone),
    timeZone: groups.settings?.[0]?.data.timeZone || "Asia/Karachi",
  };
}

/**
 * The HRM app without Accounting has no chart of accounts to pay salaries,
 * loans and expenses from, so it gets the standard cash and bank accounts.
 */
export async function ensurePaymentAccounts(me: WorkspaceUser) {
  if (me.access.locked || me.access.features.includes("accounting") || !canWriteKind(me.role, "employees")) return;
  const accounts = await db.select({ data: bookkeepingRecord.data }).from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "accounts")));
  if (accounts.some((account) => paymentAccountType({ kind: "accounts", data: account.data }))) return;
  const names = new Set(accounts.map((account) => account.data.name?.trim().toLowerCase()));
  const rows = standardAccounts.filter((account) => account.accountType === "Cash and cash equivalents" && !names.has(account.name.toLowerCase()))
    .map((account) => ({ userId: me.id, kind: "accounts", data: { code: account.code, name: account.name, type: accountCategoryForType(account.accountType) ?? "Asset", accountType: account.accountType, detailType: account.detailType } }));
  if (rows.length) await db.insert(bookkeepingRecord).values(rows);
}

/** Today's date in the business's time zone (Settings), Pakistan time by default. */
export function businessToday(timeZone: string | undefined) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
}
