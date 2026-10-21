/**
 * A customer's or supplier's ledger (statement of account): every invoice,
 * payment and credit with them, from the books, with a running balance.
 */
import type { Ledger } from "@/lib/ledger";

export interface PartyLedgerRow {
  date: string;
  type: string;
  number: string;
  memo: string;
  /** What they were charged (customer) or billed (supplier): adds to the balance. */
  debit: number;
  /** What they paid, or was paid or credited to them: takes off the balance. */
  credit: number;
  balance: number;
  sourceKind: string;
  sourceId: string;
}

export interface PartyLedger {
  opening: number;
  rows: PartyLedgerRow[];
  closing: number;
  totalDebit: number;
  totalCredit: number;
}

const round = (value: number) => Math.round(value * 100) / 100;

export function partyLedger(ledger: Ledger, party: "customer" | "supplier", names: string[], from: string, to: string): PartyLedger {
  const wanted = new Set(names.map((name) => name.trim().toLowerCase()).filter(Boolean));
  const account = party === "customer" ? ledger.ar : ledger.ap;
  // A customer owes on debits to receivables; the business owes a supplier on credits to payables.
  const sign = party === "customer" ? 1 : -1;
  const postings = ledger.postings
    .filter((posting) => posting.account === account && wanted.has((party === "customer" ? posting.customer : posting.supplier).trim().toLowerCase()) && (!to || posting.date <= to))
    .sort((a, b) => a.date.localeCompare(b.date) || a.txnId.localeCompare(b.txnId));
  let balance = round(postings.filter((posting) => from && posting.date < from).reduce((sum, posting) => sum + posting.amount * sign, 0));
  const opening = balance;
  const rows: PartyLedgerRow[] = [];
  for (const posting of postings) {
    if (from && posting.date < from) continue;
    const amount = round(posting.amount * sign);
    balance = round(balance + amount);
    rows.push({ date: posting.date, type: posting.type, number: posting.number, memo: posting.memo, debit: amount > 0 ? amount : 0, credit: amount < 0 ? -amount : 0, balance, sourceKind: posting.sourceKind, sourceId: posting.sourceId.split("#")[0] });
  }
  return { opening, rows, closing: balance, totalDebit: round(rows.reduce((sum, row) => sum + row.debit, 0)), totalCredit: round(rows.reduce((sum, row) => sum + row.credit, 0)) };
}
