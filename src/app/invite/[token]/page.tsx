import type { Metadata } from "next";

import InviteAccept from "@/components/team/InviteAccept";
import { getInvite } from "@/app/team-actions";
import { getUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Join a business", robots: { index: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invite, signedIn] = await Promise.all([getInvite(token), getUser()]);
  return <InviteAccept token={token} invite={invite} signedInEmail={signedIn?.email ?? null} />;
}
