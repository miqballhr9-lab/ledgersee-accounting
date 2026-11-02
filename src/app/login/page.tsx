import type { Metadata } from "next";
import { redirect } from "next/navigation";

import AccountAccess from "@/components/account/AccountAccess";
import { getUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Log in", description: "Sign in to MIK LEDGER, or create your business's account." };

/** Sign in, or create an account with ?mode=signup (the website's "Get started"). */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const user = await getUser();
  if (user) redirect("/app");
  const { mode } = await searchParams;
  return <AccountAccess initialMode={mode === "signup" ? "sign-up" : "sign-in"} />;
}
