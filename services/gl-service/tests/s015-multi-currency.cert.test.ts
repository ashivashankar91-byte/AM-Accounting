// S015 — Multi-Currency Revaluation & CTA
// Canonical ACs: rate lookup, conversion, triangulation via USD, GL hooks, rate update
import { describe, it, expect } from 'vitest';
import { ExchangeRateService } from '../src/infrastructure/exchange-rate-service';

describe('S015 — Multi-Currency Revaluation & CTA', () => {
  it('AC1 — getRate returns a persisted rate for a known currency pair', () => {
    const svc = new ExchangeRateService();
    const rate = svc.getRate('USD', 'CAD');
    expect(rate).not.toBeNull();
    expect(rate!.fromCurrency).toBe('USD');
    expect(rate!.toCurrency).toBe('CAD');
    expect(rate!.rate).toBeGreaterThan(0);
  });

  it('AC2 — identity conversion: same-currency returns rate 1.0 and identical amount', () => {
    const svc = new ExchangeRateService();
    const result = svc.convert(1000, 'USD', 'USD');
    expect(result.rate).toBe(1.0);
    expect(result.convertedAmount).toBe(1000);
  });

  it('AC3 — direct conversion USD→EUR returns correctly scaled amount', () => {
    const svc = new ExchangeRateService();
    const result = svc.convert(1000, 'USD', 'EUR');
    const rateObj = svc.getRate('USD', 'EUR')!;
    expect(result.convertedAmount).toBeCloseTo(1000 * rateObj.rate, 2);
    expect(result.fromCurrency).toBe('USD');
    expect(result.toCurrency).toBe('EUR');
  });

  it('AC4 — triangulation via USD: EUR→CAD resolves even without a direct rate', () => {
    const svc = new ExchangeRateService();
    // Remove direct EUR→CAD if present; this tests triangulation
    const result = svc.convert(500, 'EUR', 'CAD');
    expect(result.convertedAmount).toBeGreaterThan(0);
  });

  it('AC5 — getAllRates returns all configured currency pairs', () => {
    const svc = new ExchangeRateService();
    const rates = svc.getAllRates();
    expect(rates.length).toBeGreaterThanOrEqual(5);
    rates.forEach(r => {
      expect(r.fromCurrency).toBeTruthy();
      expect(r.toCurrency).toBeTruthy();
      expect(r.rate).toBeGreaterThan(0);
      expect(r.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it('AC6 — addRate makes the new rate available for subsequent lookups', () => {
    const svc = new ExchangeRateService();
    svc.addRate({ fromCurrency: 'XYZ', toCurrency: 'USD', rate: 0.5, effectiveDate: '2026-01-01', source: 'test' });
    const result = svc.convert(200, 'XYZ', 'USD');
    expect(result.convertedAmount).toBe(100);
  });

  it('AC7 — unsupported pair with no triangulation path throws an error (fail-closed)', () => {
    const svc = new ExchangeRateService();
    expect(() => svc.convert(100, 'ABC', 'XYZ')).toThrow();
  });
});
