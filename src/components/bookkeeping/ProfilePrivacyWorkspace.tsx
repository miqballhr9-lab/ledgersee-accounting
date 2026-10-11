"use client";

import { useState } from "react";
import { Download, LockKeyhole, Save, UserRound } from "lucide-react";
import { readableError } from "@/lib/action-error";

import { exportMyAccountData, updateProfileName } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ProfilePrivacyWorkspaceProps {
  initialName: string;
  email: string;
}

export default function ProfilePrivacyWorkspace({ initialName, email }: ProfilePrivacyWorkspaceProps) {
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

  async function downloadData() {
    setNotice("");
    setIsExporting(true);
    try {
      const data = await exportMyAccountData();
      const file = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const downloadUrl = URL.createObjectURL(file);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `mikledger-account-data-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setNotice("Your account data download is ready.");
    } catch {
      setNotice("We couldn’t prepare your download. Try again.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-7 sm:px-7 sm:py-9">
      <div className="border-b border-border pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">Account</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Profile & privacy</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Manage the name shown in your workspace and keep a copy of your bookkeeping data.</p>
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
            <p className="text-sm leading-6 text-muted-foreground">Download a copy of your account name, sign-in email, and saved bookkeeping records. The file is prepared when you request it.</p>
          </div>
          <Button type="button" variant="outline" className="mt-5 gap-2" onClick={downloadData} disabled={isExporting}>
            <Download size={15} />{isExporting ? "Preparing download…" : "Download my data"}
          </Button>
        </section>
      </div>

      <p className="min-h-5 text-sm text-muted-foreground" role="status" aria-live="polite">{notice}</p>
    </div>
  );
}
