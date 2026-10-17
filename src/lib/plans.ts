/**
 * Subscription plans. Prices are in US dollars; yearly is ten and a half months'
 * price (a month and a half free). Change them here: Stripe Checkout charges whatever this
 * file says, so no prices need setting up in Stripe.
 */

export type Feature = "accounting" | "inventory" | "crm" | "hr";
export type PlanKey = "free" | "starter" | "business" | "enterprise";
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

/** Every new business gets six months of everything free before choosing a plan. */
export const TRIAL_MONTHS = 6;
export const BILLING_CURRENCY = "usd";

export const plans: Plan[] = [
  {
    key: "free",
    name: "Free",
    description: "Accounting for one person, free for ever.",
    monthly: 0,
    yearly: 0,
    users: 1,
    features: ["accounting"],
    highlights: ["Sales, purchases and banking", "Chart of accounts and journals", "Tax returns and all accounting reports", "1 user (the owner)"],
  },
  {
    key: "starter",
    name: "Starter",
    description: "Bookkeeping for a small business.",
    monthly: 9,
    yearly: 94.5,
    users: 3,
    features: ["accounting"],
    highlights: ["Sales, purchases and banking", "Chart of accounts and journals", "Tax returns and all accounting reports", "Up to 3 users"],
  },
  {
    key: "business",
    name: "Business",
    description: "For a growing team that sells products.",
    monthly: 29,
    yearly: 304.5,
    users: 6,
    features: ["accounting", "inventory", "crm"],
    highlights: ["Everything in Starter", "Inventory, warehouses, lots and serial numbers", "CRM: leads, deals, campaigns and cases", "Up to 6 users"],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    description: "The whole ERP, with HR and payroll.",
    monthly: 79,
    yearly: 829.5,
    users: Number.POSITIVE_INFINITY,
    features: ["accounting", "inventory", "crm", "hr"],
    highlights: ["Everything in Business", "HRM: employees, time off, attendance, recruitment", "Payroll with salary slips", "Unlimited users"],
  },
];

export const planByKey = (key: string | undefined) => plans.find((plan) => plan.key === key);

export const featureLabels: Record<Feature, string> = { accounting: "Accounting", inventory: "Inventory", crm: "CRM", hr: "HR and payroll" };

/** The cheapest paid plan that includes a feature, for "upgrade to …" messages. */
export const planFor = (feature: Feature) => plans.find((plan) => plan.monthly > 0 && plan.features.includes(feature)) ?? plans[plans.length - 1];

/** Plans that are paid for through Stripe. */
export const paidPlans = plans.filter((plan) => plan.monthly > 0);

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

/** A price as shown: whole dollars without cents, otherwise two decimals. */
export const formatPlanPrice = (amount: number) => (Number.isInteger(amount) ? String(amount) : amount.toFixed(2));

export const planPrice = (plan: Plan, interval: BillingInterval) => (interval === "year" ? plan.yearly : plan.monthly);
