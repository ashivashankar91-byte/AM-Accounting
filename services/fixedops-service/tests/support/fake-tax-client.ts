import type { TaxClient, TaxCalculationRequest, TaxCalculationResult } from '../../src/infrastructure/tax-client';

export class FakeTaxClient implements TaxClient {
  public nextResult: Partial<TaxCalculationResult> | null = null;
  readonly requests: TaxCalculationRequest[] = [];

  async calculate(request: TaxCalculationRequest): Promise<TaxCalculationResult> {
    this.requests.push(request);
    const totalBase = request.lines.reduce((acc, l) => acc + Number(l.amount), 0);
    const totalTax = Math.round(totalBase * 0.08 * 100) / 100;
    return {
      taxResultId: `tax-${request.idempotencyKey}`,
      status: 'CALCULATED',
      totalTax: String(totalTax),
      totalTaxableBase: String(totalBase),
      currency: request.currency,
      lines: request.lines.map((l) => ({ lineId: l.lineId, taxAmount: String(Math.round(Number(l.amount) * 0.08 * 100) / 100) })),
      ...this.nextResult,
    };
  }
}
