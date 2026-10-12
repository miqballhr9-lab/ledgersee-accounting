import type { Metadata } from "next";

import AutomationWorkspace from "@/components/bookkeeping/AutomationWorkspace";
import { redirect } from "next/navigation";

import { getAutomationState } from "@/app/automation-actions";
import { requireUser } from "@/lib/auth";
import { homeFor } from "@/lib/permissions";

export const metadata: Metadata = { title: "Automation" };

export default async function AutomationPage() {
  const me = await requireUser();
  if (me.role !== "Admin") redirect(homeFor(me.role));
  const { mode, rules, log } = await getAutomationState();
  return <AutomationWorkspace mode={mode} rules={rules} log={log} />;
}
