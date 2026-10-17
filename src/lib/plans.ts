/**
 * Subscription plans, in US dollars. Each app can be bought on its own, or
 * several together; the bundles cost less than their apps. Yearly is ten and a
 * half months' price (a month and a half free). Change prices here: Stripe
 * Checkout charges whatever this file says, so no prices need setting up in Stripe.
 */

export type Feature = "accounting" | "inventory" | "crm" | "hr";
export type PlanKey = "free" | "starter" | "crm" | "hrm" | "business" | "enterprise";
export type BillingInterval = "month" | "year";

export interface Plan {
  key: PlanKey;
  name: string;
  /** An app is one part of the product; a bundle is several at a lower price. */
  type: "free" | "app" | "bundle";
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

const yearly = (monthly: number) => monthly * 10.5;

export const plans: Plan[] = [
  {
    key: "free",
    name: "Free",
    type: "free",
    description: "Accounting for one person, free for ever.",
    monthly: 0,
    yearly: 0,
    users: 1,
    features: ["accounting"],
    highlights: ["Sales, purchases and banking", "Chart of accounts and journals", "Tax returns and all accounting reports", "1 user (the owner)"],
  },
  {
    // The key stays "starter" so subscriptions bought before the apps keep working.
    key: "starter",
    name: "Accounting app",
    type: "app",
    description: "Bookkeeping for your business.",
    monthly: 9,
    yearly: yearly(9),
    users: 3,
    features: ["accounting"],
    highlights: ["Sales, purchases and banking", "Chart of accounts, journals and budgets", "Tax returns and all accounting reports", "Up to 3 users"],
  },
  {
    key: "crm",
    name: "CRM app",
    type: "app",
    description: "Win and keep customers.",
    monthly: 12,
    yearly: yearly(12),
    users: 5,
    features: ["crm"],
    highlights: ["Leads, contacts, accounts and deals", "Quotes from deals", "Campaigns, cases and workflow rules", "Up to 5 users"],
  },
  {
    key: "hrm",
    name: "HRM app",
    type: "app",
    description: "Your people, time and pay.",
    monthly: 15,
    yearly: yearly(15),
    users: 10,
    features: ["hr"],
    highlights: ["Employees, contracts and documents", "Attendance, time off and recruitment", "Payroll with salary slips", "Up to 10 users"],
  },
  {
    key: "business",
    name: "Business bundle",
    type: "bundle",
    description: "Accounting, inventory and CRM together.",
    monthly: 29,
    yearly: yearly(29),
    users: 6,
    features: ["accounting", "inventory", "crm"],
    highlights: ["Accounting app and CRM app", "Inventory, warehouses, lots and serial numbers", "Quotes and invoices from deals", "Up to 6 users"],
  },
  {
    key: "enterprise",
    name: "Enterprise bundle",
    type: "bundle",
    description: "The whole ERP, with HR and payroll.",
    monthly: 79,
    yearly: yearly(79),
    users: Number.POSITIVE_INFINITY,
    features: ["accounting", "inventory", "crm", "hr"],
    highlights: ["Everything in Business", "HRM app: people, time off and payroll", "Every app added later", "Unlimited users"],
  },
];

export const planByKey = (key: string | undefined) => plans.find((plan) => plan.key === key);

export const featureLabels: Record<Feature, string> = { accounting: "Accounting", inventory: "Inventory", crm: "CRM", hr: "HR and payroll" };

/** The cheapest paid plan that includes a feature, for "upgrade to …" messages. */
export const planFor = (feature: Feature) => plans.find((plan) => plan.monthly > 0 && plan.features.includes(feature)) ?? plans[plans.length - 1];

/** Plans that are paid for through Stripe. */
export const paidPlans = plans.filter((plan) => plan.monthly > 0);

/** The plan keys saved on a subscription: one or more apps, or a bundle with any apps it doesn't include. */
export function planKeysOf(data: Record<string, string>): PlanKey[] {
  const keys = (data.plans || data.plan || "").split(",").map((key) => key.trim()).filter((key): key is PlanKey => Boolean(planByKey(key)));
  return keys.length ? keys : ["enterprise"];
}

/**
 * Tidies a choice of plans: the Free plan isn't bought, a bundle replaces the
 * apps it already includes, and Enterprise includes everything.
 */
export function normalizePlans(keys: string[]): PlanKey[] {
  const chosen = [...new Set(keys)].map((key) => planByKey(key)).filter((plan): plan is Plan => Boolean(plan && plan.monthly > 0));
  if (chosen.some((plan) => plan.key === "enterprise")) return ["enterprise"];
  const bundle = chosen.find((plan) => plan.type === "bundle");
  return chosen.filter((plan) => !bundle || plan === bundle || !plan.features.every((feature) => bundle.features.includes(feature))).map((plan) => plan.key);
}

/** What several plans give together: every feature, and the largest number of users. */
export function combinePlans(keys: PlanKey[]) {
  const chosen = keys.map((key) => planByKey(key)).filter((plan): plan is Plan => Boolean(plan));
  return {
    features: [...new Set(chosen.flatMap((plan) => plan.features))],
    users: chosen.reduce((max, plan) => Math.max(max, plan.users), 0),
    name: chosen.map((plan) => plan.name).join(" + "),
  };
}

/**
 * The features that let someone change a kind of record; any one is enough.
 * Customers, items and quotes are shared by the Accounting and CRM apps.
 */
export function featuresForKind(kind: string): Feature[] {
  if (["customers", "items", "estimates"].includes(kind)) return ["accounting", "crm"];
  if (kind.startsWith("crm-")) return ["crm"];
  if (kind.startsWith("hr-") || kind === "employees" || kind === "payroll") return ["hr"];
  if (["inventory-movements", "warehouses", "stock-transfers"].includes(kind)) return ["inventory"];
  return ["accounting"];
}

/** Whole days left until a date (none once it has passed). */
export function daysUntil(iso: string | undefined) {
  return iso ? Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000)) : 0;
}

/** A price as shown: whole dollars without cents, otherwise two decimals. */
export const formatPlanPrice = (amount: number) => (Number.isInteger(amount) ? String(amount) : amount.toFixed(2));

export const planPrice = (plan: Plan, interval: BillingInterval) => (interval === "year" ? plan.yearly : plan.monthly);
