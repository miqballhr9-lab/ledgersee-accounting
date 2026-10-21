"use server";

import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";

import { db } from "@/db";
import { bookkeepingRecord, session, user } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { getUser, requireUser } from "@/lib/auth";
import { subscriptionFor, saveSubscription } from "@/lib/billing";
import { sendEmail } from "@/lib/email";
import { businessRecords, type BusinessBackup } from "@/lib/backup";
import { emailConfigured } from "@/lib/email";
import { ADMIN_LOG_KIND, ANNOUNCEMENT_KIND, BUSINESS_FLAGS_KIND, FEEDBACK_KIND, isPlatformAdmin } from "@/lib/platform";
import { loadAdminData } from "@/lib/platform-data";
import { recordAudit } from "@/lib/audit";
import { revalidatePath } from "@/lib/revalidate";
import { signViewAs, VIEW_AS_COOKIE, VIEW_AS_SECONDS } from "@/lib/view-as";

/** The signed-in platform admin, or throw: every action here is theirs alone. */
async function requirePlatformAdmin() {
  const me = await getUser();
  if (!me || !isPlatformAdmin(me.email)) throw new ActionError("Only the MIK LEDGER owner can do this.");
  return me;
}

async function ownerExists(ownerId: string) {
  const [row] = await db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(eq(user.id, ownerId)).limit(1);
  if (!row) throw new ActionError("That business no longer exists.");
  return row;
}

/** Notes what a Super Admin did, for the Activity tab. Never blocks the action itself. */
async function logAdmin(admin: { id: string; email: string }, action: string, target = "", detail = "") {
  try {
    await db.insert(bookkeepingRecord).values({ userId: admin.id, kind: ADMIN_LOG_KIND, data: { action, target: target.slice(0, 200), detail: detail.slice(0, 300), by: admin.email, at: new Date().toISOString() } });
  } catch (error) {
    console.error("[admin] couldn't log", error);
  }
}

/** "Acme Traders (owner@x.com)" for the activity log. */
async function businessLabel(ownerId: string) {
  const owner = await ownerExists(ownerId);
  const [settings] = await db.select({ data: bookkeepingRecord.data }).from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, ownerId), eq(bookkeepingRecord.kind, "settings"))).limit(1);
  return { owner, name: settings?.data.companyName?.trim() || owner.name, label: `${settings?.data.companyName?.trim() || owner.name} (${owner.email})` };
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
  const { label } = await businessLabel(ownerId);
  if (patch.suspended !== undefined) await logAdmin(admin, patch.suspended ? "Paused business" : "Resumed business", label, data.suspendedNote);
  if (patch.freeAccess !== undefined) await logAdmin(admin, patch.freeAccess ? "Gave free access" : "Removed free access", label);
  revalidatePath("/admin");
}

/** Gives a business more free trial: the trial runs on from today or from its current end, whichever is later. */
export async function extendTrial(ownerId: string, months: number): Promise<string> {
  const admin = await requirePlatformAdmin();
  await ownerExists(ownerId);
  if (!Number.isInteger(months) || months < 1 || months > 24) throw new ActionError("Choose between 1 and 24 months.");
  const subscription = await subscriptionFor(ownerId);
  if (subscription.data.stripeSubscriptionId && ["active", "past_due"].includes(subscription.data.status ?? "")) throw new ActionError("This business already pays through Stripe; give it free access instead.");
  const from = Math.max(Date.now(), Date.parse(subscription.data.trialEndsAt ?? "") || 0);
  const end = new Date(from);
  end.setUTCMonth(end.getUTCMonth() + months);
  await saveSubscription(ownerId, { status: "trialing", trialEndsAt: end.toISOString() });
  await logAdmin(admin, "Extended trial", (await businessLabel(ownerId)).label, `${months} ${months === 1 ? "month" : "months"}, until ${end.toISOString().slice(0, 10)}`);
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
  await logAdmin(admin, "Put up announcement", "Everyone", text);
  revalidatePath("/", "layout");
}

export async function clearAnnouncement(): Promise<void> {
  const admin = await requirePlatformAdmin();
  await db.delete(bookkeepingRecord).where(eq(bookkeepingRecord.kind, ANNOUNCEMENT_KIND));
  await logAdmin(admin, "Took down announcement");
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

/**
 * Opens a business read-only for support, for an hour. The business's Audit Log
 * notes it, so its owner can see that support looked.
 */
export async function startViewAs(ownerId: string): Promise<void> {
  const admin = await requirePlatformAdmin();
  await ownerExists(ownerId);
  if (ownerId === admin.id) throw new ActionError("That's your own business; open it normally.");
  (await cookies()).set(VIEW_AS_COOKIE, signViewAs(admin.id, ownerId), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: VIEW_AS_SECONDS });
  await recordAudit({ id: ownerId, name: "MIK LEDGER support", email: admin.email }, "Viewed for support (read-only)", "support-view", ownerId, { description: `By ${admin.email}` });
  await logAdmin(admin, "Viewed business (read-only)", (await businessLabel(ownerId)).label);
}

/** Back to the admin's own business. Open to anyone signed in: it only removes a cookie. */
export async function stopViewAs(): Promise<void> {
  (await cookies()).delete(VIEW_AS_COOKIE);
}

/** Signs a person out on every device, e.g. after they report a lost phone. */
export async function signOutEverywhere(userId: string): Promise<number> {
  const admin = await requirePlatformAdmin();
  const person = await ownerExists(userId);
  const removed = await db.delete(session).where(eq(session.userId, userId)).returning({ id: session.id });
  await logAdmin(admin, "Signed out everywhere", `${person.name} (${person.email})`, `${removed.length} ${removed.length === 1 ? "device" : "devices"}`);
  revalidatePath("/admin");
  return removed.length;
}

/** A business's full backup, for support or before deleting it. Logged. */
export async function exportBusiness(ownerId: string): Promise<BusinessBackup> {
  const admin = await requirePlatformAdmin();
  const { owner, name, label } = await businessLabel(ownerId);
  const records = await businessRecords(ownerId);
  await logAdmin(admin, "Downloaded backup", label, `${records.length} records`);
  return { exportedAt: new Date().toISOString(), account: { name: owner.name, email: owner.email }, business: name, records };
}

/**
 * Deletes a business for good: its owner's sign-in and every record it holds.
 * Team members keep their own sign-ins, they simply belong to no business any
 * more. The admin must type the owner's email to confirm.
 */
export async function deleteBusiness(ownerId: string, confirmEmail: string): Promise<void> {
  const admin = await requirePlatformAdmin();
  const { owner, label } = await businessLabel(ownerId);
  if (owner.id === admin.id || isPlatformAdmin(owner.email)) throw new ActionError("A Super Admin's own business can't be deleted here.");
  if (confirmEmail.trim().toLowerCase() !== owner.email.toLowerCase()) throw new ActionError("Type the owner's email exactly to confirm.");
  const [counted] = await db.select({ id: bookkeepingRecord.id }).from(bookkeepingRecord).where(eq(bookkeepingRecord.userId, ownerId));
  await db.transaction(async (tx) => {
    await tx.delete(bookkeepingRecord).where(eq(bookkeepingRecord.userId, ownerId));
    await tx.delete(user).where(eq(user.id, ownerId));
  });
  await logAdmin(admin, "Deleted business", label, counted ? "with its records" : "it had no records");
  revalidatePath("/admin");
}

export type EmailAudience = "all" | "active" | "inactive" | "trial";

/**
 * Emails business owners: everyone, those active in the last 30 days, those
 * quiet for 30 days or more, or those on a trial. Five at a time; returns how
 * many went out and how many failed.
 */
export async function emailOwners(audience: EmailAudience, subject: string, message: string): Promise<{ sent: number; failed: number }> {
  const admin = await requirePlatformAdmin();
  if (!emailConfigured()) throw new ActionError("Email isn't set up yet. Add GMAIL_USER and GMAIL_APP_PASSWORD in Vercel first.");
  const title = subject.trim().slice(0, 150);
  const body = message.trim().slice(0, 5000);
  if (!title || body.length < 5) throw new ActionError("Write a subject and a message first.");
  const { businesses } = await loadAdminData();
  const days = (value: string) => (value ? (Date.now() - Date.parse(value)) / 86400000 : Infinity);
  const chosen = businesses.filter((business) => !business.suspended && (
    audience === "active" ? days(business.lastActive) < 30
      : audience === "inactive" ? days(business.lastActive) >= 30
        : audience === "trial" ? Boolean(business.trialEndsAt)
          : true));
  if (!chosen.length) throw new ActionError("No business owners match that choice.");
  if (chosen.length > 400) throw new ActionError("That's more than 400 owners; Gmail allows about 500 emails a day. Choose a smaller group.");
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = (name: string) => `<p>Hello ${escape(name)},</p>${escape(body).split(/\n{2,}/).map((part) => `<p>${part.replace(/\n/g, "<br>")}</p>`).join("")}<p>— MIK LEDGER</p>`;
  let sent = 0;
  let failed = 0;
  for (let index = 0; index < chosen.length; index += 5) {
    const results = await Promise.all(chosen.slice(index, index + 5).map((business) =>
      sendEmail({ to: business.ownerEmail, subject: title, html: html(business.ownerName), fromName: "MIK LEDGER" }).catch(() => false)));
    sent += results.filter(Boolean).length;
    failed += results.filter((ok) => !ok).length;
  }
  await logAdmin(admin, "Emailed business owners", { all: "All owners", active: "Active owners", inactive: "Inactive owners", trial: "Owners on trial" }[audience], `“${title}”: ${sent} sent${failed ? `, ${failed} failed` : ""}`);
  return { sent, failed };
}
