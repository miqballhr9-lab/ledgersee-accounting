import { and, eq, inArray, sql } from "drizzle-orm";

import { runDueAutomations } from "@/app/automation-actions";
import { db } from "@/db";
import { bookkeepingRecord, user } from "@/db/schema";
import { runAsUser } from "@/lib/run-as-user";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily scheduled job (see vercel.json): runs the due automation rules of every
 * business that has Automation mode on, whether or not anyone opens the app.
 * Vercel calls it with "Authorization: Bearer <CRON_SECRET>"; anything else is refused.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not set." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await db
    .select({ userId: bookkeepingRecord.userId })
    .from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.kind, "automation-settings"), sql`${bookkeepingRecord.data}->>'mode' = 'Automation'`));
  const ownerIds = [...new Set(settings.map((row) => row.userId))];
  const owners = ownerIds.length ? await db.select().from(user).where(inArray(user.id, ownerIds)) : [];

  let ran = 0;
  let failed = 0;
  for (const owner of owners) {
    try {
      await runAsUser(owner, () => runDueAutomations());
      ran += 1;
    } catch {
      failed += 1;
    }
  }
  return Response.json({ businesses: owners.length, ran, failed });
}
