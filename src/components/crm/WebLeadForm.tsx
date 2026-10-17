"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";

import { submitWebLead } from "@/app/webform-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const blank = { firstName: "", lastName: "", company: "", email: "", phone: "", message: "", website: "" };

/** A simple "Contact us" form whose answers arrive in the CRM as new leads. */
export default function WebLeadForm({ token, company }: { token: string; company: string }) {
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await submitWebLead(token, form);
      setSent(true);
      setForm(blank);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That couldn’t be sent. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof typeof blank, label: string, props: { type?: string; required?: boolean } = {}) => (
    <div className="grid gap-1.5"><Label htmlFor={`lead-${key}`}>{label}</Label><Input id={`lead-${key}`} type={props.type ?? "text"} required={props.required} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></div>
  );

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Contact {company}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Leave your details and we&apos;ll get back to you.</p>
        {sent ? <p className="mt-4 flex items-center gap-2 rounded-md bg-[#21B799]/10 px-3 py-2 text-sm" role="status"><CheckCircle2 size={16} className="text-[#13866f]" />Thank you! We&apos;ve received your details.</p> : null}
        <form onSubmit={(event) => void submit(event)} className="mt-5 grid gap-3 sm:grid-cols-2">
          {field("firstName", "First name")}
          {field("lastName", "Last name", { required: true })}
          {field("company", "Company")}
          {field("phone", "Phone")}
          <div className="sm:col-span-2">{field("email", "Email", { type: "email", required: true })}</div>
          <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="lead-message">How can we help?</Label><Textarea id="lead-message" rows={4} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} /></div>
          <input tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={form.website} onChange={(event) => setForm({ ...form, website: event.target.value })} />
          {error ? <p className="text-sm text-destructive sm:col-span-2" role="alert">{error}</p> : null}
          <Button type="submit" disabled={busy} className="sm:col-span-2">{busy ? "Sending…" : "Submit"}</Button>
        </form>
      </div>
    </main>
  );
}
