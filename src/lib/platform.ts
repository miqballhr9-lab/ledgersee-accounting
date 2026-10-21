import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { cache } from "react";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";

/**
 * The platform owner's controls, above every business: who may open /admin,
 * a business paused or given free access, the announcement shown to everyone,
 * and feedback sent from inside the app. These rows use kinds the app's record
 * screens don't know, so no business can read or change them.
 */

/** One row per business the platform owner has acted on, stored under the business owner's id. */
export const BUSINESS_FLAGS_KIND = "platform-business";
/** Feedback from inside the app, stored under the sender's business. */
export const FEEDBACK_KIND = "platform-feedback";
/** The announcement strip, stored under the platform admin who wrote it. */
export const ANNOUNCEMENT_KIND = "platform-announcement";
/** What each Super Admin did, stored under the admin who did it. */
export const ADMIN_LOG_KIND = "platform-log";

/** People who may open the Super Admin panel: PLATFORM_ADMIN_EMAILS, comma separated. */
export function isPlatformAdmin(email: string | null | undefined) {
  const wanted = (email ?? "").trim().toLowerCase();
  if (!wanted) return false;
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean).includes(wanted);
}

export interface BusinessFlags {
  suspended: boolean;
  /** Shown to the business while it is paused. */
  suspendedNote: string;
  /** Every app, unlimited users, nothing to pay, whatever billing says. */
  freeAccess: boolean;
}

/** A business's flags; none set means a normal business. Read once per request. */
export const businessFlagsFor = cache(async function businessFlagsFor(ownerId: string): Promise<BusinessFlags> {
  const [row] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, ownerId), eq(bookkeepingRecord.kind, BUSINESS_FLAGS_KIND))).limit(1);
  return { suspended: row?.data.suspended === "true", suspendedNote: row?.data.suspendedNote ?? "", freeAccess: row?.data.freeAccess === "true" };
});

export interface Announcement {
  id: string;
  message: string;
  tone: "info" | "warning";
  /** Last day it shows, or empty for until it is taken down. */
  until: string;
}

/** The announcement everyone sees now, if any. */
export const activeAnnouncement = cache(async function activeAnnouncement(): Promise<Announcement | null> {
  const rows = await db.select().from(bookkeepingRecord).where(eq(bookkeepingRecord.kind, ANNOUNCEMENT_KIND)).orderBy(desc(bookkeepingRecord.updatedAt)).limit(5);
  const today = new Date().toISOString().slice(0, 10);
  const row = rows.find((item) => item.data.active === "true" && item.data.message?.trim() && (!item.data.until || item.data.until >= today));
  return row ? { id: row.id, message: row.data.message, tone: row.data.tone === "warning" ? "warning" : "info", until: row.data.until ?? "" } : null;
});
