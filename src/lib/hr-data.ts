import "server-only";

import { listBookkeepingRecordGroups } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { hrKinds } from "@/lib/crm-config";
import { odooHrData } from "@/lib/hr-status";
import { weekendDays } from "@/lib/weekend";

/** Everything the HR screens show, loaded in one query. */
export async function loadHrData() {
  const me = await requireUser();
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
  };
}

/** Today's date in the business's time zone (Settings), Pakistan time by default. */
function businessToday(timeZone: string | undefined) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
}
