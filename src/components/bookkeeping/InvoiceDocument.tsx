import { Fragment } from "react";

import { formatCustomerAddress } from "@/lib/customer-utils";
import { currencyAmount, parseInvoiceLines, type InvoiceLineData } from "@/lib/invoice-utils";
import { packFor } from "@/lib/tax-packs";

interface InvoiceDocumentProps {
  invoice: Record<string, string>;
  companyName: string;
  documentKind?: "invoices" | "estimates" | "sales-orders" | "credit-notes";
  /** The seller's Settings, for tax registration numbers and the tax-invoice title. */
  seller?: Record<string, string>;
  /** The customer's own record, printed as client details at the end. */
  customer?: Record<string, string>;
}

/** Consecutive lines from the same bundle, kept together. */
function groupBundles(lines: InvoiceLineData[]) {
  const groups: Array<{ bundleId: string; bundleName: string; show: boolean; lines: InvoiceLineData[] }> = [];
  for (const line of lines) {
    const last = groups[groups.length - 1];
    if (line.bundleId && last?.bundleId === line.bundleId) last.lines.push(line);
    else groups.push({ bundleId: line.bundleId ?? "", bundleName: line.bundleName || "Bundle", show: line.bundleShow !== "false", lines: [line] });
  }
  return groups;
}

const documentDetails = {
  invoices: { label: "Invoice", numberKey: "invoiceNumber", dateKey: "issueDate", dateLabel: "Issue date", totalLabel: "Invoice total" },
  estimates: { label: "Estimate", numberKey: "estimateNumber", dateKey: "date", dateLabel: "Date", totalLabel: "Estimate total" },
  "sales-orders": { label: "Sales order", numberKey: "orderNumber", dateKey: "date", dateLabel: "Order date", totalLabel: "Order total" },
  "credit-notes": { label: "Credit note", numberKey: "creditNumber", dateKey: "date", dateLabel: "Date", totalLabel: "Credit amount" },
} as const;

export default function InvoiceDocument({ invoice, companyName, documentKind = "invoices", seller, customer }: InvoiceDocumentProps) {
  const pack = packFor(seller?.taxCountry);
  // The address customers see: the customer-facing one when it is filled in, else the company address
  // (saved whole, or in parts by Settings).
  const companyAddress = seller?.address?.trim() || [seller?.addressStreet, [seller?.addressCity, seller?.addressState, seller?.addressPostal].map((part) => part?.trim()).filter(Boolean).join(", "), seller?.addressCountry].map((part) => part?.trim()).filter(Boolean).join("\n");
  const sellerAddress = (seller?.customerAddressSame === "false" && seller?.customerAddress?.trim()) || companyAddress;
  // Where to pay, from Settings > Bank details; invoices only, and not on a paid sales receipt.
  const bankRows: Array<[string, string]> = documentKind === "invoices" && invoice.docType !== "Sales receipt" ? ([
    ["A/C title", seller?.bankAccountTitle],
    ["A/C no.", seller?.bankAccountNumber],
    ["IBAN", seller?.bankIban],
    ["Swift code", seller?.bankSwift],
    ["Bank name", seller?.bankName],
    ["Branch", seller?.bankBranch],
  ] as Array<[string, string | undefined]>).map(([label, value]) => [label, value?.trim() ?? ""] as [string, string]).filter(([, value]) => value) : [];
  // The customer's details from their record, at the end of the document.
  const clientName = customer?.name?.trim() || invoice.customer || "";
  // Left: who and where. Right: number, phone, email, website, tax ID, in that order.
  const keep = (rows: Array<[string, string]>) => rows.filter(([, value]) => value);
  const customerLeft: Array<[string, string]> = customer ? keep([
    ["Customer", [clientName, customer.company?.trim() && customer.company.trim() !== clientName ? customer.company.trim() : ""].filter(Boolean).join(" · ")],
    ["Address", [...new Set(formatCustomerAddress(customer).split("\n").map((line) => line.trim()).filter(Boolean))].join("\n")],
  ]) : [];
  const customerRight: Array<[string, string]> = customer ? keep([
    ["Customer no.", customer.customerNumber?.trim() ?? ""],
    ["Phone", [...new Set([customer.phone, customer.mobile].map((value) => value?.trim()).filter(Boolean))].join(" · ")],
    ["Email", customer.email?.trim() ?? ""],
    ["Website", customer.website?.trim() ?? ""],
    ["Tax ID", customer.taxId?.trim() ?? ""],
  ]) : [];
  const clientRows = [...customerLeft, ...customerRight];
  const registrations = (pack?.registrations ?? []).filter((field) => seller?.[field.key]).map((field) => `${field.label}: ${seller?.[field.key]}`);
  // VAT and GST countries call a taxed invoice a "tax invoice".
  const isTaxInvoice = documentKind === "invoices" && Boolean(pack) && pack?.code !== "US" && Number(invoice.taxAmount) > 0;
  const currency = invoice.currency || "USD";
  // A sales receipt is saved as a paid invoice and prints under its own title.
  const isReceipt = documentKind === "invoices" && invoice.docType === "Sales receipt";
  const details = isReceipt ? { ...documentDetails.invoices, label: "Sales receipt", dateLabel: "Date", totalLabel: "Total" } : documentDetails[documentKind];
  const lines = parseInvoiceLines(invoice.lineItems ?? "");
  const subtotal = Number(invoice.subtotal) || 0;
  const taxAmount = Number(invoice.taxAmount) || 0;
  const discount = Number(invoice.discount) || 0;
  // A document in a foreign currency also shows its local value: tax authorities (FBR, FTA, ZATCA)
  // want the tax in the country's own currency.
  const localCurrency = pack?.currency || seller?.currency || "";
  const rate = Number(invoice.exchangeRate) || 0;
  const converted = localCurrency && currency !== localCurrency && rate > 0 && rate !== 1;
  const local = (amount: number) => currencyAmount(amount * rate, localCurrency);
  // A tax column prints only when lines carry their own rates.
  const lineTaxes = lines.some((line) => line.taxRate);
  const lineTax = (line: (typeof lines)[number]) => `${line.taxRate || invoice.taxRate || "0"}%`;

  return (
    <article className="mx-auto w-full max-w-4xl border border-border bg-card p-6 text-card-foreground shadow-sm sm:p-10 print:max-w-none print:border-0 print:p-0 print:shadow-none">
      <header className="grid gap-6 border-b border-border pb-7 sm:grid-cols-[minmax(0,1fr)_auto] print:grid-cols-[minmax(0,1fr)_auto]">
        {/* The seller on the left: logo, name, then address and contact. */}
        <div className="min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {seller?.logo ? <img src={seller.logo} alt="" className="h-14 w-auto max-w-[200px] object-contain" /> : null}
          <p className={`${seller?.logo ? "mt-3" : ""} text-lg font-semibold`}>{companyName || "Business"}</p>
          <div className="mt-1 space-y-0.5 text-sm text-muted-foreground">
            {sellerAddress ? <p className="whitespace-pre-line leading-5">{sellerAddress}</p> : null}
            {seller?.phone?.trim() ? <p>{seller.phone.trim()}</p> : null}
            {(seller?.customerEmail || seller?.companyEmail)?.trim() ? <p>{(seller?.customerEmail || seller?.companyEmail)?.trim()}</p> : null}
            {seller?.website?.trim() ? <p>{seller.website.trim()}</p> : null}
            {registrations.length ? <p>{registrations.join(" · ")}</p> : null}
          </div>
        </div>
        {/* The document on the right: its kind and number, then its dates. */}
        <div className="sm:text-right print:text-right">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">{isTaxInvoice ? (pack?.code === "PK" ? "Sales tax invoice" : "Tax invoice") : details.label}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{invoice[details.numberKey] || details.label}</h1>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:text-left print:text-left">
            <div><dt className="text-xs text-muted-foreground">{details.dateLabel}</dt><dd className="mt-1 font-medium">{invoice[details.dateKey] || "—"}</dd></div>
            {documentKind === "invoices" && !isReceipt ? <div><dt className="text-xs text-muted-foreground">Due date</dt><dd className="mt-1 font-medium">{invoice.dueDate || "—"}</dd></div> : null}
            {documentKind === "estimates" ? <div><dt className="text-xs text-muted-foreground">Expiry date</dt><dd className="mt-1 font-medium">{invoice.expiryDate || "—"}</dd></div> : null}
            {documentKind === "sales-orders" ? <div><dt className="text-xs text-muted-foreground">Delivery date</dt><dd className="mt-1 font-medium">{invoice.deliveryDate || "—"}</dd></div> : null}
            {documentKind === "invoices" ? <div><dt className="text-xs text-muted-foreground">Payment terms</dt><dd className="mt-1 font-medium">{invoice.paymentTerms || "—"}</dd></div> : null}
            <div><dt className="text-xs text-muted-foreground">Currency</dt><dd className="mt-1 font-medium">{currency}</dd></div>
            {converted ? <div className="col-span-2"><dt className="text-xs text-muted-foreground">Exchange rate</dt><dd className="mt-1 font-medium tabular-nums">1 {currency} = {rate.toLocaleString(undefined, { maximumFractionDigits: 6 })} {localCurrency}</dd></div> : null}
          </dl>
        </div>
      </header>

      <section className="grid gap-5 border-b border-border py-6 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Bill to</p>
          <p className="mt-2 text-base font-medium">{invoice.customer || "Customer"}</p>
          {invoice.billingAddress ? <p className="mt-1 whitespace-pre-line text-sm leading-6 text-muted-foreground">{invoice.billingAddress}</p> : null}
        </div>
        {invoice.shippingAddress ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Ship to</p>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">{invoice.shippingAddress}</p>
          </div>
        ) : null}
      </section>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-y border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-3 font-medium">Item or service</th>
              <th className="px-3 py-3 font-medium">Description</th>
              <th className="px-3 py-3 text-right font-medium">Qty</th>
              <th className="px-3 py-3 text-right font-medium">Rate</th>
              {lineTaxes ? <th className="px-3 py-3 text-right font-medium">Tax</th> : null}
              <th className="px-3 py-3 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {groupBundles(lines).map((group, index) => {
              const lineTotal = (line: (typeof lines)[number]) => (Number(line.quantity) || 0) * (Number(line.rate) || 0);
              if (!group.bundleId) {
                const line = group.lines[0];
                return (
                  <tr key={`${line.name}-${index}`} className="border-b border-border">
                    <td className="px-3 py-4 font-medium">{line.name}</td>
                    <td className="max-w-64 whitespace-pre-wrap px-3 py-4 text-muted-foreground">{line.description || "—"}</td>
                    <td className="px-3 py-4 text-right tabular-nums">{line.quantity}</td>
                    <td className="px-3 py-4 text-right tabular-nums">{currencyAmount(Number(line.rate) || 0, currency)}</td>
                    {lineTaxes ? <td className="px-3 py-4 text-right tabular-nums">{lineTax(line)}</td> : null}
                    <td className="px-3 py-4 text-right font-medium tabular-nums">{currencyAmount(lineTotal(line), currency)}</td>
                  </tr>
                );
              }
              // A bundle prints as one line, with its products and services under it when the bundle says so.
              const total = group.lines.reduce((sum, line) => sum + lineTotal(line), 0);
              return (
                <Fragment key={`${group.bundleId}-${index}`}>
                  <tr className={group.show ? "" : "border-b border-border"}>
                    <td className="px-3 py-4 font-medium">{group.bundleName}</td>
                    <td className="max-w-64 whitespace-pre-wrap px-3 py-4 text-muted-foreground">{group.show ? "Bundle" : group.lines.map((line) => line.name).join(", ")}</td>
                    <td className="px-3 py-4 text-right tabular-nums">1</td>
                    <td className="px-3 py-4 text-right tabular-nums">{currencyAmount(total, currency)}</td>
                    {lineTaxes ? <td className="px-3 py-4" /> : null}
                    <td className="px-3 py-4 text-right font-medium tabular-nums">{currencyAmount(total, currency)}</td>
                  </tr>
                  {group.show ? group.lines.map((line, partIndex) => (
                    <tr key={`${line.name}-${partIndex}`} className={partIndex === group.lines.length - 1 ? "border-b border-border text-muted-foreground" : "text-muted-foreground"}>
                      <td className="py-2 pl-8 pr-3">{line.name}</td>
                      <td className="max-w-64 whitespace-pre-wrap px-3 py-2">{line.description || ""}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{line.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{currencyAmount(Number(line.rate) || 0, currency)}</td>
                      {lineTaxes ? <td className="px-3 py-2 text-right tabular-nums">{lineTax(line)}</td> : null}
                      <td className="px-3 py-2 text-right tabular-nums">{currencyAmount(lineTotal(line), currency)}</td>
                    </tr>
                  )) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="ml-auto mt-6 w-full max-w-sm space-y-3 text-sm">
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{currencyAmount(subtotal, currency)}</span></div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">{lineTaxes ? "Tax" : invoice.taxName ? `${invoice.taxName}` : `Tax (${invoice.taxRate || "0"}%)`}</span><span className="tabular-nums">{currencyAmount(taxAmount, currency)}</span></div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Discount</span><span className="tabular-nums">−{currencyAmount(discount, currency)}</span></div>
        <div className="flex justify-between gap-4 border-t border-border pt-4 text-base font-semibold"><span>{details.totalLabel}</span><span className="tabular-nums">{currencyAmount(Number(invoice.amount) || 0, currency)}</span></div>
              {converted ? (
          <div className="mt-2 space-y-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">In {localCurrency} at {rate.toLocaleString(undefined, { maximumFractionDigits: 6 })}</p>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{local(subtotal)}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Tax</span><span className="tabular-nums">{local(taxAmount)}</span></div>
            {discount ? <div className="flex justify-between gap-4"><span className="text-muted-foreground">Discount</span><span className="tabular-nums">−{local(discount)}</span></div> : null}
            <div className="flex justify-between gap-4 font-semibold"><span>{details.totalLabel}</span><span className="tabular-nums">{local(Number(invoice.amount) || 0)}</span></div>
          </div>
        ) : null}
      </section>

      {documentKind === "invoices" && seller?.invoiceMessage && !invoice.notes ? <section className="mt-8 border-t border-border pt-5"><p className="whitespace-pre-wrap text-sm">{seller.invoiceMessage}</p></section> : null}
      {clientRows.length ? (
        <section className="mt-8 border-t border-border pt-5" aria-label="Customer details">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer details</h2>
          <div className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 print:grid-cols-2">
            {[customerLeft, customerRight].map((column, index) => (
              <dl key={index} className="min-w-0 space-y-3">
                {column.map(([label, value]) => (
                  <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 whitespace-pre-line break-words">{value}</dd></div>
                ))}
              </dl>
            ))}
          </div>
        </section>
      ) : null}
      {bankRows.length ? (
        <section className="mt-8 border-t border-border pt-5" aria-label="Bank details">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bank details</h2>
          {seller?.bankNote?.trim() ? <p className="mt-2 text-sm">{seller.bankNote.trim()}</p> : null}
          <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 print:grid-cols-2">
            {bankRows.map(([label, value]) => (
              <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 break-words font-medium tabular-nums">{value}</dd></div>
            ))}
          </dl>
        </section>
      ) : null}
      {invoice.notes || invoice.reason ? <section className="mt-8 border-t border-border pt-5"><h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{invoice.reason ? "Reason" : "Message"}</h2><p className="mt-2 whitespace-pre-wrap text-sm">{invoice.reason || invoice.notes}</p></section> : null}
    </article>
  );
}
