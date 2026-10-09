"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, KeyRound } from "lucide-react";

import BrandWordmark from "@/components/brand/BrandWordmark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { describeAuthError } from "@/lib/errors";

export default function ResetPasswordForm({ token, invalid }: { token: string; invalid: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [isUpdated, setIsUpdated] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (password !== confirmPassword) {
      setMessage("Those passwords don’t match yet.");
      return;
    }

    setIsPending(true);
    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result.error) {
        setMessage(describeAuthError(result.error).message);
        return;
      }
      setIsUpdated(true);
    } catch (error) {
      setMessage(describeAuthError(error).message);
    } finally {
      setIsPending(false);
    }
  }

  const isLinkInvalid = !token || invalid;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-10">
      <section className="w-full max-w-[420px]">
        <Link href="/" className="brand-lockup group mb-10 inline-flex items-center">
          <BrandWordmark />
        </Link>

        <div className="mt-4 rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <span className="grid size-11 place-items-center rounded-lg bg-accent text-accent-foreground"><KeyRound size={19} /></span>
          {isUpdated ? (
            <>
              <p className="mt-6 text-sm font-medium text-primary">Password updated</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">You’re ready to sign in</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Your new password is set. Use it the next time you sign in.</p>
              <Button type="button" className="mt-6 h-10 w-full gap-2" onClick={() => { router.replace("/"); router.refresh(); }}>
                Back to sign in <ArrowRight size={16} />
              </Button>
            </>
          ) : isLinkInvalid ? (
            <>
              <p className="mt-6 text-sm font-medium text-primary">Account recovery</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">This link can’t be used</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">It may have expired or already been used. Request a new reset link to continue.</p>
              <Button type="button" variant="outline" nativeButton={false} render={<Link href="/auth/forgot-password" />} className="mt-6 h-10 w-full gap-2">
                Request a new link <ArrowRight size={16} />
              </Button>
            </>
          ) : (
            <>
              <p className="mt-6 text-sm font-medium text-primary">Account recovery</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">Choose a new password</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Use at least 8 characters, then enter it once more to confirm.</p>

              <form className="mt-6 space-y-4" onSubmit={submit}>
                <div className="space-y-2">
                  <Label htmlFor="new-password">New password</Label>
                  <Input id="new-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm new password</Label>
                  <Input id="confirm-password" type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
                </div>
                {message ? <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm leading-5 text-destructive">{message}</p> : null}
                <Button type="submit" className="h-10 w-full gap-2" disabled={isPending}>
                  {isPending ? "Updating…" : "Update password"}
                  {!isPending ? <ArrowRight size={16} /> : null}
                </Button>
              </form>
            </>
          )}
        </div>

        {!isUpdated && !isLinkInvalid ? (
          <Link href="/" className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft size={15} /> Back to sign in
          </Link>
        ) : null}
      </section>
    </main>
  );
}
