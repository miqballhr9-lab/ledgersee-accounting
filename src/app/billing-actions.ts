"use server";

import { ActionError } from "@/lib/action-error";
import { requireUser } from "@/lib/auth";
import { billingEnabled, ensureStripeProduct, stripe, stripeItemsOf, subscriptionFor, saveSubscription } from "@/lib/billing";
import { BILLING_CURRENCY, normalizePlans, planByKey, planPrice, type BillingInterval } from "@/lib/plans";
import { revalidatePath } from "@/lib/revalidate";
import { siteUrl } from "@/lib/site";

/** Only the business owner pays for the workspace and changes its plan. */
async function owner() {
  const me = await requireUser();
  if (!me.isOwner) throw new ActionError("Only the business owner can change the plan and billing.");
  if (!billingEnabled()) throw new ActionError("Payments aren't set up yet.");
  return me;
}

/**
 * Chooses the apps or bundle to pay for. Without a subscription this opens
 * Stripe Checkout with one line per plan (any free trial left carries over);
 * with one, it swaps the subscription's lines in place and Stripe charges or
 * credits the difference. Returns a page to go to.
 */
export async function choosePlans(planKeys: string[], interval: BillingInterval): Promise<{ url: string }> {
  const me = await owner();
  if (!["month", "year"].includes(interval)) throw new ActionError("Choose monthly or yearly.");
  const keys = normalizePlans(Array.isArray(planKeys) ? planKeys.map(String) : []);
  if (!keys.length) throw new ActionError("Choose at least one app or bundle. The Free plan needs no payment.");
  const row = await subscriptionFor(me.ownerId);
  const data = row.data;
  const base = await siteUrl();
  // One line per plan, priced from plans.ts.
  const lines: Array<Record<string, string | number>> = [];
  for (const key of keys) {
    const plan = planByKey(key)!;
    lines.push({ currency: BILLING_CURRENCY, product: await ensureStripeProduct(plan.key), unit_amount: Math.round(planPrice(plan, interval) * 100), interval });
  }
  const live = data.stripeSubscriptionId && ["active", "trialing", "past_due"].includes(data.status ?? "");

  if (live) {
    // Swap every current line for the new ones in a single change.
    const current = Object.values(stripeItemsOf(data));
    const params: Record<string, string | number> = { proration_behavior: "create_prorations", cancel_at_period_end: "false", "metadata[ownerId]": me.ownerId, "metadata[plans]": keys.join(",") };
    current.forEach((itemId, index) => {
      params[`items[${index}][id]`] = itemId;
      params[`items[${index}][deleted]`] = "true";
    });
    lines.forEach((line, offset) => {
      const index = current.length + offset;
      params[`items[${index}][price_data][currency]`] = line.currency;
      params[`items[${index}][price_data][product]`] = line.product;
      params[`items[${index}][price_data][unit_amount]`] = line.unit_amount;
      params[`items[${index}][price_data][recurring][interval]`] = line.interval;
    });
    await stripe("POST", `subscriptions/${data.stripeSubscriptionId}`, params);
    await saveSubscription(me.ownerId, { plans: keys.join(","), plan: keys[0], interval, cancelAtPeriodEnd: "false" });
    revalidatePath("/app", "layout");
    return { url: `${base}/app/billing?status=changed` };
  }

  // A free trial still running carries over, if Stripe allows it (at least two days away).
  const trialEnd = data.status === "trialing" && !data.stripeSubscriptionId && data.trialEndsAt ? Math.floor(Date.parse(data.trialEndsAt) / 1000) : 0;
  const params: Record<string, string | number> = {
    mode: "subscription",
    client_reference_id: me.ownerId,
    ...(data.stripeCustomerId ? { customer: data.stripeCustomerId } : { customer_email: me.email }),
    "subscription_data[metadata][ownerId]": me.ownerId,
    "subscription_data[metadata][plans]": keys.join(","),
    ...(trialEnd > Date.now() / 1000 + 2 * 86_400 ? { "subscription_data[trial_end]": trialEnd } : {}),
    "metadata[ownerId]": me.ownerId,
    allow_promotion_codes: "true",
    success_url: `${base}/app/billing?status=success`,
    cancel_url: `${base}/app/billing?status=cancelled`,
  };
  lines.forEach((line, index) => {
    params[`line_items[${index}][quantity]`] = 1;
    params[`line_items[${index}][price_data][currency]`] = line.currency;
    params[`line_items[${index}][price_data][product]`] = line.product;
    params[`line_items[${index}][price_data][unit_amount]`] = line.unit_amount;
    params[`line_items[${index}][price_data][recurring][interval]`] = line.interval;
  });
  const session = await stripe("POST", "checkout/sessions", params);
  if (typeof session.url !== "string") throw new ActionError("The payment page couldn't be opened. Please try again.");
  return { url: session.url };
}

/** Stripe's billing page: card, invoices, cancelling. */
export async function openBillingPortal(): Promise<{ url: string }> {
  const me = await owner();
  const data = (await subscriptionFor(me.ownerId)).data;
  if (!data.stripeCustomerId) throw new ActionError("Choose a plan first.");
  const portal = await stripe("POST", "billing_portal/sessions", { customer: data.stripeCustomerId, return_url: `${await siteUrl()}/app/billing` });
  if (typeof portal.url !== "string") throw new ActionError("The billing page couldn't be opened. Please try again.");
  return { url: portal.url };
}

/** Stops the subscription at the end of the period already paid for. */
export async function cancelSubscription(): Promise<void> {
  const me = await owner();
  const data = (await subscriptionFor(me.ownerId)).data;
  if (!data.stripeSubscriptionId) throw new ActionError("There's no subscription to cancel.");
  await stripe("POST", `subscriptions/${data.stripeSubscriptionId}`, { cancel_at_period_end: "true" });
  await saveSubscription(me.ownerId, { cancelAtPeriodEnd: "true" });
  revalidatePath("/app", "layout");
}

/** Undoes a cancellation before the period ends. */
export async function resumeSubscription(): Promise<void> {
  const me = await owner();
  const data = (await subscriptionFor(me.ownerId)).data;
  if (!data.stripeSubscriptionId) throw new ActionError("There's no subscription to resume.");
  await stripe("POST", `subscriptions/${data.stripeSubscriptionId}`, { cancel_at_period_end: "false" });
  await saveSubscription(me.ownerId, { cancelAtPeriodEnd: "false" });
  revalidatePath("/app", "layout");
}
