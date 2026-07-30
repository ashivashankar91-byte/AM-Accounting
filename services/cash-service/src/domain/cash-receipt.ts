// S052 — receipt tender validation (pure, no I/O). The single rule source
// for "receipt total must exactly equal the sum of net tender amounts" —
// both ReceiptService.createReceipt and any future validate-before-submit
// path must call this, never re-implement the sum check inline.

import { toCents } from './money';
import type { Violation } from './cash-drawer';

export type TenderType = 'CASH' | 'CHECK';

export interface TenderInput {
  tenderType: TenderType;
  amount: number | string;
  cashTendered?: number | string | null;
  checkNumber?: string | null;
  checkPayer?: string | null;
}

export interface ValidatedTender {
  tenderType: TenderType;
  amountCents: number;
  cashTenderedCents: number | null;
  changeGivenCents: number | null;
  checkNumber: string | null;
  checkPayer: string | null;
}

export interface TenderValidationResult {
  pass: boolean;
  violations: Violation[];
  tenders: ValidatedTender[];
  totalTenderedCents: number;
}

/**
 * BR: at least one tender line; every tenderType is CASH or CHECK; every
 * amount is a positive integer number of cents; a CASH line's cashTendered
 * (if given) must cover its amount (change = cashTendered - amount, never
 * negative); the sum of tender amounts must equal totalAmountCents EXACTLY
 * — a one-cent mismatch is rejected, never rounded away.
 */
export function validateTenders(totalAmountCents: number, tenders: TenderInput[]): TenderValidationResult {
  const violations: Violation[] = [];
  const validated: ValidatedTender[] = [];

  if (!Number.isFinite(totalAmountCents) || totalAmountCents <= 0) {
    violations.push({ rule: 'S052-RCPT-1', field: 'totalAmount', diagnostic: 'totalAmount must be a positive amount' });
  }

  if (!tenders || tenders.length === 0) {
    violations.push({ rule: 'S052-RCPT-2', field: 'tenders', diagnostic: 'at least one tender is required' });
  }

  let sumCents = 0;
  (tenders ?? []).forEach((t, i) => {
    if (t.tenderType !== 'CASH' && t.tenderType !== 'CHECK') {
      violations.push({ rule: 'S052-RCPT-3', field: `tenders[${i}].tenderType`, diagnostic: 'tenderType must be CASH or CHECK' });
      return;
    }
    const amountCents = toCents(t.amount);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      violations.push({ rule: 'S052-RCPT-4', field: `tenders[${i}].amount`, diagnostic: 'tender amount must be a positive amount' });
      return;
    }

    let cashTenderedCents: number | null = null;
    let changeGivenCents: number | null = null;
    if (t.tenderType === 'CASH') {
      cashTenderedCents = t.cashTendered === null || t.cashTendered === undefined ? amountCents : toCents(t.cashTendered);
      if (!Number.isFinite(cashTenderedCents) || cashTenderedCents < 0) {
        violations.push({ rule: 'S052-RCPT-5', field: `tenders[${i}].cashTendered`, diagnostic: 'cashTendered must be a non-negative amount' });
      } else if (cashTenderedCents < amountCents) {
        violations.push({ rule: 'S052-RCPT-6', field: `tenders[${i}].cashTendered`, diagnostic: 'cashTendered cannot be less than the cash tender amount' });
      } else {
        changeGivenCents = cashTenderedCents - amountCents;
      }
    }

    sumCents += amountCents;
    validated.push({
      tenderType: t.tenderType,
      amountCents,
      cashTenderedCents,
      changeGivenCents,
      checkNumber: t.tenderType === 'CHECK' ? (t.checkNumber ?? null) : null,
      checkPayer: t.tenderType === 'CHECK' ? (t.checkPayer ?? null) : null,
    });
  });

  if (violations.length === 0 && sumCents !== totalAmountCents) {
    violations.push({
      rule: 'S052-RCPT-7',
      field: 'tenders',
      diagnostic: `Tender total (${(sumCents / 100).toFixed(2)}) must exactly equal the receipt total (${(totalAmountCents / 100).toFixed(2)})`,
    });
  }

  return { pass: violations.length === 0, violations, tenders: validated, totalTenderedCents: sumCents };
}
