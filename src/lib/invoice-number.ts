import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";

/** The series number of an invoice number with this prefix, up to six digits (longer ones are stray, e.g. timestamps). */
export function invoiceSequence(number: string | undefined, prefix: string): number {
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d{1,6})$`);
  return Number(pattern.exec((number ?? "").trim())?.[1] ?? 0);
}

/**
 * The next invoice number, the same everywhere invoices are made (the form, recurring
 * schedules, time and delayed charges): one after the highest in the series, or the
 * "next number" in Settings when that is further on.
 */
export async function nextInvoiceNumber(userId: string): Promise<string> {
  const rows = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "invoices")));
  const [settings] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, "settings"))).limit(1);
  const prefix = settings?.data.invoicePrefix || "INV-";
  const highest = rows.reduce((max, row) => Math.max(max, invoiceSequence(row.data.invoiceNumber, prefix)), 0);
  const configured = Number(settings?.data.nextInvoiceNumber) || 1;
  const sequence = Math.max(highest + 1, configured > 999_999 ? 1 : configured);
  return `${prefix}${String(sequence).padStart(4, "0")}`;
}
