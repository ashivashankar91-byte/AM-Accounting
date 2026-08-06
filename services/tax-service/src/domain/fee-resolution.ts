import { resolveEffective } from './effective-dating';

export interface FeeTableRow {
  id: string;
  feeCode: string;
  name: string;
  jurisdictionRef: string;
  basis: 'FIXED_PER_UNIT' | 'FIXED_PER_DOCUMENT' | 'PERCENT_OF_BASE';
  amount: string | null;
  ratePercent: string | null;
  taxabilityFlag: boolean;
  effectiveFrom: string | Date;
  effectiveTo?: string | Date | null;
  active: boolean;
  applicabilityTags: Array<{ itemClassCode: string | null; documentTypeCode: string | null }>;
}

/**
 * Deterministic resolution: given the full set of a tenant/entity's fee
 * tables, returns the ones effective at businessDate whose applicability
 * tags match itemClassCode/documentTypeCode. An empty/no-match result is
 * truthful — no fee applies, nothing errors, nothing is estimated (S125
 * AC3).
 */
export function resolveApplicableFees(
  feeTables: readonly FeeTableRow[],
  businessDate: string | Date,
  itemClassCode: string,
  documentTypeCode: string,
): FeeTableRow[] {
  const active = feeTables.filter((f) => f.active);
  const effective = resolveEffective(active, businessDate);
  return effective.filter((f) =>
    f.applicabilityTags.length === 0
      ? false
      : f.applicabilityTags.some(
          (tag) =>
            (tag.itemClassCode == null || tag.itemClassCode === itemClassCode) &&
            (tag.documentTypeCode == null || tag.documentTypeCode === documentTypeCode),
        ),
  );
}

/** Validates exactly one of amount/ratePercent is set, per basis. Throws a
 * descriptive error string (caller wraps in TaxServiceValidationError) —
 * never silently defaults the missing one to zero. */
export function validateFeeAmountBasis(basis: string, amount: string | null | undefined, ratePercent: string | null | undefined): string | null {
  const hasAmount = amount !== null && amount !== undefined;
  const hasRate = ratePercent !== null && ratePercent !== undefined;
  if (basis === 'PERCENT_OF_BASE') {
    if (!hasRate || hasAmount) return 'PERCENT_OF_BASE requires ratePercent only (not amount)';
  } else {
    if (!hasAmount || hasRate) return `${basis} requires amount only (not ratePercent)`;
  }
  return null;
}
