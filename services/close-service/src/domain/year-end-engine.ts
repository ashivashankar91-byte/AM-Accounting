import { Decimal } from '@prisma/client/runtime/library';

export interface YearEndPreviewItem {
  accountCode: string;
  description: string;
  balance: Decimal;
  closingEntry: Decimal;
}

export function buildYearEndIdempotencyKey(tenantId: string, legalEntityId: string, fiscalYear: number): string {
  return `year-end:${tenantId}:${legalEntityId}:${fiscalYear}`;
}

export function computeRetainedEarningsImpact(items: YearEndPreviewItem[]): Decimal {
  return items.reduce((sum, item) => sum.plus(item.closingEntry), new Decimal(0));
}
