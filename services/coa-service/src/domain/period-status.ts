// S209/S008 — Accounting period status domain logic (pure, no I/O).
// S008 extends the S209 FUTURE->OPEN-only vocabulary with the full
// OPEN/SOFT_CLOSED/HARD_CLOSED/LOCKED lifecycle. This allowlist is mirrored
// exactly by the enforce_period_transition() DB trigger (see
// 20260728010000_s008_period_close_control) — the service layer's canTransition()
// exists to return a clean 422 without a round trip, but the DB trigger is the
// real backstop (this list must never diverge from the trigger's allowlist).

export type PeriodStatus = 'FUTURE' | 'OPEN' | 'SOFT_CLOSED' | 'HARD_CLOSED' | 'LOCKED';

export const PERIOD_STATUSES: readonly PeriodStatus[] = [
  'FUTURE',
  'OPEN',
  'SOFT_CLOSED',
  'HARD_CLOSED',
  'LOCKED',
];

/** S008 — full allowlist. LOCKED is terminal (no transition out, S008 v1). */
const LEGAL_TRANSITIONS: Record<PeriodStatus, PeriodStatus[]> = {
  FUTURE: ['OPEN'],
  OPEN: ['SOFT_CLOSED'],
  SOFT_CLOSED: ['OPEN', 'HARD_CLOSED'],
  HARD_CLOSED: ['OPEN'],
  LOCKED: [],
};

export function canTransition(from: PeriodStatus, to: PeriodStatus): boolean {
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * A period is postable while OPEN, or while SOFT_CLOSED for an authorized
 * manual adjusting entry (S008 v1 — automated/system postings remain
 * blocked even when isAdjusting, matching the DB trigger's own guard, which
 * does not special-case caller class).
 */
export function eligibility(
  status: PeriodStatus,
  isAdjusting = false,
): { postable: boolean; reason: string } {
  if (status === 'OPEN') return { postable: true, reason: 'Period is OPEN' };
  if (status === 'SOFT_CLOSED' && isAdjusting) {
    return { postable: true, reason: 'Period is SOFT_CLOSED — postable only for an authorized adjusting entry' };
  }
  const reasons: Record<PeriodStatus, string> = {
    FUTURE: 'Period is FUTURE — not yet opened for business',
    OPEN: 'Period is OPEN',
    SOFT_CLOSED: 'Period is SOFT_CLOSED — postings blocked pending review (adjusting entries require fiscal.je.mark_adjusting)',
    HARD_CLOSED: 'Period is HARD_CLOSED — no further postings permitted',
    LOCKED: 'Period is LOCKED — permanently sealed',
  };
  return { postable: false, reason: reasons[status] };
}

export interface OrderedPeriod {
  fiscalYear: number;
  periodNumber: number;
  status: PeriodStatus;
  adjustmentsOnly: boolean;
}

/** Chronological ordering key for a period within an entity. */
export function periodOrder(p: { fiscalYear: number; periodNumber: number }): number {
  return p.fiscalYear * 100 + p.periodNumber;
}

/**
 * Skip-open detection (BR209-3 / AC skip-open warning). Returns the codes of any
 * earlier, non-adjustment periods still in FUTURE status that would be skipped by
 * opening `target`. A non-empty result means the caller should confirm.
 */
export function detectSkippedPeriods<T extends OrderedPeriod & { code: string }>(
  target: OrderedPeriod,
  allPeriods: T[],
): string[] {
  const targetKey = periodOrder(target);
  return allPeriods
    .filter(
      (p) =>
        !p.adjustmentsOnly &&
        p.status === 'FUTURE' &&
        periodOrder(p) < targetKey,
    )
    .sort((a, b) => periodOrder(a) - periodOrder(b))
    .map((p) => p.code);
}
