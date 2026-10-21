import "server-only";

import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";

export interface BusinessBackup {
  exportedAt: string;
  account: { name: string; email: string };
  business: string;
  records: { id: string; kind: string; data: Record<string, string>; createdAt: string; updatedAt: string }[];
}

/**
 * Every record of one business, for its backup file. Billing, platform notes and
 * sign-in history aren't the business's records, and no link token or secret
 * leaves in a file that may be emailed around.
 */
export async function businessRecords(ownerId: string): Promise<BusinessBackup["records"]> {
  const rows = await db
    .select({ id: bookkeepingRecord.id, kind: bookkeepingRecord.kind, data: bookkeepingRecord.data, createdAt: bookkeepingRecord.createdAt, updatedAt: bookkeepingRecord.updatedAt })
    .from(bookkeepingRecord)
    .where(eq(bookkeepingRecord.userId, ownerId))
    .orderBy(desc(bookkeepingRecord.updatedAt));
  const hidden = (kind: string) => kind === "subscription" || kind === "sign-in-log" || kind.startsWith("platform-");
  return rows.filter((row) => !hidden(row.kind)).map((row) => ({
    id: row.id,
    kind: row.kind,
    data: Object.fromEntries(Object.entries(row.data).filter(([key]) => !/token|secret|password/i.test(key))),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}
