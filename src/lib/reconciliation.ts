import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { buildLedger } from "@/lib/ledger";

/** One line of a bank, cash or card account's activity, as a statement shows it. */
export interface ReconcileItem {
  /** The ledger transaction it comes from (invoice payment, bill payment, transfer, POS sale…). */
  id: string;
  date: string;
  description: string;
  /** Money in (or, on a card, a charge) is a Deposit; money out (a card payment) a Withdrawal. */
  type: "Deposit" | "Withdrawal";
  amount: number;
  cleared: boolean;
}

/** The ledger transactions already cleared in a completed reconciliation, by account. */
function clearedIds(records: BookkeepingRecord[]) {
  const ids = new Set<string>();
  for (const record of records) {
    if (record.kind === "reconciliations") {
      try {
        const list: unknown = JSON.parse(record.data.clearedTxnIds || "[]");
        if (Array.isArray(list)) for (const id of list) ids.add(String(id));
      } catch {
        // An older reconciliation keeps its cleared lines on the transactions themselves.
      }
    }
    if (record.kind === "transactions" && record.data.reconciled === "true") ids.add(`txn-${record.id}`);
  }
  return ids;
}

/**
 * Everything that moved money in or out of one account, from the books: payments received and
 * made, POS sales, transfers (with the right sign on each side), deposits, checks, journals and
 * the opening balance. This is what a statement is matched against.
 */
export function reconcileItems(records: BookkeepingRecord[], accountName: string): ReconcileItem[] {
  const ledger = buildLedger(records, "accrual");
  const wanted = accountName.trim().toLowerCase();
  const account = [...ledger.accounts.values()].find((entry) => entry.name.trim().toLowerCase() === wanted);
  if (!account) return [];
  // A card (liability) statement shows charges going up: show them the same way.
  const sign = account.category === "Liability" ? -1 : 1;
  const byTxn = new Map<string, { date: string; description: string; amount: number }>();
  for (const posting of ledger.postings) {
    if (posting.account !== account.name) continue;
    const entry = byTxn.get(posting.txnId) ?? { date: posting.date, description: [posting.type, posting.number, posting.name || posting.memo].filter(Boolean).join(" · "), amount: 0 };
    entry.amount += posting.amount * sign;
    byTxn.set(posting.txnId, entry);
  }
  const cleared = clearedIds(records);
  return [...byTxn].filter(([, entry]) => Math.abs(entry.amount) >= 0.005).map(([id, entry]) => ({
    id,
    date: entry.date,
    description: entry.description,
    type: entry.amount >= 0 ? "Deposit" as const : "Withdrawal" as const,
    amount: Math.round(Math.abs(entry.amount) * 100) / 100,
    cleared: cleared.has(id),
  })).sort((a, b) => a.date.localeCompare(b.date));
}
