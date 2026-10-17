import type { Metadata } from "next";

import { getMyPortal } from "@/app/hr-actions";
import MyPortal from "@/components/hr/MyPortal";
import { listBookkeepingRecordGroups } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { requireFeature } from "@/lib/plan-gate";

export const metadata: Metadata = { title: "My HR portal" };

export default async function MyPortalPage() {
  await requireFeature("hr");
  const me = await requireUser();
  const [portal, groups] = await Promise.all([getMyPortal(), listBookkeepingRecordGroups(["settings"])]);
  return <MyPortal portal={portal} name={me.name} email={me.email} currency={groups.settings?.[0]?.data.currency || "USD"} canRequest={canAccess(me.role, "self", "write")} />;
}
