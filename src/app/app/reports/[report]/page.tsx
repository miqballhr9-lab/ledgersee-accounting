import { Suspense } from "react";
import type { Metadata } from "next";

import { listAllBookkeepingRecords } from "@/app/actions";
import ReportViewer from "@/components/reports/ReportViewer";
import { reportByKey } from "@/lib/report-catalog";

interface ReportPageProps {
  params: Promise<{ report: string }>;
}

export async function generateMetadata({ params }: ReportPageProps): Promise<Metadata> {
  const { report } = await params;
  return { title: report === "transaction-report" ? "Transaction Report" : reportByKey(report)?.label ?? "Report" };
}

export default async function ReportPage({ params }: ReportPageProps) {
  const { report } = await params;
  const records = await listAllBookkeepingRecords();
  return (
    <Suspense>
      <ReportViewer reportKey={report} records={records} today={new Date().toISOString().slice(0, 10)} />
    </Suspense>
  );
}
