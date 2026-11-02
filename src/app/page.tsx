import type { Metadata } from "next";

import MarketingHome from "@/components/marketing/MarketingHome";
import { getUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "MIK LEDGER: accounting, POS, CRM and HR for your business",
  description: "Accounting, inventory, point of sale, CRM and HR with payroll in one ledger. FBR-ready GST and withholding tax. Six months free.",
};

/** The public website; Log in and Get started lead to /login, and a signed-in visitor can open the app. */
export default async function Home() {
  const user = await getUser();
  return <MarketingHome signedIn={Boolean(user)} />;
}
