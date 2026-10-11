"use client";

import { ChevronDown, ListChecks, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export interface BulkMenuItem<Key extends string> {
  key: Key;
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
}

interface BulkActionsMenuProps<Key extends string> {
  label?: string;
  icon?: LucideIcon;
  count: number;
  pending: boolean;
  noun: string;
  items: BulkMenuItem<Key>[];
  onSelect: (key: Key) => void;
}

/** Toolbar menu that acts on the rows checked in a list. Destructive items sit last, after a divider. */
export default function BulkActionsMenu<Key extends string>({ label = "Actions", icon: Icon = ListChecks, count, pending, noun, items, onSelect }: BulkActionsMenuProps<Key>) {
  const regular = items.filter((item) => !item.destructive);
  const destructive = items.filter((item) => item.destructive);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="outline" className="gap-2" disabled={!count || pending} title={count ? undefined : `Select ${noun} with the checkboxes first`}>
            <Icon size={15} />
            {pending ? "Working…" : `${label}${count ? ` (${count})` : ""}`}
            <ChevronDown size={14} />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-48">
        {regular.map((item) => (
          <DropdownMenuItem key={item.key} onClick={() => onSelect(item.key)}><item.icon size={15} />{item.label}</DropdownMenuItem>
        ))}
        {regular.length && destructive.length ? <DropdownMenuSeparator /> : null}
        {destructive.map((item) => (
          <DropdownMenuItem key={item.key} variant="destructive" onClick={() => onSelect(item.key)}><item.icon size={15} />{item.label}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
