import "server-only";

import { listBookkeepingRecordGroups } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { crmKinds } from "@/lib/crm-config";

/** Everything the CRM screens show, loaded in one query, plus who can own records. */
export async function loadCrmData() {
  const me = await requireUser();
  const groups = await listBookkeepingRecordGroups([...crmKinds, "crm-notes", "customers", "estimates", "invoices", "team-members", "settings"]);
  const store: Record<string, BookkeepingRecord[]> = {};
  for (const [kind, records] of Object.entries(groups)) {
    if (kind !== "team-members" && kind !== "settings") store[kind] = records ?? [];
  }
  const teamNames = (groups["team-members"] ?? [])
    .filter((member) => member.data.enabled !== "false")
    .map((member) => member.data.name?.trim() ?? "")
    .filter(Boolean);
  return {
    store,
    me: me.name,
    owners: [...new Set([me.name, ...teamNames])],
    currency: groups.settings?.[0]?.data.currency || "USD",
  };
}
