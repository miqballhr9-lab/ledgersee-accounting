import "server-only";

import { listBookkeepingRecordGroups } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { hrKinds } from "@/lib/crm-config";
import { odooHrData } from "@/lib/hr-status";

/** Everything the HR screens show, loaded in one query. */
export async function loadHrData() {
  const me = await requireUser();
  const groups = await listBookkeepingRecordGroups([...hrKinds, "employees", "payroll", "crm-notes", "team-members", "settings"]);
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
  };
}
