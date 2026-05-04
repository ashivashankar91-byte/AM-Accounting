/**
 * Gap 5: Multi-currency support for GL.
 * Maintains exchange rates and provides conversion utilities.
 * Uses mock rates when no external FX feed is configured.
 */

export interface ExchangeRate {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  effectiveDate: string;
  source: string;
}

// ── Mock exchange rates (updated daily in production via FX feed) ───
const MOCK_RATES: ExchangeRate[] = [
  { fromCurrency: 'USD', toCurrency: 'CAD', rate: 1.3650, effectiveDate: '2025-06-01', source: 'mock' },
  { fromCurrency: 'USD', toCurrency: 'EUR', rate: 0.9230, effectiveDate: '2025-06-01', source: 'mock' },
  { fromCurrency: 'USD', toCurrency: 'GBP', rate: 0.7920, effectiveDate: '2025-06-01', source: 'mock' },
  { fromCurrency: 'USD', toCurrency: 'MXN', rate: 17.1500, effectiveDate: '2025-06-01', source: 'mock' },
  { fromCurrency: 'USD', toCurrency: 'JPY', rate: 157.4500, effectiveDate: '2025-06-01', source: 'mock' },
  { fromCurrency: 'CAD', toCurrency: 'USD', rate: 0.7326, effectiveDate: '2025-06-01', source: 'mock' },
  { fromCurrency: 'EUR', toCurrency: 'USD', rate: 1.0834, effectiveDate: '2025-06-01', source: 'mock' },
  { fromCurrency: 'GBP', toCurrency: 'USD', rate: 1.2626, effectiveDate: '2025-06-01', source: 'mock' },
  { fromCurrency: 'MXN', toCurrency: 'USD', rate: 0.0583, effectiveDate: '2025-06-01', source: 'mock' },
];

export class ExchangeRateService {
  private rates: ExchangeRate[] = [...MOCK_RATES];

  getRate(from: string, to: string): ExchangeRate | null {
    if (from === to) return { fromCurrency: from, toCurrency: to, rate: 1.0, effectiveDate: new Date().toISOString().slice(0, 10), source: 'identity' };
    return this.rates.find((r) => r.fromCurrency === from && r.toCurrency === to) ?? null;
  }

  convert(amount: number, from: string, to: string): { convertedAmount: number; rate: number; fromCurrency: string; toCurrency: string } {
    const rateObj = this.getRate(from, to);
    if (!rateObj) {
      // Try triangulation through USD
      const toUSD = this.getRate(from, 'USD');
      const fromUSD = this.getRate('USD', to);
      if (toUSD && fromUSD) {
        const triangulated = toUSD.rate * fromUSD.rate;
        return { convertedAmount: Math.round(amount * triangulated * 100) / 100, rate: triangulated, fromCurrency: from, toCurrency: to };
      }
      throw new Error(`No exchange rate found for ${from} → ${to}`);
    }
    return {
      convertedAmount: Math.round(amount * rateObj.rate * 100) / 100,
      rate: rateObj.rate,
      fromCurrency: from,
      toCurrency: to,
    };
  }

  getAllRates(): ExchangeRate[] {
    return [...this.rates];
  }

  addRate(rate: ExchangeRate): void {
    // Replace existing rate pair or add new
    const idx = this.rates.findIndex((r) => r.fromCurrency === rate.fromCurrency && r.toCurrency === rate.toCurrency);
    if (idx >= 0) this.rates[idx] = rate;
    else this.rates.push(rate);
  }

  getSupportedCurrencies(): string[] {
    const currencies = new Set<string>();
    for (const r of this.rates) {
      currencies.add(r.fromCurrency);
      currencies.add(r.toCurrency);
    }
    return Array.from(currencies).sort();
  }
}
