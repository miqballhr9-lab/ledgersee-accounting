import type { Metadata } from "next";

import { AllPartiesLedgerPage } from "@/lib/party-ledger-page";

export const metadata: Metadata = { title: "Suppliers ledger report" };

export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; show?: string }> }) {
  const { from, to, show } = await searchParams;
  return <AllPartiesLedgerPage party="supplier" from={from} to={to} show={show} />;
}
