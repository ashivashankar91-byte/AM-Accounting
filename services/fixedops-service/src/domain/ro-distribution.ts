import { assertConserves, sumCents, toCents } from './money';
import { DistributionConservationError, FixedOpsValidationError } from './errors';

export type PayType = 'C' | 'W' | 'I';
export type LineCategory = 'LABOR' | 'PARTS' | 'SUBLET' | 'MISC' | 'FEE';

export interface RoCloseLineInput {
  lineId: string;
  payType: PayType;
  category: LineCategory;
  opcode?: string | null;
  techId?: string | null;
  partNumber?: string | null;
  saleAmount: number | string;
  costAmount?: number | string;
  taxAmount?: number | string;
  taxResultId?: string | null;
}

export interface RoCloseRequest {
  tenantId: string;
  legalEntityId: string;
  storeId: string;
  roNumber: string;
  businessDate: string;
  totalSaleAmount: number | string;
  lines: RoCloseLineInput[];
}

/** S059 AC: mixed-pay conservation — Σ segments = RO totals to the cent. */
export function assertRoCloseConserves(req: RoCloseRequest): void {
  if (req.lines.length === 0) {
    throw new FixedOpsValidationError('NO_LINES', 'RO close requires at least one distribution line');
  }
  for (const line of req.lines) {
    if (!['C', 'W', 'I'].includes(line.payType)) {
      throw new FixedOpsValidationError('INVALID_PAY_TYPE', `Line ${line.lineId} has invalid payType ${line.payType}`);
    }
    if (!['LABOR', 'PARTS', 'SUBLET', 'MISC', 'FEE'].includes(line.category)) {
      throw new FixedOpsValidationError('INVALID_CATEGORY', `Line ${line.lineId} has invalid category ${line.category}`);
    }
  }
  try {
    assertConserves(req.totalSaleAmount, req.lines.map((l) => l.saleAmount), `RO ${req.roNumber} close distribution`);
  } catch (err) {
    if (err instanceof Error) throw new DistributionConservationError(err.message);
    throw err;
  }
}

export function payTypeMixLabel(lines: RoCloseLineInput[]): string {
  const present = Array.from(new Set(lines.map((l) => l.payType))).sort();
  return present.join('+');
}

export function groupByPayType(lines: RoCloseLineInput[]): Record<PayType, RoCloseLineInput[]> {
  const out: Record<PayType, RoCloseLineInput[]> = { C: [], W: [], I: [] };
  for (const l of lines) out[l.payType].push(l);
  return out;
}

export function sumSaleCents(lines: RoCloseLineInput[]): number {
  return sumCents(lines.map((l) => l.saleAmount));
}

export function sumCostCents(lines: RoCloseLineInput[]): number {
  return sumCents(lines.map((l) => l.costAmount ?? 0));
}

export function sumTaxCents(lines: RoCloseLineInput[]): number {
  return sumCents(lines.map((l) => l.taxAmount ?? 0));
}

export { toCents };
