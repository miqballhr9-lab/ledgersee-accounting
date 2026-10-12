"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Eye, EyeOff } from "lucide-react";

import { acceptInvite, type InviteDetails } from "@/app/team-actions";
import BrandWordmark from "@/components/brand/BrandWordmark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readableError } from "@/lib/action-error";
import { signIn, signOut, signUp } from "@/lib/auth-client";
import { describeAuthError } from "@/lib/errors";

interface InviteAcceptProps {
  token: string;
  invite: InviteDetails | null;
  /** Who is signed in on this browser right now, if anyone. */
  signedInEmail: string | null;
}

export default function InviteAccept({ token, invite, signedInEmail }: InviteAcceptProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-up" | "sign-in">("sign-up");
  const [name, setName] = useState(invite?.name ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function join() {
    await acceptInvite(token);
    router.replace("/app");
    router.refresh();
  }

  async function run(work: () => Promise<void>) {
    setMessage("");
    setPending(true);
    try {
      await work();
    } catch (error) {
      setMessage(error instanceof Error ? readableError(error) : "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invite) return;
    await run(async () => {
      const result = mode === "sign-up"
        ? await signUp.email({ name, email: invite.email, password, callbackURL: "/app" })
        : await signIn.email({ email: invite.email, password, callbackURL: "/app" });
      if (result.error) {
        const text = describeAuthError(result.error).message;
        // Someone who already has an account gets nudged to sign in instead.
        if (mode === "sign-up" && /exist|already/i.test(`${result.error.message ?? ""} ${text}`)) {
          setMode("sign-in");
          throw new Error("You already have an account with this email. Enter its password to sign in and join.");
        }
        throw new Error(text);
      }
      await join();
    });
  }

  const sameAccount = signedInEmail && invite && signedInEmail.toLowerCase() === invite.email.toLowerCase();

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center text-foreground"><BrandWordmark /></div>
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          {!invite ? (
            <div className="text-center">
              <h1 className="text-xl font-semibold">This invitation can’t be used</h1>
              <p className="mt-2 text-sm text-muted-foreground">It has already been accepted, or a newer invitation replaced it. Ask the person who invited you to send a new one.</p>
              <Button className="mt-5" nativeButton={false} render={<Link href="/" />}>Go to sign in</Button>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><Building2 size={18} /></span>
                <div>
                  <h1 className="text-xl font-semibold">Join {invite.business}</h1>
                  <p className="mt-1 text-sm text-muted-foreground">You’ve been invited as <span className="font-medium text-foreground">{invite.role}</span> with <span className="font-medium text-foreground">{invite.email}</span>.</p>
                </div>
              </div>

              {sameAccount ? (
                <Button className="mt-6 w-full" disabled={pending} onClick={() => void run(join)}>{pending ? "Joining…" : `Join ${invite.business}`}</Button>
              ) : signedInEmail ? (
                <div className="mt-6 space-y-3">
                  <p className="text-sm text-muted-foreground">You’re signed in as {signedInEmail}. This invitation is for {invite.email}.</p>
                  <Button variant="outline" className="w-full" disabled={pending} onClick={() => void run(async () => { await signOut(); router.refresh(); })}>Sign out and continue</Button>
                </div>
              ) : (
                <form onSubmit={submit} className="mt-6 space-y-4">
                  <div className="flex rounded-md border border-border p-0.5 text-sm">
                    {(["sign-up", "sign-in"] as const).map((value) => (
                      <button key={value} type="button" onClick={() => { setMode(value); setMessage(""); }} className={`flex-1 rounded px-3 py-1.5 font-medium ${mode === value ? "bg-secondary text-foreground" : "text-muted-foreground"}`}>
                        {value === "sign-up" ? "New account" : "I have an account"}
                      </button>
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="invite-email">Email</Label>
                    <Input id="invite-email" value={invite.email} readOnly className="bg-muted/50" />
                  </div>
                  {mode === "sign-up" ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="invite-name">Your name</Label>
                      <Input id="invite-name" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} />
                    </div>
                  ) : null}
                  <div className="space-y-1.5">
                    <Label htmlFor="invite-password">{mode === "sign-up" ? "Choose a password" : "Password"}</Label>
                    <div className="relative">
                      <Input id="invite-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete={mode === "sign-up" ? "new-password" : "current-password"} className="pr-10" />
                      <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" aria-label={showPassword ? "Hide password" : "Show password"}>
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    {mode === "sign-up" ? <p className="text-xs text-muted-foreground">At least 8 characters.</p> : null}
                  </div>
                  <Button type="submit" className="w-full" disabled={pending}>{pending ? "Please wait…" : mode === "sign-up" ? "Create account and join" : "Sign in and join"}</Button>
                </form>
              )}
              {message ? <p role="alert" className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{message}</p> : null}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
