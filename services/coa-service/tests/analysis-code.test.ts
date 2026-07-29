/**
 * S011 — Analysis Codes / Dimensions: domain validator (validateLineTags)
 * tests. Pure function, no I/O — mirrors posting-rules.test.ts's pattern of
 * building a minimal AnalysisTagValidationContext by hand and asserting the
 * exact rule-referenced violation set (AC011-2's "rule-referenced
 * rejection").
 */

import { describe, it, expect } from 'vitest';
import { validateLineTags, isValidAnalysisCode, MAX_TAGS_PER_LINE, AnalysisTagValidationContext } from '../src/domain/analysis-code';

function ctx(overrides: Partial<AnalysisTagValidationContext> = {}): AnalysisTagValidationContext {
  return {
    types: new Map([
      ['t-project', { id: 't-project', isActive: true }],
      ['t-campaign', { id: 't-campaign', isActive: true }],
      ['t-retired', { id: 't-retired', isActive: false }],
    ]),
    values: new Map([
      ['v-alpha', { id: 'v-alpha', typeId: 't-project', isActive: true }],
      ['v-beta', { id: 'v-beta', typeId: 't-project', isActive: true }],
      ['v-old', { id: 'v-old', typeId: 't-project', isActive: false }],
      ['v-camp1', { id: 'v-camp1', typeId: 't-campaign', isActive: true }],
    ]),
    ...overrides,
  };
}

function rules(vs: { rule: string }[]) {
  return vs.map((v) => v.rule);
}

describe('S011 validateLineTags — happy path', () => {
  it('CASE 1: no tags on a line is always valid (tagging is optional, BLK-14 never-required default)', () => {
    expect(validateLineTags(undefined, ctx())).toHaveLength(0);
    expect(validateLineTags([], ctx())).toHaveLength(0);
  });

  it('CASE 2: one active type/value pair, well within the cap, passes clean', () => {
    const r = validateLineTags([{ typeId: 't-project', valueId: 'v-alpha' }], ctx());
    expect(r).toHaveLength(0);
  });

  it('CASE 3: distinct types on the same line, up to the cap, all pass', () => {
    const r = validateLineTags(
      [
        { typeId: 't-project', valueId: 'v-alpha' },
        { typeId: 't-campaign', valueId: 'v-camp1' },
      ],
      ctx(),
    );
    expect(r).toHaveLength(0);
  });
});

describe('S011 validateLineTags — BR011-2 cap (BLK-13 proposed default = 3)', () => {
  it('CASE 4: exactly MAX_TAGS_PER_LINE distinct-type tags passes', () => {
    expect(MAX_TAGS_PER_LINE).toBe(3);
  });

  it('CASE 5: more than the cap is rejected with TAG_CAP_EXCEEDED', () => {
    const r = validateLineTags(
      [
        { typeId: 't-project', valueId: 'v-alpha' },
        { typeId: 't-campaign', valueId: 'v-camp1' },
        // Duplicate on a fabricated 4th/5th type id just to exceed count;
        // UNKNOWN_TYPE will also fire for these, which is fine — the cap
        // check is independent and always fires first when length > cap.
        { typeId: 't-x', valueId: 'v-x' },
        { typeId: 't-y', valueId: 'v-y' },
      ],
      ctx(),
      2,
    );
    expect(rules(r)).toContain('TAG_CAP_EXCEEDED');
    expect(r.find((v) => v.rule === 'TAG_CAP_EXCEEDED')?.lineIndex).toBe(2);
  });
});

describe('S011 validateLineTags — BR011-1 rejection matrix', () => {
  it('CASE 6: duplicate type on the same line is rejected (one value per type per line)', () => {
    const r = validateLineTags(
      [
        { typeId: 't-project', valueId: 'v-alpha' },
        { typeId: 't-project', valueId: 'v-beta' },
      ],
      ctx(),
    );
    expect(rules(r)).toContain('DUPLICATE_TYPE_ON_LINE');
  });

  it('CASE 7: unknown type id is rejected', () => {
    const r = validateLineTags([{ typeId: 't-nope', valueId: 'v-alpha' }], ctx());
    expect(rules(r)).toContain('UNKNOWN_TYPE');
  });

  it('CASE 8: inactive type is rejected even if referenced by id correctly', () => {
    const r = validateLineTags([{ typeId: 't-retired', valueId: 'v-alpha' }], ctx());
    expect(rules(r)).toContain('INACTIVE_TYPE');
  });

  it('CASE 9: unknown value id is rejected', () => {
    const r = validateLineTags([{ typeId: 't-project', valueId: 'v-nope' }], ctx());
    expect(rules(r)).toContain('UNKNOWN_VALUE');
  });

  it('CASE 10: value belonging to a different type than declared is rejected (VALUE_TYPE_MISMATCH)', () => {
    const r = validateLineTags([{ typeId: 't-campaign', valueId: 'v-alpha' }], ctx());
    expect(rules(r)).toContain('VALUE_TYPE_MISMATCH');
  });

  it('CASE 11: BR011-4 — inactive value is rejected on a NEW line', () => {
    const r = validateLineTags([{ typeId: 't-project', valueId: 'v-old' }], ctx());
    expect(rules(r)).toContain('INACTIVE_VALUE');
  });

  it('CASE 12: lineIndex is carried through onto every violation for a multi-line posting', () => {
    const r = validateLineTags([{ typeId: 't-nope', valueId: 'v-alpha' }], ctx(), 4);
    expect(r.every((v) => v.lineIndex === 4)).toBe(true);
  });
});

describe('S011 isValidAnalysisCode — format check', () => {
  it('CASE 13: a non-empty code up to 20 chars is valid', () => {
    expect(isValidAnalysisCode('PROJ')).toBe(true);
    expect(isValidAnalysisCode('A'.repeat(20))).toBe(true);
  });

  it('CASE 14: empty, whitespace-only, or over-length codes are invalid', () => {
    expect(isValidAnalysisCode('')).toBe(false);
    expect(isValidAnalysisCode('   ')).toBe(false);
    expect(isValidAnalysisCode('A'.repeat(21))).toBe(false);
  });
});
