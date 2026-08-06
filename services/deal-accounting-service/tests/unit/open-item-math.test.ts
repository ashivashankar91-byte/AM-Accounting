import { describe, it, expect } from 'vitest';
import { deriveOpenItemStatus, applyOpenItemAmountCents, OverApplicationError } from '../../src/domain/open-item-math';

describe('DealOpenItem application math', () => {
  it('derives OPEN when remaining equals original', () => {
    expect(deriveOpenItemStatus(250000, 250000)).toBe('OPEN');
  });

  it('derives PARTIALLY_APPLIED when partially relieved', () => {
    expect(deriveOpenItemStatus(250000, 100000)).toBe('PARTIALLY_APPLIED');
  });

  it('derives CLOSED when fully relieved', () => {
    expect(deriveOpenItemStatus(250000, 0)).toBe('CLOSED');
  });

  it('applies a partial amount', () => {
    expect(applyOpenItemAmountCents(250000, 250000, 100000)).toBe(150000);
  });

  it('applies the full remaining amount to zero', () => {
    expect(applyOpenItemAmountCents(250000, 150000, 150000)).toBe(0);
  });

  it('refuses an over-application', () => {
    expect(() => applyOpenItemAmountCents(250000, 100000, 150001)).toThrow(OverApplicationError);
  });

  it('refuses an application that would flip the sign negative', () => {
    expect(() => applyOpenItemAmountCents(250000, 50000, 60000)).toThrow(OverApplicationError);
  });
});
