/**
 * @test computeUnitCount — tranpost.cbl INV-08 parity
 * @cobol-origin tranpost.cbl DB-ENTRY and CR-ENTRY paragraphs
 * @trace All 18 rows from the truth table in AUDIT-SUMMARY.md G-09 are covered.
 */

import { describe, it, expect, test } from 'vitest';
import { computeUnitCount } from '../domain/unit-count';

describe('computeUnitCount — tranpost.cbl INV-08 parity', () => {
  // ── 18-row truth table ──────────────────────────────────────────────────
  // [netAmount, accountType, revAdjFlag, trackUnits, expected]
  const cases: [number, string, string, boolean, number][] = [
    // Debit (netAmount > 0) rows
    [100,  'REVENUE',       ' ', true,  -1],
    [100,  'LIABILITY',     ' ', true,  -1],
    [100,  'EXPENSE',       ' ', true,   1],
    [100,  'ASSET',         ' ', true,   1],
    [100,  'COST_OF_SALES', ' ', true,   1],
    [100,  'COST_OF_SALES', 'R', true,  -1],
    [100,  'MISC',          ' ', true,   1],
    [100,  'MISC',          'R', true,  -1],
    // Credit (netAmount < 0) rows
    [-100, 'REVENUE',       ' ', true,   1],
    [-100, 'LIABILITY',     ' ', true,   1],
    [-100, 'EXPENSE',       ' ', true,  -1],
    [-100, 'ASSET',         ' ', true,  -1],
    [-100, 'COST_OF_SALES', ' ', true,   1],
    [-100, 'COST_OF_SALES', 'R', true,  -1],
    [-100, 'MISC',          ' ', true,   1],
    [-100, 'MISC',          'R', true,  -1],
    // Zero amount rows
    [0,    'REVENUE',       ' ', true,   0],
    [0,    'ASSET',         'R', true,   0],
  ];

  test.each(cases)(
    'amount=%d type=%s revAdj="%s" → %d',
    (amount, type, revAdj, trackUnits, expected) => {
      expect(computeUnitCount(amount, type, revAdj, trackUnits)).toBe(expected);
    },
  );

  // ── trackUnits = false always returns 0 ────────────────────────────────

  it('returns 0 when trackUnits is false, regardless of type or direction', () => {
    expect(computeUnitCount(100,  'REVENUE',       ' ', false)).toBe(0);
    expect(computeUnitCount(-100, 'ASSET',          ' ', false)).toBe(0);
    expect(computeUnitCount(100,  'COST_OF_SALES',  'R', false)).toBe(0);
  });

  // ── revAdjFlag = 'A' (adjustment) behaves like non-reversal ────────────
  // @trace-cobol tranpost.cbl treats "A" same as " " for sign purposes

  it('treats revAdjFlag "A" (adjustment) as non-reversal for COST_OF_SALES', () => {
    expect(computeUnitCount(100,  'COST_OF_SALES', 'A', true)).toBe(1);
    expect(computeUnitCount(-100, 'COST_OF_SALES', 'A', true)).toBe(1);
  });

  it('treats revAdjFlag "A" (adjustment) as non-reversal for MISC', () => {
    expect(computeUnitCount(100,  'MISC', 'A', true)).toBe(1);
    expect(computeUnitCount(-100, 'MISC', 'A', true)).toBe(1);
  });

  // ── Unknown account types fall through to default (COST_OF_SALES behaviour) ──

  it('unknown account type uses COST_OF_SALES/MISC rule (revAdjFlag drives sign)', () => {
    expect(computeUnitCount(100,  'UNKNOWN_TYPE', ' ', true)).toBe(1);
    expect(computeUnitCount(100,  'UNKNOWN_TYPE', 'R', true)).toBe(-1);
    expect(computeUnitCount(-100, 'UNKNOWN_TYPE', ' ', true)).toBe(1);
    expect(computeUnitCount(-100, 'UNKNOWN_TYPE', 'R', true)).toBe(-1);
  });
});
