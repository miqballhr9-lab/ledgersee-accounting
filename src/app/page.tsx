import { redirect } from "next/navigation";

import AccountAccess from "@/components/account/AccountAccess";
import { getUser } from "@/lib/auth";

export default async function Home() {
  const user = await getUser();
  if (user) redirect("/app");
  return <AccountAccess />;
}
