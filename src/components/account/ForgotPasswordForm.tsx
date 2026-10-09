"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, MailCheck } from "lucide-react";

import BrandWordmark from "@/components/brand/BrandWordmark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { describeAuthError } from "@/lib/errors";

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsPending(true);

    try {
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/auth/reset`,
      });
      if (result.error) {
        setMessage(describeAuthError(result.error).message);
        return;
      }
      setMessage("If an account uses this email, a password reset link will arrive shortly.");
    } catch (error) {
      setMessage(describeAuthError(error).message);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-10">
      <section className="w-full max-w-[420px]">
        <Link href="/" className="brand-lockup group mb-10 inline-flex items-center">
          <BrandWordmark />
        </Link>

        <div className="mt-4 rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <span className="grid size-11 place-items-center rounded-lg bg-accent text-accent-foreground"><MailCheck size={19} /></span>
          <p className="mt-6 text-sm font-medium text-primary">Account recovery</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Forgot your password?</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Enter the email you use for MIKLEDGER. If there’s an account for it, we’ll send a link to choose a new password.</p>

          <form className="mt-6 space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="recovery-email">Email address</Label>
              <Input id="recovery-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </div>
            {message ? <p role="status" className="rounded-md border border-border bg-muted/60 px-3 py-2.5 text-sm leading-5 text-foreground">{message}</p> : null}
            <Button type="submit" className="h-10 w-full gap-2" disabled={isPending}>
              {isPending ? "Sending…" : "Send reset link"}
              {!isPending ? <ArrowRight size={16} /> : null}
            </Button>
          </form>
        </div>

        <Link href="/" className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft size={15} /> Back to sign in
        </Link>
      </section>
    </main>
  );
}
