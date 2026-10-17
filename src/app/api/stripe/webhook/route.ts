import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { bookkeepingRecord, user } from "@/db/schema";
import { saveSubscription, stripeCall, subscriptionFor, verifyStripeSignature } from "@/lib/billing";
import { planByKey } from "@/lib/plans";

export const dynamic = "force-dynamic";

type StripeObject = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value : "");
const unixDate = (value: unknown) => (typeof value === "number" && value > 0 ? new Date(value * 1000).toISOString() : "");

/** The workspace a Stripe object belongs to: its metadata, else the workspace that holds its customer. */
async function ownerOf(object: StripeObject): Promise<string> {
  const metadata = (object.metadata ?? {}) as Record<string, string>;
  const fromMetadata = metadata.ownerId || text(object.client_reference_id);
  if (fromMetadata) {
    const [found] = await db.select({ id: user.id }).from(user).where(eq(user.id, fromMetadata)).limit(1);
    if (found) return found.id;
  }
  const customer = text(object.customer);
  if (!customer) return "";
  const [row] = await db.select({ userId: bookkeepingRecord.userId }).from(bookkeepingRecord)
    .where(and(eq(bookkeepingRecord.kind, "subscription"), sql`${bookkeepingRecord.data}->>'stripeCustomerId' = ${customer}`)).limit(1);
  return row?.userId ?? "";
}

const statusMap: Record<string, string> = { active: "active", trialing: "trialing", past_due: "past_due", unpaid: "past_due", incomplete: "past_due", canceled: "canceled", incomplete_expired: "canceled", paused: "canceled" };

/** Copies a Stripe subscription onto the workspace's subscription record. */
async function applySubscription(subscription: StripeObject) {
  const ownerId = await ownerOf(subscription);
  if (!ownerId) return;
  // One line per app or bundle; each line's product names its plan.
  const items = (subscription.items as { data?: StripeObject[] } | undefined)?.data ?? [];
  const lines = items.map((item) => ({ item, plan: planByKey(text((item.price as StripeObject | undefined)?.product).replace(/^mikledger_/, ""))?.key })).filter((line) => line.plan);
  const metadata = (subscription.metadata ?? {}) as Record<string, string>;
  const keys = lines.length ? lines.map((line) => line.plan!) : (metadata.plans || metadata.plan || "").split(",").filter((key) => planByKey(key));
  const item = items[0] ?? {};
  const price = (item.price ?? {}) as StripeObject;
  const status = statusMap[text(subscription.status)] ?? "canceled";
  const current = (await subscriptionFor(ownerId)).data;
  await saveSubscription(ownerId, {
    ...(keys.length ? { plans: keys.join(","), plan: keys[0] } : {}),
    stripeItems: JSON.stringify(Object.fromEntries(lines.map((line) => [line.plan, text(line.item.id)]))),
    status,
    stripeSubscriptionId: text(subscription.id),
    stripeCustomerId: text(subscription.customer),
    stripeItemId: text(item.id),
    interval: text((price.recurring as StripeObject | undefined)?.interval),
    // Newer Stripe versions keep the period on the item.
    currentPeriodEnd: unixDate(subscription.current_period_end) || unixDate(item.current_period_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end ? "true" : "false",
    ...(status === "trialing" ? { trialEndsAt: unixDate(subscription.trial_end) } : {}),
    pastDueSince: status === "past_due" ? current.pastDueSince || new Date().toISOString() : "",
  });
}

/** The latest payments, newest first, for the Billing page. */
async function recordInvoice(invoice: StripeObject, paid: boolean) {
  const ownerId = await ownerOf(invoice);
  if (!ownerId) return;
  const current = (await subscriptionFor(ownerId)).data;
  let history: StripeObject[] = [];
  try {
    history = JSON.parse(current.payments || "[]") as StripeObject[];
  } catch {
    history = [];
  }
  const entry = {
    id: text(invoice.id),
    date: unixDate(invoice.created).slice(0, 10),
    amount: ((Number(paid ? invoice.amount_paid : invoice.amount_due) || 0) / 100).toFixed(2),
    currency: text(invoice.currency).toUpperCase(),
    status: paid ? "Paid" : "Failed",
    url: text(invoice.hosted_invoice_url),
    number: text(invoice.number),
  };
  history = [entry, ...history.filter((row) => row.id !== entry.id)].slice(0, 24);
  await saveSubscription(ownerId, {
    payments: JSON.stringify(history),
    ...(paid ? {} : { status: "past_due", pastDueSince: current.pastDueSince || new Date().toISOString() }),
  });
}

/**
 * Stripe tells the app about payments here (Developers > Webhooks in Stripe,
 * pointing at /api/stripe/webhook). Only requests signed with
 * STRIPE_WEBHOOK_SECRET are trusted.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) return Response.json({ error: "Payments aren't set up." }, { status: 503 });
  const payload = await request.text();
  if (!verifyStripeSignature(payload, request.headers.get("stripe-signature"), secret)) return Response.json({ error: "Bad signature" }, { status: 400 });
  let event: { type?: string; data?: { object?: StripeObject } };
  try {
    event = JSON.parse(payload);
  } catch {
    return Response.json({ error: "Bad payload" }, { status: 400 });
  }
  const object = event.data?.object ?? {};
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const ownerId = await ownerOf(object);
        if (ownerId && text(object.customer)) await saveSubscription(ownerId, { stripeCustomerId: text(object.customer) });
        // The subscription itself, as Stripe has it now.
        if (text(object.subscription)) {
          const { ok, json } = await stripeCall("GET", `subscriptions/${text(object.subscription)}`);
          if (ok) await applySubscription({ ...json, metadata: { ...((json.metadata ?? {}) as object), ownerId } });
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await applySubscription(object);
        break;
      case "invoice.paid":
        await recordInvoice(object, true);
        break;
      case "invoice.payment_failed":
        await recordInvoice(object, false);
        break;
      default:
        break;
    }
  } catch (error) {
    console.error("[billing] webhook failed", event.type, error);
    return Response.json({ error: "Not processed" }, { status: 500 });
  }
  return Response.json({ received: true });
}
