import type { Metadata } from "next";

import BillingWorkspace, { type BillingPayment } from "@/components/billing/BillingWorkspace";
import { requireUser } from "@/lib/auth";
import { billingEnabled, subscriptionFor } from "@/lib/billing";
import { daysUntil, featureLabels, type Feature } from "@/lib/plans";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ status?: string; upgrade?: string }> }) {
  const me = await requireUser();
  const { status, upgrade } = await searchParams;
  const enabled = billingEnabled() && me.access.enabled;
  let payments: BillingPayment[] = [];
  let hasCustomer = false;
  if (enabled) {
    const data = (await subscriptionFor(me.ownerId)).data;
    hasCustomer = Boolean(data.stripeCustomerId);
    try {
      payments = JSON.parse(data.payments || "[]") as BillingPayment[];
    } catch {
      payments = [];
    }
  }
  const upgradeFeature = (["inventory", "crm", "hr"] as Feature[]).find((feature) => feature === upgrade);
  const chosenApps = me.access.appsLimited ? me.access.features.filter((feature) => feature !== "inventory").map((feature) => featureLabels[feature]).join(", ") : "";
  return (
    <>
    {chosenApps ? (
      <div className="mx-auto mt-6 w-full max-w-5xl px-4 sm:px-7">
        <p className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm" role="status">MIK LEDGER has set up your business with: <span className="font-medium">{chosenApps}</span>. To add another app, use &quot;Send feedback&quot; at the top and we&apos;ll turn it on.</p>
      </div>
    ) : null}
    <BillingWorkspace
      enabled={enabled}
      paymentsReady={billingEnabled()}
      canManage={me.isOwner}
      access={{ ...me.access, users: Number.isFinite(me.access.users) ? me.access.users : -1 }}
      daysLeft={daysUntil(me.access.trialEndsAt)}
      payments={payments}
      hasCustomer={hasCustomer}
      notice={status === "success" || status === "changed" || status === "cancelled" ? status : undefined}
      upgrade={upgradeFeature}
    />
    </>
  );
}
