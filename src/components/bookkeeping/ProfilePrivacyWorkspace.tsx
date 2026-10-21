"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileJson, FileSpreadsheet, LockKeyhole, LogOut, Save, UserRound } from "lucide-react";
import { readableError } from "@/lib/action-error";

import { exportMyAccountData, updateProfileName } from "@/app/actions";
import { leaveBusiness } from "@/app/team-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SecurityPanel from "@/components/account/SecurityPanel";

interface ProfilePrivacyWorkspaceProps {
  initialName: string;
  email: string;
  /** Set when this person works in someone else's business as a team member. */
  membership?: { business: string; role: string } | null;
}

export default function ProfilePrivacyWorkspace({ initialName, email, membership }: ProfilePrivacyWorkspaceProps) {
  const router = useRouter();
  const [isLeaving, setIsLeaving] = useState(false);
  const [name, setName] = useState(initialName);
  const [notice, setNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setIsSaving(true);
    try {
      const result = await updateProfileName(name);
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      setName(result.name);
      setNotice("Your profile name has been saved.");
    } catch (error) {
      setNotice(error instanceof Error ? readableError(error) : "We couldn’t save your profile. Try again.");
    } finally {
      setIsSaving(false);
    }
  }

  async function downloadData(format: "xlsx" | "json") {
    setNotice("");
    setIsExporting(true);
    try {
      const data = await exportMyAccountData();
      const stamp = new Date().toISOString().slice(0, 10);
      if (format === "xlsx") {
        // One sheet per kind of record (Customers, Invoices, …), one row per record.
        const XLSX = await import("xlsx");
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
          ["MIK LEDGER backup"], [], ["Business", data.business], ["Exported by", `${data.account.name} <${data.account.email}>`], ["Exported at", data.exportedAt], ["Records", data.records.length],
          [], ["Each sheet holds one kind of record. Line items are kept as text in their own column."],
        ]), "About");
        const byKind = new Map<string, typeof data.records>();
        for (const record of data.records) byKind.set(record.kind, [...(byKind.get(record.kind) ?? []), record]);
        const used = new Set<string>(["About"]);
        for (const [kind, records] of [...byKind.entries()].sort(([a], [b]) => a.localeCompare(b))) {
          const keys = [...new Set(records.flatMap((record) => Object.keys(record.data)))];
          const rows = records.map((record) => [record.id, record.createdAt, record.updatedAt, ...keys.map((key) => String(record.data[key] ?? "").slice(0, 32000))]);
          let name = (kind.charAt(0).toUpperCase() + kind.slice(1).replace(/-/g, " ")).replace(/[\\/?*[\]:]/g, "").slice(0, 31);
          for (let n = 2; used.has(name); n += 1) name = `${name.slice(0, 28)} ${n}`;
          used.add(name);
          XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Record id", "Created", "Updated", ...keys], ...rows]), name);
        }
        XLSX.writeFile(workbook, `mikledger-backup-${stamp}.xlsx`);
      } else {
        const file = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const downloadUrl = URL.createObjectURL(file);
        const anchor = document.createElement("a");
        anchor.href = downloadUrl;
        anchor.download = `mikledger-backup-${stamp}.json`;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      }
      setNotice(data.records.length ? `Your backup is ready: ${data.records.length} records.` : "Your download is ready. Only the business owner or an Admin gets the business's records.");
    } catch (error) {
      setNotice(error instanceof Error ? readableError(error) : "We couldn’t prepare your download. Try again.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-7 sm:px-7 sm:py-9">
      <div className="border-b border-border pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">Account</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Profile & privacy</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Your name, sign-in security, the devices you’re signed in on, and a full backup of your data.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="rounded-xl border border-border bg-card p-5 sm:p-6" aria-labelledby="profile-title">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground"><UserRound size={18} /></span>
            <div>
              <h2 id="profile-title" className="text-base font-semibold">Your profile</h2>
              <p className="mt-1 text-sm text-muted-foreground">Your sign-in email identifies this account.</p>
            </div>
          </div>
          <form onSubmit={saveProfile} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="profile-name">Name</Label>
              <Input id="profile-name" name="name" autoComplete="name" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-email">Sign-in email</Label>
              <Input id="profile-email" value={email} readOnly aria-describedby="profile-email-note" />
              <p id="profile-email-note" className="text-xs text-muted-foreground">Email changes aren’t available here.</p>
            </div>
            <Button type="submit" className="gap-2" disabled={isSaving || name.trim().length < 2}>
              <Save size={15} />{isSaving ? "Saving…" : "Save profile"}
            </Button>
          </form>
        </section>

        <section id="privacy" className="scroll-mt-6 rounded-xl border border-border bg-card p-5 sm:p-6" aria-labelledby="privacy-title">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground"><LockKeyhole size={18} /></span>
            <div>
              <h2 id="privacy-title" className="text-base font-semibold">Privacy & your data</h2>
              <p className="mt-1 text-sm text-muted-foreground">Your bookkeeping records belong to this signed-in account.</p>
            </div>
          </div>
          <div className="mt-5 rounded-lg border border-border bg-background p-4">
            <p className="text-sm leading-6 text-muted-foreground">Download a full backup of the business: customers, suppliers, products, every invoice, bill, payment and journal, CRM and HR records, and settings. The Excel file has one sheet per kind of record; the JSON file is the complete copy for restoring or moving.</p>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" className="gap-2" onClick={() => downloadData("xlsx")} disabled={isExporting}>
              {isExporting ? <Download size={15} /> : <FileSpreadsheet size={15} />}{isExporting ? "Preparing…" : "Download everything (Excel)"}
            </Button>
            <Button type="button" variant="outline" className="gap-2" onClick={() => downloadData("json")} disabled={isExporting}>
              <FileJson size={15} />JSON backup
            </Button>
          </div>
        </section>
      </div>

      <SecurityPanel />

      {membership ? (
        <section className="rounded-xl border border-border bg-card p-5 sm:p-6" aria-labelledby="team-title">
          <h2 id="team-title" className="text-base font-semibold">Your business access</h2>
          <p className="mt-1 text-sm text-muted-foreground">You work in <span className="font-medium text-foreground">{membership.business}</span> as <span className="font-medium text-foreground">{membership.role}</span>. Its records belong to that business, not to your account.</p>
          <Button type="button" variant="outline" className="mt-4 gap-2 text-destructive hover:text-destructive" disabled={isLeaving} onClick={async () => {
            if (!window.confirm(`Leave ${membership.business}? You’ll need a new invitation to come back.`)) return;
            setIsLeaving(true);
            try {
              await leaveBusiness();
              router.replace("/app");
              router.refresh();
            } catch (error) {
              setNotice(error instanceof Error ? readableError(error) : "We couldn’t do that. Try again.");
            } finally {
              setIsLeaving(false);
            }
          }}><LogOut size={15} />{isLeaving ? "Leaving…" : `Leave ${membership.business}`}</Button>
        </section>
      ) : null}

      <p className="min-h-5 text-sm text-muted-foreground" role="status" aria-live="polite">{notice}</p>
    </div>
  );
}
