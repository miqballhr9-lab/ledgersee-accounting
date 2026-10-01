"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BriefcaseBusiness, LockKeyhole } from "lucide-react";

import LedgerPreview from "@/components/account/LedgerPreview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, signUp } from "@/lib/auth-client";
import { describeAuthError } from "@/lib/errors";

export default function AccountAccess() {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsPending(true);

    try {
      const result = mode === "sign-up"
        ? await signUp.email({ name, email, password, callbackURL: "/app" })
        : await signIn.email({ email, password, callbackURL: "/app" });

      if (result.error) {
        setMessage(describeAuthError(result.error).message);
        return;
      }
      router.replace("/app");
      router.refresh();
    } catch (error) {
      setMessage(describeAuthError(error).message);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <main className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1.1fr)_minmax(440px,0.9fr)]">
      <section className="relative hidden overflow-hidden bg-sidebar px-12 py-10 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between xl:px-20">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
            <BriefcaseBusiness size={19} strokeWidth={1.8} />
          </span>
          <span className="text-[17px] font-semibold tracking-tight">Ledgerline</span>
        </div>
        <div className="relative z-10 max-w-xl pb-10">
          <p className="mb-5 text-xs font-semibold uppercase tracking-[0.18em] text-sidebar-primary">Business, in balance</p>
          <h1 className="max-w-lg text-5xl font-semibold leading-[1.08] tracking-[-0.045em] xl:text-[58px]">
            Your books, clear from day one.
          </h1>
          <p className="mt-6 max-w-md text-base leading-7 text-sidebar-foreground/70">
            Keep customers, invoices, spending, and reports together in one steady workspace.
          </p>
          <div className="mt-10 flex items-center gap-3 text-sm text-sidebar-foreground/65">
            <LockKeyhole size={16} strokeWidth={1.7} />
            <span>Your financial records stay with your account.</span>
          </div>
        </div>
        <div className="absolute -bottom-28 -right-16 size-[26rem] rounded-full border border-sidebar-foreground/10" />
        <div className="absolute -bottom-12 -right-4 size-[18rem] rounded-full border border-sidebar-primary/20" />
        <p className="text-xs text-sidebar-foreground/45">A focused workspace for the details that move your business.</p>
      </section>

      <section className="flex min-h-dvh items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[420px]">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
              <BriefcaseBusiness size={19} strokeWidth={1.8} />
            </span>
            <span className="text-[17px] font-semibold tracking-tight">Ledgerline</span>
          </div>
          <p className="text-sm font-medium text-primary">Your business workspace</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">
            {mode === "sign-in" ? "Welcome back" : "Create your account"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {mode === "sign-in" ? "Sign in to pick up where you left off." : "Start organizing your books in one place."}
          </p>

          <LedgerPreview onCreateAccount={() => { setMode("sign-up"); setMessage(""); }} />

          <div className="mt-7 grid grid-cols-2 rounded-lg border border-border bg-muted/70 p-1">
            <button
              type="button"
              onClick={() => { setMode("sign-in"); setMessage(""); }}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${mode === "sign-in" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => { setMode("sign-up"); setMessage(""); }}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${mode === "sign-up" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              Create account
            </button>
          </div>

          <form className="mt-7 space-y-5" onSubmit={submit}>
            {mode === "sign-up" ? (
              <div className="space-y-2">
                <Label htmlFor="full-name">Your name</Label>
                <Input id="full-name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="password">Password</Label>
                {mode === "sign-in" ? (
                  <Link href="/auth/forgot-password" className="text-xs font-medium text-primary hover:underline">Forgot password?</Link>
                ) : null}
              </div>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                required
              />
            </div>
            {message ? <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">{message}</p> : null}
            <Button type="submit" className="h-10 w-full gap-2" disabled={isPending}>
              {isPending ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create account"}
              {!isPending ? <ArrowRight size={16} /> : null}
            </Button>
          </form>
          <p className="mt-6 text-center text-xs leading-5 text-muted-foreground">
            Your records are saved to your account and are not shared with other sign-ins.
          </p>
        </div>
      </section>
    </main>
  );
}
