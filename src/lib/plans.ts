/**
 * Subscription plans. Prices are in US dollars; yearly is ten months' price
 * (two months free). Change them here: Stripe Checkout charges whatever this
 * file says, so no prices need setting up in Stripe.
 */

export type Feature = "accounting" | "inventory" | "crm" | "hr";
export type PlanKey = "starter" | "business" | "enterprise";
export type BillingInterval = "month" | "year";

export interface Plan {
  key: PlanKey;
  name: string;
  description: string;
  monthly: number;
  yearly: number;
  /** People who can sign in, the owner included. */
  users: number;
  features: Feature[];
  highlights: string[];
}

export const TRIAL_DAYS = 14;
export const BILLING_CURRENCY = "usd";

export const plans: Plan[] = [
  {
    key: "starter",
    name: "Starter",
    description: "Bookkeeping for one person running the business.",
    monthly: 9,
    yearly: 90,
    users: 1,
    features: ["accounting"],
    highlights: ["Sales, purchases and banking", "Chart of accounts and journals", "Tax returns and all accounting reports", "1 user"],
  },
  {
    key: "business",
    name: "Business",
    description: "For a growing team that sells products.",
    monthly: 29,
    yearly: 290,
    users: 5,
    features: ["accounting", "inventory", "crm"],
    highlights: ["Everything in Starter", "Inventory, warehouses, lots and serial numbers", "CRM: leads, deals, campaigns and cases", "Up to 5 users"],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    description: "The whole ERP, with HR and payroll.",
    monthly: 79,
    yearly: 790,
    users: Number.POSITIVE_INFINITY,
    features: ["accounting", "inventory", "crm", "hr"],
    highlights: ["Everything in Business", "HRM: employees, time off, attendance, recruitment", "Payroll with salary slips", "Unlimited users"],
  },
];

export const planByKey = (key: string | undefined) => plans.find((plan) => plan.key === key);

export const featureLabels: Record<Feature, string> = { accounting: "Accounting", inventory: "Inventory", crm: "CRM", hr: "HR and payroll" };

/** The cheapest plan that includes a feature, for "upgrade to …" messages. */
export const planFor = (feature: Feature) => plans.find((plan) => plan.features.includes(feature)) ?? plans[plans.length - 1];

/** Which part of the product a kind of record belongs to. */
export function featureForKind(kind: string): Feature {
  if (kind.startsWith("crm-")) return "crm";
  if (kind.startsWith("hr-") || kind === "employees" || kind === "payroll") return "hr";
  if (["inventory-movements", "warehouses", "stock-transfers"].includes(kind)) return "inventory";
  return "accounting";
}

/** Whole days left until a date (none once it has passed). */
export function daysUntil(iso: string | undefined) {
  return iso ? Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000)) : 0;
}

export const planPrice = (plan: Plan, interval: BillingInterval) => (interval === "year" ? plan.yearly : plan.monthly);
