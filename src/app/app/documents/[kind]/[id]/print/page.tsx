import { and, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import InvoiceDocument from "@/components/bookkeeping/InvoiceDocument";
import InvoicePrintButton from "@/components/bookkeeping/InvoicePrintButton";
import { requireUser } from "@/lib/auth";

const printableKinds = ["estimates", "sales-orders", "credit-notes"] as const;
type PrintableKind = (typeof printableKinds)[number];

interface DocumentPrintPageProps {
  params: Promise<{ kind: string; id: string }>;
}

export default async function DocumentPrintPage({ params }: DocumentPrintPageProps) {
  const me = await requireUser();
  const { kind, id } = await params;
  if (!printableKinds.includes(kind as PrintableKind)) notFound();
  const documentKind = kind as PrintableKind;
  const [document, settings] = await Promise.all([
    db
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, documentKind)))
      .limit(1),
    db
      .select()
      .from(bookkeepingRecord)
      .where(and(eq(bookkeepingRecord.userId, me.id), eq(bookkeepingRecord.kind, "settings")))
      .orderBy(desc(bookkeepingRecord.updatedAt))
      .limit(1),
  ]);
  if (!document[0]) notFound();

  return (
    <main className="min-h-dvh bg-background px-4 py-8 sm:px-8 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-4xl justify-end print:hidden">
        <InvoicePrintButton />
      </div>
      <InvoiceDocument invoice={document[0].data} companyName={settings[0]?.data.companyName || me.name} documentKind={documentKind} />
    </main>
  );
}
