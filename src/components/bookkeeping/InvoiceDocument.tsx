import { currencyAmount, parseInvoiceLines } from "@/lib/invoice-utils";

interface InvoiceDocumentProps {
  invoice: Record<string, string>;
  companyName: string;
  documentKind?: "invoices" | "estimates" | "sales-orders" | "credit-notes";
}

const documentDetails = {
  invoices: { label: "Invoice", numberKey: "invoiceNumber", dateKey: "issueDate", dateLabel: "Issue date", totalLabel: "Invoice total" },
  estimates: { label: "Estimate", numberKey: "estimateNumber", dateKey: "date", dateLabel: "Date", totalLabel: "Estimate total" },
  "sales-orders": { label: "Sales order", numberKey: "orderNumber", dateKey: "date", dateLabel: "Order date", totalLabel: "Order total" },
  "credit-notes": { label: "Credit note", numberKey: "creditNumber", dateKey: "date", dateLabel: "Date", totalLabel: "Credit amount" },
} as const;

export default function InvoiceDocument({ invoice, companyName, documentKind = "invoices" }: InvoiceDocumentProps) {
  const currency = invoice.currency || "USD";
  const details = documentDetails[documentKind];
  const lines = parseInvoiceLines(invoice.lineItems ?? "");
  const subtotal = Number(invoice.subtotal) || 0;
  const taxAmount = Number(invoice.taxAmount) || 0;
  const discount = Number(invoice.discount) || 0;

  return (
    <article className="mx-auto w-full max-w-4xl border border-border bg-card p-6 text-card-foreground shadow-sm sm:p-10 print:max-w-none print:border-0 print:p-0 print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-border pb-7">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">{details.label}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{invoice[details.numberKey] || details.label}</h1>
          <p className="mt-2 text-sm text-muted-foreground">From {companyName || "Business"}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">{details.dateLabel}</dt><dd className="mt-1 font-medium">{invoice[details.dateKey] || "—"}</dd></div>
          {documentKind === "invoices" ? <div><dt className="text-xs text-muted-foreground">Due date</dt><dd className="mt-1 font-medium">{invoice.dueDate || "—"}</dd></div> : null}
          {documentKind === "estimates" ? <div><dt className="text-xs text-muted-foreground">Expiry date</dt><dd className="mt-1 font-medium">{invoice.expiryDate || "—"}</dd></div> : null}
          {documentKind === "sales-orders" ? <div><dt className="text-xs text-muted-foreground">Delivery date</dt><dd className="mt-1 font-medium">{invoice.deliveryDate || "—"}</dd></div> : null}
          {documentKind === "invoices" ? <div><dt className="text-xs text-muted-foreground">Payment terms</dt><dd className="mt-1 font-medium">{invoice.paymentTerms || "—"}</dd></div> : null}
          <div><dt className="text-xs text-muted-foreground">Currency</dt><dd className="mt-1 font-medium">{currency}</dd></div>
        </dl>
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
              <th className="px-3 py-3 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={`${line.name}-${index}`} className="border-b border-border">
                <td className="px-3 py-4 font-medium">{line.name}</td>
                <td className="max-w-64 whitespace-pre-wrap px-3 py-4 text-muted-foreground">{line.description || "—"}</td>
                <td className="px-3 py-4 text-right tabular-nums">{line.quantity}</td>
                <td className="px-3 py-4 text-right tabular-nums">{currencyAmount(Number(line.rate) || 0, currency)}</td>
                <td className="px-3 py-4 text-right font-medium tabular-nums">{currencyAmount((Number(line.quantity) || 0) * (Number(line.rate) || 0), currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="ml-auto mt-6 w-full max-w-sm space-y-3 text-sm">
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{currencyAmount(subtotal, currency)}</span></div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Tax ({invoice.taxRate || "0"}%)</span><span className="tabular-nums">{currencyAmount(taxAmount, currency)}</span></div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Discount</span><span className="tabular-nums">−{currencyAmount(discount, currency)}</span></div>
        <div className="flex justify-between gap-4 border-t border-border pt-4 text-base font-semibold"><span>{details.totalLabel}</span><span className="tabular-nums">{currencyAmount(Number(invoice.amount) || 0, currency)}</span></div>
      </section>

      {invoice.notes || invoice.reason ? <section className="mt-8 border-t border-border pt-5"><h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{invoice.reason ? "Reason" : "Notes"}</h2><p className="mt-2 whitespace-pre-wrap text-sm">{invoice.reason || invoice.notes}</p></section> : null}
    </article>
  );
}
