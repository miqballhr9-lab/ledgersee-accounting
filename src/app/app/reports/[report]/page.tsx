import { Suspense } from "react";
import type { Metadata } from "next";

import { listAllBookkeepingRecords } from "@/app/actions";
import ManagementReport from "@/components/reports/ManagementReport";
import ReportViewer from "@/components/reports/ReportViewer";
import { reportByKey } from "@/lib/report-catalog";

interface ReportPageProps {
  params: Promise<{ report: string }>;
}

export async function generateMetadata({ params }: ReportPageProps): Promise<Metadata> {
  const { report } = await params;
  return { title: report === "transaction-report" ? "Transaction Report" : report === "management-report" ? "Management report" : reportByKey(report)?.label ?? "Report" };
}

export default async function ReportPage({ params }: ReportPageProps) {
  const { report } = await params;
  const records = await listAllBookkeepingRecords();
  if (report === "management-report") return <ManagementReport records={records} today={new Date().toISOString().slice(0, 10)} />;
  return (
    <Suspense>
      <ReportViewer reportKey={report} records={records} today={new Date().toISOString().slice(0, 10)} />
    </Suspense>
  );
}
