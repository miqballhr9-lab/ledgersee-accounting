import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import AdminConsole from "@/components/admin/AdminConsole";
import { getUser } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform";
import { loadAdminData } from "@/lib/platform-data";

export const metadata: Metadata = { title: "Super Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** The platform owner's panel: every business, every user, feedback, system status and the announcement. */
export default async function AdminPage() {
  const me = await getUser();
  if (!me) redirect("/");
  // Anyone else gets a plain 404, so the panel's address gives nothing away.
  if (!isPlatformAdmin(me.email)) notFound();
  const data = await loadAdminData();
  return <AdminConsole adminEmail={me.email} {...data} />;
}
