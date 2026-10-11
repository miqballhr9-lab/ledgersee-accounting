import type { Metadata } from "next";

import AutomationWorkspace from "@/components/bookkeeping/AutomationWorkspace";
import { getAutomationState } from "@/app/automation-actions";

export const metadata: Metadata = { title: "Automation" };

export default async function AutomationPage() {
  const { mode, rules, log } = await getAutomationState();
  return <AutomationWorkspace mode={mode} rules={rules} log={log} />;
}
