/**
 * @module tax-calculator
 * @why-built COBOL had no payroll module — taxes were computed externally.
 *   This pure domain function encodes US payroll tax rules for 2024+.
 * @intelligence-additions
 *   - FICA wage base cap enforcement (YTD-aware)
 *   - Additional Medicare 0.9% on wages > $200,000
 *   - Employer FUTA at 6.0% on first $7,000 (reduced by SUTA credit max 5.4%)
 *   - All results rounded to 2 decimal places (bank-quality rounding)
 */

export interface TaxRateConfig {
  ficaRate: number;           // e.g. 0.062
  ficaWageBase: number;       // e.g. 160200
  medicareRate: number;       // e.g. 0.0145
  additionalMedicareRate: number; // e.g. 0.009, applies above $200,000
  additionalMedicareThreshold: number; // e.g. 200000
  futaRate: number;           // e.g. 0.06
  futaWageBase: number;       // e.g. 7000
  sutaRate: number;           // employer experience rate, e.g. 0.027
  sutaWageBase: number;       // varies by state, e.g. 40000
}

export interface TaxCalculationInput {
  grossPay: number;
  ytdGrossPay: number;       // YTD before this payroll
  ytdFicaWages: number;      // YTD FICA wages before this payroll (for cap check)
  ytdFutaWages?: number;     // YTD FUTA wages before this payroll
  ytdSutaWages?: number;     // YTD SUTA wages before this payroll
  federalFilingStatus: string; // SINGLE | MARRIED | HEAD_OF_HOUSEHOLD
  federalAllowances: number;
  stateCode?: string;
  stateAllowances?: number;
  payFrequency: string;      // WEEKLY | BI_WEEKLY | SEMI_MONTHLY | MONTHLY
  rates: TaxRateConfig;
}

export interface TaxCalculationResult {
  // Employee withholding
  federalTax: number;
  stateTax: number;
  socialSecurity: number;    // employee FICA
  medicare: number;          // employee Medicare (includes additional if applicable)

  // Employer taxes
  employerFICA: number;      // matches employee FICA
  employerMedicare: number;  // matches employee Medicare (excl. additional Medicare)
  employerFUTA: number;
  employerSUTA: number;
}

const PAYROLL_PERIODS_PER_YEAR: Record<string, number> = {
  WEEKLY: 52,
  BI_WEEKLY: 26,
  SEMI_MONTHLY: 24,
  MONTHLY: 12,
};

/**
 * Round to 2 decimal places using "round half up" (banker-quality).
 */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Compute federal income tax withholding using the percentage method (IRS Pub 15-T 2024).
 * Annualizes the paycheck, subtracts allowances, applies brackets, then de-annualizes.
 */
function computeFederalTax(
  grossPay: number,
  payFrequency: string,
  filingStatus: string,
  allowances: number,
): number {
  const periods = PAYROLL_PERIODS_PER_YEAR[payFrequency] ?? 26;
  const annualized = grossPay * periods;

  // 2024 allowance value: $4,300 per allowance (IRS Pub 15-T Table 1)
  const allowanceValue = 4300;
  const adjustedWage = Math.max(0, annualized - allowances * allowanceValue);

  // 2024 Federal income tax brackets (IRS Pub 15-T — Percentage Method Tables)
  // Single / Head of Household brackets
  const singleBrackets: [number, number, number][] = [
    // [threshold, rate, base_tax]
    [0, 0.10, 0],
    [11600, 0.12, 1160],
    [47150, 0.22, 5426],
    [100525, 0.24, 17168.50],
    [191950, 0.32, 39110.50],
    [243725, 0.35, 55678.50],
    [609350, 0.37, 183647.25],
  ];
  const marriedBrackets: [number, number, number][] = [
    [0, 0.10, 0],
    [23200, 0.12, 2320],
    [94300, 0.22, 10852],
    [201050, 0.24, 34337],
    [383900, 0.32, 78221],
    [487450, 0.35, 111357],
    [731200, 0.37, 196669.50],
  ];

  const brackets = filingStatus === 'MARRIED' ? marriedBrackets : singleBrackets;

  let annualTax = 0;
  for (let i = brackets.length - 1; i >= 0; i--) {
    const [threshold, rate, baseTax] = brackets[i]!;
    if (adjustedWage > threshold) {
      annualTax = baseTax + (adjustedWage - threshold) * rate;
      break;
    }
  }

  return round2(Math.max(0, annualTax / periods));
}

/**
 * Estimate state income tax using a simplified flat-equivalent approach.
 * Production systems integrate with state-specific tables; this provides
 * a reasonable approximation for states without complex brackets.
 * @intelligence-additions States with no income tax return 0.
 */
function computeStateTax(
  grossPay: number,
  stateCode: string | undefined,
  stateAllowances: number,
  payFrequency: string,
): number {
  if (!stateCode) return 0;

  // States with no income tax
  const noTaxStates = new Set(['AK', 'FL', 'NV', 'NH', 'SD', 'TN', 'TX', 'WA', 'WY']);
  if (noTaxStates.has(stateCode.toUpperCase())) return 0;

  // Simplified state flat rates (production: use state-specific tables)
  const stateFlatRates: Record<string, number> = {
    CA: 0.072, NY: 0.068, IL: 0.0495, PA: 0.0307, OH: 0.04,
    MI: 0.0425, GA: 0.055, NC: 0.0525, VA: 0.0575, MA: 0.05,
    NJ: 0.0637, MN: 0.0698, WI: 0.0553, IN: 0.0323, MO: 0.048,
    CO: 0.044, AZ: 0.025, OR: 0.099, MD: 0.0575, CT: 0.0699,
    AL: 0.05, SC: 0.07, LA: 0.042, OK: 0.05, KY: 0.05,
    AR: 0.059, IA: 0.06, KS: 0.057, UT: 0.0485, MS: 0.05,
    ID: 0.058, HI: 0.082, NM: 0.059, WV: 0.065, NE: 0.0684,
    MT: 0.0675, RI: 0.0599, DE: 0.066, DC: 0.085, ME: 0.0715,
    ND: 0.029, VT: 0.0875,
  };

  const rate = stateFlatRates[stateCode.toUpperCase()] ?? 0.05;
  const periods = PAYROLL_PERIODS_PER_YEAR[payFrequency] ?? 26;
  const allowanceValue = 1000 / periods; // Simplified state allowance
  const taxableWage = Math.max(0, grossPay - stateAllowances * allowanceValue);

  return round2(taxableWage * rate);
}

/**
 * Primary export: compute all payroll taxes for a single pay item.
 *
 * @param input Pay item details + YTD accumulators + rate config
 * @returns All employee and employer tax amounts, rounded to cents
 */
export function calculateTaxes(input: TaxCalculationInput): TaxCalculationResult {
  const { grossPay, ytdFicaWages, ytdGrossPay, rates } = input;
  const ytdFutaWages = input.ytdFutaWages ?? 0;
  const ytdSutaWages = input.ytdSutaWages ?? 0;

  // ── FICA (Social Security) ────────────────────────────────────────────────
  // Cap: employee pays 6.2% only on wages up to the annual wage base
  const ficaWageBase = rates.ficaWageBase;
  const ficaRemaining = Math.max(0, ficaWageBase - ytdFicaWages);
  const ficaTaxableWage = Math.min(grossPay, ficaRemaining);
  const employeeFICA = round2(ficaTaxableWage * rates.ficaRate);
  const employerFICA = employeeFICA; // employer matches exactly

  // ── Medicare ──────────────────────────────────────────────────────────────
  // No wage base cap. Additional 0.9% for employee on wages > $200,000 YTD.
  const employeeMedicare = round2(grossPay * rates.medicareRate);
  const employerMedicare = employeeMedicare; // employer matches base rate only

  // Additional Medicare: employee-only, on wages above threshold
  const additionalMedicareThreshold = rates.additionalMedicareThreshold;
  const priorYtdGross = ytdGrossPay;
  const postYtdGross = ytdGrossPay + grossPay;
  let additionalMedicare = 0;
  if (postYtdGross > additionalMedicareThreshold) {
    const taxableAboveThreshold = Math.max(0, postYtdGross - Math.max(priorYtdGross, additionalMedicareThreshold));
    additionalMedicare = round2(taxableAboveThreshold * rates.additionalMedicareRate);
  }
  const totalEmployeeMedicare = round2(employeeMedicare + additionalMedicare);

  // ── FUTA (Federal Unemployment) ───────────────────────────────────────────
  // Employer-only: 6.0% on first $7,000. Reduced by SUTA credit up to 5.4%.
  // Net effective FUTA rate is typically 0.6% after max SUTA credit.
  const futaWageBase = rates.futaWageBase;
  const futaRemaining = Math.max(0, futaWageBase - ytdFutaWages);
  const futaTaxable = Math.min(grossPay, futaRemaining);
  const effectiveFutaRate = Math.max(0, rates.futaRate - Math.min(0.054, rates.sutaRate));
  const employerFUTA = round2(futaTaxable * effectiveFutaRate);

  // ── SUTA (State Unemployment) ─────────────────────────────────────────────
  // Employer-only: rate varies by state and employer experience.
  const sutaWageBase = rates.sutaWageBase;
  const sutaRemaining = Math.max(0, sutaWageBase - ytdSutaWages);
  const sutaTaxable = Math.min(grossPay, sutaRemaining);
  const employerSUTA = round2(sutaTaxable * rates.sutaRate);

  // ── Federal and State Income Tax Withholding ──────────────────────────────
  const federalTax = computeFederalTax(
    grossPay,
    input.payFrequency,
    input.federalFilingStatus,
    input.federalAllowances,
  );
  const stateTax = computeStateTax(
    grossPay,
    input.stateCode,
    input.stateAllowances ?? 0,
    input.payFrequency,
  );

  return {
    federalTax,
    stateTax,
    socialSecurity: employeeFICA,
    medicare: totalEmployeeMedicare,
    employerFICA,
    employerMedicare,
    employerFUTA,
    employerSUTA,
  };
}

/**
 * Default US tax rates for 2024.
 * Override via PayrollTaxRate table in the DB for tenant-specific SUTA rates.
 */
export const DEFAULT_TAX_RATES_2024: TaxRateConfig = {
  ficaRate: 0.062,
  ficaWageBase: 168600,       // 2024 FICA wage base
  medicareRate: 0.0145,
  additionalMedicareRate: 0.009,
  additionalMedicareThreshold: 200000,
  futaRate: 0.06,
  futaWageBase: 7000,
  sutaRate: 0.027,            // national average; override per tenant
  sutaWageBase: 40000,        // varies by state; override per tenant
};
