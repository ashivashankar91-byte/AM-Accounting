import { Decimal } from '@prisma/client/runtime/library';

export type TranslationMethod = 'CURRENT_RATE' | 'AVERAGE_RATE' | 'HISTORICAL_RATE';

export interface TranslationLine {
  accountCode: string;
  accountType: 'BALANCE_SHEET' | 'INCOME_STATEMENT' | 'EQUITY';
  functionalAmount: Decimal;
  method: TranslationMethod;
}

export function translateLine(line: TranslationLine, rate: Decimal): Decimal {
  return line.functionalAmount.mul(rate);
}

export function computeCta(results: Array<{ functionalAmount: Decimal; translatedAmount: Decimal }>): Decimal {
  const functionalTotal = results.reduce((s, r) => s.plus(r.functionalAmount), new Decimal(0));
  const translatedTotal = results.reduce((s, r) => s.plus(r.translatedAmount), new Decimal(0));
  return translatedTotal.minus(functionalTotal);
}

export function buildTranslationIdempotencyKey(tenantId: string, legalEntityId: string, periodYear: number, periodMonth: number): string {
  return `translation:${tenantId}:${legalEntityId}:${periodYear}:${periodMonth}`;
}
