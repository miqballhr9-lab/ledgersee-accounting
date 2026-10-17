import type { Metadata } from "next";

import { listBookkeepingRecordGroups } from "@/app/actions";
import ReportsHome from "@/components/reports/ReportsHome";
import { requireUser } from "@/lib/auth";
import { reportCategoryFeature } from "@/lib/plan-gate";
import { reportCategories } from "@/lib/report-catalog";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  const me = await requireUser();
  const groups = await listBookkeepingRecordGroups(["custom-reports"]);
  // Only the report groups of the apps the business has.
  const categoryKeys = me.access.locked ? undefined : reportCategories.map((category) => category.key).filter((key) => me.access.features.includes(reportCategoryFeature(key)));
  return <ReportsHome customReports={me.access.features.includes("accounting") ? groups["custom-reports"] ?? [] : []} categoryKeys={categoryKeys} />;
}
