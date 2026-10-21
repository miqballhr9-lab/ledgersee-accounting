import Link from "next/link";
import { redirect } from "next/navigation";

import AppFrame from "@/components/bookkeeping/AppFrame";
import { runDueAutomations } from "@/app/automation-actions";
import { listBookkeepingRecordGroups } from "@/app/actions";
import { getWorkspaceUser } from "@/lib/auth";
import { daysUntil } from "@/lib/plans";
import AnnouncementBar from "@/components/bookkeeping/AnnouncementBar";
import ViewAsBar from "@/components/admin/ViewAsBar";
import { activeAnnouncement, isPlatformAdmin } from "@/lib/platform";

export default async function BookkeepingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getWorkspaceUser();
  if (!user) redirect("/");
  // Automation mode: run any rules that are due. In Manual mode this returns at once.
  // Never while support is only looking: that view must not change anything.
  if (!user.viewingAs) await runDueAutomations().catch(() => undefined);

  const { access } = user;
  const announcement = await activeAnnouncement();
  const company = (await listBookkeepingRecordGroups(["settings"])).settings?.[0]?.data ?? {};
  const daysLeft = daysUntil(access.trialEndsAt);
  // A strip above every page while on trial, behind on payment, or read-only after the plan ran out.
  const billingNotice = !access.enabled ? null
    : access.locked ? { tone: "border-destructive/30 bg-destructive/10 text-destructive", text: "Your business is on the Free plan, which is for the owner only. You can look at records but not change them." }
    : access.plan === "free" && access.status !== "free" ? { tone: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200", text: access.status === "trial_ended" ? "Your free trial has ended, so you're on the Free plan: accounting for one user. Upgrade to bring back inventory, CRM, HR and your team." : "Your paid plan has ended, so you're on the Free plan: accounting for one user. Upgrade any time; nothing was deleted." }
    : access.status === "past_due" ? { tone: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200", text: "Your last payment didn't go through. Update your card to keep your plan." }
    : access.status === "trialing" && !access.interval ? { tone: "border-primary/20 bg-primary/5 text-foreground", text: `Free trial: ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left.` }
    : null;

  return (
    <AppFrame userName={user.name} userEmail={user.email} role={user.role} workspaceName={user.workspaceName} companyName={company.companyName?.trim() ?? ""} companyLogo={/^https?:\/\//.test(company.logo ?? "") ? company.logo : ""} isOwner={user.isOwner} features={access.locked ? undefined : access.features} platformAdmin={isPlatformAdmin(user.email)}>
      {user.viewingAs ? <ViewAsBar business={user.workspaceName} /> : null}
      {announcement ? <AnnouncementBar id={announcement.id} message={announcement.message} tone={announcement.tone} /> : null}
      {access.suspended && !user.viewingAs ? (
        <div className="mx-auto max-w-lg px-4 py-20 text-center" role="alert">
          <h1 className="text-xl font-semibold">This business is paused</h1>
          <p className="mt-2 text-sm text-muted-foreground">MIK LEDGER has paused {user.workspaceName}. Your records are safe, but nothing can be changed for now.</p>
          {access.suspendedNote ? <p className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">{access.suspendedNote}</p> : null}
          <p className="mt-3 text-sm text-muted-foreground">Use &quot;Send feedback&quot; at the top to reach us.</p>
        </div>
      ) : null}
      {billingNotice ? (
        <div className={`flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm sm:px-7 ${billingNotice.tone}`} role="status">
          <span>{billingNotice.text}</span>
          <Link href="/app/billing" className="font-medium underline underline-offset-4">{user.isOwner ? "Choose a plan" : "See billing"}</Link>
        </div>
      ) : null}
      {access.suspended && !user.viewingAs ? null : children}
    </AppFrame>
  );
}
