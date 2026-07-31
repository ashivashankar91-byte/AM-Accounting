import { describe, it, expect } from 'vitest';
import { formatCurrency, formatCurrencyCompact, formatPercent, formatNumber, formatDays, formatPeriod, formatFreshness } from './format';

describe('formatCurrency', () => {
  it('renders whole dollars with no cents at or above the $10,000 threshold', () => {
    expect(formatCurrency(147_200)).toBe('$147,200');
    expect(formatCurrency(10_000)).toBe('$10,000');
  });
  it('renders 2 decimal places below the threshold', () => {
    expect(formatCurrency(9_999.5)).toBe('$9,999.50');
    expect(formatCurrency(42)).toBe('$42.00');
  });
  it('renders negatives in parentheses, never a minus sign', () => {
    expect(formatCurrency(-1_500)).not.toContain('-');
    expect(formatCurrency(-1_500)).toBe('($1,500.00)');
    expect(formatCurrency(-25_000)).toBe('($25,000)');
  });
  it('renders "—" for null/undefined/NaN rather than $0', () => {
    expect(formatCurrency(null)).toBe('—');
    expect(formatCurrency(undefined)).toBe('—');
    expect(formatCurrency(NaN)).toBe('—');
  });
  it('handles exactly zero as a real value, not "unavailable"', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });
});

describe('formatCurrencyCompact', () => {
  it('renders millions/thousands compactly', () => {
    expect(formatCurrencyCompact(1_400_000)).toBe('$1.4M');
    expect(formatCurrencyCompact(147_200)).toBe('$147.2K');
  });
  it('renders negatives in parentheses', () => {
    expect(formatCurrencyCompact(-147_200)).toBe('($147.2K)');
  });
  it('falls back to formatCurrency below $1,000', () => {
    expect(formatCurrencyCompact(500)).toBe('$500.00');
  });
});

describe('formatPercent', () => {
  it('renders a ratio as a percentage with one decimal by default', () => {
    expect(formatPercent(0.08)).toBe('8.0%');
  });
  it('renders negative percentages in parentheses', () => {
    expect(formatPercent(-0.05)).toBe('(5.0%)');
  });
  it('renders "—" for null', () => {
    expect(formatPercent(null)).toBe('—');
  });
});

describe('formatNumber', () => {
  it('formats with thousands separators', () => {
    expect(formatNumber(12_345)).toBe('12,345');
  });
  it('parenthesizes negatives', () => {
    expect(formatNumber(-42)).toBe('(42)');
  });
  it('renders "—" for null', () => {
    expect(formatNumber(null)).toBe('—');
  });
});

describe('formatDays', () => {
  it('pluralizes correctly', () => {
    expect(formatDays(1)).toBe('1 day');
    expect(formatDays(14)).toBe('14 days');
  });
  it('renders "—" for null', () => {
    expect(formatDays(null)).toBe('—');
  });
});

describe('formatPeriod', () => {
  it('zero-pads the month', () => {
    expect(formatPeriod(2026, 7)).toBe('07/2026');
    expect(formatPeriod(2026, 12)).toBe('12/2026');
  });
});

describe('formatFreshness', () => {
  it('reports "just now" for a timestamp seconds ago', () => {
    expect(formatFreshness(new Date(Date.now() - 5_000))).toBe('as of just now');
  });
  it('reports minutes ago', () => {
    expect(formatFreshness(new Date(Date.now() - 10 * 60_000))).toBe('as of 10 min ago');
  });
  it('reports unknown freshness when no timestamp is given', () => {
    expect(formatFreshness(null)).toBe('freshness unknown');
  });
});
