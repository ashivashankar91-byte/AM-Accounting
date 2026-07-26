// S208 — Fiscal Calendar domain logic (pure, no I/O).
// Deterministic period generation and date->period resolution. These functions
// are the property-tested core (BR208-5); the service layer only persists their
// output and emits events.

export type FiscalStructure = 'TWELVE' | 'TWELVE_PLUS_13TH';
export type CalendarStatus = 'DEFINED' | 'LOCKED';

export interface GeneratedPeriod {
  periodNumber: number; // 1-13
  code: string; // YYYY-MM (1-12) | YYYY-13 (13th)
  startDate: string; // ISO YYYY-MM-DD
  endDate: string; // ISO YYYY-MM-DD
  adjustmentsOnly: boolean;
}

const MONTH_NAMES_FMT = (year: number, month1to12: number): string =>
  `${year}-${String(month1to12).padStart(2, '0')}`;

/** Last calendar day of a month (1-12), leap-year aware. */
export function lastDayOfMonth(year: number, month1to12: number): number {
  // Day 0 of next month == last day of this month. Handles Feb/leap years.
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

function isoDate(year: number, month1to12: number, day: number): string {
  return `${year}-${String(month1to12).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Generate the periods for one fiscal year.
 *
 * fyStartMonth is the calendar month (1-12) the fiscal year opens on. The 12
 * regular periods tile consecutive calendar months contiguously (no gaps, no
 * overlaps). Each regular period's `code` is the calendar YYYY-MM it covers, so
 * a date resolves to the period whose calendar month contains it (AC: 2026-08-15
 * -> 2026-08). The optional 13th period (TWELVE_PLUS_13TH) is an adjustments-only
 * bucket pinned to the fiscal year's last day and excluded from date resolution.
 */
export function generatePeriods(
  fiscalYear: number,
  fyStartMonth: number,
  structure: FiscalStructure,
): GeneratedPeriod[] {
  const periods: GeneratedPeriod[] = [];
  let lastRegularYear = fiscalYear;
  let lastRegularMonth = fyStartMonth;

  for (let k = 0; k < 12; k++) {
    const monthIndex = fyStartMonth - 1 + k; // 0-based months since FY start
    const year = fiscalYear + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1; // 1-12
    const endDay = lastDayOfMonth(year, month);
    periods.push({
      periodNumber: k + 1,
      code: MONTH_NAMES_FMT(year, month),
      startDate: isoDate(year, month, 1),
      endDate: isoDate(year, month, endDay),
      adjustmentsOnly: false,
    });
    lastRegularYear = year;
    lastRegularMonth = month;
  }

  if (structure === 'TWELVE_PLUS_13TH') {
    const endDay = lastDayOfMonth(lastRegularYear, lastRegularMonth);
    // Pinned to the fiscal year's last day; not date-resolvable (adjustments only).
    periods.push({
      periodNumber: 13,
      code: `${fiscalYear}-13`,
      startDate: isoDate(lastRegularYear, lastRegularMonth, endDay),
      endDate: isoDate(lastRegularYear, lastRegularMonth, endDay),
      adjustmentsOnly: true,
    });
  }

  return periods;
}

/** How many periods a structure yields (BR208-2 count assertion). */
export function periodCountFor(structure: FiscalStructure): number {
  return structure === 'TWELVE_PLUS_13TH' ? 13 : 12;
}

export interface ResolvablePeriod {
  code: string;
  startDate: string; // ISO YYYY-MM-DD
  endDate: string; // ISO YYYY-MM-DD
  adjustmentsOnly: boolean;
}

/**
 * Resolve a calendar date to exactly one regular period (BR208-5).
 * Adjustments-only periods (13th) are excluded so resolution stays deterministic
 * even though the 13th period shares a boundary day with period 12. Returns the
 * matching period, or null if the date falls outside any generated period.
 */
export function resolveDate<T extends ResolvablePeriod>(
  date: string, // ISO YYYY-MM-DD
  periods: T[],
): T | null {
  const match = periods.filter(
    (p) => !p.adjustmentsOnly && p.startDate <= date && date <= p.endDate,
  );
  // Contiguous monthly tiling guarantees 0 or 1 match; never ambiguous.
  return match.length === 1 ? match[0]! : null;
}

/** Validate a fiscal-year start month (1-12). Returns a reason or null. */
export function validateFyStartMonth(m: number): string | null {
  if (!Number.isInteger(m) || m < 1 || m > 12) {
    return `fyStartMonth must be an integer 1-12, got ${m}`;
  }
  return null;
}
