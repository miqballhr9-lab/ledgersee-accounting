import { and, eq, desc } from "drizzle-orm";
import { notFound } from "next/navigation";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import InvoiceDocument from "@/components/bookkeeping/InvoiceDocument";
import InvoicePrintButton from "@/components/bookkeeping/InvoicePrintButton";
import { requireFeature } from "@/lib/plan-gate";

interface InvoicePrintPageProps {
  params: Promise<{ id: string }>;
}

export default async function InvoicePrintPage({ params }: InvoicePrintPageProps) {
  await requireFeature("accounting");
  const me = await requireUser();
  const { id } = await params;
  const [invoice, settings] = await Promise.all([
    db
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "invoices")))
      .limit(1),
    db
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "settings")))
      .orderBy(desc(bookkeepingRecord.updatedAt))
      .limit(1),
  ]);
  if (!invoice[0]) notFound();

  return (
    <main className="min-h-dvh bg-background px-4 py-8 sm:px-8 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-4xl justify-end print:hidden">
        <InvoicePrintButton />
      </div>
      <InvoiceDocument invoice={invoice[0].data} companyName={settings[0]?.data.companyName || me.name} seller={settings[0]?.data} />
    </main>
  );
}
