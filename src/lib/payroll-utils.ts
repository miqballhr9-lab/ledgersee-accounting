export interface PayrollValues {
  /** Payroll reference, shared by a month's salary sheet (e.g. SAL-2026-10), used to find it later. */
  reference: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  cnic: string;
  designation: string;
  joiningDate: string;
  month: string;
  paymentAccountId: string;
  paymentAccountName: string;
  paymentMethod: string;
  baseSalary: string;
  increment: string;
  workingDays: string;
  workedDays: string;
  incentive: string;
  overtimeAllowance: string;
  gymAllowance: string;
  medicalAllowance: string;
  otherAllowance: string;
  taxDeduction: string;
  advanceDeduction: string;
  loanDeduction: string;
  fineDeduction: string;
  /** EOBI, provident fund or other social security withheld from pay. */
  socialDeduction: string;
  adjustment: string;
  /** Approved expense claims paid back with this salary; added to take-home pay, not to gross. */
  reimbursement: string;
  /** The ids of those claims, comma separated. */
  reimbursedClaims: string;
  description: string;
}

export interface PayrollTotals {
  revisedSalary: number;
  proratedSalary: number;
  grossSalary: number;
  estimatedTax: number;
  taxDeduction: number;
  totalDeductions: number;
  payableSalary: number;
}

export const payrollCsvFields = [
  "reference", "employeeId", "employeeName", "employeeEmail", "cnic", "designation", "joiningDate", "month", "paymentAccountName", "paymentMethod", "baseSalary", "increment",
  "workingDays", "workedDays", "incentive", "overtimeAllowance", "gymAllowance", "medicalAllowance", "otherAllowance",
  "taxDeduction", "advanceDeduction", "loanDeduction", "fineDeduction", "socialDeduction", "adjustment", "description",
] as const satisfies readonly (keyof PayrollValues)[];

const pakistanSalarySlabs = [
  { limit: 600_000, base: 0, rate: 0 },
  { limit: 1_200_000, base: 0, rate: 0.01 },
  { limit: 2_200_000, base: 6_000, rate: 0.11 },
  { limit: 3_200_000, base: 116_000, rate: 0.2 },
  { limit: 4_100_000, base: 316_000, rate: 0.25 },
  { limit: 5_600_000, base: 541_000, rate: 0.29 },
  { limit: 7_000_000, base: 976_000, rate: 0.32 },
  { limit: Number.POSITIVE_INFINITY, base: 1_424_000, rate: 0.35 },
] as const;

export function pakistanAnnualSalaryTax(annualTaxableSalary: number): number {
  const annualSalary = Math.max(0, annualTaxableSalary);
  let lowerLimit = 0;

  for (const slab of pakistanSalarySlabs) {
    if (annualSalary <= slab.limit) {
      return Math.round((slab.base + Math.max(0, annualSalary - lowerLimit) * slab.rate) * 100) / 100;
    }
    lowerLimit = slab.limit;
  }

  return 0;
}

/** Which salary income tax payroll works out when the tax box is left empty. Set by Tax setup's country. */
export type SalaryTaxRule = "pakistan-slabs" | "uk-paye" | "sweden-estimate" | "denmark-estimate" | "none";

/**
 * UK income tax for 2025/26 (England, Wales and Northern Ireland), as a yearly
 * estimate: personal allowance £12,570 (tapered away above £100,000), 20% basic
 * rate to £50,270, 40% higher rate to £125,140 and 45% above. Tax codes and
 * Scottish rates aren't applied.
 */
export function ukAnnualIncomeTax(annualIncome: number): number {
  const income = Math.max(0, annualIncome);
  const allowance = Math.max(0, 12_570 - Math.max(0, income - 100_000) / 2);
  const taxable = Math.max(0, income - allowance);
  const basic = Math.min(taxable, 37_700);
  const higher = Math.min(Math.max(0, taxable - 37_700), Math.max(0, 125_140 - allowance - 37_700));
  const additional = Math.max(0, taxable - basic - higher);
  return Math.round((basic * 0.2 + higher * 0.4 + additional * 0.45) * 100) / 100;
}

/** Sweden's price base amount (prisbasbelopp) for 2026, which the deductions are set in. */
const SE_PBB = 59_200;

/**
 * Swedish preliminary tax on salary for 2026, as a yearly estimate for someone
 * under 66: the basic deduction (grundavdrag), municipal tax at the national
 * average of 32.38%, state tax of 20% over 643,000 kr, less the job tax credit
 * (jobbskatteavdrag, approximated to reach its 2026 maximum at 8.08 price base
 * amounts). The employee's own municipality and Skatteverket's tax table give
 * the exact figure.
 */
export function swedenAnnualIncomeTax(annualIncome: number): number {
  const income = Math.max(0, annualIncome);
  const p = SE_PBB;
  const basic = income <= 0.99 * p ? 0.423 * p
    : income <= 2.72 * p ? 0.423 * p + 0.2 * (income - 0.99 * p)
      : income <= 3.11 * p ? 0.77 * p
        : income <= 7.88 * p ? 0.77 * p - 0.1 * (income - 3.11 * p)
          : 0.293 * p;
  const deduction = Math.min(income, Math.ceil(basic / 100) * 100);
  const taxable = Math.max(0, income - deduction);
  const municipalRate = 0.3238;
  const municipal = taxable * municipalRate;
  const state = Math.max(0, taxable - 643_000) * 0.2;
  const workBase = income <= 0.91 * p ? income : 0.91 * p + 0.3006 * (Math.min(income, 8.08 * p) - 0.91 * p);
  const jobCredit = Math.min(municipal, Math.max(0, (workBase - deduction) * municipalRate));
  return Math.round((municipal + state - jobCredit) * 100) / 100;
}

/**
 * Danish tax on salary for 2026, as a yearly estimate: AM-bidrag 8%, then
 * municipal tax at about the national average of 25% and bottom tax of 12.01%
 * after the 54,100 kr personal allowance, with the employment and job
 * deductions lowering the municipal tax, and middle, top and top-top tax above
 * their thresholds. The employee's tax card (skattekort) gives the exact rate.
 */
export function denmarkAnnualIncomeTax(annualIncome: number): number {
  const gross = Math.max(0, annualIncome);
  const labourContribution = gross * 0.08;
  const personal = gross - labourContribution;
  const allowance = 54_100;
  const employmentDeduction = Math.min(gross * 0.1275, 63_300);
  const jobDeduction = Math.min(Math.max(0, gross - 235_200) * 0.045, 3_100);
  const municipal = Math.max(0, personal - employmentDeduction - jobDeduction - allowance) * 0.25;
  const bottom = Math.max(0, personal - allowance) * 0.1201;
  const middle = Math.max(0, personal - 641_200) * 0.075;
  const top = Math.max(0, personal - 777_900) * 0.075;
  const topTop = Math.max(0, personal - 2_592_700) * 0.05;
  return Math.round((labourContribution + municipal + bottom + middle + top + topTop) * 100) / 100;
}

export function annualSalaryTax(rule: SalaryTaxRule, annualIncome: number) {
  if (rule === "uk-paye") return ukAnnualIncomeTax(annualIncome);
  if (rule === "sweden-estimate") return swedenAnnualIncomeTax(annualIncome);
  if (rule === "denmark-estimate") return denmarkAnnualIncomeTax(annualIncome);
  if (rule === "none") return 0;
  return pakistanAnnualSalaryTax(annualIncome);
}

function amount(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function calculatePayroll(values: Pick<PayrollValues,
  "baseSalary" | "increment" | "workingDays" | "workedDays" | "incentive" | "overtimeAllowance" | "gymAllowance" | "medicalAllowance" | "otherAllowance" | "taxDeduction" | "advanceDeduction" | "loanDeduction" | "fineDeduction" | "adjustment"
> & Partial<Pick<PayrollValues, "socialDeduction" | "reimbursement">>, taxRule: SalaryTaxRule = "pakistan-slabs"): PayrollTotals {
  const revisedSalary = amount(values.baseSalary) + amount(values.increment);
  const workingDays = amount(values.workingDays);
  const workedDays = amount(values.workedDays);
  const proratedSalary = workingDays > 0 ? revisedSalary * Math.min(workedDays, workingDays) / workingDays : 0;
  const grossSalary = proratedSalary + amount(values.incentive) + amount(values.overtimeAllowance) + amount(values.gymAllowance) + amount(values.medicalAllowance) + amount(values.otherAllowance);
  const estimatedTax = annualSalaryTax(taxRule, grossSalary * 12) / 12;
  const enteredTax = values.taxDeduction.trim() ? Math.max(0, amount(values.taxDeduction)) : estimatedTax;
  const taxDeduction = Math.round(enteredTax * 100) / 100;
  const totalDeductions = taxDeduction + amount(values.advanceDeduction) + amount(values.loanDeduction) + amount(values.fineDeduction) + amount(values.socialDeduction ?? "0");
  const payableSalary = grossSalary - totalDeductions + amount(values.adjustment) + amount(values.reimbursement ?? "0");

  return {
    revisedSalary: Math.round(revisedSalary * 100) / 100,
    proratedSalary: Math.round(proratedSalary * 100) / 100,
    grossSalary: Math.round(grossSalary * 100) / 100,
    estimatedTax: Math.round(estimatedTax * 100) / 100,
    taxDeduction,
    totalDeductions: Math.round(totalDeductions * 100) / 100,
    payableSalary: Math.round(payableSalary * 100) / 100,
  };
}

export function emptyPayrollValues(month: string): PayrollValues {
  return {
    reference: "",
    employeeId: "",
    employeeName: "",
    employeeEmail: "",
    cnic: "",
    designation: "",
    joiningDate: "",
    month,
    paymentAccountId: "",
    paymentAccountName: "",
    paymentMethod: "",
    baseSalary: "0",
    increment: "0",
    workingDays: "26",
    workedDays: "26",
    incentive: "0",
    overtimeAllowance: "0",
    gymAllowance: "0",
    medicalAllowance: "0",
    otherAllowance: "0",
    taxDeduction: "",
    advanceDeduction: "0",
    loanDeduction: "0",
    fineDeduction: "0",
    socialDeduction: "0",
    adjustment: "0",
    reimbursement: "0",
    reimbursedClaims: "",
    description: "",
  };
}

/** What the employer pays on top of a salary: a share of gross pay plus a fixed monthly amount (the country's payroll rules). */
export interface EmployerContribution {
  rate: number;
  monthly: number;
}

export function serializePayroll(values: PayrollValues, taxRule: SalaryTaxRule = "pakistan-slabs", employer?: EmployerContribution): Record<string, string> {
  const totals = calculatePayroll(values, taxRule);
  const employerCost = employer && totals.grossSalary > 0 ? totals.grossSalary * employer.rate / 100 + employer.monthly : 0;
  return {
    ...values,
    ...(employerCost > 0 ? { employerContribution: employerCost.toFixed(2) } : {}),
    afterIncrement: totals.revisedSalary.toFixed(2),
    proratedSalary: totals.proratedSalary.toFixed(2),
    grossSalary: totals.grossSalary.toFixed(2),
    estimatedTax: totals.estimatedTax.toFixed(2),
    taxDeduction: totals.taxDeduction.toFixed(2),
    totalDeductions: totals.totalDeductions.toFixed(2),
    payableSalary: totals.payableSalary.toFixed(2),
  };
}
