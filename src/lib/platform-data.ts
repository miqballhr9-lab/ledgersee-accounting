import "server-only";

import { desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { bookkeepingRecord, session, user } from "@/db/schema";
import { emailConfigured, smtpSettings } from "@/lib/email";
import { planByKey, planKeysOf } from "@/lib/plans";
import { blobConfigured } from "@/lib/storage";
import { ANNOUNCEMENT_KIND, BUSINESS_FLAGS_KIND, FEEDBACK_KIND } from "@/lib/platform";

/** Kinds that aren't a business's own work, left out of its record counts. */
const notWork = ["audit-events", "settings", "subscription", "team-members", BUSINESS_FLAGS_KIND, FEEDBACK_KIND, ANNOUNCEMENT_KIND, "automation-log"];

export interface AdminBusiness {
  ownerId: string;
  name: string;
  ownerName: string;
  ownerEmail: string;
  signedUp: string;
  /** Last time anyone in the business signed in or saved something. */
  lastActive: string;
  users: number;
  records: number;
  invoices: number;
  plan: string;
  trialEndsAt: string;
  suspended: boolean;
  suspendedNote: string;
  freeAccess: boolean;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  signedUp: string;
  lastSeen: string;
  business: string;
  role: string;
}

export interface AdminFeedback {
  id: string;
  at: string;
  type: string;
  message: string;
  page: string;
  name: string;
  email: string;
  business: string;
  status: string;
}

export interface StatusCheck {
  name: string;
  ok: boolean;
  detail: string;
}

const iso = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : "");

export async function loadAdminData() {
  const [users, sessions, stats, memberships, settings, subscriptions, flags, feedback, announcements] = await Promise.all([
    db.select({ id: user.id, name: user.name, email: user.email, createdAt: user.createdAt }).from(user),
    db.select({ userId: session.userId, last: sql<Date>`max(${session.updatedAt})` }).from(session).groupBy(session.userId),
    db.select({
      userId: bookkeepingRecord.userId,
      records: sql<number>`count(*) filter (where ${bookkeepingRecord.kind} not in (${sql.join(notWork.map((kind) => sql`${kind}`), sql`, `)}))`,
      invoices: sql<number>`count(*) filter (where ${bookkeepingRecord.kind} = 'invoices')`,
      last: sql<Date>`max(${bookkeepingRecord.updatedAt}) filter (where ${bookkeepingRecord.kind} not in (${sql.join(notWork.map((kind) => sql`${kind}`), sql`, `)}))`,
    }).from(bookkeepingRecord).groupBy(bookkeepingRecord.userId),
    db.select({ ownerId: bookkeepingRecord.userId, data: bookkeepingRecord.data }).from(bookkeepingRecord).where(eq(bookkeepingRecord.kind, "team-members")),
    db.select({ ownerId: bookkeepingRecord.userId, data: bookkeepingRecord.data }).from(bookkeepingRecord).where(eq(bookkeepingRecord.kind, "settings")),
    db.select({ ownerId: bookkeepingRecord.userId, data: bookkeepingRecord.data }).from(bookkeepingRecord).where(eq(bookkeepingRecord.kind, "subscription")),
    db.select({ ownerId: bookkeepingRecord.userId, data: bookkeepingRecord.data }).from(bookkeepingRecord).where(eq(bookkeepingRecord.kind, BUSINESS_FLAGS_KIND)),
    db.select().from(bookkeepingRecord).where(eq(bookkeepingRecord.kind, FEEDBACK_KIND)).orderBy(desc(bookkeepingRecord.createdAt)).limit(500),
    db.select().from(bookkeepingRecord).where(inArray(bookkeepingRecord.kind, [ANNOUNCEMENT_KIND])).orderBy(desc(bookkeepingRecord.updatedAt)).limit(1),
  ]);

  const lastSession = new Map(sessions.map((row) => [row.userId, iso(row.last)]));
  const statsBy = new Map(stats.map((row) => [row.userId, row]));
  const active = memberships.filter((row) => row.data.status === "Active" && row.data.enabled !== "false" && row.data.memberUserId && row.data.memberUserId !== row.ownerId);
  // Someone invited into another business works there; everyone else owns their own.
  const memberOf = new Map(active.map((row) => [row.data.memberUserId, row]));
  const userById = new Map(users.map((row) => [row.id, row]));
  const later = (...dates: string[]) => dates.filter(Boolean).sort().pop() ?? "";

  const businesses: AdminBusiness[] = users.filter((row) => !memberOf.has(row.id)).map((owner) => {
    const team = active.filter((row) => row.ownerId === owner.id);
    const stat = statsBy.get(owner.id);
    const subscription = subscriptions.find((row) => row.ownerId === owner.id)?.data;
    const flag = flags.find((row) => row.ownerId === owner.id)?.data ?? {};
    const company = settings.find((row) => row.ownerId === owner.id)?.data;
    const keys = subscription ? planKeysOf(subscription) : [];
    return {
      ownerId: owner.id,
      name: company?.companyName?.trim() || owner.name,
      ownerName: owner.name,
      ownerEmail: owner.email,
      signedUp: iso(owner.createdAt),
      lastActive: later(iso(stat?.last), lastSession.get(owner.id) ?? "", ...team.map((row) => lastSession.get(row.data.memberUserId) ?? "")),
      users: 1 + team.length,
      records: Number(stat?.records ?? 0),
      invoices: Number(stat?.invoices ?? 0),
      plan: !subscription ? "Free beta" : subscription.status === "trialing" && !subscription.stripeSubscriptionId ? "Trial" : keys.map((key) => planByKey(key)?.name ?? key).join(" + "),
      trialEndsAt: subscription?.status === "trialing" ? subscription.trialEndsAt ?? "" : "",
      suspended: flag.suspended === "true",
      suspendedNote: flag.suspendedNote ?? "",
      freeAccess: flag.freeAccess === "true",
    };
  }).sort((a, b) => b.signedUp.localeCompare(a.signedUp));

  const businessName = new Map(businesses.map((row) => [row.ownerId, row.name]));
  const people: AdminUser[] = users.map((row) => {
    const membership = memberOf.get(row.id);
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      signedUp: iso(row.createdAt),
      lastSeen: lastSession.get(row.id) ?? "",
      business: membership ? businessName.get(membership.ownerId) ?? userById.get(membership.ownerId)?.name ?? "" : businessName.get(row.id) ?? row.name,
      role: membership ? membership.data.role || "Viewer" : "Owner",
    };
  }).sort((a, b) => (b.lastSeen || b.signedUp).localeCompare(a.lastSeen || a.signedUp));

  const inbox: AdminFeedback[] = feedback.map((row) => ({
    id: row.id, at: iso(row.createdAt), type: row.data.type ?? "Other", message: row.data.message ?? "", page: row.data.page ?? "",
    name: row.data.name ?? "", email: row.data.email ?? "", business: row.data.business ?? "", status: row.data.status ?? "New",
  }));

  const announcement = announcements[0] && announcements[0].data.active === "true"
    ? { message: announcements[0].data.message ?? "", tone: announcements[0].data.tone === "warning" ? "warning" as const : "info" as const, until: announcements[0].data.until ?? "" }
    : null;

  return { businesses, people, inbox, announcement, status: systemStatus() };
}

/** What this deployment has switched on, without ever showing a key. */
export function systemStatus(): StatusCheck[] {
  const has = (...names: string[]) => names.every((name) => Boolean(process.env[name]?.trim()));
  const site = process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  return [
    { name: "Database", ok: true, detail: "Connected (this page read from it)." },
    { name: "Sign-in secret", ok: has("BETTER_AUTH_SECRET"), detail: has("BETTER_AUTH_SECRET") ? "Set." : "BETTER_AUTH_SECRET is missing: sign-in won't work." },
    { name: "Site address", ok: Boolean(site), detail: site || "Set BETTER_AUTH_URL to your live address." },
    { name: "Email", ok: emailConfigured(), detail: smtpSettings() ? `Sends from ${smtpSettings()!.from}. Use “Send test email” to be sure.` : emailConfigured() ? "Set (platform). Use “Send test email” to be sure." : "Not set: password resets, invites and invoice emails won't send. Add GMAIL_USER and GMAIL_APP_PASSWORD in Vercel." },
    { name: "File uploads", ok: blobConfigured() || has("IMAGINE_SERVICES_URL", "IMAGINE_APP_TOKEN"), detail: blobConfigured() ? "Vercel Blob is connected." : has("IMAGINE_SERVICES_URL", "IMAGINE_APP_TOKEN") ? "Set (platform)." : "Not set: attachments can't be uploaded. Connect a Vercel Blob store (Storage → Blob)." },
    { name: "Payments (Stripe)", ok: has("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"), detail: has("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET") ? "On: businesses choose and pay for plans." : has("STRIPE_SECRET_KEY") ? "Secret key set, but STRIPE_WEBHOOK_SECRET is missing: paid plans won't update." : "Off: everything is free for every business (beta)." },
    { name: "Scheduled jobs (cron)", ok: has("CRON_SECRET"), detail: has("CRON_SECRET") ? "Set: reminders and recurring invoices run daily." : "CRON_SECRET is missing: daily automation won't run on its own." },
    { name: "AI assistant", ok: has("IMAGINE_AI_URL", "IMAGINE_AI_KEY"), detail: has("IMAGINE_AI_URL", "IMAGINE_AI_KEY") ? "On: free questions are answered." : "Off: suggested questions work; free questions don't." },
    { name: "Super Admins", ok: has("PLATFORM_ADMIN_EMAILS"), detail: `${(process.env.PLATFORM_ADMIN_EMAILS ?? "").split(",").filter((entry) => entry.trim()).length} email(s) in PLATFORM_ADMIN_EMAILS.` },
  ];
}
