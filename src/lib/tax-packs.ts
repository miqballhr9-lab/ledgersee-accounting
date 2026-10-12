/**
 * Country packs: the tax rates, tax accounts and payroll rules one country
 * needs, installed together from Tax setup. Rates live in the Taxes list
 * afterwards, so a business can change them when a budget or notification
 * changes them — nothing here is fixed in the documents.
 *
 * Rates were current when written (Pakistan FY 2025-26, UAE and Saudi VAT) but
 * governments change them; Tax setup says so and asks people to check.
 */

export type CountryCode = "PK" | "AE" | "SA" | "GB" | "US" | "OTHER";

export interface PackTax {
  name: string;
  rate: number;
  /** What kind of tax it is; drives which box of the return it lands in. */
  type: "Standard" | "Reduced" | "Zero-rated" | "Exempt" | "Further tax" | "Withholding" | "Provincial services";
  appliesTo: "Sales" | "Purchases" | "Both";
  jurisdiction: string;
  isDefault?: boolean;
  note?: string;
}

export interface PackAccount {
  code: string;
  name: string;
  type: "Asset" | "Liability" | "Expense";
  description: string;
}

export interface CountryPack {
  code: CountryCode;
  country: string;
  currency: string;
  fiscalYear: "January" | "April" | "July" | "October";
  /** True where sales tax is set per state or city and reported by jurisdiction (USA). */
  byJurisdiction?: boolean;
  timeZone: string;
  /** Tax registration numbers the business and its customers carry. */
  registrations: { key: string; label: string; placeholder: string }[];
  taxes: PackTax[];
  accounts: PackAccount[];
  /** How the tax return is laid out in Tax returns. */
  returnName: string;
  /** Payroll rules shown on Tax setup and used where the app works them out. */
  payroll: {
    incomeTax: "pakistan-slabs" | "uk-paye" | "none";
    notes: string[];
    gratuity: string;
  };
}

export const countryPacks: Record<CountryCode, CountryPack> = {
  PK: {
    code: "PK",
    country: "Pakistan",
    currency: "PKR",
    fiscalYear: "July",
    timeZone: "Asia/Karachi",
    registrations: [
      { key: "ntn", label: "NTN", placeholder: "1234567-8" },
      { key: "strn", label: "STRN (sales tax registration)", placeholder: "3277876123456" },
    ],
    taxes: [
      { name: "GST 18% (standard)", rate: 18, type: "Standard", appliesTo: "Both", jurisdiction: "FBR — Sales Tax Act 1990", isDefault: true },
      { name: "Zero-rated 0% (exports)", rate: 0, type: "Zero-rated", appliesTo: "Sales", jurisdiction: "FBR — Fifth Schedule" },
      { name: "Exempt", rate: 0, type: "Exempt", appliesTo: "Both", jurisdiction: "FBR — Sixth Schedule" },
      { name: "Further tax 4% (unregistered buyers)", rate: 4, type: "Further tax", appliesTo: "Sales", jurisdiction: "FBR — section 3(1A)", note: "Charged on top of GST when the buyer has no STRN." },
      { name: "Punjab sales tax on services 16% (PRA)", rate: 16, type: "Provincial services", appliesTo: "Sales", jurisdiction: "Punjab Revenue Authority" },
      { name: "Sindh sales tax on services 15% (SRB)", rate: 15, type: "Provincial services", appliesTo: "Sales", jurisdiction: "Sindh Revenue Board" },
      { name: "KP sales tax on services 15% (KPRA)", rate: 15, type: "Provincial services", appliesTo: "Sales", jurisdiction: "Khyber Pakhtunkhwa Revenue Authority" },
      { name: "Balochistan sales tax on services 15% (BRA)", rate: 15, type: "Provincial services", appliesTo: "Sales", jurisdiction: "Balochistan Revenue Authority" },
      { name: "ICT sales tax on services 15%", rate: 15, type: "Provincial services", appliesTo: "Sales", jurisdiction: "FBR — Islamabad Capital Territory" },
      { name: "WHT on supply of goods (153(1)(a)) — filer", rate: 5, type: "Withholding", appliesTo: "Purchases", jurisdiction: "FBR — Income Tax Ordinance 2001", note: "Deducted when you pay a supplier; rates differ for companies, individuals and non-filers." },
      { name: "WHT on services (153(1)(b)) — filer", rate: 11, type: "Withholding", appliesTo: "Purchases", jurisdiction: "FBR — Income Tax Ordinance 2001", note: "Rates differ by service and for non-filers." },
    ],
    accounts: [
      { code: "2310", name: "Sales tax payable (output tax)", type: "Liability", description: "GST charged on sales, owed to FBR." },
      { code: "1410", name: "Input sales tax", type: "Asset", description: "GST paid on purchases, claimable against output tax." },
      { code: "2320", name: "Provincial sales tax on services payable", type: "Liability", description: "PRA, SRB, KPRA or BRA tax charged on services." },
      { code: "2330", name: "Withholding income tax payable", type: "Liability", description: "Income tax deducted from suppliers and staff, to deposit with FBR." },
      { code: "1420", name: "Advance income tax (deducted by customers)", type: "Asset", description: "Tax customers withheld from your payments; adjustable in your return." },
      { code: "2340", name: "EOBI payable", type: "Liability", description: "Employer and employee EOBI contributions due." },
    ],
    returnName: "Sales tax return (FBR)",
    payroll: {
      incomeTax: "pakistan-slabs",
      notes: [
        "Salary income tax uses the FY 2025-26 slabs: nothing up to Rs 600,000 a year, then 1%, 11%, 20%, 25%, 29%, 32% and 35%. Payroll works this out when the tax box is left empty.",
        "EOBI: employer 5% and employee 1% of the minimum wage each month, for businesses with 5 or more staff.",
        "Provincial employees' social security (PESSI, SESSI) applies to lower-paid workers in most provinces.",
      ],
      gratuity: "Gratuity is usually 30 days' last basic salary per completed year (a part year of six months or more counts). Final settlements use this by default.",
    },
  },
  AE: {
    code: "AE",
    country: "United Arab Emirates",
    currency: "AED",
    fiscalYear: "January",
    timeZone: "Asia/Dubai",
    registrations: [{ key: "trn", label: "TRN (tax registration number)", placeholder: "100123456700003" }],
    taxes: [
      { name: "VAT 5% (standard)", rate: 5, type: "Standard", appliesTo: "Both", jurisdiction: "Federal Tax Authority", isDefault: true },
      { name: "Zero-rated 0%", rate: 0, type: "Zero-rated", appliesTo: "Both", jurisdiction: "Federal Tax Authority", note: "Exports, international transport, some education and healthcare." },
      { name: "Exempt", rate: 0, type: "Exempt", appliesTo: "Both", jurisdiction: "Federal Tax Authority", note: "Some financial services, residential property, bare land, local passenger transport." },
    ],
    accounts: [
      { code: "2310", name: "VAT output payable", type: "Liability", description: "VAT charged on sales, owed to the FTA." },
      { code: "1410", name: "VAT input recoverable", type: "Asset", description: "VAT paid on purchases you can recover." },
      { code: "2350", name: "End of service benefits provision", type: "Liability", description: "Gratuity built up for employees." },
    ],
    returnName: "VAT return (VAT 201)",
    payroll: {
      incomeTax: "none",
      notes: [
        "There is no personal income tax on salaries.",
        "Salaries are paid through the Wage Protection System (WPS) for most mainland employers.",
        "UAE nationals are covered by pension contributions (GPSSA or the emirate's fund).",
      ],
      gratuity: "End of service gratuity is 21 days' basic salary per year for the first five years and 30 days per year after that, capped at two years' pay. Set 21 in final settlements for service under five years.",
    },
  },
  SA: {
    code: "SA",
    country: "Saudi Arabia",
    currency: "SAR",
    fiscalYear: "January",
    timeZone: "Asia/Riyadh",
    registrations: [
      { key: "trn", label: "VAT registration number", placeholder: "300000000000003" },
      { key: "cr", label: "Commercial registration (CR)", placeholder: "1010101010" },
    ],
    taxes: [
      { name: "VAT 15% (standard)", rate: 15, type: "Standard", appliesTo: "Both", jurisdiction: "ZATCA", isDefault: true },
      { name: "Zero-rated 0%", rate: 0, type: "Zero-rated", appliesTo: "Both", jurisdiction: "ZATCA", note: "Exports, international transport, qualifying medicines and medical equipment." },
      { name: "Exempt", rate: 0, type: "Exempt", appliesTo: "Both", jurisdiction: "ZATCA", note: "Some financial services and residential rent." },
    ],
    accounts: [
      { code: "2310", name: "VAT output payable", type: "Liability", description: "VAT charged on sales, owed to ZATCA." },
      { code: "1410", name: "VAT input recoverable", type: "Asset", description: "VAT paid on purchases you can recover." },
      { code: "2360", name: "GOSI payable", type: "Liability", description: "Social insurance contributions due." },
      { code: "2350", name: "End of service benefits provision", type: "Liability", description: "End of service award built up for employees." },
    ],
    returnName: "VAT return (ZATCA)",
    payroll: {
      incomeTax: "none",
      notes: [
        "There is no personal income tax on salaries.",
        "GOSI: Saudi employees and employers both contribute (pension and unemployment insurance); for non-Saudis the employer pays occupational hazards (2%).",
        "ZATCA e-invoicing (FATOORA) requires invoices with a QR code from an approved solution.",
      ],
      gratuity: "End of service award is half a month's wage per year for the first five years and a full month per year after that. Set 15 days per year in final settlements for service under five years.",
    },
  },
  GB: {
    code: "GB",
    country: "United Kingdom",
    currency: "GBP",
    fiscalYear: "April",
    timeZone: "Europe/London",
    registrations: [
      { key: "trn", label: "VAT registration number", placeholder: "GB123456789" },
      { key: "utr", label: "Unique Taxpayer Reference (UTR)", placeholder: "1234567890" },
      { key: "cr", label: "Company number", placeholder: "01234567" },
    ],
    taxes: [
      { name: "VAT 20% (standard)", rate: 20, type: "Standard", appliesTo: "Both", jurisdiction: "HMRC", isDefault: true },
      { name: "VAT 5% (reduced)", rate: 5, type: "Reduced", appliesTo: "Both", jurisdiction: "HMRC", note: "Domestic fuel and power, children's car seats, some energy-saving installations." },
      { name: "Zero-rated 0%", rate: 0, type: "Zero-rated", appliesTo: "Both", jurisdiction: "HMRC", note: "Most food, books, children's clothes, exports." },
      { name: "Exempt", rate: 0, type: "Exempt", appliesTo: "Both", jurisdiction: "HMRC", note: "Insurance, finance, education, health, postage stamps." },
    ],
    accounts: [
      { code: "2310", name: "VAT output payable", type: "Liability", description: "VAT charged on sales, owed to HMRC." },
      { code: "1410", name: "VAT input reclaimable", type: "Asset", description: "VAT paid on purchases you can reclaim." },
      { code: "2330", name: "PAYE and National Insurance payable", type: "Liability", description: "Income tax and NI deducted from salaries, due to HMRC." },
      { code: "2340", name: "Workplace pension payable", type: "Liability", description: "Auto-enrolment pension contributions due." },
    ],
    returnName: "VAT return (HMRC, 9 boxes)",
    payroll: {
      incomeTax: "uk-paye",
      notes: [
        "Income tax (England, Wales and Northern Ireland, 2025/26): personal allowance £12,570; 20% up to £50,270; 40% up to £125,140; 45% above. The allowance shrinks by £1 for every £2 over £100,000. Payroll estimates this when the tax box is left empty; tax codes and Scottish rates aren't applied.",
        "National Insurance 2025/26: employees 8% between £12,570 and £50,270 and 2% above; employers 15% above £5,000 a year. Enter NI as a deduction or adjustment.",
        "Workplace pension auto-enrolment: at least 8% of qualifying earnings, with the employer paying at least 3%.",
      ],
      gratuity: "There is no gratuity in the UK; statutory redundancy pay applies after two years' service. Set gratuity days to 0 in final settlements.",
    },
  },
  US: {
    code: "US",
    country: "United States",
    currency: "USD",
    fiscalYear: "January",
    timeZone: "America/New_York",
    byJurisdiction: true,
    registrations: [
      { key: "trn", label: "EIN (employer identification number)", placeholder: "12-3456789" },
      { key: "strn", label: "State sales tax permit number", placeholder: "" },
    ],
    taxes: [
      { name: "California sales tax 7.25%", rate: 7.25, type: "Standard", appliesTo: "Sales", jurisdiction: "California (CDTFA) — state base rate; local district taxes add more" },
      { name: "New York sales tax 4%", rate: 4, type: "Standard", appliesTo: "Sales", jurisdiction: "New York — state rate; New York City adds 4.5% + 0.375%" },
      { name: "New York City sales tax 8.875%", rate: 8.875, type: "Standard", appliesTo: "Sales", jurisdiction: "New York City — state, city and MCTD combined" },
      { name: "Texas sales tax 6.25%", rate: 6.25, type: "Standard", appliesTo: "Sales", jurisdiction: "Texas — state rate; local up to 2% more" },
      { name: "Florida sales tax 6%", rate: 6, type: "Standard", appliesTo: "Sales", jurisdiction: "Florida — state rate; county surtax may apply" },
      { name: "Illinois sales tax 6.25%", rate: 6.25, type: "Standard", appliesTo: "Sales", jurisdiction: "Illinois — state rate; local taxes add more" },
      { name: "Washington sales tax 6.5%", rate: 6.5, type: "Standard", appliesTo: "Sales", jurisdiction: "Washington — state rate; local taxes add more" },
      { name: "New Jersey sales tax 6.625%", rate: 6.625, type: "Standard", appliesTo: "Sales", jurisdiction: "New Jersey" },
      { name: "Pennsylvania sales tax 6%", rate: 6, type: "Standard", appliesTo: "Sales", jurisdiction: "Pennsylvania — Allegheny County and Philadelphia add more" },
      { name: "Georgia sales tax 4%", rate: 4, type: "Standard", appliesTo: "Sales", jurisdiction: "Georgia — state rate; local taxes add more" },
      { name: "Not taxable (resale, exempt or out of state)", rate: 0, type: "Exempt", appliesTo: "Both", jurisdiction: "Keep the customer's resale or exemption certificate" },
    ],
    accounts: [
      { code: "2310", name: "Sales tax payable", type: "Liability", description: "Sales tax collected, owed to each state." },
      { code: "2330", name: "Payroll taxes payable", type: "Liability", description: "Federal and state withholding, Social Security and Medicare." },
      { code: "2340", name: "Federal and state unemployment tax payable", type: "Liability", description: "FUTA and SUTA due." },
    ],
    returnName: "Sales tax report by state",
    payroll: {
      incomeTax: "none",
      notes: [
        "Federal income tax withholding depends on each employee's W-4 and IRS Publication 15-T, and most states add their own; enter the withholding in each payroll row.",
        "FICA 2025: Social Security 6.2% each for employee and employer on wages up to $176,100, and Medicare 1.45% each (plus 0.9% for the employee over $200,000).",
        "FUTA is 6% of the first $7,000 of wages, usually 0.6% after the state credit; SUTA rates are set by each state.",
      ],
      gratuity: "There is no statutory gratuity in the USA. Set gratuity days to 0 in final settlements.",
    },
  },
  OTHER: {
    code: "OTHER",
    country: "Other country",
    currency: "USD",
    fiscalYear: "January",
    timeZone: "UTC",
    registrations: [{ key: "trn", label: "Tax registration number", placeholder: "" }],
    taxes: [
      { name: "Standard rate", rate: 0, type: "Standard", appliesTo: "Both", jurisdiction: "Set your own rate", isDefault: true, note: "Change this to your country's VAT, GST or sales tax rate." },
      { name: "Zero-rated 0%", rate: 0, type: "Zero-rated", appliesTo: "Both", jurisdiction: "" },
      { name: "Exempt", rate: 0, type: "Exempt", appliesTo: "Both", jurisdiction: "" },
    ],
    accounts: [
      { code: "2310", name: "Sales tax payable", type: "Liability", description: "Tax charged on sales." },
      { code: "1410", name: "Input tax recoverable", type: "Asset", description: "Tax paid on purchases you can recover." },
    ],
    returnName: "Tax return",
    payroll: {
      incomeTax: "none",
      notes: ["Enter salary tax in each payroll row; the app doesn't work it out for this country yet."],
      gratuity: "Set the gratuity days per year in final settlements to match your local law.",
    },
  },
};

export function isCountryCode(value: unknown): value is CountryCode {
  return typeof value === "string" && value in countryPacks;
}

export function packFor(code: string | undefined): CountryPack | null {
  return isCountryCode(code) ? countryPacks[code] : null;
}
