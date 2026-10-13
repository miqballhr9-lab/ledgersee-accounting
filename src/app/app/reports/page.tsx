import type { Metadata } from "next";

import { listBookkeepingRecordGroups } from "@/app/actions";
import ReportsHome from "@/components/reports/ReportsHome";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  const groups = await listBookkeepingRecordGroups(["custom-reports"]);
  return <ReportsHome customReports={groups["custom-reports"] ?? []} />;
}
