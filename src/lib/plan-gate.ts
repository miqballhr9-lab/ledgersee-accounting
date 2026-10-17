import "server-only";

import { redirect } from "next/navigation";

import { getWorkspaceUser } from "@/lib/auth";
import type { Feature } from "@/lib/plans";

/** Sends people to Billing when their plan doesn't include this part of the product. A lapsed plan can still read everything. */
export async function requireFeature(feature: Feature) {
  const me = await getWorkspaceUser();
  if (me && !me.access.locked && !me.access.features.includes(feature)) redirect(`/app/billing?upgrade=${feature}`);
}
