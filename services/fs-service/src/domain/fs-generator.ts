import { Decimal } from '@prisma/client/runtime/library';
import { evaluateFormula } from './formula-evaluator';

export interface TrialBalanceAccount {
  accountCode: string;
  accountName: string;
  accountType: string;
  /** Net balance: debit − credit (positive = debit balance) */
  balance: Decimal;
}

export interface MappingLine {
  oemLineNumber: string;
  oemLineLabel: string;
  oemSection: string;
  glAccountCodes: string[];
  calculationType: 'SUM' | 'DIFFERENCE' | 'FORMULA';
  formula?: string | null;
  displayOrder: number;
  isSubtotal: boolean;
  isTotal: boolean;
}

export interface GeneratedLine {
  oemLineNumber: string;
  oemLineLabel: string;
  oemSection: string;
  currentMonth: Decimal;
  yearToDate: Decimal;
  priorMonth: Decimal | null;
  priorYear: Decimal | null;
  variance: Decimal | null;
  variancePct: Decimal | null;
  displayOrder: number;
  isSubtotal: boolean;
  isTotal: boolean;
  glAccountCodes: string[];
}

/**
 * Core financial statement generation engine.
 *
 * @cobol-origin finstm* family — 100 programs, one per OEM per year.
 * Each hardcoded which GL accounts mapped to which OEM report line.
 * This engine replaces all 100 programs: it reads the OEMAccountMapping
 * table and applies the same logic for any OEM, any year.
 */
export function generateLines(
  mappings: MappingLine[],
  currentMonthTB: Map<string, Decimal>,
  ytdTB: Map<string, Decimal>,
  priorMonthTB: Map<string, Decimal> | null,
  priorYearTB: Map<string, Decimal> | null,
): GeneratedLine[] {
  // Sort by display order to ensure formula dependencies resolve top-to-bottom
  const sorted = [...mappings].sort((a, b) => a.displayOrder - b.displayOrder);

  // Build a map of lineNumber → computed value for formula resolution
  const currentLineValues = new Map<string, Decimal>();
  const ytdLineValues = new Map<string, Decimal>();
  const priorMonthLineValues = new Map<string, Decimal>();
  const priorYearLineValues = new Map<string, Decimal>();

  const lines: GeneratedLine[] = [];

  for (const mapping of sorted) {
    const current = computeValue(mapping, currentMonthTB, currentLineValues);
    const ytd = computeValue(mapping, ytdTB, ytdLineValues);
    const prior = priorMonthTB ? computeValue(mapping, priorMonthTB, priorMonthLineValues) : null;
    const priorYr = priorYearTB ? computeValue(mapping, priorYearTB, priorYearLineValues) : null;

    // Variance = currentMonth - priorMonth
    const variance = prior !== null ? current.minus(prior) : null;
    const variancePct =
      variance !== null && prior !== null && !prior.isZero()
        ? variance.div(prior.abs()).times(100).toDecimalPlaces(4)
        : null;

    currentLineValues.set(mapping.oemLineNumber, current);
    ytdLineValues.set(mapping.oemLineNumber, ytd);
    if (prior !== null) priorMonthLineValues.set(mapping.oemLineNumber, prior);
    if (priorYr !== null) priorYearLineValues.set(mapping.oemLineNumber, priorYr);

    lines.push({
      oemLineNumber: mapping.oemLineNumber,
      oemLineLabel: mapping.oemLineLabel,
      oemSection: mapping.oemSection,
      currentMonth: current,
      yearToDate: ytd,
      priorMonth: prior,
      priorYear: priorYr,
      variance,
      variancePct,
      displayOrder: mapping.displayOrder,
      isSubtotal: mapping.isSubtotal,
      isTotal: mapping.isTotal,
      glAccountCodes: mapping.glAccountCodes,
    });
  }

  return lines;
}

function computeValue(
  mapping: MappingLine,
  tb: Map<string, Decimal>,
  lineValues: Map<string, Decimal>,
): Decimal {
  if (mapping.calculationType === 'FORMULA' && mapping.formula) {
    try {
      return evaluateFormula(mapping.formula, lineValues);
    } catch {
      return new Decimal(0);
    }
  }

  if (mapping.calculationType === 'DIFFERENCE') {
    // DIFFERENCE: first GL code is minuend, rest are subtracted
    const codes = mapping.glAccountCodes;
    if (codes.length === 0) return new Decimal(0);
    const first = tb.get(codes[0]) ?? new Decimal(0);
    const rest = codes.slice(1).reduce(
      (acc, code) => acc.plus(tb.get(code) ?? new Decimal(0)),
      new Decimal(0),
    );
    return first.minus(rest);
  }

  // Default: SUM
  return mapping.glAccountCodes.reduce(
    (acc, code) => acc.plus(tb.get(code) ?? new Decimal(0)),
    new Decimal(0),
  );
}

/**
 * Build a GL account balance map from a trial balance array.
 * Keyed by accountCode. Net balance = debit balance for revenue/expense sign convention.
 */
export function buildAccountMap(accounts: TrialBalanceAccount[]): Map<string, Decimal> {
  const map = new Map<string, Decimal>();
  for (const acct of accounts) {
    map.set(acct.accountCode, acct.balance);
  }
  return map;
}
