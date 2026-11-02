import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Boxes,
  Briefcase,
  Calculator,
  Check,
  ChevronDown,
  Cloud,
  FileText,
  Globe2,
  KeyRound,
  LineChart,
  Lock,
  Menu,
  ReceiptText,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Users,
} from "lucide-react";

import BrandWordmark from "@/components/brand/BrandWordmark";
import { plans, TRIAL_MONTHS } from "@/lib/plans";

/*
 * The public website at "/": what MIK LEDGER is, its apps, prices, and the way in
 * (Log in / Get started go to /login). Signed-in visitors get "Open MIK LEDGER".
 */

const navy = "bg-[oklch(0.205_0.045_251)]";
const teal = "bg-[oklch(0.78_0.13_172)] text-[oklch(0.2_0.045_250)] hover:bg-[oklch(0.83_0.13_172)]";

const apps = [
  { id: "accounting", icon: Calculator, name: "Accounting", text: "Invoices, bills, expenses, banking and reconciliation, with the ledger, tax returns and every report kept up to date as you work.", points: ["Profit and loss, balance sheet, cash flow", "Bank reconciliation and transfers", "Budgets and recurring transactions"] },
  { id: "inventory", icon: Boxes, name: "Inventory", text: "Stock that follows every sale and purchase, across warehouses, with lots and serial numbers.", points: ["Purchase orders to bills", "Stock counts and transfers", "Low stock alerts"] },
  { id: "pos", icon: ShoppingCart, name: "Point of sale", text: "A fast till for the counter: scan, take cash or card, print the receipt. Sales post to your books by themselves.", points: ["Hold a sale, serve the next customer", "Returns and refunds", "Daily takings at a glance"] },
  { id: "crm", icon: Briefcase, name: "CRM", text: "Leads, contacts and deals in one pipeline, with quotes that turn into invoices in a click.", points: ["Pipeline and forecasts", "Campaigns and web forms", "Tasks, calls and reminders"] },
  { id: "hrm", icon: Users, name: "HR and payroll", text: "Employees, attendance, time off and payroll with tax and EOBI worked out, and payslips your staff open on their phones.", points: ["Check in and out from the phone", "Time off with approvals", "Final settlement and gratuity"] },
  { id: "assistant", icon: Sparkles, name: "AI assistant", text: "Ask about your books in plain words: who owes you, what you spent on fuel, how this month compares.", points: ["Answers from your own figures", "Spots overdue and unusual items", "Works across every app"] },
];

const stories = [
  {
    icon: ReceiptText,
    title: "Get paid sooner",
    text: "Send a professional invoice with a link your customer can open on any phone. Reminders go out when it falls due, and each payment lands in the right account.",
    points: ["Invoices, quotes and sales receipts", "Share link and PDF", "Customer statements and reminders"],
  },
  {
    icon: LineChart,
    title: "Know where you stand",
    text: "The dashboard and reports read from one set of books, on the cash or accrual basis you choose. No spreadsheets to reconcile at month end.",
    points: ["Live dashboard", "Budgets against actuals", "Reports you can export or email"],
  },
  {
    icon: Smartphone,
    title: "Your team, on their phones",
    text: "Staff install MIK LEDGER on their phone to check in and out, ask for time off and open their payslips. You see who is in, right now.",
    points: ["Installs like an app", "Location on check in", "Self-service portal"],
  },
];

const localPoints = [
  "GST, provincial sales tax (PRA, SRB, KPRA, BRA) and further tax",
  "Withholding tax kept back from supplier payments, with an NTN statement",
  "Sales tax return laid out the way FBR asks for it",
  "Payroll income tax slabs, EOBI and final settlement with gratuity",
  "Rupees, with any other currency at its exchange rate",
  "Pakistan time, weekly days off and public holidays",
];

const faqs = [
  { q: "Is there a free trial?", a: `Yes. Every new business gets ${TRIAL_MONTHS} months with every app, no card needed. After that, choose the apps you use; your books stay with you.` },
  { q: "Can I buy only the app I need?", a: "Yes. Accounting, CRM, HR and point of sale are sold separately, and the bundles cost less than their apps bought one by one." },
  { q: "Does it work for a Pakistani business?", a: "It was built for one: FBR sales tax and withholding, provincial sales tax, EOBI, payroll tax slabs and rupees. UAE, Saudi Arabia, the UK, the US, Sweden and Denmark are set up too." },
  { q: "Can my accountant and staff sign in?", a: "Invite them by email and give each a role: Admin, Accountant, Sales or HR. Each person sees only what their role allows." },
  { q: "Is my data safe?", a: "Two-step sign-in, private storage for employee documents, and a full backup of your business you can download at any time." },
  { q: "Does it work on a phone?", a: "Yes, in any browser, and it installs on the home screen like an app. The point of sale and the employee portal are made for phones and tablets." },
];

function Cta({ href, children, variant = "solid" }: { href: string; children: React.ReactNode; variant?: "solid" | "ghost" }) {
  return (
    <Link
      href={href}
      className={variant === "solid"
        ? `inline-flex h-12 items-center justify-center gap-2 rounded-full px-7 text-base font-semibold transition-colors ${teal}`
        : "inline-flex h-12 items-center justify-center gap-2 rounded-full border border-white/30 px-7 text-base font-semibold text-white transition-colors hover:bg-white/10"}
    >
      {children}
    </Link>
  );
}

export default function MarketingHome({ signedIn }: { signedIn: boolean }) {
  const start = signedIn ? "/app" : "/login?mode=signup";
  const startLabel = signedIn ? "Open MIK LEDGER" : "Start free";
  const year = new Date().getFullYear();
  const shown = plans.filter((plan) => plan.monthly > 0);

  return (
    <div className="min-h-dvh bg-white text-[oklch(0.22_0.03_250)]">
      {/* Offer band */}
      <div className="bg-[oklch(0.17_0.06_270)] px-4 py-10 text-center text-white sm:py-12">
        <p className="text-sm font-medium tracking-[0.12em] text-white/85">FREE TRIAL OFFER</p>
        <p className="mt-4 text-3xl font-medium tracking-tight sm:text-5xl">Get <span className="font-bold text-[oklch(0.83_0.16_150)]">every app free</span> for {TRIAL_MONTHS} months</p>
        <Link href={start} className="mt-7 inline-flex h-14 items-center justify-center rounded-full bg-[oklch(0.78_0.18_150)] px-10 text-lg font-semibold text-[oklch(0.17_0.06_270)] transition-colors hover:bg-[oklch(0.84_0.17_150)]">{signedIn ? "Open MIK LEDGER" : "Get started"}</Link>
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-black/5 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-[82px] max-w-[1400px] items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="brand-lockup group shrink-0" aria-label="MIK LEDGER home"><BrandWordmark size="compact" /></Link>
          <nav className="hidden items-center gap-1 text-[17px] font-medium lg:flex" aria-label="Main">
            <div className="group relative">
              <button type="button" className="inline-flex items-center gap-1 rounded-md px-3 py-2 hover:bg-black/5">For Business <ChevronDown size={16} className="transition-transform group-hover:rotate-180" /></button>
              <div className="invisible absolute left-0 top-full w-[540px] translate-y-1 rounded-xl border border-black/10 bg-white p-3 text-[15px] opacity-0 shadow-xl transition-all group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
                <div className="grid grid-cols-2 gap-1">
                  {apps.map((app) => (
                    <a key={app.id} href={`#${app.id}`} className="flex gap-3 rounded-lg p-3 hover:bg-black/[0.04]">
                      <app.icon size={20} className="mt-0.5 shrink-0 text-[oklch(0.49_0.105_238)]" />
                      <span><span className="block font-semibold">{app.name}</span><span className="mt-0.5 block text-xs font-normal leading-5 text-black/60">{app.points[0]}</span></span>
                    </a>
                  ))}
                </div>
              </div>
            </div>
            <div className="group relative">
              <button type="button" className="inline-flex items-center gap-1 rounded-md px-3 py-2 hover:bg-black/5">For Accountants &amp; Bookkeepers <ChevronDown size={16} className="transition-transform group-hover:rotate-180" /></button>
              <div className="invisible absolute left-0 top-full w-80 translate-y-1 rounded-xl border border-black/10 bg-white p-2 text-[15px] opacity-0 shadow-xl transition-all group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
                {[["#accountants", "Work in your clients' books", "Invite yourself as Accountant to each business"], ["#pakistan", "Tax returns and withholding", "FBR GST, PST and WHT statements"], ["#accounting", "Reports and close", "Trial balance, journals and closing the books"]].map(([href, title, text]) => (
                  <a key={title} href={href} className="block rounded-lg p-3 hover:bg-black/[0.04]"><span className="block font-semibold">{title}</span><span className="mt-0.5 block text-xs font-normal text-black/60">{text}</span></a>
                ))}
              </div>
            </div>
            <a href="#pricing" className="rounded-md px-3 py-2 hover:bg-black/5">Pricing</a>
            <div className="group relative">
              <button type="button" className="inline-flex items-center gap-1 rounded-md px-3 py-2 hover:bg-black/5">Learn &amp; Support <ChevronDown size={16} className="transition-transform group-hover:rotate-180" /></button>
              <div className="invisible absolute left-0 top-full w-64 translate-y-1 rounded-xl border border-black/10 bg-white p-2 text-[15px] opacity-0 shadow-xl transition-all group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
                {[["#faq", "Help and questions"], ["#pakistan", "Made for Pakistan"], ["#security", "Security"]].map(([href, title]) => <a key={title} href={href} className="block rounded-lg px-3 py-2.5 font-semibold hover:bg-black/[0.04]">{title}</a>)}
              </div>
            </div>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-[15px] xl:inline-flex"><Globe2 size={16} />English</span>
            {signedIn ? (
              <Link href="/app" className={`inline-flex h-10 items-center gap-1.5 rounded-full px-5 text-sm font-semibold ${teal}`}>Open MIK LEDGER <ArrowRight size={16} /></Link>
            ) : (
              <>
                <Link href="/login" className="rounded-md px-3 py-2 text-[17px] font-bold hover:bg-black/5">Log in</Link>
                <Link href="/login?mode=signup" className={`hidden h-10 items-center rounded-full px-5 text-sm font-semibold sm:inline-flex ${teal}`}>Get started</Link>
              </>
            )}
            <details className="relative lg:hidden">
              <summary className="flex size-10 cursor-pointer list-none items-center justify-center rounded-md hover:bg-black/5 [&::-webkit-details-marker]:hidden" aria-label="Menu"><Menu size={22} /></summary>
              <div className="absolute right-0 top-12 w-64 rounded-xl border border-black/10 bg-white p-2 text-[15px] font-medium shadow-xl">
                {apps.map((app) => <a key={app.id} href={`#${app.id}`} className="block rounded-md px-3 py-2 hover:bg-black/5">{app.name}</a>)}
                <div className="my-1 border-t border-black/10" />
                <a href="#pakistan" className="block rounded-md px-3 py-2 hover:bg-black/5">Made for Pakistan</a>
                <a href="#pricing" className="block rounded-md px-3 py-2 hover:bg-black/5">Pricing</a>
                <a href="#faq" className="block rounded-md px-3 py-2 hover:bg-black/5">Help</a>
                <div className="my-1 border-t border-black/10" />
                <Link href={signedIn ? "/app" : "/login"} className="block rounded-md px-3 py-2 font-semibold hover:bg-black/5">{signedIn ? "Open MIK LEDGER" : "Log in"}</Link>
                {!signedIn ? <Link href="/login?mode=signup" className="block rounded-md px-3 py-2 font-semibold text-[oklch(0.49_0.105_238)] hover:bg-black/5">Get started free</Link> : null}
              </div>
            </details>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden bg-gradient-to-b from-[oklch(0.2_0.08_268)] via-[oklch(0.27_0.13_265)] to-[oklch(0.36_0.15_258)] text-white">
          <div className="pointer-events-none absolute -right-40 -top-40 size-[34rem] rounded-full bg-[oklch(0.49_0.105_238)]/30 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-48 left-1/3 size-[30rem] rounded-full bg-[oklch(0.78_0.13_172)]/15 blur-3xl" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:py-24">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/80"><BadgeCheck size={14} className="text-[oklch(0.83_0.13_172)]" />Accounting, inventory, POS, CRM and HR in one place</p>
              <h1 className="mt-6 text-5xl font-bold leading-[0.98] tracking-tight sm:text-7xl lg:text-[88px]">Business<br /><span className="whitespace-nowrap font-semibold">in one ledger</span></h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-white/75">Sell, buy, pay your people and file your taxes from one set of books that keeps itself up to date. Built for growing businesses in Pakistan and beyond.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Cta href={start}>{startLabel} <ArrowRight size={18} /></Cta>
                {signedIn ? null : <Cta href="/login" variant="ghost">Log in</Cta>}
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/70">
                <li className="flex items-center gap-1.5"><Check size={16} className="text-[oklch(0.83_0.13_172)]" />{TRIAL_MONTHS} months free</li>
                <li className="flex items-center gap-1.5"><Check size={16} className="text-[oklch(0.83_0.13_172)]" />FBR-ready tax</li>
                <li className="flex items-center gap-1.5"><Check size={16} className="text-[oklch(0.83_0.13_172)]" />Works on any phone</li>
              </ul>
            </div>

            {/* Product picture, drawn rather than photographed */}
            <div className="relative mx-auto w-full max-w-[560px]" aria-hidden="true">
              <div className="rounded-2xl border border-white/10 bg-white p-5 text-[oklch(0.22_0.03_250)] shadow-2xl">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Income vs expenses</p>
                  <span className="rounded-full bg-[oklch(0.94_0.035_186)] px-2.5 py-0.5 text-xs font-medium text-[oklch(0.35_0.08_200)]">This year</span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  {[["Income", "Rs 4.82M", "text-[oklch(0.5_0.12_160)]"], ["Expenses", "Rs 3.17M", "text-[oklch(0.55_0.17_25)]"], ["Net profit", "Rs 1.65M", "text-[oklch(0.49_0.105_238)]"]].map(([label, value, tone]) => (
                    <div key={label} className="rounded-lg bg-black/[0.03] p-3"><p className="text-[11px] text-black/55">{label}</p><p className={`mt-1 text-base font-bold tabular-nums ${tone}`}>{value}</p></div>
                  ))}
                </div>
                <svg viewBox="0 0 320 110" className="mt-4 h-32 w-full">
                  {[22, 44, 66, 88].map((y) => <line key={y} x1="0" x2="320" y1={y} y2={y} stroke="currentColor" strokeOpacity="0.08" />)}
                  {[18, 30, 26, 40, 36, 52, 48, 60, 58, 72, 70, 84].map((h, i) => <rect key={i} x={8 + i * 26} y={100 - h} width="9" height={h} rx="2" fill="oklch(0.49 0.105 238)" />)}
                  {[12, 22, 20, 26, 24, 30, 34, 32, 38, 40, 44, 46].map((h, i) => <rect key={i} x={18 + i * 26} y={100 - h} width="9" height={h} rx="2" fill="oklch(0.78 0.13 172)" />)}
                </svg>
              </div>
              <div className="absolute -left-6 -top-8 hidden w-60 rounded-xl border border-black/5 bg-white p-4 text-[oklch(0.22_0.03_250)] shadow-xl sm:block">
                <p className="text-xs text-black/55">Sales tax payable to FBR</p>
                <p className="mt-1 text-2xl font-bold tabular-nums">Rs 86,400</p>
                <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-[oklch(0.5_0.12_160)]"><BadgeCheck size={14} />Return ready to file</p>
              </div>
              <div className="absolute -bottom-8 -right-4 w-64 rounded-xl border border-black/5 bg-white p-4 text-[oklch(0.22_0.03_250)] shadow-xl">
                <p className="flex items-center gap-1.5 text-xs font-semibold"><Sparkles size={14} className="text-[oklch(0.49_0.105_238)]" />Assistant</p>
                <p className="mt-2 rounded-lg bg-black/[0.04] px-3 py-2 text-xs">Who owes me money?</p>
                <p className="mt-2 text-xs leading-5 text-black/70">3 customers owe <b className="tabular-nums">Rs 1,09,140</b>. Ali Traders is 12 days overdue.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Apps */}
        <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6" aria-labelledby="apps-title">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[oklch(0.49_0.105_238)]">One system</p>
          <h2 id="apps-title" className="mt-2 max-w-2xl text-4xl font-bold tracking-tight">Every part of the business, talking to the same books</h2>
          <p className="mt-4 max-w-2xl text-lg text-black/60">Start with the app you need and add the rest when you grow. A sale at the till, a salary paid or a stock count all land in the ledger by themselves.</p>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {apps.map((app) => (
              <article id={app.id} key={app.id} className="scroll-mt-28 rounded-2xl border border-black/10 p-6 transition-shadow hover:shadow-lg">
                <span className="grid size-11 place-items-center rounded-xl bg-[oklch(0.94_0.035_186)] text-[oklch(0.35_0.08_200)]"><app.icon size={22} /></span>
                <h3 className="mt-5 text-xl font-semibold">{app.name}</h3>
                <p className="mt-2 leading-7 text-black/65">{app.text}</p>
                <ul className="mt-4 space-y-1.5 text-sm">
                  {app.points.map((point) => <li key={point} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-[oklch(0.5_0.12_160)]" />{point}</li>)}
                </ul>
              </article>
            ))}
          </div>
        </section>

        {/* Stories */}
        <section className="bg-[oklch(0.975_0.008_230)]">
          <div className="mx-auto max-w-7xl space-y-16 px-4 py-20 sm:px-6">
            {stories.map((story, index) => (
              <div key={story.title} className={`grid items-center gap-10 lg:grid-cols-2 ${index % 2 ? "lg:[&>*:first-child]:order-2" : ""}`}>
                <div>
                  <span className="grid size-11 place-items-center rounded-xl bg-white text-[oklch(0.49_0.105_238)] shadow-sm"><story.icon size={22} /></span>
                  <h2 className="mt-5 text-3xl font-bold tracking-tight">{story.title}</h2>
                  <p className="mt-4 text-lg leading-8 text-black/65">{story.text}</p>
                  <ul className="mt-5 space-y-2">
                    {story.points.map((point) => <li key={point} className="flex gap-2"><Check size={18} className="mt-0.5 shrink-0 text-[oklch(0.5_0.12_160)]" />{point}</li>)}
                  </ul>
                </div>
                <div className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm" aria-hidden="true">
                  {index === 0 ? (
                    <div>
                      <div className="flex items-center justify-between"><p className="font-semibold">Invoice INV-0142</p><span className="rounded-full bg-[oklch(0.94_0.06_160)] px-2.5 py-0.5 text-xs font-medium text-[oklch(0.4_0.1_160)]">Paid</span></div>
                      <div className="mt-4 space-y-2 text-sm">
                        {[["Website design", "Rs 120,000"], ["Hosting, 12 months", "Rs 25,000"], ["Discount", "−Rs 5,000"], ["GST 18%", "Rs 25,200"]].map(([a, b]) => <div key={a} className="flex justify-between border-b border-black/5 pb-2"><span className="text-black/65">{a}</span><span className="tabular-nums">{b}</span></div>)}
                        <div className="flex justify-between pt-1 text-base font-bold"><span>Total</span><span className="tabular-nums">Rs 165,200</span></div>
                      </div>
                    </div>
                  ) : index === 1 ? (
                    <div className="space-y-3">
                      {[["Sales", 92], ["Cost of sales", 54], ["Salaries", 38], ["Rent and utilities", 16], ["Marketing", 9]].map(([label, value]) => (
                        <div key={label as string}><div className="flex justify-between text-sm"><span>{label}</span><span className="tabular-nums text-black/55">{value}%</span></div><div className="mt-1 h-2 rounded-full bg-black/5"><div className="h-2 rounded-full bg-[oklch(0.49_0.105_238)]" style={{ width: `${value}%` }} /></div></div>
                      ))}
                    </div>
                  ) : (
                    <div className="mx-auto max-w-[260px] rounded-[28px] border-8 border-[oklch(0.205_0.045_251)] p-4">
                      <p className="text-xs text-black/55">Good morning, Sana</p>
                      <p className="mt-1 text-lg font-bold">You&apos;re checked in</p>
                      <p className="text-xs text-black/55">Since 9:02 · Lahore office</p>
                      <div className={`mt-4 rounded-xl px-4 py-3 text-center text-sm font-semibold ${teal}`}>Check out</div>
                      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-lg bg-black/[0.04] p-2"><p className="text-black/55">Annual leave</p><p className="font-bold">9 days left</p></div>
                        <div className="rounded-lg bg-black/[0.04] p-2"><p className="text-black/55">October payslip</p><p className="font-bold">Ready</p></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Pakistan */}
        <section id="pakistan" className={`${navy} scroll-mt-20 text-white`}>
          <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[oklch(0.83_0.13_172)]">Made for Pakistan</p>
              <h2 className="mt-2 text-4xl font-bold tracking-tight">Local tax and payroll, already set up</h2>
              <p className="mt-4 text-lg leading-8 text-white/70">Pick your country once and the right taxes, accounts, payroll rules and time zone are ready. Working across borders? UAE, Saudi Arabia, the UK, the US, Sweden and Denmark are set up too.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Cta href={start}>{startLabel} <ArrowRight size={18} /></Cta>
              </div>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {localPoints.map((point) => (
                <li key={point} className="flex gap-3 rounded-xl border border-white/10 bg-white/5 p-4 text-[15px] leading-6"><BadgeCheck size={20} className="mt-0.5 shrink-0 text-[oklch(0.83_0.13_172)]" />{point}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* Accountants */}
        <section id="accountants" className="mx-auto max-w-7xl scroll-mt-28 px-4 pt-20 sm:px-6">
          <div className="grid items-center gap-10 rounded-3xl border border-black/10 p-8 sm:p-12 lg:grid-cols-[1.2fr_1fr]">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[oklch(0.49_0.105_238)]">For accountants &amp; bookkeepers</p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight">Look after many clients from one sign-in</h2>
              <p className="mt-4 text-lg leading-8 text-black/65">Your clients invite you as their Accountant. Switch between their businesses, post journals, reconcile banks, close the period and file their tax returns, without sharing a password.</p>
            </div>
            <ul className="space-y-3">
              {["Switch between client businesses", "Trial balance, journals and closing the books", "FBR sales tax returns and withholding statements", "Every change kept in the audit log"].map((point) => <li key={point} className="flex gap-2"><Check size={18} className="mt-0.5 shrink-0 text-[oklch(0.5_0.12_160)]" />{point}</li>)}
            </ul>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-20 sm:px-6" aria-labelledby="pricing-title">
          <div className="text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[oklch(0.49_0.105_238)]">Pricing</p>
            <h2 id="pricing-title" className="mt-2 text-4xl font-bold tracking-tight">Pay only for the apps you use</h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-black/60">{TRIAL_MONTHS} months free with everything. Then a monthly plan in US dollars, or yearly with a month and a half free.</p>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((plan) => {
              const featured = plan.key === "business";
              return (
                <article key={plan.key} className={`relative flex flex-col rounded-2xl border p-6 ${featured ? "border-[oklch(0.49_0.105_238)] shadow-xl" : "border-black/10"}`}>
                  {featured ? <span className="absolute -top-3 left-6 rounded-full bg-[oklch(0.49_0.105_238)] px-3 py-1 text-xs font-semibold text-white">Most chosen</span> : null}
                  <p className="text-xs font-semibold uppercase tracking-wider text-black/45">{plan.type === "bundle" ? "Bundle" : "App"}</p>
                  <h3 className="mt-1 text-xl font-semibold">{plan.name}</h3>
                  <p className="mt-1 text-sm text-black/60">{plan.description}</p>
                  <p className="mt-5"><span className="text-4xl font-bold tabular-nums">${plan.monthly}</span><span className="text-black/55"> / month</span></p>
                  <ul className="mt-5 flex-1 space-y-2 text-sm">
                    {plan.highlights.map((point) => <li key={point} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-[oklch(0.5_0.12_160)]" />{point}</li>)}
                  </ul>
                  <Link href={start} className={`mt-6 inline-flex h-11 items-center justify-center rounded-full text-sm font-semibold transition-colors ${featured ? teal : "border border-black/15 hover:bg-black/5"}`}>{signedIn ? "Open MIK LEDGER" : "Start free"}</Link>
                </article>
              );
            })}
          </div>
        </section>

        {/* Security */}
        <section id="security" className="scroll-mt-20 bg-[oklch(0.975_0.008_230)]">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
            <h2 className="max-w-2xl text-3xl font-bold tracking-tight">Your books stay yours, and stay safe</h2>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {[
                [KeyRound, "Two-step sign-in", "An authenticator code on top of the password, with backup codes."],
                [Lock, "Private documents", "CVs, ID cards and payslips are stored privately, opened only by your team."],
                [Users, "Roles for everyone", "Admin, accountant, sales and HR each see only their part."],
                [Cloud, "Backups you own", "Download your whole business to Excel any time."],
              ].map(([Icon, title, text]) => {
                const Glyph = Icon as typeof Lock;
                return (
                  <div key={title as string} className="rounded-2xl bg-white p-6 shadow-sm">
                    <Glyph size={22} className="text-[oklch(0.49_0.105_238)]" />
                    <h3 className="mt-4 font-semibold">{title as string}</h3>
                    <p className="mt-1.5 text-sm leading-6 text-black/60">{text as string}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-20 sm:px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight">Questions, answered</h2>
          <div className="mt-10 divide-y divide-black/10 rounded-2xl border border-black/10">
            {faqs.map((item) => (
              <details key={item.q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden">{item.q}<ChevronDown size={18} className="shrink-0 transition-transform group-open:rotate-180" /></summary>
                <p className="mt-3 leading-7 text-black/65">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Closing call */}
        <section className="px-4 pb-20 sm:px-6">
          <div className={`${navy} mx-auto max-w-7xl overflow-hidden rounded-3xl px-6 py-14 text-center text-white sm:px-12`}>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Put your business in one ledger today</h2>
            <p className="mx-auto mt-3 max-w-xl text-white/70">{TRIAL_MONTHS} months free, every app included. Set up in minutes.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Cta href={start}>{startLabel} <ArrowRight size={18} /></Cta>
              {signedIn ? null : <Cta href="/login" variant="ghost">Log in</Cta>}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-black/10">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Link href="/" className="brand-lockup group inline-flex" aria-label="MIK LEDGER home"><BrandWordmark size="compact" /></Link>
            <p className="mt-4 max-w-xs text-sm leading-6 text-black/60">Accounting, inventory, point of sale, CRM and HR for growing businesses.</p>
          </div>
          <div>
            <p className="text-sm font-semibold">Apps</p>
            <ul className="mt-3 space-y-2 text-sm text-black/60">{apps.slice(0, 5).map((app) => <li key={app.id}><a href={`#${app.id}`} className="hover:text-black">{app.name}</a></li>)}</ul>
          </div>
          <div>
            <p className="text-sm font-semibold">Product</p>
            <ul className="mt-3 space-y-2 text-sm text-black/60">
              <li><a href="#pricing" className="hover:text-black">Pricing</a></li>
              <li><a href="#pakistan" className="hover:text-black">Made for Pakistan</a></li>
              <li><a href="#security" className="hover:text-black">Security</a></li>
              <li><a href="#faq" className="hover:text-black">Help</a></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold">Account</p>
            <ul className="mt-3 space-y-2 text-sm text-black/60">
              {signedIn ? <li><Link href="/app" className="hover:text-black">Open MIK LEDGER</Link></li> : (
                <>
                  <li><Link href="/login" className="hover:text-black">Log in</Link></li>
                  <li><Link href="/login?mode=signup" className="hover:text-black">Create an account</Link></li>
                </>
              )}
              <li><Link href="/auth/forgot-password" className="hover:text-black">Forgot password</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-black/10">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-black/50 sm:px-6">
            <p>© {year} MIK LEDGER. All rights reserved.</p>
            <p className="flex items-center gap-4"><span className="flex items-center gap-1.5"><Globe2 size={14} />English</span><span className="flex items-center gap-1.5"><Banknote size={14} />PKR, USD, AED, SAR and more</span><span className="flex items-center gap-1.5"><FileText size={14} />Prices in USD</span></p>
          </div>
        </div>
      </footer>
    </div>
  );
}
