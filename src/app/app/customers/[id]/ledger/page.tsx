import type { Metadata } from "next";

import { PartyLedgerPage } from "@/lib/party-ledger-page";

export const metadata: Metadata = { title: "Customer ledger" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const [{ id }, { from, to }] = await Promise.all([params, searchParams]);
  return <PartyLedgerPage party="customer" id={id} from={from} to={to} />;
}
