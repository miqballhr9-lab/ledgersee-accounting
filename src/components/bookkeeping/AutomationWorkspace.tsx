"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Check, CirclePause, Ellipsis, Hand, Pencil, Play, Plus, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import {
  addRecommendedRules,
  approveAutomationItem,
  deleteAutomationRule,
  rejectAutomationItem,
  runAutomationRule,
  saveAutomationRule,
  setAutomationMode,
} from "@/app/automation-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { readableError } from "@/lib/action-error";
import { automationTemplate, automationTemplates, describeTrigger, parseAutomationItems, type AutomationAction, type AutomationMode, type AutomationTrigger } from "@/lib/automation";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";

interface AutomationWorkspaceProps {
  mode: AutomationMode;
  rules: BookkeepingRecord[];
  log: BookkeepingRecord[];
}

interface RuleDraft {
  id?: string;
  name: string;
  action: AutomationAction;
  trigger: AutomationTrigger;
  dayOfMonth: string;
  requireApproval: boolean;
  active: boolean;
}

function errorText(error: unknown) {
  return error instanceof Error ? readableError(error) : "Something went wrong. Please try again.";
}

function when(value: string | undefined) {
  return value ? value.replace("T", " ").slice(0, 16) : "—";
}

const itemHref: Record<string, string> = { payroll: "/app/payroll", invoices: "/app/invoices" };

export default function AutomationWorkspace({ mode: initialMode, rules, log }: AutomationWorkspaceProps) {
  const router = useRouter();
  const [mode, setMode] = useState<AutomationMode>(initialMode);
  const [tab, setTab] = useState<"rules" | "approvals" | "log">("rules");
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [busy, setBusy] = useState("");

  const pending = log.flatMap((run) => parseAutomationItems(run.data.items).filter((item) => item.status === "Pending approval").map((item) => ({ run, item })));

  async function act(key: string, work: () => Promise<void>, success?: string) {
    setBusy(key);
    try {
      await work();
      if (success) toast.success(success);
      router.refresh();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy("");
    }
  }

  function changeMode(next: AutomationMode) {
    if (next === mode) return;
    setMode(next);
    void act("mode", () => setAutomationMode(next), next === "Automation" ? "Automation mode is on. Due rules run when you open the app." : "Manual mode is on. Nothing runs on its own.");
  }

  function newRule() {
    const template = automationTemplates[0];
    setDraft({ name: template.name, action: template.action, trigger: template.trigger, dayOfMonth: template.dayOfMonth, requireApproval: true, active: true });
  }

  function editRule(rule: BookkeepingRecord) {
    setDraft({
      id: rule.id,
      name: rule.data.name || "",
      action: (rule.data.action as AutomationAction) || "monthlyPayroll",
      trigger: rule.data.trigger === "daily" ? "daily" : "monthly",
      dayOfMonth: rule.data.dayOfMonth || "1",
      requireApproval: rule.data.requireApproval !== "false",
      active: rule.data.active === "true",
    });
  }

  function saveDraft() {
    if (!draft) return;
    const { id, ...input } = draft;
    void act("save", async () => {
      await saveAutomationRule(input, id);
      setDraft(null);
    }, id ? "Rule updated." : "Rule added.");
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7 sm:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Organization / Automation</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">Automation</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">Automation rules and scheduled actions, as in Odoo. Switch to Automation mode to let due rules run on their own; Manual mode keeps everything in your hands.</p>
        </div>
        <Button type="button" className="gap-2" onClick={newRule}><Plus size={15} />New rule</Button>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-2">
        {([
          { value: "Manual", icon: Hand, title: "Manual mode", text: "Nothing runs on its own. You create every entry yourself, exactly as before. Rules can still be run by hand with Run now." },
          { value: "Automation", icon: Bot, title: "Automation mode", text: "Active rules run when they’re due (checked each time you open the app). New entries wait in Approvals when a rule asks for approval." },
        ] as const).map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => changeMode(option.value)}
            disabled={busy === "mode"}
            className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-colors ${mode === option.value ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card hover:bg-muted/40"}`}
            aria-pressed={mode === option.value}
          >
            <span className={`grid size-9 shrink-0 place-items-center rounded-full ${mode === option.value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}><option.icon size={17} /></span>
            <span>
              <span className="flex items-center gap-2 font-semibold">{option.title}{mode === option.value ? <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">On</span> : null}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{option.text}</span>
            </span>
          </button>
        ))}
      </section>

      <section className="mt-4 rounded-lg border border-border bg-card">
        <div className="flex flex-wrap gap-1 border-b border-border px-3 pt-3">
          {([
            { key: "rules", label: `Automation rules (${rules.length})` },
            { key: "approvals", label: `Approvals (${pending.length})` },
            { key: "log", label: "Run log" },
          ] as const).map((item) => (
            <button key={item.key} type="button" onClick={() => setTab(item.key)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === item.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{item.label}</button>
          ))}
        </div>

        {tab === "rules" ? (
          rules.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                    <th className="px-4 py-3">Rule name</th>
                    <th className="px-4 py-3">Model</th>
                    <th className="px-4 py-3">Trigger</th>
                    <th className="px-4 py-3">Next execution</th>
                    <th className="px-4 py-3">Last run</th>
                    <th className="px-4 py-3">Approval</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="w-12"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        <p className="font-medium">{rule.data.name}</p>
                        <p className="mt-0.5 max-w-sm text-xs text-muted-foreground">{automationTemplate(rule.data.action)?.description}</p>
                      </td>
                      <td className="px-4 py-3">{rule.data.model || "—"}</td>
                      <td className="px-4 py-3">{describeTrigger(rule.data.trigger, rule.data.dayOfMonth)}</td>
                      <td className="px-4 py-3 tabular-nums">{rule.data.active === "true" ? rule.data.nextRun || "—" : "—"}</td>
                      <td className="px-4 py-3"><p className="tabular-nums">{when(rule.data.lastRun)}</p>{rule.data.lastResult ? <p className="mt-0.5 max-w-xs text-xs text-muted-foreground">{rule.data.lastResult}</p> : null}</td>
                      <td className="px-4 py-3">{rule.data.requireApproval !== "false" ? "Needs approval" : "Automatic"}</td>
                      <td className="px-4 py-3">
                        {rule.data.active === "true"
                          ? <span className="inline-flex rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">Active</span>
                          : <span className="inline-flex rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">Paused</span>}
                      </td>
                      <td className="px-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`More actions for ${rule.data.name}`}><Ellipsis size={16} /></Button>} />
                          <DropdownMenuContent align="end" className="min-w-44">
                            <DropdownMenuItem disabled={Boolean(busy)} onClick={() => void act(`run-${rule.id}`, () => runAutomationRule(rule.id), "Rule ran. See the run log for what it did.")}><Play size={14} />Run now</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => editRule(rule)}><Pencil size={14} />Edit</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => void act(`toggle-${rule.id}`, () => saveAutomationRule({ name: rule.data.name, action: rule.data.action as AutomationAction, trigger: rule.data.trigger === "daily" ? "daily" : "monthly", dayOfMonth: rule.data.dayOfMonth || "1", requireApproval: rule.data.requireApproval !== "false", active: rule.data.active !== "true" }, rule.id))}>
                              {rule.data.active === "true" ? <><CirclePause size={14} />Pause</> : <><Play size={14} />Activate</>}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={() => { if (window.confirm(`Delete the rule “${rule.data.name}”?`)) void act(`delete-${rule.id}`, () => deleteAutomationRule(rule.id), "Rule deleted."); }}><Trash2 size={14} />Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-5 py-14 text-center">
              <div className="mx-auto grid size-11 place-items-center rounded-full bg-primary/10 text-primary"><Sparkles size={20} /></div>
              <h3 className="mt-4 font-semibold">No automation rules yet</h3>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Start with the recommended rules: monthly payroll on the 1st, and recurring invoices every day. Both ask for your approval before anything is kept.</p>
              <Button className="mt-4 gap-2" disabled={busy === "recommended"} onClick={() => void act("recommended", () => addRecommendedRules(), "Recommended rules added.")}><Sparkles size={15} />Add recommended rules</Button>
            </div>
          )
        ) : null}

        {tab === "approvals" ? (
          pending.length ? (
            <ul className="divide-y divide-border">
              {pending.map(({ run, item }) => (
                <li key={`${run.id}-${item.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">{item.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{run.data.ruleName} · {run.data.trigger} · {when(run.data.ranAt)} · <Link href={itemHref[item.kind] ?? "/app"} className="text-primary underline-offset-4 hover:underline">Open {item.kind === "payroll" ? "Payroll" : "Invoices"}</Link></p>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" className="gap-1.5" disabled={Boolean(busy)} onClick={() => void act(`approve-${item.id}`, () => approveAutomationItem(run.id, item.id), "Approved.")}><Check size={14} />Approve</Button>
                    <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={Boolean(busy)} onClick={() => { if (window.confirm(`Reject and delete “${item.label}”?`)) void act(`reject-${item.id}`, () => rejectAutomationItem(run.id, item.id), "Rejected and deleted."); }}><X size={14} />Reject</Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="px-5 py-14 text-center text-sm text-muted-foreground">Nothing is waiting for approval.</p>
        ) : null}

        {tab === "log" ? (
          log.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                    <th className="px-4 py-3">Ran at (UTC)</th>
                    <th className="px-4 py-3">Rule</th>
                    <th className="px-4 py-3">How</th>
                    <th className="px-4 py-3">Result</th>
                    <th className="px-4 py-3">Items</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((run) => {
                    const items = parseAutomationItems(run.data.items);
                    return (
                      <tr key={run.id} className="border-b border-border last:border-0 align-top">
                        <td className="px-4 py-3 tabular-nums">{when(run.data.ranAt)}</td>
                        <td className="px-4 py-3 font-medium">{run.data.ruleName}</td>
                        <td className="px-4 py-3">{run.data.trigger}</td>
                        <td className="px-4 py-3"><p>{run.data.summary}</p>{run.data.errors ? <p className="mt-1 text-xs text-destructive">{run.data.errors}</p> : null}</td>
                        <td className="px-4 py-3">
                          {items.length ? items.map((item) => <p key={item.id} className="text-xs"><span className="text-muted-foreground">{item.status}:</span> {item.label}</p>) : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="px-5 py-14 text-center text-sm text-muted-foreground">No rule has run yet.</p>
        ) : null}
      </section>

      <Dialog open={draft !== null} onOpenChange={(open) => { if (!open && busy !== "save") setDraft(null); }}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit automation rule" : "New automation rule"}</DialogTitle>
            <DialogDescription>{draft ? automationTemplate(draft.action)?.description : null}</DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="rule-action">Action to do</Label>
                <Select value={draft.action} onValueChange={(value) => {
                  const template = automationTemplate(value ?? "");
                  if (template) setDraft({ ...draft, action: template.action, name: draft.id ? draft.name : template.name, trigger: template.trigger, dayOfMonth: template.dayOfMonth });
                }}>
                  <SelectTrigger id="rule-action" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{automationTemplates.map((template) => <SelectItem key={template.action} value={template.action}>{template.name} · {template.model}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rule-name">Rule name</Label>
                <Input id="rule-name" value={draft.name} maxLength={100} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rule-trigger">Trigger</Label>
                  <Select value={draft.trigger} onValueChange={(value) => setDraft({ ...draft, trigger: value === "daily" ? "daily" : "monthly" })}>
                    <SelectTrigger id="rule-trigger" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Every month</SelectItem>
                      <SelectItem value="daily">Every day</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {draft.trigger === "monthly" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="rule-day">On day of month</Label>
                    <Input id="rule-day" type="number" min="1" max="28" value={draft.dayOfMonth} onChange={(event) => setDraft({ ...draft, dayOfMonth: event.target.value })} />
                  </div>
                ) : null}
              </div>
              <label className="flex items-start gap-2 text-sm"><Checkbox checked={draft.requireApproval} onCheckedChange={(checked) => setDraft({ ...draft, requireApproval: checked === true })} /><span><span className="font-medium">Needs approval</span><span className="block text-xs text-muted-foreground">What the rule creates waits in Approvals until you approve or reject it.</span></span></label>
              <label className="flex items-start gap-2 text-sm"><Checkbox checked={draft.active} onCheckedChange={(checked) => setDraft({ ...draft, active: checked === true })} /><span><span className="font-medium">Active</span><span className="block text-xs text-muted-foreground">Runs on schedule while Automation mode is on.</span></span></label>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDraft(null)} disabled={busy === "save"}>Cancel</Button>
            <Button type="button" onClick={saveDraft} disabled={busy === "save"}>{busy === "save" ? "Saving…" : "Save rule"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
