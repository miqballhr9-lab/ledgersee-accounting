import Link from "next/link";
import { redirect } from "next/navigation";

import AppFrame from "@/components/bookkeeping/AppFrame";
import { runDueAutomations } from "@/app/automation-actions";
import { getWorkspaceUser } from "@/lib/auth";
import { daysUntil } from "@/lib/plans";

export default async function BookkeepingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getWorkspaceUser();
  if (!user) redirect("/");
  // Automation mode: run any rules that are due. In Manual mode this returns at once.
  await runDueAutomations().catch(() => undefined);

  const { access } = user;
  const daysLeft = daysUntil(access.trialEndsAt);
  // A strip above every page while on trial, behind on payment, or read-only after the plan ran out.
  const billingNotice = !access.enabled ? null
    : access.locked ? { tone: "border-destructive/30 bg-destructive/10 text-destructive", text: "Your business is on the Free plan, which is for the owner only. You can look at records but not change them." }
    : access.plan === "free" && access.status !== "free" ? { tone: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200", text: access.status === "trial_ended" ? "Your free trial has ended, so you're on the Free plan: accounting for one user. Upgrade to bring back inventory, CRM, HR and your team." : "Your paid plan has ended, so you're on the Free plan: accounting for one user. Upgrade any time; nothing was deleted." }
    : access.status === "past_due" ? { tone: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200", text: "Your last payment didn't go through. Update your card to keep your plan." }
    : access.status === "trialing" && !access.interval ? { tone: "border-primary/20 bg-primary/5 text-foreground", text: `Free trial: ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left.` }
    : null;

  return (
    <AppFrame userName={user.name} userEmail={user.email} role={user.role} workspaceName={user.workspaceName} isOwner={user.isOwner}>
      {billingNotice ? (
        <div className={`flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm sm:px-7 ${billingNotice.tone}`} role="status">
          <span>{billingNotice.text}</span>
          <Link href="/app/billing" className="font-medium underline underline-offset-4">{user.isOwner ? "Choose a plan" : "See billing"}</Link>
        </div>
      ) : null}
      {children}
    </AppFrame>
  );
}
