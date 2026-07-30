import { describe, it, expect } from 'vitest';
import { validateTenders } from '../src/domain/cash-receipt';

describe('validateTenders', () => {
  it('accepts an exact single CASH tender with no change', () => {
    const r = validateTenders(5000, [{ tenderType: 'CASH', amount: 50 }]);
    expect(r.pass).toBe(true);
    expect(r.tenders[0].changeGivenCents).toBe(0);
  });

  it('computes change when cashTendered exceeds the cash tender amount', () => {
    const r = validateTenders(4500, [{ tenderType: 'CASH', amount: 45, cashTendered: 50 }]);
    expect(r.pass).toBe(true);
    expect(r.tenders[0].cashTenderedCents).toBe(5000);
    expect(r.tenders[0].changeGivenCents).toBe(500);
  });

  it('rejects cashTendered less than the cash tender amount', () => {
    const r = validateTenders(4500, [{ tenderType: 'CASH', amount: 45, cashTendered: 40 }]);
    expect(r.pass).toBe(false);
    expect(r.violations.some((v) => v.rule === 'S052-RCPT-6')).toBe(true);
  });

  it('accepts an exact single CHECK tender', () => {
    const r = validateTenders(12000, [{ tenderType: 'CHECK', amount: 120, checkNumber: '1001' }]);
    expect(r.pass).toBe(true);
    expect(r.tenders[0].checkNumber).toBe('1001');
  });

  it('accepts an exact split CASH/CHECK tender', () => {
    const r = validateTenders(10000, [
      { tenderType: 'CASH', amount: 40 },
      { tenderType: 'CHECK', amount: 60, checkNumber: '2002' },
    ]);
    expect(r.pass).toBe(true);
    expect(r.totalTenderedCents).toBe(10000);
  });

  it('rejects a one-cent tender mismatch', () => {
    const r = validateTenders(10000, [{ tenderType: 'CASH', amount: 99.99 }]);
    expect(r.pass).toBe(false);
    expect(r.violations.some((v) => v.rule === 'S052-RCPT-7')).toBe(true);
  });

  it('rejects a negative tender amount', () => {
    const r = validateTenders(10000, [{ tenderType: 'CASH', amount: -10 }]);
    expect(r.pass).toBe(false);
    expect(r.violations.some((v) => v.rule === 'S052-RCPT-4')).toBe(true);
  });

  it('rejects a zero tender amount', () => {
    const r = validateTenders(0, [{ tenderType: 'CASH', amount: 0 }]);
    expect(r.pass).toBe(false);
  });

  it('rejects when no tenders are supplied', () => {
    const r = validateTenders(5000, []);
    expect(r.pass).toBe(false);
    expect(r.violations.some((v) => v.rule === 'S052-RCPT-2')).toBe(true);
  });

  it('rejects an unknown tender type', () => {
    const r = validateTenders(5000, [{ tenderType: 'CARD' as any, amount: 50 }]);
    expect(r.pass).toBe(false);
    expect(r.violations.some((v) => v.rule === 'S052-RCPT-3')).toBe(true);
  });
});
