import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";

/** The customer a sales document is for, from its customer id or else its name, for the client details on the printout. */
export async function customerForDocument(ownerId: string, data: Record<string, string>): Promise<Record<string, string> | undefined> {
  if (data.customerId) {
    const [byId] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.id, data.customerId), eq(bookkeepingRecord.userId, ownerId), eq(bookkeepingRecord.kind, "customers"))).limit(1);
    if (byId) return byId.data;
  }
  const name = data.customer?.trim();
  if (!name) return undefined;
  const [byName] = await db.select().from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, ownerId), eq(bookkeepingRecord.kind, "customers"), sql`lower(trim(${bookkeepingRecord.data}->>'name')) = lower(${name})`)).limit(1);
  return byName?.data;
}
