"use client";

import { useState } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { sendAdminConfirmLink } from "@/app/admin-actions";

/** Shown to a listed Super Admin whose email isn't confirmed yet: the panel opens once it is. */
export default function AdminConfirmEmail({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [reason, setReason] = useState("");
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center px-4">
      <div className="w-full rounded-xl border border-border bg-card p-6 text-center">
        <MailCheck className="mx-auto text-primary" size={28} />
        <h1 className="mt-3 text-lg font-semibold">Confirm your email to open Super Admin</h1>
        <p className="mt-2 text-sm text-muted-foreground">For safety, the Super Admin panel opens only after {email} is confirmed. We&apos;ll email you a link; open it, then come back here.</p>
        <Button className="mt-5 w-full" disabled={state === "sending"} onClick={async () => {
          setState("sending");
          const result = await sendAdminConfirmLink().catch(() => null);
          if (result?.ok) return setState("sent");
          setReason(result && !result.ok ? result.reason : "The email couldn't be sent. Please try again.");
          setState("failed");
        }}>{state === "sending" ? "Checking and sending…" : state === "sent" ? "Link sent. Send again" : "Email me the link"}</Button>
        {state === "sent" ? <p className="mt-3 text-sm text-muted-foreground" role="status">Sent to {email}. Check the inbox and the Spam folder for “Confirm your email address”.</p> : null}
        {state === "failed" ? <p className="mt-3 text-left text-sm text-destructive" role="alert">{reason}</p> : null}
        <Link href="/app" className="mt-4 inline-block text-sm text-primary hover:underline">Back to the app</Link>
      </div>
    </main>
  );
}
