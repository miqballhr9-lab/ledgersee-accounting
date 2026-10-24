"use client";

import { useState } from "react";
import { Check, CreditCard, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { cancelSubscription, choosePlans, openBillingPortal, resumeSubscription } from "@/app/billing-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { readableError } from "@/lib/action-error";
import type { BillingAccess } from "@/lib/billing";
import { featureLabels, formatPlanPrice, normalizePlans, planByKey, planFor, planPrice, plans, TRIAL_MONTHS, type BillingInterval, type Feature, type Plan, type PlanKey } from "@/lib/plans";

export interface BillingPayment {
  id: string;
  date: string;
  amount: string;
  currency: string;
  status: string;
  url: string;
  number: string;
}

const statusText: Record<BillingAccess["status"], string> = {
  trialing: "Free trial",
  active: "Active",
  past_due: "Payment due",
  canceled: "Cancelled",
  trial_ended: "Trial ended",
  free: "Free",
};

const formatDate = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

/** Plans, the current subscription and payment history. Only the business owner can change them. */
export default function BillingWorkspace({ enabled, paymentsReady, canManage, access, daysLeft, payments, hasCustomer, notice, upgrade }: {
  enabled: boolean;
  paymentsReady: boolean;
  canManage: boolean;
  /** users is -1 for unlimited. */
  access: Omit<BillingAccess, "users"> & { users: number };
  /** Days left in the trial. */
  daysLeft: number;
  payments: BillingPayment[];
  hasCustomer: boolean;
  notice?: "success" | "changed" | "cancelled";
  upgrade?: Feature;
}) {
  const [interval, setInterval] = useState<BillingInterval>(access.interval === "year" ? "year" : "month");
  const [busy, setBusy] = useState("");
  const subscribed = hasCustomer && ["active", "trialing", "past_due"].includes(access.status) && access.interval !== "";
  const current = enabled && !access.locked ? access.plans : [];
  const [selected, setSelected] = useState<PlanKey[]>(() => (current.length && access.interval ? current : upgrade ? [planFor(upgrade).key] : []));
  const total = selected.reduce((sum, key) => sum + planPrice(planByKey(key)!, interval), 0);
  const unchanged = subscribed && interval === access.interval && selected.length === current.length && selected.every((key) => current.includes(key));
  // Point out a bundle that costs no more than the apps chosen.
  const chosenFeatures = new Set(selected.flatMap((key) => planByKey(key)!.features));
  const cheaperBundle = plans.find((plan) => plan.type === "bundle" && !selected.includes(plan.key) && [...chosenFeatures].every((feature) => plan.features.includes(feature)) && planPrice(plan, interval) <= total);
  const bundleHint = cheaperBundle ? `the ${cheaperBundle.name} includes all this for $${formatPlanPrice(planPrice(cheaperBundle, interval))}` : "";

  function toggle(key: PlanKey) {
    setSelected((now) => normalizePlans(now.includes(key) ? now.filter((entry) => entry !== key) : [...now, key]));
  }

  function planCard(plan: Plan) {
    const picked = selected.includes(plan.key);
    const coveredBy = !picked ? selected.map((key) => planByKey(key)!).find((other) => other.type === "bundle" && plan.features.every((feature) => other.features.includes(feature))) : undefined;
    const highlight = picked || (upgrade ? planFor(upgrade).key === plan.key : false);
    return (
      <article key={plan.key} className={`flex flex-col rounded-lg border bg-card p-5 ${highlight ? "border-primary shadow-sm" : "border-border"}`}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">{plan.name}</h3>
          {current.includes(plan.key) ? <Badge variant="secondary">Current</Badge> : upgrade && planFor(upgrade).key === plan.key ? <Badge>Needed</Badge> : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
        <p className="mt-4"><span className="text-3xl font-semibold tabular-nums">${formatPlanPrice(planPrice(plan, interval))}</span><span className="text-sm text-muted-foreground">{` / ${interval === "year" ? "year" : "month"}`}</span></p>
        {interval === "year" && plan.monthly * 12 > plan.yearly ? <p className="text-xs font-medium text-primary">Save ${formatPlanPrice(plan.monthly * 12 - plan.yearly)} a year</p> : null}
        <ul className="mt-4 flex-1 space-y-2 text-sm">
          {plan.highlights.map((line) => <li key={line} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-primary" />{line}</li>)}
        </ul>
        <Button type="button" className="mt-5 w-full" variant={picked ? "default" : "outline"} aria-pressed={picked} disabled={Boolean(coveredBy) || Boolean(busy)} onClick={() => toggle(plan.key)}>
          {coveredBy ? `In the ${coveredBy.name}` : picked ? <><Check size={15} />Selected</> : plan.type === "bundle" ? `Choose ${plan.name}` : `Add ${plan.name}`}
        </Button>
      </article>
    );
  }

  async function run(key: string, action: () => Promise<{ url: string } | void>, done?: string) {
    setBusy(key);
    try {
      const result = await action();
      if (result && "url" in result) {
        window.location.href = result.url;
        return;
      }
      if (done) toast.success(done);
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? readableError(error) : "That couldn't be done. Please try again.");
      setBusy("");
    }
  }

  return (
    <main className="space-y-6 px-4 py-6 sm:px-7 lg:px-8">
      <section>
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Organization / Billing</p>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">Plan and billing</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">Choose the plan for your business. Every business starts with {TRIAL_MONTHS} months free with everything included; after that a plan is needed to keep working. Your records are never deleted. Change or cancel at any time.</p>
      </section>

      {notice === "success" ? <p role="status" className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">Thank you! Your payment went through. Your plan updates here within a minute.</p> : null}
      {notice === "changed" ? <p role="status" className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">Your plan has changed. The difference is added to or taken off your next invoice.</p> : null}
      {notice === "cancelled" ? <p role="status" className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">Checkout was cancelled; nothing was charged.</p> : null}
      {upgrade ? <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">{featureLabels[upgrade]} isn&apos;t in your plan. Add the {planFor(upgrade).name}, or a bundle that includes it.</p> : null}

      {!paymentsReady ? (
        access.locked ? (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">Your free trial ended{access.trialEndsAt ? ` on ${formatDate(access.trialEndsAt)}` : ""}. You can still look at and download your records. Online payment isn&apos;t open yet, so to keep working, use &quot;Send feedback&quot; at the top and MIK LEDGER will turn your business back on.</p>
        ) : access.status === "trialing" ? (
          <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm">Free trial of every app: <span className="font-medium">{daysLeft} {daysLeft === 1 ? "day" : "days"} left</span>, until {formatDate(access.trialEndsAt)}. Online payments aren&apos;t switched on yet; the plans below show what will be offered.</p>
        ) : (
          <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm">This business has free access; there is nothing to pay.</p>
        )
      ) : !enabled ? (
        <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm">This business has free access to everything; there is nothing to pay.</p>
      ) : (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card p-5" aria-label="Current plan">
          <div>
            <p className="text-xs text-muted-foreground">Current plan</p>
            <p className="mt-1 flex items-center gap-2 text-lg font-semibold">
              {access.status === "trialing" && !subscribed ? "Free trial (all apps)" : access.planName}
              <Badge variant={access.locked ? "destructive" : "secondary"}>{statusText[access.status]}</Badge>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {access.status === "trialing" ? `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left, until ${formatDate(access.trialEndsAt)}.`
                : access.locked ? "Read-only: choose a plan below to carry on. Nothing has been deleted."
                : access.status === "past_due" ? "The last payment didn't go through. Update your card to keep your plan."
                : access.cancelAtPeriodEnd ? `Cancelled; it stays active until ${formatDate(access.currentPeriodEnd)}.`
                : access.currentPeriodEnd ? `Renews on ${formatDate(access.currentPeriodEnd)}, billed ${access.interval === "year" ? "yearly" : "monthly"}.` : ""}
              {" "}{access.users > 0 ? `${access.users} ${access.users === 1 ? "user" : "users"} included.` : "Unlimited users."}
            </p>
          </div>
          {canManage && hasCustomer ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => run("portal", openBillingPortal)}><CreditCard size={15} />Card and invoices<ExternalLink size={13} /></Button>
              {subscribed && !access.cancelAtPeriodEnd ? <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => { if (window.confirm("Cancel the subscription? It stays active until the end of the period you've paid for.")) void run("cancel", cancelSubscription, "Subscription cancelled."); }}>Cancel subscription</Button> : null}
              {subscribed && access.cancelAtPeriodEnd ? <Button type="button" disabled={Boolean(busy)} onClick={() => run("resume", resumeSubscription, "Subscription resumed.")}>Keep my subscription</Button> : null}
            </div>
          ) : null}
        </section>
      )}

      {enabled && !canManage ? <p className="text-sm text-muted-foreground">Only the business owner can change the plan.</p> : null}

      <section aria-label="Plans" className="space-y-5">
        <div className="inline-flex rounded-md border border-border bg-card p-0.5" role="group" aria-label="Billing period">
          {(["month", "year"] as const).map((value) => (
            <Button key={value} type="button" size="sm" variant={interval === value ? "secondary" : "ghost"} aria-pressed={interval === value} onClick={() => setInterval(value)}>
              {value === "month" ? "Monthly" : "Yearly"}
            </Button>
          ))}
        </div>

        <div>
          <h2 className="font-semibold">Apps</h2>
          <p className="text-sm text-muted-foreground">Take only what you need, one app or several together.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {plans.filter((plan) => plan.type === "app").map((plan) => planCard(plan))}
        </div>

        <div>
          <h2 className="font-semibold">Bundles</h2>
          <p className="text-sm text-muted-foreground">Several apps together for less than buying them one by one.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {plans.filter((plan) => plan.type === "bundle").map((plan) => planCard(plan))}
        </div>

        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="text-sm">
            {selected.length ? (
              <>
                <p className="font-medium">{selected.map((key) => planByKey(key)?.name).join(" + ")}</p>
                <p className="text-muted-foreground">${formatPlanPrice(total)} / {interval === "year" ? "year" : "month"}{bundleHint ? ` · ${bundleHint}` : ""}</p>
              </>
            ) : <p className="text-muted-foreground">Choose one or more apps, or a bundle.</p>}
          </div>
          <Button
            type="button"
            disabled={!enabled || !canManage || !selected.length || unchanged || Boolean(busy)}
            title={!paymentsReady ? "Online payments aren't switched on yet." : undefined}
            onClick={() => run("checkout", () => choosePlans(selected, interval))}
          >
            {busy === "checkout" ? "Opening…" : unchanged ? "Your plan" : subscribed ? "Update my plan" : "Continue to payment"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Prices in US dollars. Yearly saves a month and a half. Payments are handled securely by Stripe; card details never reach MIK LEDGER.</p>
      </section>

      {enabled && payments.length ? (
        <section className="rounded-lg border border-border bg-card" aria-labelledby="payment-history">
          <h2 id="payment-history" className="border-b border-border px-4 py-3 font-semibold">Payment history</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground"><tr className="border-b border-border"><th className="px-4 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">Invoice</th><th className="px-4 py-2 text-right font-medium">Amount</th><th className="px-4 py-2 font-medium">Status</th></tr></thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5">{payment.date}</td>
                  <td className="px-4 py-2.5">{payment.url ? <a href={payment.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{payment.number || "View"}</a> : payment.number || "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{payment.currency} {payment.amount}</td>
                  <td className="px-4 py-2.5"><Badge variant={payment.status === "Paid" ? "secondary" : "destructive"}>{payment.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </main>
  );
}
