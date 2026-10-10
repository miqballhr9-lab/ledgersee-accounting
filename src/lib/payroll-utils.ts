export interface PayrollValues {
  employeeId: string;
  employeeName: string;
  cnic: string;
  designation: string;
  month: string;
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
  adjustment: string;
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

function amount(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function calculatePayroll(values: Pick<PayrollValues,
  "baseSalary" | "increment" | "workingDays" | "workedDays" | "incentive" | "overtimeAllowance" | "gymAllowance" | "medicalAllowance" | "otherAllowance" | "taxDeduction" | "advanceDeduction" | "loanDeduction" | "fineDeduction" | "adjustment"
>): PayrollTotals {
  const revisedSalary = amount(values.baseSalary) + amount(values.increment);
  const workingDays = amount(values.workingDays);
  const workedDays = amount(values.workedDays);
  const proratedSalary = workingDays > 0 ? revisedSalary * Math.min(workedDays, workingDays) / workingDays : 0;
  const grossSalary = proratedSalary + amount(values.incentive) + amount(values.overtimeAllowance) + amount(values.gymAllowance) + amount(values.medicalAllowance) + amount(values.otherAllowance);
  const estimatedTax = pakistanAnnualSalaryTax(grossSalary * 12) / 12;
  const enteredTax = values.taxDeduction.trim() ? Math.max(0, amount(values.taxDeduction)) : estimatedTax;
  const taxDeduction = Math.round(enteredTax * 100) / 100;
  const totalDeductions = taxDeduction + amount(values.advanceDeduction) + amount(values.loanDeduction) + amount(values.fineDeduction);
  const payableSalary = grossSalary - totalDeductions + amount(values.adjustment);

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
    employeeId: "",
    employeeName: "",
    cnic: "",
    designation: "",
    month,
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
    adjustment: "0",
    description: "",
  };
}

export function serializePayroll(values: PayrollValues): Record<string, string> {
  const totals = calculatePayroll(values);
  return {
    ...values,
    afterIncrement: totals.revisedSalary.toFixed(2),
    proratedSalary: totals.proratedSalary.toFixed(2),
    grossSalary: totals.grossSalary.toFixed(2),
    estimatedTax: totals.estimatedTax.toFixed(2),
    taxDeduction: totals.taxDeduction.toFixed(2),
    totalDeductions: totals.totalDeductions.toFixed(2),
    payableSalary: totals.payableSalary.toFixed(2),
  };
}
