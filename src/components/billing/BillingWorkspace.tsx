"use client";

import { useState } from "react";
import { Check, CreditCard, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { cancelSubscription, choosePlan, openBillingPortal, resumeSubscription } from "@/app/billing-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { readableError } from "@/lib/action-error";
import type { BillingAccess } from "@/lib/billing";
import { featureLabels, planFor, plans, planPrice, TRIAL_DAYS, type BillingInterval, type Feature } from "@/lib/plans";

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
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">Choose the plan for your business. Every plan starts with a {TRIAL_DAYS}-day free trial of everything, and you can change or cancel at any time.</p>
      </section>

      {notice === "success" ? <p role="status" className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">Thank you! Your payment went through. Your plan updates here within a minute.</p> : null}
      {notice === "changed" ? <p role="status" className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">Your plan has changed. The difference is added to or taken off your next invoice.</p> : null}
      {notice === "cancelled" ? <p role="status" className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">Checkout was cancelled; nothing was charged.</p> : null}
      {upgrade ? <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">{featureLabels[upgrade]} is part of the {planFor(upgrade).name} plan and above. Upgrade to use it.</p> : null}

      {!paymentsReady ? (
        <p className="rounded-lg border border-dashed border-border bg-card px-4 py-3 text-sm text-muted-foreground">Online payments aren&apos;t switched on yet, so every part of MIK LEDGER is open to you for now. The plans below show what will be offered.</p>
      ) : !enabled ? (
        <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm">This business has free access to everything; there is nothing to pay.</p>
      ) : (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card p-5" aria-label="Current plan">
          <div>
            <p className="text-xs text-muted-foreground">Current plan</p>
            <p className="mt-1 flex items-center gap-2 text-lg font-semibold">
              {access.status === "trial_ended" ? "Free trial" : access.status === "trialing" && !subscribed ? "Free trial (all features)" : plans.find((plan) => plan.key === access.plan)?.name}
              <Badge variant={access.locked ? "destructive" : "secondary"}>{statusText[access.status]}</Badge>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {access.status === "trialing" ? `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left, until ${formatDate(access.trialEndsAt)}.`
                : access.locked ? "Your records are read-only. Choose a plan to keep working; nothing has been deleted."
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

      <section aria-label="Plans" className="space-y-4">
        <div className="inline-flex rounded-md border border-border bg-card p-0.5" role="group" aria-label="Billing period">
          {(["month", "year"] as const).map((value) => (
            <Button key={value} type="button" size="sm" variant={interval === value ? "secondary" : "ghost"} aria-pressed={interval === value} onClick={() => setInterval(value)}>
              {value === "month" ? "Monthly" : "Yearly"}
            </Button>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {plans.map((plan) => {
            const current = enabled && subscribed && access.plan === plan.key && access.interval === interval;
            const highlight = upgrade ? planFor(upgrade).key === plan.key : plan.key === "business";
            return (
              <article key={plan.key} className={`flex flex-col rounded-lg border bg-card p-5 ${highlight ? "border-primary shadow-sm" : "border-border"}`}>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">{plan.name}</h2>
                  {highlight ? <Badge>{upgrade ? "Needed" : "Most popular"}</Badge> : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
                <p className="mt-4"><span className="text-3xl font-semibold tabular-nums">${planPrice(plan, interval)}</span><span className="text-sm text-muted-foreground"> / {interval === "year" ? "year" : "month"}</span></p>
                {interval === "year" && plan.monthly * 12 > plan.yearly ? <p className="text-xs font-medium text-primary">Save ${plan.monthly * 12 - plan.yearly} a year</p> : null}
                <ul className="mt-4 flex-1 space-y-2 text-sm">
                  {plan.highlights.map((line) => <li key={line} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-primary" />{line}</li>)}
                </ul>
                <Button
                  type="button"
                  className="mt-5 w-full"
                  variant={highlight ? "default" : "outline"}
                  disabled={!enabled || !canManage || current || Boolean(busy)}
                  title={!paymentsReady ? "Online payments aren't switched on yet." : undefined}
                  onClick={() => run(plan.key, () => choosePlan(plan.key, interval))}
                >
                  {busy === plan.key ? "Opening…" : current ? "Your plan" : subscribed ? `Switch to ${plan.name}` : `Choose ${plan.name}`}
                </Button>
              </article>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">Prices in US dollars. Payments are handled securely by Stripe; card details never reach MIK LEDGER.</p>
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
