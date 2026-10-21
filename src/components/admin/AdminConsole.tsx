"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Activity, ArrowLeft, Building2, CheckCircle2, Eye, Gift, LogOut, Inbox, LayoutDashboard, Megaphone, MoreHorizontal, Pause, Play, Search, ServerCog, Timer, Trash2, UserPlus, Users, XCircle } from "lucide-react";

import { clearAnnouncement, deleteFeedback, extendTrial, saveAnnouncement, sendTestEmail, setBusinessFlags, setFeedbackStatus, signOutEverywhere, startViewAs } from "@/app/admin-actions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { readableError } from "@/lib/action-error";
import type { AdminBusiness, AdminFeedback, AdminUser, StatusCheck } from "@/lib/platform-data";

interface AdminConsoleProps {
  adminEmail: string;
  businesses: AdminBusiness[];
  people: AdminUser[];
  inbox: AdminFeedback[];
  announcement: { message: string; tone: "info" | "warning"; until: string } | null;
  status: StatusCheck[];
}

type Tab = "dashboard" | "businesses" | "users" | "feedback" | "system" | "announcement";

const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "businesses", label: "Businesses", icon: Building2 },
  { key: "users", label: "Users", icon: Users },
  { key: "feedback", label: "Feedback", icon: Inbox },
  { key: "system", label: "System status", icon: ServerCog },
  { key: "announcement", label: "Announcement", icon: Megaphone },
];

const DAY = 86_400_000;

function daysAgo(value: string) {
  return value ? Math.floor((Date.now() - Date.parse(value)) / DAY) : Infinity;
}

function when(value: string) {
  if (!value) return "Never";
  const days = daysAgo(value);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function date(value: string) {
  return value ? new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) : "—";
}

function Kpi({ label, value, note, icon: Icon }: { label: string; value: string | number; note?: string; icon: React.ElementType }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3.5">
      <div className="flex items-center justify-between gap-2 text-muted-foreground"><p className="text-xs">{label}</p><Icon size={15} /></div>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</p>
      {note ? <p className="mt-0.5 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function Pill({ tone, children }: { tone: "good" | "bad" | "warn" | "info" | "neutral"; children: React.ReactNode }) {
  const tones = { good: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", bad: "bg-destructive/10 text-destructive", warn: "bg-amber-500/15 text-amber-800 dark:text-amber-300", info: "bg-primary/10 text-primary", neutral: "bg-muted text-muted-foreground" };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

/** The platform owner's panel, over every business on MIK LEDGER. */
export default function AdminConsole({ adminEmail, businesses, people, inbox, announcement, status }: AdminConsoleProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [busy, setBusy] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [userSearch, setUserSearch] = useState("");
  const [feedbackFilter, setFeedbackFilter] = useState("New");
  const [notice, setNotice] = useState(announcement?.message ?? "");
  const [noticeTone, setNoticeTone] = useState<"info" | "warning">(announcement?.tone ?? "info");
  const [noticeUntil, setNoticeUntil] = useState(announcement?.until ?? "");

  async function run(key: string, action: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      await action();
      toast.success(done);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? readableError(error) : "That didn't work. Please try again.");
    } finally {
      setBusy("");
    }
  }

  const newFeedback = inbox.filter((item) => item.status === "New").length;
  const activeWeek = businesses.filter((business) => daysAgo(business.lastActive) < 7).length;
  const signupMonths = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, index) => {
      const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + index, 1));
      const key = month.toISOString().slice(0, 7);
      return { key, label: new Intl.DateTimeFormat(undefined, { month: "short" }).format(month), count: businesses.filter((business) => business.signedUp.startsWith(key)).length };
    });
  }, [businesses]);
  const maxSignups = Math.max(1, ...signupMonths.map((month) => month.count));

  const needle = search.trim().toLowerCase();
  const shownBusinesses = businesses.filter((business) => {
    if (needle && ![business.name, business.ownerName, business.ownerEmail].some((value) => value.toLowerCase().includes(needle))) return false;
    if (filter === "active") return daysAgo(business.lastActive) < 7;
    if (filter === "inactive") return daysAgo(business.lastActive) >= 30;
    if (filter === "paused") return business.suspended;
    if (filter === "free") return business.freeAccess;
    return true;
  });
  const userNeedle = userSearch.trim().toLowerCase();
  const shownPeople = people.filter((person) => !userNeedle || [person.name, person.email, person.business].some((value) => value.toLowerCase().includes(userNeedle)));
  const shownFeedback = inbox.filter((item) => feedbackFilter === "all" || item.status === feedbackFilter);

  async function viewAs(business: AdminBusiness) {
    if (!window.confirm(`Open ${business.name} read-only for support? Their Audit Log will show that MIK LEDGER support looked. The view closes by itself after an hour.`)) return;
    setBusy(`view-${business.ownerId}`);
    try {
      await startViewAs(business.ownerId);
      window.location.assign("/app");
    } catch (error) {
      toast.error(error instanceof Error ? readableError(error) : "That didn't work. Please try again.");
      setBusy("");
    }
  }

  function pause(business: AdminBusiness) {
    const note = window.prompt(`Pause ${business.name}? Its people can still sign in and look, but can't change anything.\n\nReason shown to them (optional):`, "");
    if (note === null) return;
    void run(`flags-${business.ownerId}`, () => setBusinessFlags(business.ownerId, { suspended: true, suspendedNote: note }), `${business.name} paused.`);
  }

  function trial(business: AdminBusiness, months: number) {
    void run(`trial-${business.ownerId}`, async () => {
      const end = await extendTrial(business.ownerId, months);
      toast.message(`Trial now runs until ${date(end)}.`);
    }, `${business.name}: trial extended by ${months} ${months === 1 ? "month" : "months"}.`);
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- the small app icon */}
            <img src="/icons/icon.svg" alt="" width={32} height={32} className="size-8 rounded-[22%]" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">MIK LEDGER · Super Admin</p>
              <p className="truncate text-xs text-muted-foreground">{adminEmail}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" nativeButton={false} render={<Link href="/app" />}><ArrowLeft size={14} />Back to app</Button>
        </div>
        <nav aria-label="Admin sections" className="mx-auto flex w-full max-w-[1440px] gap-1 overflow-x-auto px-4 sm:px-7">
          {tabs.map((item) => (
            <button key={item.key} type="button" onClick={() => setTab(item.key)} aria-current={tab === item.key ? "page" : undefined}
              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors ${tab === item.key ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              <item.icon size={15} />{item.label}
              {item.key === "feedback" && newFeedback ? <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{newFeedback}</span> : null}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7">
        {tab === "dashboard" ? (
          <div className="space-y-5">
            <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Kpi label="Businesses" value={businesses.length} icon={Building2} />
              <Kpi label="New this week" value={businesses.filter((business) => daysAgo(business.signedUp) < 7).length} icon={UserPlus} />
              <Kpi label="New this month" value={businesses.filter((business) => daysAgo(business.signedUp) < 30).length} icon={UserPlus} />
              <Kpi label="Active this week" value={activeWeek} note={businesses.length ? `${Math.round((activeWeek / businesses.length) * 100)}% of businesses` : undefined} icon={Activity} />
              <Kpi label="Users" value={people.length} icon={Users} />
              <Kpi label="New feedback" value={newFeedback} icon={Inbox} />
            </section>
            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-lg border border-border bg-card p-4">
                <h2 className="text-sm font-semibold">Sign-ups, last 6 months</h2>
                <div className="mt-4 flex h-40 items-end gap-3">
                  {signupMonths.map((month) => (
                    <div key={month.key} className="flex flex-1 flex-col items-center gap-1.5">
                      <span className="text-xs tabular-nums text-muted-foreground">{month.count}</span>
                      <div className="w-full rounded-t-md bg-primary" style={{ height: `${Math.max(3, (month.count / maxSignups) * 110)}px` }} />
                      <span className="text-xs text-muted-foreground">{month.label}</span>
                    </div>
                  ))}
                </div>
              </section>
              <section className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Newest businesses</h2><button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setTab("businesses")}>View all</button></div>
                <ul className="mt-2 divide-y divide-border">
                  {businesses.slice(0, 6).map((business) => (
                    <li key={business.ownerId} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <div className="min-w-0"><p className="truncate font-medium">{business.name}</p><p className="truncate text-xs text-muted-foreground">{business.ownerEmail}</p></div>
                      <span className="shrink-0 text-xs text-muted-foreground">{when(business.signedUp)}</span>
                    </li>
                  ))}
                  {!businesses.length ? <li className="py-6 text-center text-sm text-muted-foreground">No businesses yet.</li> : null}
                </ul>
              </section>
            </div>
            {status.some((check) => !check.ok) ? (
              <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                <p className="font-medium">Not switched on: {status.filter((check) => !check.ok).map((check) => check.name).join(", ")}.</p>
                <button type="button" className="mt-1 underline underline-offset-4" onClick={() => setTab("system")}>See system status</button>
              </section>
            ) : null}
          </div>
        ) : null}

        {tab === "businesses" ? (
          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <p className="text-sm font-semibold">{shownBusinesses.length} {shownBusinesses.length === 1 ? "business" : "businesses"}</p>
              <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                <div className="relative min-w-0 basis-full sm:w-64 sm:basis-auto">
                  <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or email" className="pl-9" aria-label="Search businesses" />
                </div>
                <Select value={filter} onValueChange={(value) => setFilter(String(value ?? "all"))}>
                  <SelectTrigger className="w-44" aria-label="Show"><SelectValue>{({ all: "All businesses", active: "Active this week", inactive: "Inactive 30+ days", paused: "Paused", free: "Free access" } as Record<string, string>)[filter]}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All businesses</SelectItem>
                    <SelectItem value="active">Active this week</SelectItem>
                    <SelectItem value="inactive">Inactive 30+ days</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                    <SelectItem value="free">Free access</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    {["Business", "Owner", "Signed up", "Last active", "Users", "Records", "Plan", "Status", ""].map((heading) => <TableHead key={heading} className="whitespace-nowrap text-xs">{heading}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shownBusinesses.map((business) => (
                    <TableRow key={business.ownerId}>
                      <TableCell className="max-w-[220px] text-sm font-medium"><span className="block truncate" title={business.name}>{business.name}</span></TableCell>
                      <TableCell className="max-w-[240px] text-sm"><span className="block truncate">{business.ownerName}</span><a href={`mailto:${business.ownerEmail}`} className="block truncate text-xs text-primary hover:underline">{business.ownerEmail}</a></TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{date(business.signedUp)}</TableCell>
                      <TableCell className={`whitespace-nowrap text-sm ${daysAgo(business.lastActive) >= 30 ? "text-muted-foreground" : ""}`}>{when(business.lastActive)}</TableCell>
                      <TableCell className="text-sm tabular-nums">{business.users}</TableCell>
                      <TableCell className="text-sm tabular-nums">{business.records}<span className="block text-xs text-muted-foreground">{business.invoices} invoices</span></TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{business.freeAccess ? "Free access" : business.plan}{business.trialEndsAt ? <span className="block text-xs text-muted-foreground">until {date(business.trialEndsAt)}</span> : null}</TableCell>
                      <TableCell>{business.suspended ? <Pill tone="bad">Paused</Pill> : daysAgo(business.lastActive) < 7 ? <Pill tone="good">Active</Pill> : daysAgo(business.lastActive) >= 30 ? <Pill tone="neutral">Inactive</Pill> : <Pill tone="info">Quiet</Pill>}</TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${business.name}`} disabled={busy.endsWith(business.ownerId)}><MoreHorizontal size={15} /></Button>} />
                          <DropdownMenuContent align="end" className="min-w-56">
                            <DropdownMenuItem onClick={() => void viewAs(business)}><Eye size={14} />View as (read-only)</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {business.freeAccess
                              ? <DropdownMenuItem onClick={() => void run(`flags-${business.ownerId}`, () => setBusinessFlags(business.ownerId, { freeAccess: false }), "Free access removed.")}><XCircle size={14} />Remove free access</DropdownMenuItem>
                              : <DropdownMenuItem onClick={() => void run(`flags-${business.ownerId}`, () => setBusinessFlags(business.ownerId, { freeAccess: true }), `${business.name} now has free access.`)}><Gift size={14} />Give free access</DropdownMenuItem>}
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                              <DropdownMenuLabel className="text-xs text-muted-foreground">Extend free trial</DropdownMenuLabel>
                              {[1, 3, 6, 12].map((months) => <DropdownMenuItem key={months} onClick={() => trial(business, months)}><Timer size={14} />{months} {months === 1 ? "month" : "months"}</DropdownMenuItem>)}
                            </DropdownMenuGroup>
                            <DropdownMenuSeparator />
                            {business.suspended
                              ? <DropdownMenuItem onClick={() => void run(`flags-${business.ownerId}`, () => setBusinessFlags(business.ownerId, { suspended: false }), `${business.name} is back on.`)}><Play size={14} />Resume business</DropdownMenuItem>
                              : <DropdownMenuItem className="text-destructive" onClick={() => pause(business)}><Pause size={14} />Pause business</DropdownMenuItem>}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!shownBusinesses.length ? <TableRow><TableCell colSpan={9} className="h-32 text-center text-sm text-muted-foreground">No businesses match.</TableCell></TableRow> : null}
                </TableBody>
              </Table>
            </div>
            <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">You see counts and activity here. “View as” opens a business read-only for support; it shows in that business&apos;s Audit Log. A paused business can sign in and look, but can&apos;t change anything. Free access and trials apply once online payments are switched on; until then everything is free for everyone.</p>
          </section>
        ) : null}

        {tab === "users" ? (
          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <p className="text-sm font-semibold">{shownPeople.length} {shownPeople.length === 1 ? "user" : "users"}</p>
              <div className="relative w-full sm:w-64">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Search name, email or business" className="pl-9" aria-label="Search users" />
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow className="bg-muted/40 hover:bg-muted/40">{["Name", "Email", "Business", "Role", "2-step", "Signed up", "Last signed in", "Devices", ""].map((heading) => <TableHead key={heading} className="whitespace-nowrap text-xs">{heading}</TableHead>)}</TableRow></TableHeader>
                <TableBody>
                  {shownPeople.map((person) => (
                    <TableRow key={person.id}>
                      <TableCell className="text-sm font-medium">{person.name}</TableCell>
                      <TableCell className="text-sm"><a href={`mailto:${person.email}`} className="text-primary hover:underline">{person.email}</a></TableCell>
                      <TableCell className="max-w-[220px] truncate text-sm">{person.business}</TableCell>
                      <TableCell className="text-sm">{person.role}</TableCell>
                      <TableCell>{person.twoStep ? <Pill tone="good">On</Pill> : <Pill tone="neutral">Off</Pill>}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{date(person.signedUp)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{when(person.lastSeen)}</TableCell>
                      <TableCell className="text-sm tabular-nums">{person.devices}</TableCell>
                      <TableCell className="text-right">
                        {person.devices ? (
                          <Button variant="ghost" size="sm" className="gap-1.5 text-destructive hover:text-destructive" disabled={busy === `out-${person.id}`} onClick={() => {
                            if (!window.confirm(`Sign ${person.name} out on every device? They can sign in again with their password.`)) return;
                            void run(`out-${person.id}`, () => signOutEverywhere(person.id), `${person.name} was signed out everywhere.`);
                          }}><LogOut size={14} />Sign out everywhere</Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!shownPeople.length ? <TableRow><TableCell colSpan={9} className="h-32 text-center text-sm text-muted-foreground">No users match.</TableCell></TableRow> : null}
                </TableBody>
              </Table>
            </div>
          </section>
        ) : null}

        {tab === "feedback" ? (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">Sent from &quot;Send feedback&quot; in the app&apos;s top bar.</p>
              <Select value={feedbackFilter} onValueChange={(value) => setFeedbackFilter(String(value ?? "New"))}>
                <SelectTrigger className="w-36" aria-label="Show feedback"><SelectValue>{({ New: "New", Done: "Done", all: "All" } as Record<string, string>)[feedbackFilter]}</SelectValue></SelectTrigger>
                <SelectContent><SelectItem value="New">New</SelectItem><SelectItem value="Done">Done</SelectItem><SelectItem value="all">All</SelectItem></SelectContent>
              </Select>
            </div>
            {shownFeedback.map((item) => (
              <article key={item.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={item.type === "Problem" ? "bad" : item.type === "Idea" ? "good" : "info"}>{item.type}</Pill>
                    {item.status === "Done" ? <Pill tone="neutral">Done</Pill> : null}
                    <span className="text-sm font-medium">{item.name}</span>
                    <a href={`mailto:${item.email}?subject=${encodeURIComponent("Your MIK LEDGER feedback")}`} className="text-xs text-primary hover:underline">{item.email}</a>
                    <span className="text-xs text-muted-foreground">· {item.business} · {when(item.at)}</span>
                  </div>
                  <div className="flex gap-1">
                    {item.status === "New"
                      ? <Button size="xs" variant="outline" className="gap-1" disabled={busy === item.id} onClick={() => void run(item.id, () => setFeedbackStatus(item.id, "Done"), "Marked as done.")}><CheckCircle2 size={12} />Done</Button>
                      : <Button size="xs" variant="ghost" disabled={busy === item.id} onClick={() => void run(item.id, () => setFeedbackStatus(item.id, "New"), "Moved back to new.")}>Reopen</Button>}
                    <Button size="icon-xs" variant="ghost" aria-label="Delete feedback" disabled={busy === item.id} onClick={() => { if (window.confirm("Delete this feedback?")) void run(item.id, () => deleteFeedback(item.id), "Deleted."); }}><Trash2 size={13} /></Button>
                  </div>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{item.message}</p>
                {item.page ? <p className="mt-2 text-xs text-muted-foreground">Page: {item.page}</p> : null}
              </article>
            ))}
            {!shownFeedback.length ? <p className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">No feedback here.</p> : null}
          </section>
        ) : null}

        {tab === "system" ? (
          <section className="space-y-3">
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <ul className="divide-y divide-border">
                {status.map((check) => (
                  <li key={check.name} className="flex items-start gap-3 px-4 py-3">
                    {check.ok ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" /> : <XCircle size={18} className="mt-0.5 shrink-0 text-destructive" />}
                    <div className="min-w-0"><p className="text-sm font-medium">{check.name}</p><p className="text-sm text-muted-foreground">{check.detail}</p></div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" disabled={busy === "email"} onClick={() => void run("email", async () => { if (!(await sendTestEmail())) throw new Error("The email couldn't be sent. Check the email settings in Vercel."); }, `Test email sent to ${adminEmail}. Check your inbox.`)}>Send test email</Button>
              <p className="text-xs text-muted-foreground">Keys are never shown here. Change them in Vercel → Project → Settings → Environment Variables, then redeploy.</p>
            </div>
          </section>
        ) : null}

        {tab === "announcement" ? (
          <section className="max-w-2xl space-y-4 rounded-lg border border-border bg-card p-5">
            <div>
              <h2 className="text-base font-semibold">Announcement for everyone</h2>
              <p className="mt-1 text-sm text-muted-foreground">Shown as a strip at the top of the app for every signed-in person, e.g. planned maintenance or a new feature. Each person can close it.</p>
            </div>
            {announcement ? (
              <div className={`rounded-md border px-3 py-2 text-sm ${announcement.tone === "warning" ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" : "border-primary/20 bg-primary/5"}`}>
                <p className="text-xs font-medium text-muted-foreground">Showing now{announcement.until ? ` until ${date(announcement.until)}` : ""}</p>
                <p className="mt-0.5">{announcement.message}</p>
              </div>
            ) : <p className="text-sm text-muted-foreground">Nothing is showing now.</p>}
            <div className="space-y-1.5">
              <Label htmlFor="announcement-text">Message</Label>
              <Textarea id="announcement-text" rows={3} maxLength={280} value={notice} onChange={(event) => setNotice(event.target.value)} placeholder="e.g. MIK LEDGER will be down for 15 minutes tonight at 2 am for an update." />
              <p className="text-right text-xs text-muted-foreground">{notice.length}/280</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="announcement-tone">Style</Label>
                <Select value={noticeTone} onValueChange={(value) => setNoticeTone(value === "warning" ? "warning" : "info")}>
                  <SelectTrigger id="announcement-tone" className="w-full"><SelectValue>{noticeTone === "warning" ? "Warning (amber)" : "Information (blue)"}</SelectValue></SelectTrigger>
                  <SelectContent><SelectItem value="info">Information (blue)</SelectItem><SelectItem value="warning">Warning (amber)</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="announcement-until">Last day (optional)</Label>
                <Input id="announcement-until" type="date" value={noticeUntil} onChange={(event) => setNoticeUntil(event.target.value)} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy === "notice" || !notice.trim()} onClick={() => void run("notice", () => saveAnnouncement(notice, noticeTone, noticeUntil), "Announcement is showing.")}>Show to everyone</Button>
              {announcement ? <Button variant="outline" disabled={busy === "notice"} onClick={() => void run("notice", () => clearAnnouncement(), "Announcement taken down.")}>Take down</Button> : null}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
