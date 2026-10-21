import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { cache } from "react";

import { db } from "@/db";
import { bookkeepingRecord } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { businessFlagsFor } from "@/lib/platform";
import { combinePlans, planByKey, planKeysOf, TRIAL_MONTHS, type Feature, type PlanKey } from "@/lib/plans";

/**
 * Subscriptions, paid through Stripe. Billing is off until STRIPE_SECRET_KEY is
 * set: until then every workspace keeps the whole product, as before. Each
 * workspace owner has one "subscription" record; it is never editable through
 * the record forms, only by checkout and Stripe's webhook.
 */

const SUBSCRIPTION_KIND = "subscription";
/** Days a failed renewal keeps working while Stripe retries the card. */
const GRACE_DAYS = 7;

export const billingEnabled = () => Boolean(process.env.STRIPE_SECRET_KEY);

export interface BillingAccess {
  /** False when Stripe isn't set up, or the workspace is on the free list. */
  enabled: boolean;
  /** Records can be read and exported, not changed: a team member's workspace is on the owner-only Free plan. */
  locked: boolean;
  /** The first plan, for messages; plans holds every app or bundle bought. */
  plan: PlanKey;
  plans: PlanKey[];
  /** The plans' names together, e.g. "CRM app + HRM app". */
  planName: string;
  status: "trialing" | "active" | "past_due" | "canceled" | "trial_ended" | "free";
  trialEndsAt: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  interval: string;
  features: Feature[];
  users: number;
  /** Paused by the platform owner (Super Admin): nothing can be changed. */
  suspended: boolean;
  suspendedNote: string;
}

const allFeatures: Feature[] = ["accounting", "inventory", "crm", "hr", "pos"];

/** Workspaces that never pay, such as the business that runs this product (BILLING_EXEMPT_EMAILS). */
function exempt(email: string) {
  return (process.env.BILLING_EXEMPT_EMAILS ?? "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean).includes(email.trim().toLowerCase());
}

/** The workspace's subscription record; a new workspace starts a trial of everything. */
export async function subscriptionFor(ownerId: string) {
  const [row] = await db.select().from(bookkeepingRecord).where(and(eq(bookkeepingRecord.userId, ownerId), eq(bookkeepingRecord.kind, SUBSCRIPTION_KIND))).orderBy(asc(bookkeepingRecord.createdAt)).limit(1);
  if (row) return row;
  const end = new Date();
  end.setUTCMonth(end.getUTCMonth() + TRIAL_MONTHS);
  const trialEndsAt = end.toISOString();
  const [created] = await db.insert(bookkeepingRecord).values({ userId: ownerId, kind: SUBSCRIPTION_KIND, data: { plan: "enterprise", status: "trialing", trialEndsAt } }).returning();
  return created;
}

export async function saveSubscription(ownerId: string, patch: Record<string, string>) {
  const row = await subscriptionFor(ownerId);
  const [saved] = await db.update(bookkeepingRecord).set({ data: { ...row.data, ...patch }, updatedAt: new Date() }).where(eq(bookkeepingRecord.id, row.id)).returning();
  return saved;
}

/** What a workspace may do under its plan right now, and whether the platform owner paused it. Read once per request. */
export const billingAccess = cache(async function billingAccess(ownerId: string, ownerEmail: string): Promise<BillingAccess> {
  const flags = await businessFlagsFor(ownerId);
  const access = flags.freeAccess ? openAccess() : await planAccess(ownerId, ownerEmail);
  return { ...access, suspended: flags.suspended, suspendedNote: flags.suspendedNote };
});

/** Everything, free: billing is off, or the business is on the free list. */
function openAccess(): BillingAccess {
  return { enabled: false, locked: false, plan: "enterprise", plans: ["enterprise"], planName: "Enterprise bundle", status: "free", trialEndsAt: "", currentPeriodEnd: "", cancelAtPeriodEnd: false, interval: "", features: allFeatures, users: Number.POSITIVE_INFINITY, suspended: false, suspendedNote: "" };
}

async function planAccess(ownerId: string, ownerEmail: string): Promise<BillingAccess> {
  const open = openAccess();
  if (!billingEnabled() || exempt(ownerEmail)) return open;
  const data = (await subscriptionFor(ownerId)).data;
  const now = Date.now();
  const keys = planKeysOf(data);
  const bought = combinePlans(keys);
  const base = { ...open, enabled: true, plan: keys[0], plans: keys, planName: bought.name, trialEndsAt: data.trialEndsAt ?? "", currentPeriodEnd: data.currentPeriodEnd ?? "", cancelAtPeriodEnd: data.cancelAtPeriodEnd === "true", interval: data.interval ?? "" };
  const paidUp = { ...base, features: bought.features, users: bought.users };
  // When a trial or paid plan runs out, the business carries on with the Free plan; nothing is locked or deleted.
  const free = planByKey("free")!;
  const onFree = { ...base, plan: free.key, plans: [free.key], planName: free.name, features: free.features, users: free.users, cancelAtPeriodEnd: false, interval: "" };
  const before = (date: string | undefined, extraDays = 0) => Boolean(date) && now < Date.parse(date!) + extraDays * 86_400_000;
  switch (data.status) {
    case "active":
      return { ...paidUp, status: "active" };
    case "trialing":
      // A trial started at checkout is on the chosen plan; the free trial is everything.
      return before(data.trialEndsAt) ? { ...(data.stripeSubscriptionId ? paidUp : { ...base, features: allFeatures }), status: "trialing" } : { ...onFree, status: "trial_ended" };
    case "past_due":
      return before(data.pastDueSince, GRACE_DAYS) ? { ...paidUp, status: "past_due" } : { ...onFree, status: "past_due" };
    default:
      return before(data.currentPeriodEnd) ? { ...paidUp, status: "canceled" } : { ...onFree, status: data.status === "canceled" ? "canceled" : "trial_ended" };
  }
}

/** The Stripe subscription line for each plan bought, by plan key. Older records kept one line in stripeItemId. */
export function stripeItemsOf(data: Record<string, string>): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(data.stripeItems || "{}");
    if (parsed && typeof parsed === "object" && Object.keys(parsed).length) return parsed as Record<string, string>;
  } catch {
    // Unreadable: fall back to the single line.
  }
  return data.stripeItemId ? { [data.plan || "plan"]: data.stripeItemId } : {};
}

/** Calls Stripe's API (form-encoded, as Stripe expects) and returns its status and body without throwing on errors. */
export async function stripeCall(method: "GET" | "POST", path: string, params: Record<string, string | number | undefined> = {}): Promise<{ ok: boolean; json: Record<string, unknown> & { error?: { message?: string; code?: string } } }> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new ActionError("Payments aren't set up yet.");
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value !== undefined && value !== "") body.set(name, String(value));
  const query = method === "GET" && body.size ? `?${body}` : "";
  let response: Response;
  try {
    response = await fetch(`https://api.stripe.com/v1/${path}${query}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body: method === "POST" ? body : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ActionError("We couldn't reach the payment service. Please try again in a moment.");
  }
  return { ok: response.ok, json: (await response.json().catch(() => ({}))) as Record<string, unknown> };
}

/** Like stripeCall, but a refusal becomes a message for the person. */
export async function stripe(method: "GET" | "POST", path: string, params: Record<string, string | number | undefined> = {}) {
  const { ok, json } = await stripeCall(method, path, params);
  if (!ok) {
    console.error("[billing] Stripe error", path, json.error?.message);
    throw new ActionError("The payment service turned this down. Please try again, or contact support if it keeps happening.");
  }
  return json;
}

/** Each plan is one Stripe product with a fixed id, created the first time it's needed. */
export const stripeProductId = (plan: PlanKey) => `mikledger_${plan}`;

export async function ensureStripeProduct(plan: PlanKey) {
  const name = planByKey(plan)?.name ?? plan;
  const { ok, json } = await stripeCall("POST", "products", { id: stripeProductId(plan), name: `MIK LEDGER ${name}` });
  if (!ok && json.error?.code !== "resource_already_exists") throw new ActionError("The payment service turned this down. Please try again, or contact support if it keeps happening.");
  return stripeProductId(plan);
}

/** Checks a webhook really came from Stripe (the Stripe-Signature header), within five minutes. */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, toleranceSeconds = 300): boolean {
  if (!header) return false;
  const parts = header.split(",").map((part) => part.split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !signatures.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return signatures.some((signature) => signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected)));
}
