import type { Metadata } from "next";
import { and, eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import CareersBoard from "@/components/hr/CareersBoard";

export const metadata: Metadata = { title: "Careers" };

/** The public job board (Odoo's Jobs website page), shared by link. */
export default async function CareersPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(token)) notFound();
  const [settings] = await db.select().from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.kind, "settings"), sql`${bookkeepingRecord.data}->>'careersToken' = ${token}`)).limit(1);
  if (!settings) notFound();
  const jobs = (await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, settings.userId), eq(bookkeepingRecord.kind, "hr-jobs"))))
    .filter((job) => !["Not recruiting", "Closed", "On hold"].includes(job.data.status ?? ""))
    .map((job) => ({ id: job.id, title: job.data.jobTitle || "Job", department: job.data.department ?? "", location: job.data.location ?? "", type: job.data.employmentType ?? "", description: job.data.description ?? "" }))
    .sort((a, b) => a.title.localeCompare(b.title));
  return <CareersBoard token={token} company={settings.data.companyName || "Our company"} logo={settings.data.logo || ""} jobs={jobs} />;
}
