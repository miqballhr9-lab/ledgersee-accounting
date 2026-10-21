"use server";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { bookkeepingRecord, user } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { getUser, requireUser } from "@/lib/auth";
import { subscriptionFor, saveSubscription } from "@/lib/billing";
import { sendEmail } from "@/lib/email";
import { ANNOUNCEMENT_KIND, BUSINESS_FLAGS_KIND, FEEDBACK_KIND, isPlatformAdmin } from "@/lib/platform";
import { revalidatePath } from "@/lib/revalidate";

/** The signed-in platform admin, or throw: every action here is theirs alone. */
async function requirePlatformAdmin() {
  const me = await getUser();
  if (!me || !isPlatformAdmin(me.email)) throw new ActionError("Only the MIK LEDGER owner can do this.");
  return me;
}

async function ownerExists(ownerId: string) {
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.id, ownerId)).limit(1);
  if (!row) throw new ActionError("That business no longer exists.");
}

/** Pauses or resumes a business, or gives it free access; the change is noted with who made it. */
export async function setBusinessFlags(ownerId: string, patch: { suspended?: boolean; suspendedNote?: string; freeAccess?: boolean }): Promise<void> {
  const admin = await requirePlatformAdmin();
  await ownerExists(ownerId);
  const [row] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, ownerId), eq(bookkeepingRecord.kind, BUSINESS_FLAGS_KIND))).limit(1);
  const data: Record<string, string> = { ...(row?.data ?? {}) };
  if (patch.suspended !== undefined) {
    data.suspended = patch.suspended ? "true" : "false";
    data.suspendedNote = patch.suspended ? (patch.suspendedNote ?? "").trim().slice(0, 300) : "";
    data.suspendedAt = patch.suspended ? new Date().toISOString() : "";
  }
  if (patch.freeAccess !== undefined) data.freeAccess = patch.freeAccess ? "true" : "false";
  data.changedBy = admin.email;
  data.changedAt = new Date().toISOString();
  if (row) await db.update(bookkeepingRecord).set({ data, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, row.id));
  else await db.insert(bookkeepingRecord).values({ userId: ownerId, kind: BUSINESS_FLAGS_KIND, data });
  revalidatePath("/admin");
}

/** Gives a business more free trial: the trial runs on from today or from its current end, whichever is later. */
export async function extendTrial(ownerId: string, months: number): Promise<string> {
  await requirePlatformAdmin();
  await ownerExists(ownerId);
  if (!Number.isInteger(months) || months < 1 || months > 24) throw new ActionError("Choose between 1 and 24 months.");
  const subscription = await subscriptionFor(ownerId);
  if (subscription.data.stripeSubscriptionId && ["active", "past_due"].includes(subscription.data.status ?? "")) throw new ActionError("This business already pays through Stripe; give it free access instead.");
  const from = Math.max(Date.now(), Date.parse(subscription.data.trialEndsAt ?? "") || 0);
  const end = new Date(from);
  end.setUTCMonth(end.getUTCMonth() + months);
  await saveSubscription(ownerId, { status: "trialing", trialEndsAt: end.toISOString() });
  revalidatePath("/admin");
  return end.toISOString();
}

/** Puts up the announcement every signed-in person sees, replacing any earlier one. */
export async function saveAnnouncement(message: string, tone: "info" | "warning", until: string): Promise<void> {
  const admin = await requirePlatformAdmin();
  const text = message.trim().slice(0, 280);
  if (!text) throw new ActionError("Write the announcement first.");
  if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new ActionError("Choose a valid last day.");
  await db.update(bookkeepingRecord).set({ data: { active: "false" }, updatedAt: new Date() }).where(eq(bookkeepingRecord.kind, ANNOUNCEMENT_KIND));
  await db.insert(bookkeepingRecord).values({ userId: admin.id, kind: ANNOUNCEMENT_KIND, data: { message: text, tone: tone === "warning" ? "warning" : "info", until, active: "true", by: admin.email } });
  revalidatePath("/", "layout");
}

export async function clearAnnouncement(): Promise<void> {
  await requirePlatformAdmin();
  await db.delete(bookkeepingRecord).where(eq(bookkeepingRecord.kind, ANNOUNCEMENT_KIND));
  revalidatePath("/", "layout");
}

export async function setFeedbackStatus(id: string, status: "New" | "Done"): Promise<void> {
  await requirePlatformAdmin();
  const [row] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.kind, FEEDBACK_KIND))).limit(1);
  if (!row) throw new ActionError("That feedback was already deleted.");
  await db.update(bookkeepingRecord).set({ data: { ...row.data, status }, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, id));
  revalidatePath("/admin");
}

export async function deleteFeedback(id: string): Promise<void> {
  await requirePlatformAdmin();
  await db.delete(bookkeepingRecord).where(and(eq(bookkeepingRecord.id, id), eq(bookkeepingRecord.kind, FEEDBACK_KIND)));
  revalidatePath("/admin");
}

/** Sends a test email to the admin, to see that email works on this deployment. */
export async function sendTestEmail(): Promise<boolean> {
  const admin = await requirePlatformAdmin();
  return sendEmail({ to: admin.email, subject: "MIK LEDGER test email", html: "<p>Email is working on this MIK LEDGER deployment.</p>", fromName: "MIK LEDGER" });
}

/** Feedback from anyone signed in: a problem, an idea or a question, with the page it came from. */
export async function submitFeedback(type: string, message: string, page: string): Promise<void> {
  const me = await requireUser();
  const text = message.trim().slice(0, 3000);
  if (text.length < 3) throw new ActionError("Write a few words first.");
  const kind = ["Problem", "Idea", "Question"].includes(type) ? type : "Other";
  await db.insert(bookkeepingRecord).values({
    userId: me.ownerId,
    kind: FEEDBACK_KIND,
    data: { type: kind, message: text, page: page.slice(0, 200), name: me.name, email: me.email, business: me.workspaceName, role: me.role, status: "New" },
  });
}
