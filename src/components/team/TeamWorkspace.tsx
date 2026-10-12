"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Ellipsis, MailPlus, Power, RefreshCcw, ShieldCheck, Trash2, UserPlus } from "lucide-react";

import { inviteMember, removeMember, resendInvite, updateMember, type TeamState } from "@/app/team-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { readableError } from "@/lib/action-error";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { roleDescriptions, roles, type Role } from "@/lib/permissions";

function errorText(error: unknown) {
  return error instanceof Error ? readableError(error) : "Something went wrong. Please try again.";
}

function statusOf(member: BookkeepingRecord) {
  if (member.data.enabled === "false") return { label: "Turned off", tone: "bg-destructive/10 text-destructive" };
  if (member.data.status === "Active") return { label: "Active", tone: "bg-accent text-accent-foreground" };
  if (member.data.status === "Invited") return { label: "Invite sent", tone: "bg-chart-3/20 text-foreground" };
  if (member.data.status === "Left") return { label: "Left", tone: "bg-secondary text-secondary-foreground" };
  return { label: "Not invited", tone: "bg-secondary text-secondary-foreground" };
}

export default function TeamWorkspace({ team }: { team: TeamState }) {
  const router = useRouter();
  const [inviting, setInviting] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "Sales" as Role, department: "" });
  const [link, setLink] = useState<{ url: string; emailed: boolean; name: string } | null>(null);
  const [busy, setBusy] = useState("");

  async function act(key: string, work: () => Promise<void>) {
    setBusy(key);
    try {
      await work();
      router.refresh();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy("");
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Invite link copied.");
    } catch {
      toast.error("Couldn’t copy. Select the link and copy it.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7 sm:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Organization / Users & roles</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">Users & roles</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">Invite your team. Each person signs in with their own email and password, works in this business, and sees only what their role allows.</p>
        </div>
        <Button className="gap-2" onClick={() => { setForm({ name: "", email: "", role: "Sales", department: "" }); setInviting(true); }}><UserPlus size={15} />Invite user</Button>
      </header>

      <section className="mt-6 overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Since</th>
              <th className="w-12"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="px-4 py-3 font-medium">{team.owner.name} <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">Owner</span></td>
              <td className="px-4 py-3">{team.owner.email}</td>
              <td className="px-4 py-3">Admin</td>
              <td className="px-4 py-3 text-muted-foreground">—</td>
              <td className="px-4 py-3"><span className="inline-flex rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">Active</span></td>
              <td className="px-4 py-3 text-muted-foreground">—</td>
              <td />
            </tr>
            {team.members.map((member) => {
              const status = statusOf(member);
              const isMe = member.data.memberUserId === team.me.actorId;
              return (
                <tr key={member.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">{member.data.name}{isMe ? <span className="ml-1 text-xs text-muted-foreground">(you)</span> : null}</td>
                  <td className="px-4 py-3">{member.data.email}</td>
                  <td className="px-4 py-2">
                    <Select value={member.data.role || "Viewer"} disabled={Boolean(busy) || isMe} onValueChange={(value) => void act(`role-${member.id}`, async () => { await updateMember(member.id, { role: String(value) }); toast.success(`${member.data.name} is now ${value}.`); })}>
                      <SelectTrigger className="w-[150px]" aria-label={`Role for ${member.data.name}`}><SelectValue /></SelectTrigger>
                      <SelectContent>{roles.map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3">{member.data.department || <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${status.tone}`}>{status.label}</span></td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{(member.data.joinedAt || member.data.invitedAt || member.createdAt).slice(0, 10)}</td>
                  <td className="px-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`More actions for ${member.data.name}`}><Ellipsis size={16} /></Button>} />
                      <DropdownMenuContent align="end" className="min-w-48">
                        {member.data.status !== "Active" ? (
                          <DropdownMenuItem onClick={() => void act(`resend-${member.id}`, async () => {
                            const result = member.data.status === "Invited" || member.data.status === "Left"
                              ? await resendInvite(member.id)
                              : await inviteMember({ name: member.data.name, email: member.data.email, role: member.data.role || "Viewer", department: member.data.department });
                            const url = "link" in result ? result.link : "";
                            setLink({ url, emailed: result.emailed, name: member.data.name });
                          })}>{member.data.status === "Invited" ? <><RefreshCcw size={14} />Resend invite</> : <><MailPlus size={14} />Send invite</>}</DropdownMenuItem>
                        ) : null}
                        {!isMe ? (
                          <DropdownMenuItem onClick={() => void act(`toggle-${member.id}`, async () => {
                            await updateMember(member.id, { enabled: member.data.enabled === "false" });
                            toast.success(member.data.enabled === "false" ? "Access turned on." : "Access turned off. They can’t open this business now.");
                          })}><Power size={14} />{member.data.enabled === "false" ? "Turn access on" : "Turn access off"}</DropdownMenuItem>
                        ) : null}
                        {!isMe ? <DropdownMenuSeparator /> : null}
                        {!isMe ? (
                          <DropdownMenuItem variant="destructive" onClick={() => {
                            if (!window.confirm(`Remove ${member.data.name}? They won’t be able to open this business. Their past work stays.`)) return;
                            void act(`remove-${member.id}`, async () => { await removeMember(member.id); toast.success("Removed."); });
                          }}><Trash2 size={14} />Remove</DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!team.members.length ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">Only you so far. Invite your accountant, sales team or HR to work with you.</p> : null}
      </section>

      <section className="mt-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={16} className="text-primary" />What each role can do</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {roles.map((role) => (
            <div key={role} className="rounded-lg border border-border bg-card px-4 py-3">
              <p className="font-medium">{role}</p>
              <p className="mt-1 text-sm text-muted-foreground">{roleDescriptions[role]}</p>
            </div>
          ))}
        </div>
      </section>

      <Dialog open={inviting} onOpenChange={(open) => { if (!busy) setInviting(open); }}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Invite a user</DialogTitle>
            <DialogDescription>They get an email with a link to join. You can also copy the link and send it yourself, for example on WhatsApp.</DialogDescription>
          </DialogHeader>
          <form id="invite-form" className="space-y-4" onSubmit={(event) => {
            event.preventDefault();
            void act("invite", async () => {
              const result = await inviteMember(form);
              setInviting(false);
              setLink({ url: result.link, emailed: result.emailed, name: form.name });
            });
          }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="invite-name">Name</Label>
                <Input id="invite-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required minLength={2} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-email">Email</Label>
                <Input id="invite-email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-role">Role</Label>
                <Select value={form.role} onValueChange={(value) => setForm({ ...form, role: (value ?? "Viewer") as Role })}>
                  <SelectTrigger id="invite-role" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{roles.map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-department">Department (optional)</Label>
                <Input id="invite-department" value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} />
              </div>
            </div>
            <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">{roleDescriptions[form.role]}</p>
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => setInviting(false)}>Cancel</Button>
            <Button type="submit" form="invite-form" disabled={Boolean(busy)}>{busy === "invite" ? "Sending…" : "Send invite"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={link !== null} onOpenChange={(open) => { if (!open) setLink(null); }}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Invitation ready</DialogTitle>
            <DialogDescription>{link?.emailed ? `We emailed ${link.name} a link to join.` : `We couldn’t send the email, so share this link with ${link?.name} yourself.`} The link works once.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input value={link?.url ?? ""} readOnly aria-label="Invite link" onFocus={(event) => event.target.select()} />
            <Button type="button" variant="outline" className="gap-1.5" onClick={() => link && void copy(link.url)}><Copy size={14} />Copy</Button>
          </div>
          <DialogFooter><Button type="button" onClick={() => setLink(null)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
