"use server";

import { ActionError } from "@/lib/action-error";
import { requireUser } from "@/lib/auth";
import { billingEnabled, ensureStripeProduct, stripe, subscriptionFor, saveSubscription } from "@/lib/billing";
import { BILLING_CURRENCY, planByKey, planPrice, type BillingInterval } from "@/lib/plans";
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
 * Chooses a plan. Without a subscription this opens Stripe Checkout (any free
 * trial days left carry over); with one, it switches the plan in place and
 * Stripe charges or credits the difference. Returns a page to go to.
 */
export async function choosePlan(planKey: string, interval: BillingInterval): Promise<{ url: string }> {
  const me = await owner();
  const plan = planByKey(planKey);
  if (!plan || !["month", "year"].includes(interval)) throw new ActionError("Choose a plan.");
  // The Free plan needs no payment: cancelling a paid plan moves the business to it at the end of the period.
  if (plan.monthly <= 0) throw new ActionError("The Free plan needs no payment. Cancel your subscription to move to it at the end of the period.");
  const row = await subscriptionFor(me.ownerId);
  const data = row.data;
  const product = await ensureStripeProduct(plan.key);
  const amount = Math.round(planPrice(plan, interval) * 100);
  const base = await siteUrl();
  const live = data.stripeSubscriptionId && ["active", "trialing", "past_due"].includes(data.status ?? "");

  if (live && data.stripeItemId) {
    await stripe("POST", `subscriptions/${data.stripeSubscriptionId}`, {
      "items[0][id]": data.stripeItemId,
      "items[0][price_data][currency]": BILLING_CURRENCY,
      "items[0][price_data][product]": product,
      "items[0][price_data][unit_amount]": amount,
      "items[0][price_data][recurring][interval]": interval,
      proration_behavior: "create_prorations",
      cancel_at_period_end: "false",
      "metadata[ownerId]": me.ownerId,
      "metadata[plan]": plan.key,
    });
    await saveSubscription(me.ownerId, { plan: plan.key, interval, cancelAtPeriodEnd: "false" });
    revalidatePath("/app", "layout");
    return { url: `${base}/app/billing?status=changed` };
  }

  // A free trial still running carries over, if Stripe allows it (at least two days away).
  const trialEnd = data.status === "trialing" && !data.stripeSubscriptionId && data.trialEndsAt ? Math.floor(Date.parse(data.trialEndsAt) / 1000) : 0;
  const session = await stripe("POST", "checkout/sessions", {
    mode: "subscription",
    client_reference_id: me.ownerId,
    ...(data.stripeCustomerId ? { customer: data.stripeCustomerId } : { customer_email: me.email }),
    "line_items[0][quantity]": 1,
    "line_items[0][price_data][currency]": BILLING_CURRENCY,
    "line_items[0][price_data][product]": product,
    "line_items[0][price_data][unit_amount]": amount,
    "line_items[0][price_data][recurring][interval]": interval,
    "subscription_data[metadata][ownerId]": me.ownerId,
    "subscription_data[metadata][plan]": plan.key,
    ...(trialEnd > Date.now() / 1000 + 2 * 86_400 ? { "subscription_data[trial_end]": trialEnd } : {}),
    "metadata[ownerId]": me.ownerId,
    allow_promotion_codes: "true",
    success_url: `${base}/app/billing?status=success`,
    cancel_url: `${base}/app/billing?status=cancelled`,
  });
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
