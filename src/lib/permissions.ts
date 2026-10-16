/**
 * Who may see and change what, by role.
 *
 * A business owner can invite people into their workspace. Each member has one
 * role; the role decides which areas of the app they can open (read) and change
 * (write). The server enforces this on every query and save; the browser only
 * uses it to hide what a person can't open anyway.
 */

export const roles = ["Admin", "Accountant", "Sales", "HR manager", "Employee", "Viewer"] as const;
export type Role = (typeof roles)[number];

export function isRole(value: unknown): value is Role {
  return roles.includes(value as Role);
}

export type Area = "dashboard" | "sales" | "purchases" | "inventory" | "accounting" | "payroll" | "budgets" | "crm" | "hr" | "self" | "admin";
type Access = "read" | "write";

const allAreas: Area[] = ["dashboard", "sales", "purchases", "inventory", "accounting", "payroll", "budgets", "crm", "hr", "self", "admin"];

const matrix: Record<Role, Partial<Record<Area, Access>>> = {
  Admin: Object.fromEntries(allAreas.map((area) => [area, "write"])),
  Accountant: { dashboard: "write", sales: "write", purchases: "write", inventory: "write", accounting: "write", payroll: "write", budgets: "write", crm: "read", hr: "read", self: "write" },
  Sales: { sales: "write", inventory: "read", crm: "write", self: "write" },
  "HR manager": { payroll: "write", hr: "write", self: "write" },
  Employee: { self: "write" },
  Viewer: { dashboard: "read", sales: "read", purchases: "read", inventory: "read", accounting: "read", budgets: "read", crm: "read", self: "read" },
};

export const roleDescriptions: Record<Role, string> = {
  Admin: "Everything, including users, settings and automation.",
  Accountant: "Sales, purchases, inventory, banking, journals, reports, payroll and budgets. Can view CRM and HR.",
  Sales: "CRM (leads, deals, activities) and sales: customers, quotes, orders and invoices.",
  "HR manager": "Employees, payroll and HR: attendance, leave, loans and recruitment.",
  Employee: "Their own HR self-service only: profile, payslips, leave and attendance.",
  Viewer: "Can look at the books, sales and CRM but can't change anything. No payroll or HR.",
};

export function canAccess(role: Role, area: Area, access: Access = "read") {
  const granted = matrix[role][area];
  if (!granted) return false;
  return access === "read" || granted === "write";
}

/** The area each record kind belongs to. Kinds not listed are Admin-only. */
export function areaForKind(kind: string): Area | "settings" {
  if (kind === "settings") return "settings";
  if (kind.startsWith("crm-")) return "crm";
  if (kind.startsWith("hr-")) return "hr";
  const map: Record<string, Area> = {
    customers: "sales", items: "sales", invoices: "sales", estimates: "sales", "sales-orders": "sales", "credit-notes": "sales", "recurring-invoices": "sales", payments: "sales",
    vendors: "purchases", bills: "purchases", expenses: "purchases", "purchase-orders": "purchases", "supplier-credits": "purchases",
    "inventory-movements": "inventory",
    "bank-accounts": "accounting", transactions: "accounting", "bank-rules": "accounting", accounts: "accounting", journals: "accounting", taxes: "accounting", reconciliations: "accounting", "recurring-transactions": "accounting", "custom-reports": "accounting",
    budgets: "budgets",
    payroll: "payroll", employees: "payroll",
  };
  return map[kind] ?? "admin";
}

/** Records other areas need to read to work, e.g. CRM accounts are customers. */
const borrowedReads: Partial<Record<Area, string[]>> = {
  crm: ["customers", "estimates", "invoices", "items", "team-members"],
  payroll: ["accounts", "team-members"],
  hr: ["employees", "payroll", "team-members", "accounts"],
  inventory: ["items"],
  budgets: ["invoices", "bills", "expenses", "payroll", "accounts"],
  sales: ["accounts", "taxes"],
  purchases: ["accounts", "items", "taxes"],
  accounting: ["customers", "vendors", "employees", "payroll", "invoices", "bills", "expenses", "hr-loans", "hr-claims", "hr-settlements"],
};

export function canReadKind(role: Role, kind: string) {
  const area = areaForKind(kind);
  if (area === "settings") return true;
  if (canAccess(role, area, "read")) return true;
  return Object.entries(borrowedReads).some(([from, kinds]) => kinds?.includes(kind) && canAccess(role, from as Area, "read"));
}

export function canWriteKind(role: Role, kind: string) {
  const area = areaForKind(kind);
  return canAccess(role, area === "settings" ? "admin" : area, "write");
}

/** The area a page under /app belongs to, from its path after /app/. */
export function areaForPage(path: string): Area | null {
  const slug = path.split(/[?#]/)[0].replace(/^\/?app\/?/, "").split("/")[0] ?? "";
  if (!slug) return "dashboard";
  if (slug === "profile") return null;
  if (slug === "crm") return "crm";
  if (slug === "hr" || slug === "my") return slug === "my" ? "self" : "hr";
  if (slug === "invoices" || slug === "documents" || slug === "sales") return "sales";
  if (slug === "recurring" || slug === "reconciliation" || slug === "reports" || slug === "tax-setup" || slug === "tax-returns") return "accounting";
  if (slug === "inventory") return "inventory";
  if (slug === "automation") return "admin";
  const area = areaForKind(slug);
  return area === "settings" ? "admin" : area;
}

/** Where a role lands when it opens the app. */
export function homeFor(role: Role) {
  if (canAccess(role, "dashboard")) return "/app";
  if (canAccess(role, "crm")) return "/app/crm";
  if (canAccess(role, "hr")) return "/app/hr";
  if (canAccess(role, "payroll")) return "/app/payroll";
  return "/app/my";
}
