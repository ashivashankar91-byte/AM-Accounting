// AMACC dashboard rebuild — centralized currency/period formatting.
//
// Single formatter module consumed by all 3 accounting surfaces per the
// build brief: "Currency and period formatting is centralized... Whole
// dollars for anything over $10K, cents below. Negative values in
// parentheses, not with a minus sign — that is the accounting convention
// and controllers read it faster." No component may call
// `toLocaleString`/`Intl.NumberFormat` directly for a dealership money
// value — everything routes through here so the convention can never
// silently drift screen to screen.

const WHOLE_DOLLAR_THRESHOLD = 10_000;

/**
 * Formats a dollar amount per dealership accounting convention:
 * - |amount| >= $10,000 → whole dollars, no cents
 * - |amount| <  $10,000 → 2 decimal places
 * - negative → parentheses, never a leading minus sign
 * - always thousands-separated
 */
export function formatCurrency(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '—';
  const abs = Math.abs(amount);
  const decimals = abs >= WHOLE_DOLLAR_THRESHOLD ? 0 : 2;
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const withSymbol = `$${formatted}`;
  return amount < 0 ? `(${withSymbol})` : withSymbol;
}

/** Compact form for tile headlines where space is tight (e.g. "$147.2K",
 * "$1.4M") — still parenthesized for negatives, still routes through the
 * one threshold/negative convention. Never used for anything that must
 * tie out exactly (statement grids, drill-through tables) — use
 * `formatCurrency` there. */
export function formatCurrencyCompact(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '—';
  const abs = Math.abs(amount);
  let compact: string;
  if (abs >= 1_000_000) {
    compact = `$${(abs / 1_000_000).toFixed(1)}M`;
  } else if (abs >= 1_000) {
    compact = `$${(abs / 1_000).toFixed(1)}K`;
  } else {
    compact = formatCurrency(abs);
  }
  return amount < 0 ? `(${compact})` : compact;
}

/** Percentages: one decimal place, parentheses for negative, `—` for null.
 * `value` is a ratio (0.08 → "8.0%"), matching what every formula in
 * `metrics/formulas.ts` returns for PERCENT-unit metrics. */
export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const pct = value * 100;
  const formatted = `${Math.abs(pct).toFixed(decimals)}%`;
  return pct < 0 ? `(${formatted})` : formatted;
}

/** Plain counts/days/ratios — no currency symbol, still parenthesized if
 * negative (variance counts can be negative, e.g. schedule variance). */
export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const formatted = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return value < 0 ? `(${formatted})` : formatted;
}

export function formatDays(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return '—';
  return `${formatNumber(days)} day${Math.abs(days) === 1 ? '' : 's'}`;
}

/** Accounting period label, e.g. "07/2026" — matches the format already
 * used in GL Trial Balance / statement headers elsewhere in the app. */
export function formatPeriod(year: number, month: number): string {
  return `${String(month).padStart(2, '0')}/${year}`;
}

/** Relative "as of" freshness label for the honest-staleness requirement
 * ("Include `as_of`... so the UI can show honest staleness."). */
export function formatFreshness(asOf: string | Date | null | undefined): string {
  if (!asOf) return 'freshness unknown';
  const asOfDate = typeof asOf === 'string' ? new Date(asOf) : asOf;
  const ms = Date.now() - asOfDate.getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'as of just now';
  if (minutes < 60) return `as of ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `as of ${hours}h ago`;
  const days = Math.round(hours / 24);
  return `as of ${days}d ago`;
}
