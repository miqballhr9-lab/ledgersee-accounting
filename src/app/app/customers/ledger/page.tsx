import type { Metadata } from "next";

import { AllPartiesLedgerPage } from "@/lib/party-ledger-page";

export const metadata: Metadata = { title: "Customers ledger report" };

export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; show?: string }> }) {
  const { from, to, show } = await searchParams;
  return <AllPartiesLedgerPage party="customer" from={from} to={to} show={show} />;
}
