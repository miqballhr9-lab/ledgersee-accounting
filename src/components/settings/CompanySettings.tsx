"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircle, Pencil, UploadCloud } from "lucide-react";
import { toast } from "sonner";

import { getAttachmentUploadTarget, saveBookkeepingRecord } from "@/app/actions";
import { CurrencyPicker } from "@/components/bookkeeping/CurrencyPicker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { readableError } from "@/lib/action-error";
import type { BookkeepingRecord } from "@/lib/bookkeeping-types";
import { packFor } from "@/lib/tax-packs";

interface CompanySettingsProps {
  settings: BookkeepingRecord | null;
  workspaceName: string;
}

type Data = Record<string, string>;
type TabKey = "company" | "sales" | "expenses" | "advanced";

const tabs: { key: TabKey; label: string }[] = [
  { key: "company", label: "Company" },
  { key: "sales", label: "Sales" },
  { key: "expenses", label: "Expenses" },
  { key: "advanced", label: "Advanced" },
];

const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const terms = ["Due on receipt", "15 days", "30 days", "60 days"];
const companyTypes = ["Sole proprietor", "Partnership", "Private limited company", "Public limited company", "Single member company", "Non-profit / trust", "Other"];
const defaultEmailTemplate = "Hello {{customer}}, your invoice {{invoice}} for {{amount}} is ready. — {{company}}";

/** The company address in one block, as invoices and documents print it. */
export function composeAddress(data: Data, prefix = "address") {
  const street = data[`${prefix}Street`]?.trim() ?? "";
  const cityLine = [data[`${prefix}City`], data[`${prefix}State`], data[`${prefix}Postal`]].map((part) => part?.trim()).filter(Boolean).join(", ");
  return [street, cityLine, data[`${prefix}Country`]?.trim()].filter(Boolean).join("\n");
}

/** Settings saved before the address was split into parts keep their address in the street box. */
function withDefaults(data: Data, workspaceName: string): Data {
  const filled: Data = { ...data };
  filled.companyName ||= workspaceName;
  filled.currency ||= "USD";
  filled.fiscalYear ||= "January";
  filled.invoicePrefix ||= "INV-";
  filled.nextInvoiceNumber ||= "1";
  filled.invoiceTerms ||= "30 days";
  filled.billTerms ||= "30 days";
  filled.accountingMethod ||= "Accrual";
  filled.legalNameSame ||= "true";
  filled.customerEmailSame ||= "true";
  filled.customerAddressSame ||= "true";
  filled.legalAddressSame ||= "true";
  if (!filled.addressStreet && !filled.addressCity && filled.address) filled.addressStreet = filled.address;
  return filled;
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid gap-1 py-1 text-sm sm:grid-cols-[180px_1fr]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 whitespace-pre-line break-words">{value || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

function Field({ label, htmlFor, children, help, wide }: { label: string; htmlFor?: string; children: ReactNode; help?: string; wide?: boolean }) {
  return (
    <div className={`space-y-1.5 ${wide ? "sm:col-span-2" : ""}`}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
    </div>
  );
}

/**
 * Account and settings, laid out like QuickBooks Online: tabs on the left,
 * each setting group shown read-only and edited in place.
 */
export default function CompanySettings({ settings, workspaceName }: CompanySettingsProps) {
  const router = useRouter();
  const [record, setRecord] = useState(settings);
  const saved = withDefaults(record?.data ?? {}, workspaceName);
  const [tab, setTab] = useState<TabKey>("company");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Data>(saved);
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const pack = packFor(saved.taxCountry);

  const set = (key: string, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const checked = (key: string) => draft[key] === "true";

  function startEditing(section: string) {
    setDraft(saved);
    setError("");
    setEditing(section);
  }

  function cancel() {
    setDraft(saved);
    setError("");
    setEditing(null);
  }

  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const target = await getAttachmentUploadTarget(file.name, file.type, file.size);
      const response = await fetch(target.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!response.ok) throw new Error("The upload didn’t finish. Please try again.");
      setDraft((current) => ({ ...current, logo: target.publicUrl, logoName: file.name }));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? readableError(uploadError) : "The upload didn’t finish. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    const next: Data = { ...draft };
    if (!next.companyName?.trim()) { setError("Enter your company name."); return; }
    if (!next.currency?.trim()) { setError("Choose your home currency."); return; }
    for (const key of ["companyEmail", "customerEmail"]) {
      if (next[key]?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next[key].trim())) { setError("Enter a valid email address."); return; }
    }
    if (!/^\d{1,9}$/.test(next.nextInvoiceNumber?.trim() || "1") || Number(next.nextInvoiceNumber) < 1) { setError("The next invoice number must be a whole number from 1."); return; }
    if (next.legalNameSame === "true") next.legalName = next.companyName;
    if (next.customerEmailSame === "true") next.customerEmail = next.companyEmail ?? "";
    next.address = composeAddress(next);
    if (next.customerAddressSame === "true") next.customerAddress = next.address;
    if (next.legalAddressSame === "true") next.legalAddress = next.address;
    setPending(true);
    setError("");
    try {
      const result = await saveBookkeepingRecord("settings", next, record?.id);
      setRecord(result);
      setDraft(withDefaults(result.data, workspaceName));
      setEditing(null);
      toast.success("Settings saved.");
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? readableError(saveError) : "We couldn’t save your settings.");
    } finally {
      setPending(false);
    }
  }

  function section(id: string, title: string, view: ReactNode, edit: ReactNode) {
    const isEditing = editing === id;
    return (
      <section key={id} className={`grid gap-3 border-b border-border px-5 py-5 last:border-0 md:grid-cols-[200px_1fr_auto] ${isEditing ? "bg-muted/20" : "cursor-pointer hover:bg-muted/30"}`} onClick={isEditing || editing ? undefined : () => startEditing(id)}>
        <h3 className="text-base font-semibold">{title}</h3>
        {isEditing ? (
          <div className="min-w-0 space-y-4" onClick={(event) => event.stopPropagation()}>
            <div className="grid gap-4 sm:grid-cols-2">{edit}</div>
            {error ? <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={cancel} disabled={pending}>Cancel</Button>
              <Button type="button" onClick={() => void save()} disabled={pending || uploading}>{pending ? "Saving…" : "Save"}</Button>
            </div>
          </div>
        ) : (
          <dl className="min-w-0">{view}</dl>
        )}
        {!isEditing ? (
          <Button type="button" variant="ghost" size="icon-sm" className="hidden text-muted-foreground md:inline-flex" aria-label={`Edit ${title}`} disabled={Boolean(editing)} onClick={(event) => { event.stopPropagation(); startEditing(id); }}><Pencil size={15} /></Button>
        ) : <span />}
      </section>
    );
  }

  const text = (key: string, label: string, props: { placeholder?: string; type?: string; help?: string; wide?: boolean; disabled?: boolean } = {}) => (
    <Field label={label} htmlFor={`settings-${key}`} help={props.help} wide={props.wide}>
      <Input id={`settings-${key}`} type={props.type ?? "text"} value={draft[key] ?? ""} placeholder={props.placeholder} disabled={props.disabled} maxLength={300} onChange={(event) => set(key, event.target.value)} />
    </Field>
  );
  const select = (key: string, label: string, options: readonly string[], help?: string) => (
    <Field label={label} htmlFor={`settings-${key}`} help={help}>
      <Select value={draft[key] || null} onValueChange={(value) => set(key, String(value ?? ""))}>
        <SelectTrigger id={`settings-${key}`} className="w-full"><SelectValue placeholder="Choose" /></SelectTrigger>
        <SelectContent>{options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
      </Select>
    </Field>
  );
  const sameAs = (key: string, label: string) => (
    <label className="flex items-center gap-2 text-sm sm:col-span-2"><Checkbox checked={checked(key)} onCheckedChange={(value) => set(key, value === true ? "true" : "false")} />{label}</label>
  );
  const addressFields = (prefix: string) => (
    <>
      <Field label="Street address" htmlFor={`settings-${prefix}Street`} wide>
        <Textarea id={`settings-${prefix}Street`} rows={2} value={draft[`${prefix}Street`] ?? ""} maxLength={300} onChange={(event) => set(`${prefix}Street`, event.target.value)} />
      </Field>
      {text(`${prefix}City`, "City / town")}
      {text(`${prefix}State`, "Province / state")}
      {text(`${prefix}Postal`, "Postal code")}
      {text(`${prefix}Country`, "Country", { placeholder: pack?.country })}
    </>
  );

  const nextInvoice = `${saved.invoicePrefix}${String(Math.max(1, Number(saved.nextInvoiceNumber) || 1)).padStart(4, "0")}`;

  return (
    <main className="min-h-full space-y-5 p-4 sm:p-6 lg:p-8">
      <section>
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Organization / Settings</p>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight sm:text-3xl">Account and settings</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Click a section to change it. These details appear on your invoices, documents and reports.</p>
      </section>

      <div className="grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Settings" className="flex gap-1 overflow-x-auto lg:flex-col">
          {tabs.map((item) => (
            <button key={item.key} type="button" onClick={() => { if (!editing) setTab(item.key); }} disabled={Boolean(editing) && tab !== item.key} aria-current={tab === item.key ? "page" : undefined} className={`whitespace-nowrap rounded-md px-3 py-2 text-left text-sm font-medium disabled:opacity-50 ${tab === item.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 rounded-lg border border-border bg-card">
          {tab === "company" ? (
            <>
              {section("name", "Company name",
                <>
                  {saved.logo ? (
                    <div className="mb-2">
                      {/* eslint-disable-next-line @next/next/no-img-element -- uploaded logos come from storage, not the image optimiser */}
                      <img src={saved.logo} alt="Company logo" className="h-14 w-auto max-w-[180px] rounded border border-border bg-white object-contain p-1" />
                    </div>
                  ) : <Row label="Logo" value="" />}
                  <Row label="Company name" value={saved.companyName} />
                  <Row label="Legal name" value={saved.legalNameSame === "true" ? saved.companyName : saved.legalName} />
                  {(pack?.registrations ?? [{ key: "businessId", label: "Business ID no." }]).map((field) => <Row key={field.key} label={field.label} value={saved[field.key]} />)}
                </>,
                <>
                  <Field label="Company logo" htmlFor="settings-logo" wide help="PNG, JPEG, WebP, or GIF. Shown on invoices.">
                    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {draft.logo ? <img src={draft.logo} alt="" className="h-12 w-auto max-w-[140px] rounded border border-border bg-white object-contain p-1" /> : null}
                      <Input id="settings-logo" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={uploading} onChange={(event) => void uploadLogo(event.target.files?.[0])} className="h-10 max-w-xs cursor-pointer bg-card file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-2.5 file:py-1 file:text-xs file:font-medium" />
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">{uploading ? <LoaderCircle size={13} className="animate-spin" /> : <UploadCloud size={13} />}{draft.logoName || (draft.logo ? "Logo added" : "No logo yet")}</span>
                      {draft.logo ? <Button type="button" variant="ghost" size="sm" onClick={() => setDraft((current) => ({ ...current, logo: "", logoName: "" }))}>Remove</Button> : null}
                    </div>
                  </Field>
                  {text("companyName", "Company name")}
                  <div className="space-y-2">
                    {text("legalName", "Legal name", { disabled: checked("legalNameSame") })}
                    <label className="flex items-center gap-2 text-sm"><Checkbox checked={checked("legalNameSame")} onCheckedChange={(value) => set("legalNameSame", value === true ? "true" : "false")} />Same as company name</label>
                  </div>
                  {(pack?.registrations ?? [{ key: "businessId", label: "Business ID no.", placeholder: "" }]).map((field) => <div key={field.key}>{text(field.key, field.label, { placeholder: field.placeholder })}</div>)}
                </>,
              )}
              {section("type", "Company type",
                <>
                  <Row label="Tax form" value={saved.companyType} />
                  <Row label="Industry" value={saved.industry} />
                </>,
                <>
                  {select("companyType", "Tax form", companyTypes)}
                  {text("industry", "Industry", { placeholder: "e.g. Trading, IT services, Textile" })}
                </>,
              )}
              {section("contact", "Contact info",
                <>
                  <Row label="Company email" value={saved.companyEmail} />
                  <Row label="Customer-facing email" value={saved.customerEmailSame === "true" ? saved.companyEmail : saved.customerEmail} />
                  <Row label="Company phone" value={saved.phone} />
                  <Row label="Website" value={saved.website} />
                </>,
                <>
                  {text("companyEmail", "Company email", { type: "email", help: "Where we send messages about your account." })}
                  <div className="space-y-2">
                    {text("customerEmail", "Customer-facing email", { type: "email", disabled: checked("customerEmailSame") })}
                    <label className="flex items-center gap-2 text-sm"><Checkbox checked={checked("customerEmailSame")} onCheckedChange={(value) => set("customerEmailSame", value === true ? "true" : "false")} />Same as company email</label>
                  </div>
                  {text("phone", "Company phone", { type: "tel", placeholder: "0300-1234567" })}
                  {text("website", "Website", { placeholder: "www.example.com" })}
                </>,
              )}
              {section("address", "Address",
                <>
                  <Row label="Company address" value={composeAddress(saved) || saved.address} />
                  <Row label="Customer-facing address" value={saved.customerAddressSame === "true" ? "Same as company address" : saved.customerAddress} />
                  <Row label="Legal address" value={saved.legalAddressSame === "true" ? "Same as company address" : saved.legalAddress} />
                </>,
                <>
                  {addressFields("address")}
                  {sameAs("customerAddressSame", "Customer-facing address is the same as company address")}
                  {!checked("customerAddressSame") ? <Field label="Customer-facing address" htmlFor="settings-customerAddress" wide help="Printed on invoices and other documents."><Textarea id="settings-customerAddress" rows={3} value={draft.customerAddress ?? ""} maxLength={600} onChange={(event) => set("customerAddress", event.target.value)} /></Field> : null}
                  {sameAs("legalAddressSame", "Legal address is the same as company address")}
                  {!checked("legalAddressSame") ? <Field label="Legal address" htmlFor="settings-legalAddress" wide><Textarea id="settings-legalAddress" rows={3} value={draft.legalAddress ?? ""} maxLength={600} onChange={(event) => set("legalAddress", event.target.value)} /></Field> : null}
                </>,
              )}
            </>
          ) : null}

          {tab === "sales" ? (
            <>
              {section("sales-form", "Customise",
                <>
                  <Row label="Preferred invoice terms" value={saved.invoiceTerms} />
                  <Row label="Invoice number prefix" value={saved.invoicePrefix} />
                  <Row label="Next invoice number" value={`${saved.nextInvoiceNumber} (next invoice: ${nextInvoice})`} />
                </>,
                <>
                  {select("invoiceTerms", "Preferred invoice terms", terms, "Used for new invoices.")}
                  {text("invoicePrefix", "Invoice number prefix", { placeholder: "INV-", help: "Numbers follow it, e.g. INV-0006." })}
                  {text("nextInvoiceNumber", "Next invoice number", { type: "number" })}
                </>,
              )}
              {section("messages", "Messages",
                <>
                  <Row label="Default email message" value={saved.emailTemplate || defaultEmailTemplate} />
                  <Row label="Message on invoices" value={saved.invoiceMessage} />
                </>,
                <>
                  <Field label="Default email message" htmlFor="settings-emailTemplate" wide help="Available fields: {{customer}}, {{invoice}}, {{amount}}, {{company}}.">
                    <Textarea id="settings-emailTemplate" rows={4} value={draft.emailTemplate ?? ""} placeholder={defaultEmailTemplate} onChange={(event) => set("emailTemplate", event.target.value)} />
                  </Field>
                  <Field label="Default message shown on invoices" htmlFor="settings-invoiceMessage" wide help="Printed at the bottom of every invoice, e.g. bank details or thanks.">
                    <Textarea id="settings-invoiceMessage" rows={3} value={draft.invoiceMessage ?? ""} maxLength={1000} placeholder="Thank you for your business." onChange={(event) => set("invoiceMessage", event.target.value)} />
                  </Field>
                </>,
              )}
            </>
          ) : null}

          {tab === "expenses" ? (
            section("bills", "Bills and expenses",
              <Row label="Default bill payment terms" value={saved.billTerms} />,
              <>{select("billTerms", "Default bill payment terms", terms, "Used for new bills.")}</>,
            )
          ) : null}

          {tab === "advanced" ? (
            <>
              {section("accounting", "Accounting",
                <>
                  <Row label="First month of fiscal year" value={saved.fiscalYear} />
                  <Row label="Accounting method" value={saved.accountingMethod} />
                </>,
                <>
                  {select("fiscalYear", "First month of fiscal year", months, "Reports use it for “This year” and retained earnings.")}
                  {select("accountingMethod", "Accounting method", ["Accrual", "Cash"], "The basis reports open with; you can still switch on each report.")}
                </>,
              )}
              {section("currency", "Currency",
                <Row label="Home currency" value={saved.currency} />,
                <Field label="Home currency" htmlFor="settings-currency" wide help="Changing it after you have transactions changes how existing amounts read in reports.">
                  <CurrencyPicker id="settings-currency" value={draft.currency ?? ""} required onValueChange={(value: string) => set("currency", value)} />
                </Field>,
              )}
              <section className="grid gap-3 px-5 py-5 md:grid-cols-[200px_1fr_auto]">
                <h3 className="text-base font-semibold">Tax</h3>
                <dl><Row label="Tax country" value={pack ? pack.country : "Not set"} /></dl>
                <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/app/tax-setup" />}>Tax setup</Button>
              </section>
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}
