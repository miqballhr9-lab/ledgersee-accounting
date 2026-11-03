import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Boxes,
  Briefcase,
  Building2,
  Calculator,
  Check,
  ChevronDown,
  Cloud,
  Factory,
  Globe2,
  GraduationCap,
  HeartPulse,
  KeyRound,
  Lock,
  Mail,
  Menu,
  Search,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Store,
  Truck,
  UserRound,
  Users,
  Utensils,
} from "lucide-react";

import BrandWordmark from "@/components/brand/BrandWordmark";
import SolutionTabs, { type Solution } from "@/components/marketing/SolutionTabs";
import { plans, TRIAL_MONTHS } from "@/lib/plans";

/*
 * The public website at "/": what MIK LEDGER is, its apps, industries, prices, and the
 * way in (Log in / Get started go to /login). Signed-in visitors get "Open MIK LEDGER".
 * Layout: a utility bar and mega menu over the page, an offer band, a bold hero with
 * product cards, solution tabs, industry tiles, facts, pricing, help and a full footer.
 */

const ink = "text-[oklch(0.2_0.03_255)]";
const pill = "bg-[oklch(0.78_0.18_150)] text-[oklch(0.17_0.06_270)] hover:bg-[oklch(0.84_0.17_150)]";

const apps = [
  { id: "accounting", icon: Calculator, name: "Accounting", line: "Books, banking, tax and reports", text: "Invoices, bills, expenses, banking and reconciliation, with the ledger, tax returns and every report kept up to date as you work." },
  { id: "inventory", icon: Boxes, name: "Inventory", line: "Stock across warehouses", text: "Stock that follows every sale and purchase, across warehouses, with lots and serial numbers." },
  { id: "pos", icon: ShoppingCart, name: "Point of sale", line: "A fast till for the counter", text: "Scan, take cash or card and print the receipt. Sales post to your books by themselves." },
  { id: "crm", icon: Briefcase, name: "CRM", line: "Leads, deals and quotes", text: "Leads, contacts and deals in one pipeline, with quotes that turn into invoices in a click." },
  { id: "hrm", icon: Users, name: "HR and payroll", line: "People, time off and pay", text: "Employees, attendance, time off and payroll with tax and EOBI worked out, and payslips staff open on their phones." },
  { id: "assistant", icon: Sparkles, name: "AI assistant", line: "Ask your books anything", text: "Ask in plain words: who owes you, what you spent on fuel, how this month compares." },
];

const solutions: Solution[] = [
  {
    id: "finance", tab: "Finance", title: "Close the month in hours, not weeks",
    text: "Sales, purchases, payroll and stock all post to one ledger, so the trial balance, profit and loss and balance sheet are ready the moment you need them.",
    points: ["Bank reconciliation from the books", "Budgets against actuals", "Columns by day, week, month, quarter or year"],
    figure: [{ label: "Net profit, this year", value: "Rs 1.65M", note: "Up 18% on last year" }, { label: "Cash in bank", value: "Rs 2.10M", note: "Reconciled to 31 Oct" }, { label: "Owed to you", value: "Rs 1,09,140", note: "3 customers" }],
  },
  {
    id: "tax", tab: "Tax", title: "Sales tax and withholding, worked out for you",
    text: "Every invoice and bill carries its tax. The sales tax return is laid out the way FBR asks for it, and withholding kept back from suppliers is listed with their NTN.",
    points: ["GST, provincial sales tax and further tax", "Withholding tax on supplier payments", "Discounts taken off before tax"],
    figure: [{ label: "Output tax", value: "Rs 1,24,200", note: "October" }, { label: "Input tax", value: "Rs 37,800", note: "Claimable" }, { label: "Payable to FBR", value: "Rs 86,400", note: "Return ready" }],
  },
  {
    id: "supply", tab: "Inventory", title: "Know what you have and where it is",
    text: "Purchase orders become bills, received stock lands in the right warehouse, and every sale takes it out again, by lot or serial number.",
    points: ["Warehouses, transfers and stock counts", "Lots and serial numbers", "Average cost and stock value"],
    figure: [{ label: "Stock value", value: "Rs 3.0M", note: "4 warehouses" }, { label: "Low on stock", value: "6 items", note: "Below reorder point" }, { label: "Open orders", value: "3", note: "Rs 6,07,700" }],
  },
  {
    id: "sales", tab: "Sales & CRM", title: "From first call to paid invoice",
    text: "Track leads and deals, send quotes, turn them into invoices and get paid by link. Every customer's history sits in one place.",
    points: ["Pipeline, campaigns and web forms", "Quotes, sales orders and invoices", "Statements and payment reminders"],
    figure: [{ label: "Pipeline", value: "Rs 8.4M", note: "21 open deals" }, { label: "Won this month", value: "Rs 1.2M", note: "6 deals" }, { label: "Overdue", value: "2 invoices", note: "Reminders sent" }],
  },
  {
    id: "people", tab: "People", title: "Run HR and payroll from one screen",
    text: "Contracts, attendance and time off feed payroll, which works out tax, EOBI and loans. Staff check in and open their payslips on their phones.",
    points: ["Phone check in with location", "Payroll for joiners and leavers by the day", "Final settlement and gratuity"],
    figure: [{ label: "In today", value: "42 of 45", note: "3 on leave" }, { label: "October payroll", value: "Rs 4.17M", note: "Paid" }, { label: "Time off to approve", value: "4", note: "Requests" }],
  },
];

const industries = [
  { icon: Store, name: "Retail and shops", text: "Point of sale, stock and daily takings." },
  { icon: Truck, name: "Wholesale and distribution", text: "Warehouses, orders and supplier credit." },
  { icon: Factory, name: "Manufacturing", text: "Materials, stock and average cost." },
  { icon: Building2, name: "Services and agencies", text: "Time, projects and recurring invoices." },
  { icon: Utensils, name: "Restaurants and cafés", text: "A quick till and staff shifts." },
  { icon: HeartPulse, name: "Clinics and pharmacies", text: "Stock by batch and serial number." },
  { icon: GraduationCap, name: "Schools and training", text: "Recurring fees and staff payroll." },
  { icon: ShoppingBag, name: "Online sellers", text: "Orders, stock and many currencies." },
];

const spotlight = [
  { tag: "New", title: "Withholding tax on supplier payments", text: "Set a supplier's rate once; each payment keeps the tax back and lists it for your statement." },
  { tag: "New", title: "Reports by day or by week", text: "Profit and loss and the balance sheet, a column for each day or week you choose." },
  { tag: "Mobile", title: "The employee app", text: "Check in and out, ask for time off and open payslips, from the home screen." },
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

/** A mega-menu panel that opens under its header button on hover or keyboard focus. */
function MegaMenu({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="group">
      <button type="button" className="inline-flex h-[72px] items-center gap-1 border-b-[3px] border-transparent px-3 group-focus-within:border-[oklch(0.49_0.105_238)] group-hover:border-[oklch(0.49_0.105_238)]">{label} <ChevronDown size={16} className="transition-transform group-hover:rotate-180" /></button>
      <div className="invisible absolute inset-x-0 top-full border-t border-black/10 bg-white opacity-0 shadow-2xl transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
        <div className="mx-auto max-w-[1400px] px-6 py-8">{children}</div>
      </div>
    </div>
  );
}

export default function MarketingHome({ signedIn }: { signedIn: boolean }) {
  const start = signedIn ? "/app" : "/login?mode=signup";
  const startLabel = signedIn ? "Open MIK LEDGER" : "Start free";
  const year = new Date().getFullYear();
  const shown = plans.filter((plan) => plan.monthly > 0);

  return (
    <div className={`min-h-dvh bg-white ${ink}`}>
      {/* Utility bar */}
      <div className="bg-black text-[13px] text-white/80">
        <div className="mx-auto flex h-9 max-w-[1400px] items-center justify-end gap-5 px-4 sm:px-6">
          <a href="#faq" className="hidden items-center gap-1.5 hover:text-white sm:inline-flex"><Mail size={14} />Help and contact</a>
          <span className="inline-flex items-center gap-1.5"><Globe2 size={14} />Pakistan · English</span>
          <Link href={signedIn ? "/app" : "/login"} className="inline-flex items-center gap-1.5 font-semibold text-white hover:underline"><UserRound size={14} />{signedIn ? "My account" : "Log in"}</Link>
        </div>
      </div>

      {/* Offer band */}
      <div className="bg-[oklch(0.17_0.06_270)] px-4 py-9 text-center text-white sm:py-11">
        <p className="text-sm font-medium tracking-[0.12em] text-white/85">FREE TRIAL OFFER</p>
        <p className="mt-3 text-3xl font-medium tracking-tight sm:text-5xl">Get <span className="font-bold text-[oklch(0.83_0.16_150)]">every app free</span> for {TRIAL_MONTHS} months</p>
        <Link href={start} className={`mt-6 inline-flex h-14 items-center justify-center rounded-full px-10 text-lg font-semibold transition-colors ${pill}`}>{signedIn ? "Open MIK LEDGER" : "Get started"}</Link>
      </div>

      {/* Header with mega menu */}
      <header className="sticky top-0 z-40 border-b border-black/10 bg-white">
        <div className="mx-auto flex h-[72px] max-w-[1400px] items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="brand-lockup group shrink-0" aria-label="MIK LEDGER home"><BrandWordmark size="compact" /></Link>
          <nav className="ml-4 hidden items-stretch text-[16px] font-medium lg:flex" aria-label="Main">
            <MegaMenu label="Products">
              <div className="grid grid-cols-[1fr_2.2fr] gap-10">
                <div className="rounded-xl bg-[oklch(0.975_0.008_230)] p-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[oklch(0.49_0.105_238)]">MIK LEDGER suite</p>
                  <p className="mt-2 text-2xl font-bold">One ledger, every app</p>
                  <p className="mt-2 text-sm leading-6 text-black/60">Start with one app and add the rest as you grow. Everything posts to the same books.</p>
                  <Link href={start} className={`mt-5 inline-flex h-10 items-center gap-1.5 rounded-full px-5 text-sm font-semibold ${pill}`}>{startLabel} <ArrowRight size={15} /></Link>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {apps.map((app) => (
                    <a key={app.id} href={`#${app.id}`} className="flex gap-3 rounded-lg p-3 hover:bg-black/[0.04]">
                      <app.icon size={22} className="mt-0.5 shrink-0" style={{ color: `oklch(0.49 0.105 238)` }} />
                      <span><span className="block font-semibold">{app.name}</span><span className="mt-0.5 block text-sm font-normal text-black/60">{app.line}</span></span>
                    </a>
                  ))}
                </div>
              </div>
            </MegaMenu>
            <MegaMenu label="Industries">
              <div className="grid grid-cols-4 gap-2">
                {industries.map((item) => (
                  <a key={item.name} href="#industries" className="flex gap-3 rounded-lg p-3 hover:bg-black/[0.04]">
                    <item.icon size={22} className="mt-0.5 shrink-0" style={{ color: `oklch(0.49 0.105 238)` }} />
                    <span><span className="block font-semibold">{item.name}</span><span className="mt-0.5 block text-sm font-normal text-black/60">{item.text}</span></span>
                  </a>
                ))}
              </div>
            </MegaMenu>
            <MegaMenu label="For Accountants">
              <div className="grid grid-cols-3 gap-2">
                {[["Work in your clients' books", "Join each business as its Accountant."], ["Tax returns and withholding", "FBR GST, PST and WHT statements."], ["Reports and closing", "Trial balance, journals and closing the books."]].map(([title, text]) => (
                  <a key={title} href="#accountants" className="rounded-lg p-3 hover:bg-black/[0.04]"><span className="block font-semibold">{title}</span><span className="mt-0.5 block text-sm font-normal text-black/60">{text}</span></a>
                ))}
              </div>
            </MegaMenu>
            <a href="#pricing" className="inline-flex h-[72px] items-center border-b-[3px] border-transparent px-3 hover:border-[oklch(0.49_0.105_238)]">Pricing</a>
            <MegaMenu label="Learn & Support">
              <div className="grid grid-cols-4 gap-2">
                {[["#faq", "Help and questions", "Answers about trial, plans and setup."], ["#pakistan", "Made for Pakistan", "Local tax, payroll and currency."], ["#security", "Security", "Two-step sign-in, private files, backups."], ["/auth/forgot-password", "Forgot password", "Reset it by email."]].map(([href, title, text]) => (
                  <a key={title} href={href} className="rounded-lg p-3 hover:bg-black/[0.04]"><span className="block font-semibold">{title}</span><span className="mt-0.5 block text-sm font-normal text-black/60">{text}</span></a>
                ))}
              </div>
            </MegaMenu>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <a href="#apps" className="hidden size-10 items-center justify-center rounded-full hover:bg-black/5 md:inline-flex" aria-label="Explore the apps"><Search size={19} /></a>
            {signedIn ? (
              <Link href="/app" className={`inline-flex h-10 items-center gap-1.5 rounded-full px-5 text-sm font-semibold ${pill}`}>Open MIK LEDGER <ArrowRight size={16} /></Link>
            ) : (
              <>
                <Link href="/login" className="rounded-md px-3 py-2 text-[16px] font-bold hover:bg-black/5">Log in</Link>
                <Link href="/login?mode=signup" className={`hidden h-10 items-center rounded-full px-5 text-sm font-semibold sm:inline-flex ${pill}`}>Get started</Link>
              </>
            )}
            <details className="relative lg:hidden">
              <summary className="flex size-10 cursor-pointer list-none items-center justify-center rounded-md hover:bg-black/5 [&::-webkit-details-marker]:hidden" aria-label="Menu"><Menu size={22} /></summary>
              <div className="absolute right-0 top-12 max-h-[75dvh] w-72 overflow-y-auto rounded-xl border border-black/10 bg-white p-2 text-[15px] font-medium shadow-xl">
                <p className="px-3 pt-2 text-xs font-semibold uppercase tracking-wider text-black/45">Products</p>
                {apps.map((app) => <a key={app.id} href={`#${app.id}`} className="block rounded-md px-3 py-2 hover:bg-black/5">{app.name}</a>)}
                <div className="my-1 border-t border-black/10" />
                <a href="#industries" className="block rounded-md px-3 py-2 hover:bg-black/5">Industries</a>
                <a href="#accountants" className="block rounded-md px-3 py-2 hover:bg-black/5">For Accountants</a>
                <a href="#pricing" className="block rounded-md px-3 py-2 hover:bg-black/5">Pricing</a>
                <a href="#faq" className="block rounded-md px-3 py-2 hover:bg-black/5">Learn &amp; Support</a>
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
        <section className="relative overflow-hidden bg-gradient-to-br from-[oklch(0.17_0.07_268)] via-[oklch(0.26_0.13_264)] to-[oklch(0.38_0.15_255)] text-white">
          <div className="pointer-events-none absolute -right-40 -top-40 size-[34rem] rounded-full bg-[oklch(0.6_0.15_240)]/25 blur-3xl" />
          <div className="relative mx-auto grid max-w-[1400px] items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:py-24">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/80"><BadgeCheck size={14} className="text-[oklch(0.83_0.16_150)]" />ERP for growing businesses</p>
              <h1 className="mt-6 text-5xl font-bold leading-[0.98] tracking-tight sm:text-7xl lg:text-[88px]">Business<br /><span className="whitespace-nowrap font-semibold">in one ledger</span></h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-white/75">Accounting, inventory, point of sale, CRM and HR with payroll, running on one set of books that keeps itself up to date. Built for Pakistan and ready for the world.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={start} className={`inline-flex h-12 items-center gap-2 rounded-full px-7 text-base font-semibold transition-colors ${pill}`}>{startLabel} <ArrowRight size={18} /></Link>
                <a href="#solutions" className="inline-flex h-12 items-center gap-2 rounded-md border border-white/40 px-6 text-base font-semibold text-white transition-colors hover:bg-white/10">Explore solutions</a>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/70">
                {[`${TRIAL_MONTHS} months free`, "FBR-ready tax", "Works on any phone"].map((point) => <li key={point} className="flex items-center gap-1.5"><Check size={16} className="text-[oklch(0.83_0.16_150)]" />{point}</li>)}
              </ul>
            </div>

            {/* Product picture, drawn rather than photographed */}
            <div className="relative mx-auto w-full max-w-[560px]" aria-hidden="true">
              <div className={`rounded-2xl border border-white/10 bg-white p-5 shadow-2xl ${ink}`}>
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
              <div className={`absolute -left-6 -top-8 hidden w-60 rounded-xl border border-black/5 bg-white p-4 shadow-xl sm:block ${ink}`}>
                <p className="text-xs text-black/55">Sales tax payable to FBR</p>
                <p className="mt-1 text-2xl font-bold tabular-nums">Rs 86,400</p>
                <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-[oklch(0.5_0.12_160)]"><BadgeCheck size={14} />Return ready to file</p>
              </div>
              <div className={`absolute -bottom-8 -right-4 w-64 rounded-xl border border-black/5 bg-white p-4 shadow-xl ${ink}`}>
                <p className="flex items-center gap-1.5 text-xs font-semibold"><Sparkles size={14} className="text-[oklch(0.49_0.105_238)]" />Assistant</p>
                <p className="mt-2 rounded-lg bg-black/[0.04] px-3 py-2 text-xs">Who owes me money?</p>
                <p className="mt-2 text-xs leading-5 text-black/70">3 customers owe <b className="tabular-nums">Rs 1,09,140</b>. Ali Traders is 12 days overdue.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Spotlight */}
        <section className="border-b border-black/10 bg-white">
          <div className="mx-auto grid max-w-[1400px] gap-px bg-black/10 sm:grid-cols-3">
            {spotlight.map((item) => (
              <a key={item.title} href="#solutions" className="group bg-white px-6 py-7 transition-colors hover:bg-[oklch(0.975_0.008_230)]">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[oklch(0.49_0.105_238)]">{item.tag}</span>
                <p className="mt-2 text-lg font-semibold">{item.title}</p>
                <p className="mt-1.5 text-sm leading-6 text-black/60">{item.text}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[oklch(0.49_0.105_238)]">Learn more <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" /></span>
              </a>
            ))}
          </div>
        </section>

        {/* Solutions */}
        <section id="solutions" className="mx-auto max-w-[1400px] scroll-mt-24 px-4 pt-20 sm:px-6">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[oklch(0.49_0.105_238)]">Explore solutions</p>
          <h2 className="mt-2 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">Run every part of the business on one platform</h2>
          <div className="mt-10"><SolutionTabs solutions={solutions} start={start} startLabel={startLabel} /></div>
        </section>

        {/* Apps */}
        <section id="apps" className="bg-[oklch(0.975_0.008_230)] scroll-mt-24">
          <div className="mx-auto max-w-[1400px] px-4 py-20 sm:px-6">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[oklch(0.49_0.105_238)]">Products</p>
            <h2 className="mt-2 max-w-2xl text-4xl font-bold tracking-tight">Every app, talking to the same books</h2>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {apps.map((app) => (
                <article id={app.id} key={app.id} className="scroll-mt-28 rounded-xl border border-black/5 bg-white p-6 shadow-sm transition-shadow hover:shadow-lg">
                  <span className="grid size-11 place-items-center rounded-lg bg-[oklch(0.94_0.035_186)] text-[oklch(0.35_0.08_200)]"><app.icon size={22} /></span>
                  <h3 className="mt-5 text-xl font-semibold">{app.name}</h3>
                  <p className="mt-2 leading-7 text-black/65">{app.text}</p>
                  <Link href={start} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[oklch(0.49_0.105_238)] hover:underline">Try {app.name} <ArrowRight size={14} /></Link>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Industries */}
        <section id="industries" className="mx-auto max-w-[1400px] scroll-mt-24 px-4 py-20 sm:px-6">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[oklch(0.49_0.105_238)]">Industries</p>
          <h2 className="mt-2 max-w-2xl text-4xl font-bold tracking-tight">Made for the way your business works</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {industries.map((item, index) => (
              <div key={item.name} className={`flex min-h-44 flex-col justify-between rounded-xl p-6 text-white ${["bg-[oklch(0.26_0.1_262)]", "bg-[oklch(0.33_0.11_240)]", "bg-[oklch(0.3_0.08_210)]", "bg-[oklch(0.24_0.06_280)]"][index % 4]}`}>
                <item.icon size={28} className="text-[oklch(0.83_0.16_150)]" />
                <div>
                  <p className="text-lg font-semibold">{item.name}</p>
                  <p className="mt-1 text-sm text-white/70">{item.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Facts */}
        <section className="bg-black text-white">
          <div className="mx-auto grid max-w-[1400px] gap-8 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
            {[["6", "apps in one ledger"], ["7", "countries' taxes set up"], [`${TRIAL_MONTHS} months`, "free to start"], ["24/7", "in the browser and on the phone"]].map(([value, label]) => (
              <div key={label}><p className="text-5xl font-bold tracking-tight text-[oklch(0.83_0.16_150)]">{value}</p><p className="mt-2 text-white/70">{label}</p></div>
            ))}
          </div>
        </section>

        {/* Pakistan */}
        <section id="pakistan" className="scroll-mt-24 bg-[oklch(0.205_0.045_251)] text-white">
          <div className="mx-auto grid max-w-[1400px] gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[oklch(0.83_0.16_150)]">Made for Pakistan</p>
              <h2 className="mt-2 text-4xl font-bold tracking-tight">Local tax and payroll, already set up</h2>
              <p className="mt-4 text-lg leading-8 text-white/70">Pick your country once and the right taxes, accounts, payroll rules and time zone are ready. UAE, Saudi Arabia, the UK, the US, Sweden and Denmark are set up too.</p>
              <Link href={start} className={`mt-8 inline-flex h-12 items-center gap-2 rounded-full px-7 font-semibold ${pill}`}>{startLabel} <ArrowRight size={18} /></Link>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {localPoints.map((point) => <li key={point} className="flex gap-3 rounded-xl border border-white/10 bg-white/5 p-4 text-[15px] leading-6"><BadgeCheck size={20} className="mt-0.5 shrink-0 text-[oklch(0.83_0.16_150)]" />{point}</li>)}
            </ul>
          </div>
        </section>

        {/* Accountants */}
        <section id="accountants" className="mx-auto max-w-[1400px] scroll-mt-24 px-4 pt-20 sm:px-6">
          <div className="grid items-center gap-10 rounded-2xl border border-black/10 p-8 sm:p-12 lg:grid-cols-[1.2fr_1fr]">
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
        <section id="pricing" className="mx-auto max-w-[1400px] scroll-mt-24 px-4 py-20 sm:px-6" aria-labelledby="pricing-title">
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
                  <Link href={start} className={`mt-6 inline-flex h-11 items-center justify-center rounded-full text-sm font-semibold transition-colors ${featured ? pill : "border border-black/15 hover:bg-black/5"}`}>{signedIn ? "Open MIK LEDGER" : "Start free"}</Link>
                </article>
              );
            })}
          </div>
        </section>

        {/* Security */}
        <section id="security" className="scroll-mt-24 bg-[oklch(0.975_0.008_230)]">
          <div className="mx-auto max-w-[1400px] px-4 py-20 sm:px-6">
            <h2 className="max-w-2xl text-3xl font-bold tracking-tight">Your books stay yours, and stay safe</h2>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {([
                [KeyRound, "Two-step sign-in", "An authenticator code on top of the password, with backup codes."],
                [Lock, "Private documents", "CVs, ID cards and payslips are stored privately, opened only by your team."],
                [Users, "Roles for everyone", "Admin, accountant, sales and HR each see only their part."],
                [Cloud, "Backups you own", "Download your whole business to Excel any time."],
              ] as const).map(([Icon, title, text]) => (
                <div key={title} className="rounded-xl bg-white p-6 shadow-sm">
                  <Icon size={22} className="text-[oklch(0.49_0.105_238)]" />
                  <h3 className="mt-4 font-semibold">{title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-black/60">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="mx-auto max-w-3xl scroll-mt-24 px-4 py-20 sm:px-6">
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
          <div className="mx-auto max-w-[1400px] overflow-hidden rounded-2xl bg-gradient-to-r from-[oklch(0.2_0.08_268)] to-[oklch(0.38_0.15_255)] px-6 py-14 text-center text-white sm:px-12">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Put your business in one ledger today</h2>
            <p className="mx-auto mt-3 max-w-xl text-white/70">{TRIAL_MONTHS} months free, every app included. Set up in minutes.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href={start} className={`inline-flex h-12 items-center gap-2 rounded-full px-7 font-semibold ${pill}`}>{startLabel} <ArrowRight size={18} /></Link>
              {signedIn ? null : <Link href="/login" className="inline-flex h-12 items-center rounded-md border border-white/40 px-6 font-semibold hover:bg-white/10">Log in</Link>}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-[oklch(0.15_0.02_260)] text-white/70">
        <div className="mx-auto grid max-w-[1400px] gap-10 px-4 py-16 sm:grid-cols-2 sm:px-6 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <Link href="/" className="brand-lockup group inline-flex" aria-label="MIK LEDGER home"><BrandWordmark size="compact" /></Link>
            <p className="mt-4 max-w-xs text-sm leading-6">Accounting, inventory, point of sale, CRM and HR for growing businesses.</p>
            <Link href={start} className={`mt-5 inline-flex h-10 items-center gap-1.5 rounded-full px-5 text-sm font-semibold ${pill}`}>{startLabel} <ArrowRight size={15} /></Link>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Products</p>
            <ul className="mt-4 space-y-2.5 text-sm">{apps.map((app) => <li key={app.id}><a href={`#${app.id}`} className="hover:text-white">{app.name}</a></li>)}</ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Industries</p>
            <ul className="mt-4 space-y-2.5 text-sm">{industries.slice(0, 6).map((item) => <li key={item.name}><a href="#industries" className="hover:text-white">{item.name}</a></li>)}</ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Learn &amp; Support</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li><a href="#faq" className="hover:text-white">Help and questions</a></li>
              <li><a href="#pakistan" className="hover:text-white">Made for Pakistan</a></li>
              <li><a href="#security" className="hover:text-white">Security</a></li>
              <li><a href="#accountants" className="hover:text-white">For accountants</a></li>
              <li><a href="#pricing" className="hover:text-white">Pricing</a></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Account</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {signedIn ? <li><Link href="/app" className="hover:text-white">Open MIK LEDGER</Link></li> : (
                <>
                  <li><Link href="/login" className="hover:text-white">Log in</Link></li>
                  <li><Link href="/login?mode=signup" className="hover:text-white">Create an account</Link></li>
                </>
              )}
              <li><Link href="/auth/forgot-password" className="hover:text-white">Forgot password</Link></li>
                          </ul>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-white/50 sm:px-6">
            <p>© {year} MIK LEDGER. All rights reserved.</p>
            <p className="flex flex-wrap items-center gap-4"><span className="flex items-center gap-1.5"><Globe2 size={14} />Pakistan · English</span><span>Prices in US dollars</span></p>
          </div>
        </div>
      </footer>
    </div>
  );
}
