"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Download, KeyRound, Laptop, LogOut, RefreshCw, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { renderSVG } from "uqr";

import { mySecurity, signOutDevice, signOutOtherDevices, type MySecurity } from "@/app/security-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readableError } from "@/lib/action-error";
import { twoFactor } from "@/lib/auth-client";

function when(value: string) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}

function problem(error: unknown, fallback: string) {
  return error instanceof Error ? readableError(error) : fallback;
}

/** Text of a better-auth error, worded for a person. */
function authProblem(error: { message?: string; status?: number } | null | undefined) {
  if (!error) return "";
  if (/password/i.test(error.message ?? "")) return "That password isn’t right.";
  if (/invalid|code/i.test(error.message ?? "")) return "That code didn’t work. Check the time on your phone and try the newest code.";
  return error.message || "That didn’t work. Please try again.";
}

function saveCodes(codes: string[]) {
  const text = `MIK LEDGER backup codes\nEach code signs you in once if you can't use your authenticator app.\n\n${codes.join("\n")}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "mikledger-backup-codes.txt";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function BackupCodes({ codes }: { codes: string[] }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      <p className="text-sm font-semibold">Save your backup codes</p>
      <p className="mt-1 text-xs">If you lose your phone, each code signs you in once. Keep them somewhere safe; they won’t be shown again.</p>
      <ul className="mt-3 grid grid-cols-2 gap-1.5 font-mono text-sm sm:grid-cols-5">{codes.map((code) => <li key={code} className="rounded bg-background/70 px-2 py-1 text-center text-foreground">{code}</li>)}</ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" className="gap-1.5 bg-background" onClick={() => saveCodes(codes)}><Download size={14} />Download</Button>
        <Button type="button" size="sm" variant="outline" className="gap-1.5 bg-background" onClick={() => void navigator.clipboard.writeText(codes.join("\n")).then(() => toast.success("Backup codes copied."))}><Copy size={14} />Copy</Button>
      </div>
    </div>
  );
}

/** Two-step sign-in, the devices signed in now, and recent sign-ins, for the person signed in. */
export default function SecurityPanel() {
  const [security, setSecurity] = useState<MySecurity | null>(null);
  const [loadError, setLoadError] = useState("");
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<{ uri: string; codes: string[] } | null>(null);
  const [code, setCode] = useState("");
  const [freshCodes, setFreshCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setSecurity(await mySecurity());
      setLoadError("");
    } catch (failure) {
      setLoadError(problem(failure, "We couldn’t load your sign-in security."));
    }
  }, []);

  useEffect(() => {
    let live = true;
    mySecurity().then((value) => { if (live) setSecurity(value); }).catch((failure) => { if (live) setLoadError(problem(failure, "We couldn’t load your sign-in security.")); });
    return () => { live = false; };
  }, []);

  const qr = useMemo(() => (setup ? renderSVG(setup.uri, { border: 1 }) : ""), [setup]);
  const secret = useMemo(() => (setup ? new URL(setup.uri).searchParams.get("secret") ?? "" : ""), [setup]);
  const needsPassword = Boolean(security?.hasPassword);

  async function step(key: string, work: () => Promise<void>) {
    setBusy(key);
    setError("");
    try {
      await work();
    } catch (failure) {
      setError(problem(failure, "That didn’t work. Please try again."));
    } finally {
      setBusy("");
    }
  }

  const turnOn = () => step("enable", async () => {
    const result = await twoFactor.enable(needsPassword ? { password } : {});
    if (result.error || !result.data) return setError(authProblem(result.error));
    setSetup({ uri: result.data.totpURI, codes: result.data.backupCodes });
    setCode("");
  });

  const confirm = () => step("verify", async () => {
    const result = await twoFactor.verifyTotp({ code: code.replace(/\s/g, "") });
    if (result.error) return setError(authProblem(result.error));
    setFreshCodes(setup?.codes ?? []);
    setSetup(null);
    setPassword("");
    toast.success("Two-step sign-in is on.");
    await load();
  });

  const turnOff = () => step("disable", async () => {
    if (!window.confirm("Turn off two-step sign-in? Your password alone will sign you in again.")) return;
    const result = await twoFactor.disable(needsPassword ? { password } : {});
    if (result.error) return setError(authProblem(result.error));
    setPassword("");
    setFreshCodes([]);
    toast.success("Two-step sign-in is off.");
    await load();
  });

  const newCodes = () => step("codes", async () => {
    const result = await twoFactor.generateBackupCodes(needsPassword ? { password } : {});
    if (result.error || !result.data) return setError(authProblem(result.error));
    setFreshCodes(result.data.backupCodes);
    setPassword("");
    toast.success("New backup codes made. The old ones no longer work.");
  });

  const passwordField = needsPassword ? (
    <div className="max-w-xs space-y-2">
      <Label htmlFor="security-password">Your password</Label>
      <Input id="security-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
    </div>
  ) : null;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="rounded-xl border border-border bg-card p-5 sm:p-6" aria-labelledby="two-step-title">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground"><ShieldCheck size={18} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="two-step-title" className="text-base font-semibold">Two-step sign-in</h2>
              {security ? <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${security.twoStep ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>{security.twoStep ? "On" : "Off"}</span> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">After your password, enter a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy). A stolen password alone can’t get in.</p>
          </div>
        </div>

        {!security ? <p className="mt-5 text-sm text-muted-foreground">{loadError || "Loading…"}</p> : setup ? (
          <div className="mt-5 space-y-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Open your authenticator app and add an account.</li>
              <li>Scan this code, or type the key below.</li>
              <li>Enter the 6-digit code the app shows.</li>
            </ol>
            <div className="flex flex-wrap items-center gap-4">
              <div className="size-40 shrink-0 rounded-lg border border-border bg-white p-1 [&_svg]:size-full" role="img" aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: qr }} />
              <div className="min-w-0 space-y-1">
                <p className="text-xs text-muted-foreground">Setup key</p>
                <p className="break-all font-mono text-sm">{secret.replace(/(.{4})/g, "$1 ").trim()}</p>
                <Button type="button" size="sm" variant="ghost" className="-ml-2 gap-1.5" onClick={() => void navigator.clipboard.writeText(secret).then(() => toast.success("Key copied."))}><Copy size={14} />Copy key</Button>
              </div>
            </div>
            <div className="max-w-xs space-y-2">
              <Label htmlFor="two-step-setup-code">6-digit code</Label>
              <Input id="two-step-setup-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(event) => setCode(event.target.value)} className="text-center text-lg tracking-[0.3em]" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={confirm} disabled={busy === "verify" || code.replace(/\s/g, "").length !== 6}>{busy === "verify" ? "Checking…" : "Turn on"}</Button>
              <Button type="button" variant="ghost" onClick={() => { setSetup(null); setError(""); }}>Cancel</Button>
            </div>
          </div>
        ) : security.twoStep ? (
          <div className="mt-5 space-y-4">
            {freshCodes.length ? <BackupCodes codes={freshCodes} /> : null}
            {passwordField}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="gap-1.5" onClick={newCodes} disabled={Boolean(busy) || (needsPassword && !password)}><KeyRound size={15} />{busy === "codes" ? "Making…" : "New backup codes"}</Button>
              <Button type="button" variant="outline" className="gap-1.5 text-destructive hover:text-destructive" onClick={turnOff} disabled={Boolean(busy) || (needsPassword && !password)}><ShieldOff size={15} />{busy === "disable" ? "Turning off…" : "Turn off"}</Button>
            </div>
            {needsPassword ? <p className="text-xs text-muted-foreground">Enter your password to make new backup codes or turn this off.</p> : null}
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {passwordField}
            <Button type="button" className="gap-1.5" onClick={turnOn} disabled={busy === "enable" || (needsPassword && !password)}><ShieldCheck size={15} />{busy === "enable" ? "Starting…" : "Set up two-step sign-in"}</Button>
          </div>
        )}
        {error ? <p role="alert" className="mt-3 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      </section>

      <section className="rounded-xl border border-border bg-card p-5 sm:p-6" aria-labelledby="devices-title">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground"><Laptop size={18} /></span>
          <div className="min-w-0 flex-1">
            <h2 id="devices-title" className="text-base font-semibold">Where you’re signed in</h2>
            <p className="mt-1 text-sm text-muted-foreground">Don’t recognise a device? Sign it out and change your password.</p>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Refresh" onClick={() => void load()}><RefreshCw size={14} /></Button>
        </div>
        {security ? (
          <>
            <ul className="mt-4 max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {security.devices.map((device) => (
                <li key={device.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{device.device}{device.current ? <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">This device</span> : null}</p>
                    <p className="truncate text-xs text-muted-foreground">{[device.ipAddress, `active ${when(device.lastActive)}`].filter(Boolean).join(" · ")}</p>
                  </div>
                  {!device.current ? <Button type="button" size="sm" variant="ghost" className="shrink-0 text-destructive hover:text-destructive" disabled={busy === device.id} onClick={() => void step(device.id, async () => { await signOutDevice(device.id); toast.success("That device was signed out."); await load(); })}>Sign out</Button> : null}
                </li>
              ))}
            </ul>
            {security.devices.length > 1 ? (
              <Button type="button" variant="outline" className="mt-3 gap-1.5" disabled={busy === "others"} onClick={() => void step("others", async () => {
                if (!window.confirm("Sign out every other device? This one stays signed in.")) return;
                const count = await signOutOtherDevices();
                toast.success(`${count} ${count === 1 ? "device" : "devices"} signed out.`);
                await load();
              })}><LogOut size={15} />Sign out all other devices</Button>
            ) : null}
            <h3 className="mt-5 text-sm font-semibold">Recent sign-ins</h3>
            {security.signIns.length ? (
              <ul className="mt-2 space-y-1.5 text-sm">
                {security.signIns.map((entry, index) => (
                  <li key={`${entry.at}-${index}`} className="flex flex-wrap justify-between gap-x-3 text-muted-foreground"><span className="text-foreground">{entry.device}</span><span className="text-xs">{[entry.ipAddress, when(entry.at)].filter(Boolean).join(" · ")}</span></li>
                ))}
              </ul>
            ) : <p className="mt-2 text-sm text-muted-foreground">Sign-ins from now on will be listed here.</p>}
          </>
        ) : <p className="mt-4 text-sm text-muted-foreground">{loadError || "Loading…"}</p>}
      </section>
    </div>
  );
}
