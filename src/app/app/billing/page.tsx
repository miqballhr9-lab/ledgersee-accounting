import type { Metadata } from "next";

import BillingWorkspace, { type BillingPayment } from "@/components/billing/BillingWorkspace";
import { requireUser } from "@/lib/auth";
import { billingEnabled, subscriptionFor } from "@/lib/billing";
import { daysUntil, type Feature } from "@/lib/plans";

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
  return (
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
  );
}
