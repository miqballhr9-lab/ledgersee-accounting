/**
 * Country packs: the tax rates, tax accounts and payroll rules one country
 * needs, installed together from Tax setup. Rates live in the Taxes list
 * afterwards, so a business can change them when a budget or notification
 * changes them — nothing here is fixed in the documents.
 *
 * Rates were current when written (Pakistan FY 2025-26, UAE and Saudi VAT,
 * Sweden and Denmark 2026) but governments change them; Tax setup says so and
 * asks people to check.
 */

export type CountryCode = "PK" | "AE" | "SA" | "GB" | "US" | "SE" | "DK" | "OTHER";

/**
 * Cross-border VAT in the EU: sales to businesses in other EU countries go out
 * without VAT, and purchases from abroad carry no VAT from the supplier — the
 * buyer works out the VAT itself (reverse charge), owing and reclaiming it in
 * the same return.
 */
export const crossBorderTypes = ["EU goods sale", "EU services sale", "EU goods purchase", "EU services purchase", "Non-EU services purchase", "Import"] as const;
export const reverseChargeTypes = new Set<string>(["EU goods purchase", "EU services purchase", "Non-EU services purchase", "Import"]);

export interface PackTax {
  name: string;
  rate: number;
  /** What kind of tax it is; drives which box of the return it lands in. */
  type: "Standard" | "Reduced" | "Zero-rated" | "Exempt" | "Further tax" | "Withholding" | "Provincial services" | (typeof crossBorderTypes)[number];
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
    incomeTax: "pakistan-slabs" | "uk-paye" | "sweden-estimate" | "denmark-estimate" | "none";
    notes: string[];
    gratuity: string;
    /** What the employer pays on top of salaries, booked with each payroll row: a share of gross pay and/or a fixed monthly amount per employee. */
    employer?: { rate: number; monthly: number; label: string };
  };
  /** Tax on the business's profit, shown on Tax setup. */
  companyTax?: { rate: string; notes: string[] };
  /** VAT rate a reverse-charge purchase is self-assessed at. */
  reverseChargeRate?: number;
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
    companyTax: { rate: "29%", notes: ["Companies pay 29% income tax on taxable profit (small companies 20%); banks pay more.", "Tax is paid in advance each quarter and settled with the annual return to FBR."] },
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
    companyTax: { rate: "9%", notes: ["Corporate tax is 9% on taxable profit above AED 375,000 (0% below it); qualifying free zone income can be 0%.", "Returns are filed with the FTA within nine months of the year end."] },
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
    companyTax: { rate: "20% / 2.5% Zakat", notes: ["Foreign-owned shares of a company pay 20% income tax on profit; Saudi and GCC-owned shares pay 2.5% Zakat on the Zakat base.", "Returns are filed with ZATCA within 120 days of the year end."] },
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
    companyTax: { rate: "19%–25%", notes: ["Corporation tax is 25% on profits over £250,000 and 19% up to £50,000, with marginal relief in between.", "Pay within nine months and one day of the year end; file the CT600 within 12 months."] },
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
    companyTax: { rate: "21% federal", notes: ["C corporations pay 21% federal income tax on profit, plus state corporate tax in most states.", "LLCs and S corporations usually pass profit through to the owners' personal returns."] },
  },
  SE: {
    code: "SE",
    country: "Sweden",
    currency: "SEK",
    fiscalYear: "January",
    timeZone: "Europe/Stockholm",
    registrations: [
      { key: "cr", label: "Organisationsnummer", placeholder: "556677-8899" },
      { key: "trn", label: "VAT number (momsregistreringsnummer)", placeholder: "SE556677889901" },
    ],
    taxes: [
      { name: "Moms 25% (standard)", rate: 25, type: "Standard", appliesTo: "Both", jurisdiction: "Skatteverket", isDefault: true },
      { name: "Moms 12% (restaurants, hotels)", rate: 12, type: "Reduced", appliesTo: "Both", jurisdiction: "Skatteverket", note: "Eat-in restaurant and catering services, hotel stays." },
      { name: "Moms 6% (food)", rate: 6, type: "Reduced", appliesTo: "Both", jurisdiction: "Skatteverket", note: "Food, including takeaway, from 1 April 2026 to 31 December 2027 (12% before and after). Alcohol stays at 25%." },
      { name: "Moms 6% (books, newspapers, transport, culture)", rate: 6, type: "Reduced", appliesTo: "Both", jurisdiction: "Skatteverket", note: "Books, newspapers, domestic passenger transport, concerts and sports events." },
      { name: "Export outside the EU 0%", rate: 0, type: "Zero-rated", appliesTo: "Sales", jurisdiction: "Skatteverket — ruta 36" },
      { name: "Momsfri (exempt)", rate: 0, type: "Exempt", appliesTo: "Both", jurisdiction: "Skatteverket — ruta 42", note: "Healthcare, education, banking and insurance, residential rent." },
      { name: "Goods to EU businesses 0% (reverse charge)", rate: 0, type: "EU goods sale", appliesTo: "Sales", jurisdiction: "Skatteverket — ruta 35", note: "The buyer must have a valid EU VAT number; also report it in the EC sales list (periodisk sammanställning)." },
      { name: "Services to EU businesses 0% (reverse charge)", rate: 0, type: "EU services sale", appliesTo: "Sales", jurisdiction: "Skatteverket — ruta 39", note: "Also report it in the EC sales list." },
      { name: "Goods from EU suppliers (reverse charge 25%)", rate: 0, type: "EU goods purchase", appliesTo: "Purchases", jurisdiction: "Skatteverket — ruta 20 and 30", note: "No VAT on the supplier's invoice: you owe 25% and reclaim it in the same return." },
      { name: "Services from EU suppliers (reverse charge 25%)", rate: 0, type: "EU services purchase", appliesTo: "Purchases", jurisdiction: "Skatteverket — ruta 21 and 30" },
      { name: "Services from outside the EU (reverse charge 25%)", rate: 0, type: "Non-EU services purchase", appliesTo: "Purchases", jurisdiction: "Skatteverket — ruta 22 and 30" },
      { name: "Import of goods (import VAT 25%)", rate: 0, type: "Import", appliesTo: "Purchases", jurisdiction: "Skatteverket — ruta 50 and 60", note: "Import VAT is declared in your VAT return, not paid to customs." },
    ],
    accounts: [
      { code: "2611", name: "VAT output payable (utgående moms)", type: "Liability", description: "Moms charged on sales, owed to Skatteverket." },
      { code: "2641", name: "VAT input recoverable (ingående moms)", type: "Asset", description: "Moms paid on purchases you can deduct." },
      { code: "2710", name: "Employee income tax withheld (personalskatt)", type: "Liability", description: "Preliminary tax withheld from salaries, paid to Skatteverket each month." },
      { code: "2731", name: "Employer contributions owed (arbetsgivaravgifter)", type: "Liability", description: "Employer social security contributions due with the monthly employer return." },
      { code: "7510", name: "Employer social contributions (arbetsgivaravgifter)", type: "Expense", description: "The employer's 31.42% on salaries: pension, health, parental and work injury insurance and the general payroll fee." },
      { code: "2512", name: "Corporate income tax owed (bolagsskatt)", type: "Liability", description: "Tax on the company's profit, paid as monthly preliminary tax (F-skatt)." },
    ],
    returnName: "Momsdeklaration (Skatteverket)",
    reverseChargeRate: 25,
    payroll: {
      incomeTax: "sweden-estimate",
      employer: { rate: 31.42, monthly: 0, label: "Arbetsgivaravgifter 31.42%" },
      notes: [
        "Preliminary income tax (2026): municipal tax averages 32.38% (29–35% by municipality) after the basic deduction (grundavdrag), less the job tax credit (jobbskatteavdrag); state tax adds 20% on taxable income over 643,000 kr (about 660,400 kr salary). Payroll estimates this at the average municipal rate when the tax box is left empty — use Skatteverket's tax table (skattetabell) for the employee's municipality for the exact amount.",
        "Employer contributions (arbetsgivaravgifter) are 31.42% of gross pay for employees born 1959–2002: retirement pension 10.21%, survivor's pension 0.60%, health insurance 3.55%, parental insurance 2.00%, work injury 0.10%, labour market 2.64% and the general payroll fee 12.32%. Lower rates apply to young people (20.81% up to 25,000 kr a month for those born 2003–2007) and people over 66. Payroll books 31.42% automatically.",
        "Health care, sick pay after day 14 and parental benefit are covered by these contributions and taxes; employees pay no separate health insurance. The employer pays sick pay for days 2–14 (80%).",
        "The employer files the monthly employer return (arbetsgivardeklaration på individnivå) and pays the withheld tax and contributions by the 12th of the following month (17th in January and August).",
        "Occupational pension and insurance under collective agreements (e.g. ITP, SAF-LO, Fora) are extra; add them as deductions or adjustments.",
      ],
      gratuity: "There is no gratuity in Sweden; notice periods follow LAS and collective agreements. Set gratuity days to 0 in final settlements.",
    },
    companyTax: {
      rate: "20.6%",
      notes: [
        "Limited companies (aktiebolag) pay 20.6% corporate tax (bolagsskatt) on taxable profit.",
        "Tax is paid in advance each month as preliminary tax (F-skatt) based on estimated profit, and settled with the annual income tax return (inkomstdeklaration 2).",
        "Sole traders (enskild firma) pay income tax on the profit through their personal return, plus self-employed contributions (egenavgifter, about 28.97%).",
      ],
    },
  },
  DK: {
    code: "DK",
    country: "Denmark",
    currency: "DKK",
    fiscalYear: "January",
    timeZone: "Europe/Copenhagen",
    registrations: [
      { key: "cr", label: "CVR number", placeholder: "12345678" },
      { key: "trn", label: "VAT number (SE / momsnummer)", placeholder: "DK12345678" },
    ],
    taxes: [
      { name: "Moms 25% (standard)", rate: 25, type: "Standard", appliesTo: "Both", jurisdiction: "Skattestyrelsen", isDefault: true, note: "Denmark has a single VAT rate." },
      { name: "Export outside the EU 0%", rate: 0, type: "Zero-rated", appliesTo: "Sales", jurisdiction: "Skattestyrelsen — rubrik C" },
      { name: "Momsfritaget (exempt)", rate: 0, type: "Exempt", appliesTo: "Both", jurisdiction: "Skattestyrelsen — rubrik C", note: "Healthcare, education, banking and insurance, renting property, passenger transport." },
      { name: "Goods to EU businesses 0% (reverse charge)", rate: 0, type: "EU goods sale", appliesTo: "Sales", jurisdiction: "Skattestyrelsen — rubrik B (varer)", note: "The buyer must have a valid EU VAT number; also report it in EU-salg uden moms." },
      { name: "Services to EU businesses 0% (reverse charge)", rate: 0, type: "EU services sale", appliesTo: "Sales", jurisdiction: "Skattestyrelsen — rubrik B (ydelser)" },
      { name: "Goods from EU suppliers (reverse charge 25%)", rate: 0, type: "EU goods purchase", appliesTo: "Purchases", jurisdiction: "Skattestyrelsen — rubrik A (varer)", note: "No VAT on the supplier's invoice: you owe 25% and deduct it again as købsmoms." },
      { name: "Services from EU suppliers (reverse charge 25%)", rate: 0, type: "EU services purchase", appliesTo: "Purchases", jurisdiction: "Skattestyrelsen — rubrik A (ydelser)" },
      { name: "Services from outside the EU (reverse charge 25%)", rate: 0, type: "Non-EU services purchase", appliesTo: "Purchases", jurisdiction: "Skattestyrelsen — moms af ydelseskøb i udlandet" },
      { name: "Import of goods (import VAT 25%)", rate: 0, type: "Import", appliesTo: "Purchases", jurisdiction: "Skattestyrelsen — moms af varekøb i udlandet" },
    ],
    accounts: [
      { code: "2310", name: "VAT output payable (salgsmoms)", type: "Liability", description: "Moms charged on sales, owed to Skattestyrelsen." },
      { code: "1410", name: "VAT input recoverable (købsmoms)", type: "Asset", description: "Moms paid on purchases you can deduct." },
      { code: "2330", name: "A-tax and AM contribution withheld (A-skat og AM-bidrag)", type: "Liability", description: "Withheld from salaries and reported through eIndkomst." },
      { code: "2340", name: "Employer contributions owed (ATP, AES, Barsel.dk)", type: "Liability", description: "ATP and other employer contributions due." },
      { code: "7510", name: "Employer social contributions (ATP, AES, Barsel.dk)", type: "Expense", description: "The employer's ATP share and other labour market contributions." },
      { code: "2512", name: "Corporate income tax owed (selskabsskat)", type: "Liability", description: "Tax on the company's profit, paid on account (acontoskat) in March and November." },
    ],
    returnName: "Momsangivelse (Skattestyrelsen)",
    reverseChargeRate: 25,
    payroll: {
      incomeTax: "denmark-estimate",
      employer: { rate: 0, monthly: 198, label: "ATP employer share 198 kr a month" },
      notes: [
        "AM-bidrag (labour market contribution) is 8% of gross pay, taken before any other tax. Payroll includes it in the tax it estimates.",
        "A-skat (2026): municipal tax averages about 25% (plus church tax for members) and bottom tax (bundskat) is 12.01%, after the personal allowance of 54,100 kr a year; the employment deduction (beskæftigelsesfradrag, 12.75% up to 63,300 kr) and job deduction lower the municipal tax. Middle tax (mellemskat) 7.5% above 641,200 kr, top tax (topskat) 7.5% above 777,900 kr and top-top tax 5% above 2,592,700 kr. Payroll estimates this when the tax box is left empty; use each employee's tax card (skattekort) for the exact rate and deduction.",
        "ATP (supplementary pension) for full-time staff on monthly pay (117+ hours) is 297 kr a month: 99 kr from the employee (enter it as a social deduction) and 198 kr from the employer, which payroll books automatically.",
        "Health care is paid from taxes; there is no separate health insurance contribution. Employers must carry work injury insurance (arbejdsskadeforsikring) and pay small contributions to AES, Barsel.dk, AUB and FIB.",
        "Salaries, A-skat and AM-bidrag are reported each month through eIndkomst, and paid to Skattestyrelsen by the due date.",
      ],
      gratuity: "There is no general gratuity in Denmark; salaried employees (funktionærer) may get severance after 12 or more years. Holiday pay (feriepenge, 12.5%) is earned on top of pay. Set gratuity days to 0 in final settlements.",
    },
    companyTax: {
      rate: "22%",
      notes: [
        "Companies (ApS, A/S) pay 22% corporate tax (selskabsskat) on taxable profit.",
        "Tax is paid on account (acontoskat) in March and November, and settled with the annual tax return (selvangivelse for selskaber).",
        "Sole proprietors (enkeltmandsvirksomhed) pay personal income tax on the profit, or can use the company tax scheme (virksomhedsordningen).",
      ],
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
