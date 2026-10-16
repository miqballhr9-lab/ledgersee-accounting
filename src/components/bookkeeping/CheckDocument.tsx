import { expenseLinesFromData } from "@/lib/expense-utils";

const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below1000(value: number): string {
  const hundred = Math.floor(value / 100);
  const rest = value % 100;
  const parts = [hundred ? `${ones[hundred]} Hundred` : "", rest < 20 ? ones[rest] : `${tens[Math.floor(rest / 10)]}${rest % 10 ? `-${ones[rest % 10]}` : ""}`];
  return parts.filter(Boolean).join(" ");
}

/** An amount in words, as written on a cheque: "One Thousand Two Hundred and 50/100". */
export function amountInWords(amount: number) {
  const whole = Math.floor(Math.abs(amount) + 1e-9);
  const cents = Math.round((Math.abs(amount) - whole) * 100);
  const scales: Array<[number, string]> = [[1_000_000_000, "Billion"], [1_000_000, "Million"], [1000, "Thousand"]];
  let rest = whole;
  const words: string[] = [];
  for (const [size, name] of scales) {
    if (rest >= size) {
      words.push(`${below1000(Math.floor(rest / size))} ${name}`);
      rest %= size;
    }
  }
  if (rest) words.push(below1000(rest));
  return `${words.join(" ") || "Zero"} and ${String(cents).padStart(2, "0")}/100`;
}

interface CheckDocumentProps {
  check: Record<string, string>;
  companyName: string;
  bankName: string;
  currency: string;
}

/** A printable cheque with a voucher stub, as QuickBooks' Print checks. */
export default function CheckDocument({ check, companyName, bankName, currency }: CheckDocumentProps) {
  const amount = Number(check.amount) || 0;
  const figure = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  const lines = expenseLinesFromData(check);
  return (
    <div className="mx-auto max-w-4xl space-y-6 bg-white text-black">
      <section className="relative rounded-md border-2 border-black/70 p-6" aria-label="Cheque">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-lg font-semibold">{companyName}</p>
            <p className="text-sm">{bankName}</p>
          </div>
          <div className="text-right">
            <p className="text-sm">No. <span className="font-mono text-base font-semibold">{check.referenceNumber}</span></p>
            <p className="mt-2 text-sm">Date <span className="ml-2 border-b border-black px-3 font-medium">{check.expenseDate}</span></p>
          </div>
        </div>
        <div className="mt-6 flex items-end gap-3">
          <span className="shrink-0 text-sm">Pay to the order of</span>
          <span className="flex-1 border-b border-black pb-0.5 text-lg font-medium">{check.payee}</span>
          <span className="shrink-0 rounded border-2 border-black px-3 py-1 font-mono text-lg font-semibold">{currency} {figure}</span>
        </div>
        <div className="mt-5 flex items-end gap-3">
          <span className="flex-1 border-b border-black pb-0.5 text-base">{amountInWords(amount)} <span className="tracking-widest">***</span></span>
          <span className="shrink-0 text-sm">{currency === "PKR" ? "Rupees" : currency}</span>
        </div>
        <div className="mt-10 flex items-end justify-between gap-6">
          <p className="text-sm">Memo <span className="ml-2 inline-block min-w-56 border-b border-black">{check.memo || check.description || ""}</span></p>
          <p className="w-64 border-t border-black pt-1 text-center text-xs">Authorised signature</p>
        </div>
      </section>

      <section className="rounded-md border border-black/40 p-5 text-sm" aria-label="Voucher">
        <div className="flex justify-between font-medium">
          <span>{check.payee}</span>
          <span>Check no. {check.referenceNumber} · {check.expenseDate}</span>
        </div>
        <table className="mt-3 w-full border-collapse">
          <thead><tr className="border-b border-black/40 text-left"><th className="py-1 font-medium">Account</th><th className="py-1 font-medium">Description</th><th className="py-1 text-right font-medium">Amount</th></tr></thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index} className="border-b border-black/10"><td className="py-1">{line.category}</td><td className="py-1">{line.description}</td><td className="py-1 text-right tabular-nums">{line.amount.toFixed(2)}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={2} className="pt-2 font-semibold">Total</td><td className="pt-2 text-right font-semibold tabular-nums">{figure}</td></tr></tfoot>
        </table>
      </section>
    </div>
  );
}
