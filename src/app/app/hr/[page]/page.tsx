import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import CrmWorkspace from "@/components/crm/CrmWorkspace";
import { hrModules, hrPages } from "@/lib/hr-config";
import { loadHrData } from "@/lib/hr-data";

interface HrPageProps {
  params: Promise<{ page: string }>;
  searchParams: Promise<{ open?: string }>;
}

export async function generateMetadata({ params }: HrPageProps): Promise<Metadata> {
  const { page } = await params;
  return { title: `${hrModules.find((module) => module.key === page)?.plural ?? "HRM"} · HRM` };
}

/** Pages renamed to Odoo's names; old links still land in the right place. */
const renamed: Record<string, string> = {
  attendance: "attendances", "leave-requests": "time-off", "leave-types": "time-off-types", holidays: "public-holidays", loans: "salary-attachments",
  "expense-claims": "expenses", jobs: "job-positions", candidates: "applications", settlements: "departures",
};

export default async function HrSectionPage({ params, searchParams }: HrPageProps) {
  const { page } = await params;
  if (renamed[page]) redirect(`/app/hr/${renamed[page]}`);
  if (!hrPages.includes(page)) notFound();
  const { open } = await searchParams;
  const { store, currency, me, owners } = await loadHrData();
  return <CrmWorkspace key={page} page={page} initialStore={store} currency={currency} me={me} owners={owners} openId={open} />;
}
