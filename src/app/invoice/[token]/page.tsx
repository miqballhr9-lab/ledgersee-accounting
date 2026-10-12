import type { Metadata } from "next";
import { and, eq, inArray, sql } from "drizzle-orm";
import { notFound } from "next/navigation";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import InvoiceDocument from "@/components/bookkeeping/InvoiceDocument";
import InvoicePrintButton from "@/components/bookkeeping/InvoicePrintButton";

export const metadata: Metadata = {
  title: "Invoice",
  robots: { index: false, follow: false },
};

interface SharedInvoicePageProps {
  params: Promise<{ token: string }>;
}

export default async function SharedInvoicePage({ params }: SharedInvoicePageProps) {
  const { token } = await params;
  const [invoice] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(
      inArray(bookkeepingRecord.kind, ["invoices", "estimates", "sales-orders", "credit-notes"]),
      sql`${bookkeepingRecord.data}->>'shareToken' = ${token}`,
    ))
    .limit(1);
  if (!invoice) notFound();

  const [settings] = await db
    .select()
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, invoice.userId), eq(bookkeepingRecord.kind, "settings")))
    .orderBy(sql`${bookkeepingRecord.updatedAt} desc`)
    .limit(1);

  return (
    <main className="min-h-dvh bg-background px-4 py-8 sm:px-8 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-4xl justify-end print:hidden">
        <InvoicePrintButton />
      </div>
      <InvoiceDocument
        invoice={invoice.data}
        companyName={settings?.data.companyName || "Business"}
        seller={settings?.data}
        documentKind={invoice.kind as "invoices" | "estimates" | "sales-orders" | "credit-notes"}
      />
    </main>
  );
}
