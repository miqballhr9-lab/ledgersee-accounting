import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { listAllBookkeepingRecords, listBookkeepingRecords } from "@/app/actions";
import ChartOfAccountsWorkspace from "@/components/bookkeeping/ChartOfAccountsWorkspace";
import ModuleWorkspace from "@/components/bookkeeping/ModuleWorkspace";
import ReportsWorkspace from "@/components/bookkeeping/ReportsWorkspace";
import { moduleBySlug } from "@/lib/bookkeeping-config";

interface SectionPageProps {
  params: Promise<{ section: string }>;
}

export async function generateMetadata({ params }: SectionPageProps): Promise<Metadata> {
  const { section } = await params;
  const module = moduleBySlug(section);
  return { title: module?.plural ?? (section === "reports" ? "Reports" : "Workspace") };
}

export default async function SectionPage({ params }: SectionPageProps) {
  const { section } = await params;
  if (section === "reports") {
    const records = await listAllBookkeepingRecords();
    return <ReportsWorkspace records={records} asOfDate={new Date().toISOString().slice(0, 10)} />;
  }

  const module = moduleBySlug(section);
  if (!module) notFound();
  if (module.kind === "accounts") {
    const [accounts, settings] = await Promise.all([
      listBookkeepingRecords("accounts"),
      listBookkeepingRecords("settings"),
    ]);
    return <ChartOfAccountsWorkspace accounts={accounts} currency={settings[0]?.data.currency || "USD"} />;
  }

  const [records, customers, vendors, accounts, items] = await Promise.all([
    listBookkeepingRecords(module.kind),
    module.fields.some((field) => field.key === "customer")
      ? listBookkeepingRecords("customers")
      : Promise.resolve([]),
    module.fields.some((field) => field.key === "vendor")
      ? listBookkeepingRecords("vendors")
      : Promise.resolve([]),
    module.kind === "journals" ? listBookkeepingRecords("accounts") : Promise.resolve([]),
    module.kind === "invoices" ? listBookkeepingRecords("items") : Promise.resolve([]),
  ]);
  return <ModuleWorkspace module={module} records={records} customers={customers} vendors={vendors} accounts={accounts} items={items} />;
}
