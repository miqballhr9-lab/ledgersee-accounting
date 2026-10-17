"use client";

import { useState, type FormEvent } from "react";
import { BriefcaseBusiness, CheckCircle2, MapPin } from "lucide-react";

import { applyForJob } from "@/app/careers-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Job {
  id: string;
  title: string;
  department: string;
  location: string;
  type: string;
  description: string;
}

/** The public jobs page: open positions and an application form, as Odoo's Jobs website page. */
export default function CareersBoard({ token, company, logo, jobs }: { token: string; company: string; logo: string; jobs: Job[] }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", linkedin: "", message: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");
  const job = jobs.find((entry) => entry.id === jobId) ?? null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!job) return;
    setBusy(true);
    setError("");
    try {
      await applyForJob(token, { jobId: job.id, ...form });
      setSent(job.title);
      setJobId(null);
      setForm({ name: "", email: "", phone: "", linkedin: "", message: "", website: "" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your application couldn’t be sent. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logo ? <img src={logo} alt="" className="h-10 w-auto" /> : null}
          <div>
            <p className="text-lg font-semibold">{company}</p>
            <p className="text-sm text-muted-foreground">Careers</p>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-8">
        {sent ? (
          <p className="flex items-center gap-2 rounded-lg border border-[#21B799]/40 bg-[#21B799]/10 px-4 py-3 text-sm" role="status"><CheckCircle2 size={16} className="text-[#13866f]" />Thank you! Your application for {sent} has been received.</p>
        ) : null}
        <h1 className="text-2xl font-semibold">Open positions</h1>
        {jobs.length ? jobs.map((entry) => (
          <article key={entry.id} className="rounded-lg border border-border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{entry.title}</h2>
                <p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  {entry.department ? <span className="flex items-center gap-1"><BriefcaseBusiness size={14} />{entry.department}</span> : null}
                  {entry.location ? <span className="flex items-center gap-1"><MapPin size={14} />{entry.location}</span> : null}
                  {entry.type ? <span>{entry.type}</span> : null}
                </p>
              </div>
              <Button onClick={() => { setJobId(entry.id); setSent(""); setError(""); }}>Apply</Button>
            </div>
            {entry.description ? <p className="mt-3 whitespace-pre-line text-sm leading-6">{entry.description}</p> : null}
            {jobId === entry.id ? (
              <form onSubmit={(event) => void submit(event)} className="mt-5 grid gap-3 border-t border-border pt-5 sm:grid-cols-2">
                <div className="grid gap-1.5"><Label htmlFor="apply-name">Your name</Label><Input id="apply-name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
                <div className="grid gap-1.5"><Label htmlFor="apply-email">Email</Label><Input id="apply-email" type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></div>
                <div className="grid gap-1.5"><Label htmlFor="apply-phone">Phone</Label><Input id="apply-phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div>
                <div className="grid gap-1.5"><Label htmlFor="apply-linkedin">LinkedIn profile</Label><Input id="apply-linkedin" placeholder="https://linkedin.com/in/…" value={form.linkedin} onChange={(event) => setForm({ ...form, linkedin: event.target.value })} /></div>
                <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="apply-message">Why you&apos;re a good fit</Label><Textarea id="apply-message" rows={4} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} /></div>
                <input tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={form.website} onChange={(event) => setForm({ ...form, website: event.target.value })} />
                {error ? <p className="text-sm text-destructive sm:col-span-2" role="alert">{error}</p> : null}
                <div className="flex gap-2 sm:col-span-2">
                  <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send application"}</Button>
                  <Button type="button" variant="ghost" onClick={() => setJobId(null)}>Cancel</Button>
                </div>
              </form>
            ) : null}
          </article>
        )) : <p className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No open positions right now. Please check back later.</p>}
      </div>
    </main>
  );
}
