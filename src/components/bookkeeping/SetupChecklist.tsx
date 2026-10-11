"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight, Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export interface SetupProgress {
  company: boolean;
  accounts: boolean;
  customer: boolean;
  item: boolean;
  invoice: boolean;
  payment: boolean;
}

const steps: { key: keyof SetupProgress; title: string; detail: string; href: string; action: string }[] = [
  { key: "company", title: "Add your company details", detail: "Name, address, logo and currency appear on every invoice.", href: "/app/settings?new=1", action: "Add details" },
  { key: "accounts", title: "Set up your chart of accounts", detail: "Add the standard cash, bank, income and expense accounts in one click.", href: "/app/accounts", action: "Set up accounts" },
  { key: "customer", title: "Add your first customer", detail: "Save who you sell to so invoices fill in their details.", href: "/app/customers?new=1", action: "Add customer" },
  { key: "item", title: "Add a product or service", detail: "Saved items fill in descriptions and rates on invoices.", href: "/app/items?new=1", action: "Add item" },
  { key: "invoice", title: "Create your first invoice", detail: "Send it by email, WhatsApp or SMS, or print it.", href: "/app/invoices?new=1", action: "Create invoice" },
  { key: "payment", title: "Record a payment", detail: "Mark money received against an invoice to keep balances right.", href: "/app/invoices", action: "Open invoices" },
];

const STORAGE_KEY = "mikledger:setup-checklist-dismissed";
const listeners = new Set<() => void>();
let hiddenThisVisit = false;

function readDismissed() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function dismiss() {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Storage can be unavailable (private mode); the card simply stays hidden for this visit.
  }
  hiddenThisVisit = true;
  listeners.forEach((listener) => listener());
}

export default function SetupChecklist({ progress }: { progress: SetupProgress }) {
  const dismissed = useSyncExternalStore(subscribe, () => hiddenThisVisit || readDismissed(), () => true);
  const done = steps.filter((step) => progress[step.key]).length;
  if (dismissed || done === steps.length) return null;
  const next = steps.find((step) => !progress[step.key]);

  return (
    <section aria-labelledby="setup-heading" className="mt-6 rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 id="setup-heading" className="text-sm font-semibold">Get your books ready</h2>
          <p className="mt-1 text-xs text-muted-foreground">{done} of {steps.length} steps done{next ? ` · Next: ${next.title.toLowerCase()}` : ""}</p>
        </div>
        <div className="flex items-center gap-3">
          <Progress value={(done / steps.length) * 100} className="w-28 sm:w-40" aria-label="Setup progress" />
          <Button variant="ghost" size="icon-sm" aria-label="Hide setup checklist" title="Hide setup checklist" onClick={dismiss}>
            <X size={15} />
          </Button>
        </div>
      </div>
      <ol className="grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3">
        {steps.map((step, index) => {
          const complete = progress[step.key];
          return (
            <li key={step.key} className="flex gap-3 px-5 py-4 sm:border-b sm:border-border">
              <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${complete ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"}`}>
                {complete ? <Check size={13} strokeWidth={2.5} /> : index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${complete ? "text-muted-foreground line-through decoration-muted-foreground/40" : ""}`}>{step.title}</p>
                {!complete ? (
                  <>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{step.detail}</p>
                    <Link href={step.href} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                      {step.action}<ArrowRight size={12} />
                    </Link>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
