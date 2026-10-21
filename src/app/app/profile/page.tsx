import type { Metadata } from "next";
import { redirect } from "next/navigation";

import ProfilePrivacyWorkspace from "@/components/bookkeeping/ProfilePrivacyWorkspace";
import { getWorkspaceUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Profile & privacy" };

export default async function ProfilePage() {
  const user = await getWorkspaceUser();
  if (!user) redirect("/");

  return <ProfilePrivacyWorkspace initialName={user.name} email={user.email} membership={user.isOwner || user.viewingAs ? null : { business: user.workspaceName, role: user.role }} />;
}
