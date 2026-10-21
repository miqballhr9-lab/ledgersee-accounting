import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import { nextPartyNumber, partyNumberKey } from "@/lib/party-number";

/**
 * Gives every customer (or supplier) without a number the next one in the
 * series, oldest first: those added before numbers existed, and those made
 * from CRM, a converted lead or an import.
 */
export async function assignMissingPartyNumbers(userId: string, kind: "customers" | "vendors") {
  const key = partyNumberKey[kind];
  const rows = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, userId), eq(bookkeepingRecord.kind, kind))).orderBy(asc(bookkeepingRecord.createdAt));
  const missing = rows.filter((row) => !(row.data[key] ?? "").trim());
  if (!missing.length) return;
  const numbered = rows.filter((row) => (row.data[key] ?? "").trim());
  for (const row of missing) {
    const value = nextPartyNumber(kind, numbered);
    const data = { ...row.data, [key]: value };
    await db.update(bookkeepingRecord).set({ data }).where(eq(bookkeepingRecord.id, row.id));
    numbered.push({ ...row, data });
  }
}
