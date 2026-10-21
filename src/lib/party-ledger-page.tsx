import "server-only";

import { notFound } from "next/navigation";

import { listAllBookkeepingRecords } from "@/app/actions";
import PartyLedgerView from "@/components/bookkeeping/PartyLedgerView";
import { requireUser } from "@/lib/auth";
import { buildLedger } from "@/lib/ledger";
import { partyLedger } from "@/lib/party-ledger";
import { requireFeature } from "@/lib/plan-gate";

/** The customer or supplier ledger page, for /app/customers/[id]/ledger and /app/vendors/[id]/ledger. */
export async function PartyLedgerPage({ party, id, from, to }: { party: "customer" | "supplier"; id: string; from?: string; to?: string }) {
  await requireFeature("accounting");
  const me = await requireUser();
  const records = await listAllBookkeepingRecords();
  const kind = party === "customer" ? "customers" : "vendors";
  const record = records.find((row) => row.kind === kind && row.id === id);
  if (!record) notFound();
  const settings = records.find((row) => row.kind === "settings")?.data ?? {};
  const today = new Date().toISOString().slice(0, 10);
  const isDate = (value: string | undefined) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? "");
  const end = isDate(to) ? to! : today;
  const start = isDate(from) ? from! : "";
  const data = record.data;
  // Documents name the party by any of its names.
  const names = [data.name, data.displayName, data.company].filter((value): value is string => Boolean(value?.trim()));
  const ledger = partyLedger(buildLedger(records, "accrual"), party, names, start, end);
  // Quotes and orders don't change what is owed; they are listed under the ledger.
  const named = new Set(names.map((value) => value.trim().toLowerCase()));
  const otherKinds: Record<string, [string, string, string]> = party === "customer" ? { estimates: ["Estimate", "estimateNumber", "date"], "sales-orders": ["Sales order", "orderNumber", "date"] } : { "purchase-orders": ["Purchase order", "poNumber", "date"] };
  const docDate = (row: (typeof records)[number]) => row.data[otherKinds[row.kind][2]] || row.createdAt.slice(0, 10);
  const others = records
    .filter((row) => row.kind in otherKinds && named.has((row.data[party === "customer" ? "customer" : "vendor"] ?? "").trim().toLowerCase()) && docDate(row) <= end && (!start || docDate(row) >= start))
    .map((row) => {
      const [type, numberKey] = otherKinds[row.kind];
      return { id: row.id, kind: row.kind, type, number: row.data[numberKey] ?? "", date: docDate(row), status: row.data.status || "Draft", amount: Number(row.data.amount) || 0 };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const display = data.displayName || data.name || data.company || (party === "customer" ? "Customer" : "Supplier");
  const address = [data.address || data.street, [data.city, data.state, data.postalCode].filter(Boolean).join(", "), data.country].filter(Boolean) as string[];
  return (
    <PartyLedgerView
      party={party}
      partyId={id}
      name={display}
      details={[...address, data.email, data.phone].filter((value): value is string => Boolean(value))}
      company={settings.companyName || me.workspaceName}
      companyDetails={[settings.email, settings.phone].filter((value): value is string => Boolean(value))}
      currency={settings.currency || "USD"}
      from={start}
      to={end}
      ledger={ledger}
      others={others}
      backHref={`/app/${kind}?open=${encodeURIComponent(id)}`}
    />
  );
}
