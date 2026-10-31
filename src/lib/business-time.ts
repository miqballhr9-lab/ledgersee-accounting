import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { and, desc, eq } from "drizzle-orm";
import { cache } from "react";

import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { bookkeepingRecord } from "@/db/schema";
import { dateInZone, effectiveTimeZone } from "@/lib/dates";

/** A business's time zone, read once per request. */
export const zoneFor = cache(async function zoneFor(ownerId: string) {
  const [settings] = await db.select({ data: bookkeepingRecord.data }).from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.userId, ownerId), eq(bookkeepingRecord.kind, "settings")))
    .orderBy(desc(bookkeepingRecord.updatedAt)).limit(1);
  return effectiveTimeZone(settings?.data);
});

/** Today (YYYY-MM-DD) where the business is. Use this, never the server's UTC date. */
export async function todayFor(ownerId: string) {
  return dateInZone(await zoneFor(ownerId));
}

const zoneStore = new AsyncLocalStorage<string>();

/** Runs work (automation, scheduled jobs) with the business's zone as "today" for serverToday(). */
export async function withBusinessZone<T>(ownerId: string, work: () => Promise<T>): Promise<T> {
  return zoneStore.run(await zoneFor(ownerId), work);
}

/**
 * Today for code deep inside a business's work that has no owner id at hand:
 * the zone set by withBusinessZone, else Pakistan time. Prefer todayFor(ownerId).
 */
export function serverToday() {
  return dateInZone(zoneStore.getStore());
}

/** Today where the signed-in person's business is, for pages and actions. */
export async function myToday() {
  return todayFor((await requireUser()).id);
}
