import Link from "next/link";
import {
  Banknote, BriefcaseBusiness, CalendarDays, CalendarCheck, Clock, FileBadge, HandCoins, ListChecks, LogOut, Network, PartyPopper, ReceiptText, Star, Users,
} from "lucide-react";

import type { CrmStore } from "@/components/crm/crm-shared";

interface App {
  label: string;
  href: string;
  icon: typeof Users;
  colour: string;
  /** Things waiting on HR, shown as a badge like Odoo's activity counter. */
  waiting?: number;
}

/** HRM home in Odoo's style: the apps menu, one tile per HR app. */
export default function HrHome({ store }: { store: CrmStore; currency?: string; asOfDate?: string }) {
  const count = (kind: string, test: (data: Record<string, string>) => boolean) => (store[kind] ?? []).filter((record) => test(record.data)).length;
  const apps: App[] = [
    { label: "Employees", href: "/app/employees", icon: Users, colour: "#714B67" },
    { label: "Departments", href: "/app/hr/departments", icon: Network, colour: "#5B899E" },
    { label: "Attendances", href: "/app/hr/check-in", icon: Clock, colour: "#017E84" },
    { label: "Time Off", href: "/app/hr/my-time-off", icon: CalendarDays, colour: "#21B799", waiting: count("hr-leaves", (data) => data.status === "To Approve") + count("hr-allocations", (data) => data.status === "To Approve") },
    { label: "Recruitment", href: "/app/hr/job-positions", icon: BriefcaseBusiness, colour: "#E46F78", waiting: count("hr-candidates", (data) => (data.stage || "New") === "New") },
    { label: "Appraisals", href: "/app/hr/appraisals", icon: Star, colour: "#E4A900", waiting: count("hr-appraisals", (data) => data.status === "To Confirm") },
    { label: "Expenses", href: "/app/hr/expenses", icon: ReceiptText, colour: "#8F5FD8", waiting: count("hr-claims", (data) => data.status === "Submitted") },
    { label: "Payroll", href: "/app/payroll", icon: Banknote, colour: "#1F7A4D" },
    { label: "Salary Attachments", href: "/app/hr/salary-attachments", icon: HandCoins, colour: "#B5651D", waiting: count("hr-loans", (data) => data.status === "To Approve") },
    { label: "Onboarding", href: "/app/hr/onboarding", icon: ListChecks, colour: "#3C6FB4", waiting: count("hr-onboarding", (data) => data.status === "To Do") },
    { label: "Departures", href: "/app/hr/departures", icon: LogOut, colour: "#9A4A4A" },
    { label: "Documents", href: "/app/hr/documents", icon: FileBadge, colour: "#4F6D7A" },
    { label: "Allocations", href: "/app/hr/allocations", icon: CalendarCheck, colour: "#2E8B7A" },
    { label: "Public Holidays", href: "/app/hr/public-holidays", icon: PartyPopper, colour: "#C2577A" },
  ];

  return (
    <div className="min-h-full bg-gradient-to-b from-[#714B67]/10 via-background to-background">
      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:py-14">
        <h1 className="sr-only">HRM apps</h1>
        <ul className="grid grid-cols-3 gap-x-4 gap-y-8 sm:grid-cols-4 md:grid-cols-5">
          {apps.map((app) => (
            <li key={app.label}>
              <Link href={app.href} className="group flex flex-col items-center gap-2 rounded-lg p-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <span className="relative grid size-16 place-items-center rounded-xl text-white shadow-sm transition group-hover:-translate-y-0.5 group-hover:shadow-md sm:size-[72px]" style={{ background: app.colour }}>
                  <app.icon size={30} strokeWidth={1.75} aria-hidden />
                  {app.waiting ? <span className="absolute -top-1.5 -right-1.5 min-w-5 rounded-full bg-[#E46F78] px-1.5 text-xs font-semibold leading-5 text-white ring-2 ring-background" aria-label={`${app.waiting} waiting`}>{app.waiting}</span> : null}
                </span>
                <span className="text-sm font-medium text-foreground">{app.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
