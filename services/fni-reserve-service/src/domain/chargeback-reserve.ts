// S091(b) flat-% chargeback-reserve accrual + S091(c)/S093 shared
// chargeback-draw conservation math. Pure, deterministic, no I/O.
//
// S091(c) and S093 (product cancellations that are chargeback-reserve-
// affecting) both draw down the SAME chargeback-reserve liability using the
// SAME "draw up to the remaining balance, excess to expense" split — this
// module is the single shared function both call, so the math can never
// diverge between the two entry points (per this service's mandate).

import { allocateCents, toCents } from './money';

export class ChargebackReserveDomainError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ChargebackReserveDomainError';
  }
}

export interface AccrualComputation {
  reserveIncomeCents: number;
  /** Basis points (0-10000), derived from the configured flat percent (0-100.00). */
  accrualBp: number;
  accrualCents: number;
  /** The complementary "retained" amount — not booked anywhere by this
   *  service, computed only so the accrual is derived via the same
   *  remainder-absorbing bp-allocation technique the DSL itself uses
   *  (BR: never ad-hoc Math.round on its own). */
  retainedCents: number;
}

/** Convert a configured percent (e.g. "15.00" meaning 15%) to basis points (1500). */
export function percentToBp(percent: number | string): number {
  const n = typeof percent === 'string' ? Number(percent) : percent;
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new ChargebackReserveDomainError('INVALID_PERCENT', `chargebackReservePercent must be between 0 and 100, got ${percent}`);
  }
  return Math.round(n * 100);
}

/**
 * S091(b) — a CONFIGURED flat percentage of each reserve-income dollar
 * accrues to the chargeback-reserve liability. Deterministic basis-point
 * math, using the exact same remainder-absorbing allocateCents() the DSL
 * itself uses for a two-way split (accrual + retained) of the reserve-income
 * total — never ad-hoc rounding.
 */
export function computeChargebackAccrual(reserveIncomeAmount: number | string, chargebackReservePercent: number | string): AccrualComputation {
  const reserveIncomeCents = toCents(reserveIncomeAmount);
  if (!Number.isFinite(reserveIncomeCents) || reserveIncomeCents < 0) {
    throw new ChargebackReserveDomainError('INVALID_AMOUNT', `reserveIncomeAmount must be a non-negative decimal amount, got ${reserveIncomeAmount}`);
  }
  const accrualBp = percentToBp(chargebackReservePercent);
  const [accrualCents, retainedCents] = allocateCents(reserveIncomeCents, [accrualBp, 10_000 - accrualBp]);
  return { reserveIncomeCents, accrualBp, accrualCents, retainedCents };
}

export interface ChargebackDrawComputation {
  chargebackAmountCents: number;
  reserveBalanceBeforeCents: number;
  /** min(chargebackAmountCents, reserveBalanceBeforeCents) — drawn from the liability. */
  drawFromReserveCents: number;
  /** chargebackAmountCents - drawFromReserveCents — posted to expense. */
  excessToExpenseCents: number;
}

/**
 * S091(c) + S093 (shared) — an actual chargeback draws the chargeback-reserve
 * liability down by min(chargebackAmount, remaining balance); any excess
 * posts to expense. Conservation identity, provable for every input:
 *   drawFromReserveCents + excessToExpenseCents === chargebackAmountCents
 * This is exact subtraction on already-whole cents — no rounding is possible
 * or needed, unlike the bp-based accrual above.
 */
export function computeChargebackDraw(chargebackAmount: number | string, reserveBalanceBefore: number | string): ChargebackDrawComputation {
  const chargebackAmountCents = toCents(chargebackAmount);
  const reserveBalanceBeforeCents = toCents(reserveBalanceBefore);
  if (!Number.isFinite(chargebackAmountCents) || chargebackAmountCents <= 0) {
    throw new ChargebackReserveDomainError('INVALID_AMOUNT', `chargebackAmount must be a positive decimal amount, got ${chargebackAmount}`);
  }
  if (!Number.isFinite(reserveBalanceBeforeCents) || reserveBalanceBeforeCents < 0) {
    throw new ChargebackReserveDomainError('INVALID_AMOUNT', `reserveBalanceBefore must be a non-negative decimal amount, got ${reserveBalanceBefore}`);
  }
  const drawFromReserveCents = Math.min(chargebackAmountCents, reserveBalanceBeforeCents);
  const excessToExpenseCents = chargebackAmountCents - drawFromReserveCents;
  return { chargebackAmountCents, reserveBalanceBeforeCents, drawFromReserveCents, excessToExpenseCents };
}
