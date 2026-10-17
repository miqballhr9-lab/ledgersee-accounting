import "server-only";

import { redirect } from "next/navigation";

import { getWorkspaceUser } from "@/lib/auth";
import type { Feature } from "@/lib/plans";

/** Where someone starts: the dashboard with Accounting, else the first app they have. */
export function appHome(features: Feature[]) {
  if (features.includes("accounting")) return "/app";
  if (features.includes("crm")) return "/app/crm";
  if (features.includes("hr")) return "/app/hr";
  return "/app/billing";
}

/**
 * Sends people to Billing when their plan includes none of these parts of the
 * product. A team member on the owner-only Free plan can still read everything.
 */
export async function requireFeature(...features: Feature[]) {
  const me = await getWorkspaceUser();
  if (me && !me.access.locked && !features.some((feature) => me.access.features.includes(feature))) redirect(`/app/billing?upgrade=${features[0]}`);
}

/** The dashboard is Accounting's; someone with only CRM or HRM starts in their app instead. */
export async function requireAccountingHome() {
  const me = await getWorkspaceUser();
  if (me && !me.access.locked && !me.access.features.includes("accounting")) redirect(appHome(me.access.features));
}

/** Which app a report category belongs to. */
export function reportCategoryFeature(category: string): Feature {
  if (category === "crm") return "crm";
  if (category === "employees") return "hr";
  if (category === "inventory") return "inventory";
  return "accounting";
}
