import { redirect } from "next/navigation";

import AppFrame from "@/components/bookkeeping/AppFrame";
import { runDueAutomations } from "@/app/automation-actions";
import { getWorkspaceUser } from "@/lib/auth";

export default async function BookkeepingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getWorkspaceUser();
  if (!user) redirect("/");
  // Automation mode: run any rules that are due. In Manual mode this returns at once.
  await runDueAutomations().catch(() => undefined);

  return (
    <AppFrame userName={user.name} userEmail={user.email} role={user.role} workspaceName={user.workspaceName} isOwner={user.isOwner}>
      {children}
    </AppFrame>
  );
}
