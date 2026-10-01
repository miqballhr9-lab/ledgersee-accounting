import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { listAllBookkeepingRecords, listBookkeepingRecords } from "@/app/actions";
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
  const records = await listBookkeepingRecords(module.kind);
  return <ModuleWorkspace module={module} records={records} />;
}
