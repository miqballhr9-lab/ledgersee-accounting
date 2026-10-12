import type { Metadata } from "next";
import { notFound } from "next/navigation";

import CrmWorkspace from "@/components/crm/CrmWorkspace";
import { hrModules, hrPages } from "@/lib/hr-config";
import { loadHrData } from "@/lib/hr-data";

interface HrPageProps {
  params: Promise<{ page: string }>;
  searchParams: Promise<{ open?: string }>;
}

export async function generateMetadata({ params }: HrPageProps): Promise<Metadata> {
  const { page } = await params;
  return { title: `${hrModules.find((module) => module.key === page)?.plural ?? "HR"} · HR` };
}

export default async function HrSectionPage({ params, searchParams }: HrPageProps) {
  const { page } = await params;
  if (!hrPages.includes(page)) notFound();
  const { open } = await searchParams;
  const { store, currency, me, owners } = await loadHrData();
  return <CrmWorkspace key={page} page={page} initialStore={store} currency={currency} me={me} owners={owners} openId={open} />;
}
