import { and, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import CheckDocument from "@/components/bookkeeping/CheckDocument";
import InvoiceDocument from "@/components/bookkeeping/InvoiceDocument";
import InvoicePrintButton from "@/components/bookkeeping/InvoicePrintButton";
import { requireUser } from "@/lib/auth";
import { canReadKind } from "@/lib/permissions";
import { requireFeature } from "@/lib/plan-gate";
import { featuresForKind } from "@/lib/plans";
import { customerForDocument } from "@/lib/document-customer";

const printableKinds = ["estimates", "sales-orders", "credit-notes", "expenses"] as const;
type PrintableKind = (typeof printableKinds)[number];

interface DocumentPrintPageProps {
  params: Promise<{ kind: string; id: string }>;
}

export default async function DocumentPrintPage({ params }: DocumentPrintPageProps) {
  const me = await requireUser();
  const { kind, id } = await params;
  if (!printableKinds.includes(kind as PrintableKind)) notFound();
  if (!canReadKind(me.role, kind)) notFound();
  // Quotes print with the CRM app too; the rest belong to Accounting.
  await requireFeature(...featuresForKind(kind));
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
  // Expenses print only as cheques.
  if (documentKind === "expenses") {
    if (document[0].data.docType !== "Check") notFound();
    const [bank] = document[0].data.paymentAccountId
      ? await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.id, document[0].data.paymentAccountId), eq(bookkeepingRecord.userId, me.id))).limit(1)
      : [];
    return (
      <main className="min-h-dvh bg-background px-4 py-8 sm:px-8 print:bg-white print:p-0">
        <div className="mx-auto mb-4 flex max-w-4xl justify-end print:hidden"><InvoicePrintButton /></div>
        <CheckDocument check={document[0].data} companyName={settings[0]?.data.companyName || me.name} bankName={bank?.data.name || document[0].data.paymentAccountName || ""} currency={document[0].data.currency || settings[0]?.data.currency || "PKR"} />
      </main>
    );
  }

  const customer = await customerForDocument(me.id, document[0].data);

  return (
    <main className="min-h-dvh bg-background px-4 py-8 sm:px-8 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-4xl justify-end print:hidden">
        <InvoicePrintButton />
      </div>
      <InvoiceDocument invoice={document[0].data} companyName={settings[0]?.data.companyName || me.name} documentKind={documentKind as Exclude<PrintableKind, "expenses">} seller={settings[0]?.data} customer={customer} />
    </main>
  );
}
