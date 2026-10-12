import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getTeam } from "@/app/team-actions";
import TeamWorkspace from "@/components/team/TeamWorkspace";
import { requireUser } from "@/lib/auth";
import { homeFor } from "@/lib/permissions";

export const metadata: Metadata = { title: "Users & roles" };

export default async function TeamPage() {
  const me = await requireUser();
  if (me.role !== "Admin") redirect(homeFor(me.role));
  const team = await getTeam();
  return <TeamWorkspace team={team} />;
}
