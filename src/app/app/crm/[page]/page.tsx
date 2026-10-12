import type { Metadata } from "next";
import { notFound } from "next/navigation";

import CrmWorkspace from "@/components/crm/CrmWorkspace";
import { crmPages, type CrmPage } from "@/lib/crm-config";
import { loadCrmData } from "@/lib/crm-data";

interface CrmPageProps {
  params: Promise<{ page: string }>;
  searchParams: Promise<{ open?: string }>;
}

function isCrmPage(value: string): value is CrmPage {
  return (crmPages as readonly string[]).includes(value);
}

export async function generateMetadata({ params }: CrmPageProps): Promise<Metadata> {
  const { page } = await params;
  return { title: isCrmPage(page) ? `${page.charAt(0).toUpperCase()}${page.slice(1)} · CRM` : "CRM" };
}

export default async function CrmSectionPage({ params, searchParams }: CrmPageProps) {
  const { page } = await params;
  if (!isCrmPage(page)) notFound();
  const { open } = await searchParams;
  const { store, currency, me, owners } = await loadCrmData();
  return <CrmWorkspace key={page} page={page} initialStore={store} currency={currency} me={me} owners={owners} openId={open} />;
}
