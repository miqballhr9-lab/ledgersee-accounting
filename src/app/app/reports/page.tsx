import type { Metadata } from "next";

import ReportsHome from "@/components/reports/ReportsHome";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return <ReportsHome />;
}
