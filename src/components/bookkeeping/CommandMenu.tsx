"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, FileText, Plus, Search, UserRound, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { navigationGroups } from "@/lib/bookkeeping-config";

const createActions = [
  { label: "New invoice", href: "/app/invoices?new=1", keywords: ["sale", "bill customer"] },
  { label: "New estimate", href: "/app/estimates?new=1", keywords: ["quote", "quotation"] },
  { label: "New customer", href: "/app/customers?new=1", keywords: ["client"] },
  { label: "New item or service", href: "/app/items?new=1", keywords: ["product", "sku"] },
  { label: "New expense", href: "/app/expenses?new=1", keywords: ["spend", "receipt", "cost"] },
  { label: "New bill", href: "/app/bills?new=1", keywords: ["payable", "supplier invoice"] },
  { label: "New supplier", href: "/app/vendors?new=1", keywords: ["vendor"] },
  { label: "New purchase order", href: "/app/purchase-orders?new=1", keywords: ["po", "rfq"] },
  { label: "New supplier credit note", href: "/app/supplier-credits?new=1", keywords: ["vendor credit", "refund", "debit note"] },
  { label: "New employee", href: "/app/employees?new=1", keywords: ["staff", "payroll", "worker"] },
  { label: "New journal entry", href: "/app/journals?new=1", keywords: ["manual journal", "debit", "credit"] },
] as const;

interface CommandMenuProps {
  icons: Record<string, LucideIcon>;
  /** Whether the signed-in person's role can open a page; others are left out. */
  canOpen?: (href: string) => boolean;
}

export default function CommandMenu({ icons, canOpen = () => true }: CommandMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label="Search pages and actions"
        className="h-9 gap-2 px-2.5 text-muted-foreground sm:w-56 sm:justify-start sm:px-3"
      >
        <Search size={15} />
        <span className="hidden flex-1 text-left text-[13px] font-normal sm:inline">Search or create…</span>
        <Kbd className="hidden sm:inline-flex">Ctrl K</Kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Quick search" description="Jump to a page or start a new record." className="sm:max-w-lg">
        <Command>
          <CommandInput placeholder="Type a page or action, e.g. “invoice”" />
          <CommandList className="max-h-[min(60dvh,26rem)]">
            <CommandEmpty>Nothing matches that.</CommandEmpty>
            <CommandGroup heading="Create">
              {createActions.filter((action) => canOpen(action.href)).map((action) => (
                <CommandItem key={action.href} value={action.label} keywords={[...action.keywords]} onSelect={() => go(action.href)}>
                  <Plus className="text-primary" />
                  <span>{action.label}</span>
                  <CommandShortcut><CornerDownLeft className="size-3" /></CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
            {navigationGroups.filter((group) => group.items.some((item) => canOpen(item.slug === "dashboard" ? "/app" : `/app/${item.slug}`))).map((group) => (
              <CommandGroup key={group.label} heading={group.label}>
                {group.items.filter((item) => canOpen(item.slug === "dashboard" ? "/app" : `/app/${item.slug}`)).map((item) => {
                  const Icon = icons[item.icon] ?? FileText;
                  const href = item.slug === "dashboard" ? "/app" : `/app/${item.slug}`;
                  return (
                    <CommandItem key={item.slug} value={`${group.label} ${item.label}`} onSelect={() => go(href)}>
                      <Icon />
                      <span>{item.label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
            <CommandGroup heading="Account">
              <CommandItem value="Profile & privacy" onSelect={() => go("/app/profile")}>
                <UserRound />
                <span>Profile & privacy</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
