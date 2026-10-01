import { redirect } from "next/navigation";

import AppFrame from "@/components/bookkeeping/AppFrame";
import { getUser } from "@/lib/auth";

export default async function BookkeepingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getUser();
  if (!user) redirect("/");

  return (
    <AppFrame userName={user.name} userEmail={user.email}>
      {children}
    </AppFrame>
  );
}
