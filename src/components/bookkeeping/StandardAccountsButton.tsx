"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ListTree } from "lucide-react";
import { toast } from "sonner";
import { readableError } from "@/lib/action-error";

import { addStandardAccounts } from "@/app/actions";
import { Button } from "@/components/ui/button";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { standardAccounts } from "@/lib/standard-accounts";

interface StandardAccountsButtonProps {
  label?: string;
  variant?: "default" | "outline" | "secondary";
  size?: "default" | "sm";
  className?: string;
  onAdded?: (records: BookkeepingRecord[]) => void;
}

/** One click to add the standard chart of accounts; accounts that already exist are skipped. */
export default function StandardAccountsButton({ label = "Add standard accounts", variant = "outline", size = "default", className, onAdded }: StandardAccountsButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      const result = await addStandardAccounts();
      if (result.added === 0) {
        toast.info("You already have all the standard accounts.");
      } else {
        toast.success(`Added ${result.added} standard account${result.added === 1 ? "" : "s"}, including Cash on hand, a bank account and a credit card.`);
        onAdded?.(result.records);
      }
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? readableError(error) : "We couldn’t add the standard accounts. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={`gap-2 ${className ?? ""}`}
      disabled={pending}
      onClick={() => void handleClick()}
      title={`Adds ${standardAccounts.length} common small-business accounts. Any you already have are skipped.`}
    >
      <ListTree size={size === "sm" ? 14 : 16} />
      {pending ? "Adding accounts…" : label}
    </Button>
  );
}
