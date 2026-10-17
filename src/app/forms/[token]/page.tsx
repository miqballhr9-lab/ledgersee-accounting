import type { Metadata } from "next";
import { and, eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import WebLeadForm from "@/components/crm/WebLeadForm";

export const metadata: Metadata = { title: "Contact us" };

/** The public web-to-lead form, shared by link or embedded on a website. */
export default async function WebFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(token)) notFound();
  const [settings] = await db.select().from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.kind, "settings"), sql`${bookkeepingRecord.data}->>'webFormToken' = ${token}`)).limit(1);
  if (!settings) notFound();
  return <WebLeadForm token={token} company={settings.data.companyName || "Us"} />;
}
