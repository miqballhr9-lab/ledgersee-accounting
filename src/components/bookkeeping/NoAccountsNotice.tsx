"use client";

import Link from "next/link";

import StandardAccountsButton from "@/components/bookkeeping/StandardAccountsButton";

/** Shown where a form needs Chart of Accounts entries that don't exist yet. */
export default function NoAccountsNotice({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
      <p>{message}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <StandardAccountsButton size="sm" label="Add standard accounts" />
        <Link href="/app/accounts" className="font-medium text-primary hover:underline">Open Chart of accounts</Link>
      </div>
    </div>
  );
}
