// S209 — Accounting period status domain logic (pure, no I/O).
// The full status vocabulary ships now for S013; only FUTURE->OPEN is a legal
// transition in this story (BR209-1). Later transitions are owned by S008/R1.

export type PeriodStatus = 'FUTURE' | 'OPEN' | 'SOFT_CLOSED' | 'HARD_CLOSED' | 'LOCKED';

export const PERIOD_STATUSES: readonly PeriodStatus[] = [
  'FUTURE',
  'OPEN',
  'SOFT_CLOSED',
  'HARD_CLOSED',
  'LOCKED',
];

/** Legal transitions in this story. Close transitions arrive with S008/R1. */
const LEGAL_TRANSITIONS: Record<PeriodStatus, PeriodStatus[]> = {
  FUTURE: ['OPEN'],
  OPEN: [], // SOFT_CLOSED etc. owned by S008/R1
  SOFT_CLOSED: [],
  HARD_CLOSED: [],
  LOCKED: [],
};

export function canTransition(from: PeriodStatus, to: PeriodStatus): boolean {
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

/** A period is postable only while OPEN (BR209 / S013 eligibility). */
export function eligibility(status: PeriodStatus): { postable: boolean; reason: string } {
  if (status === 'OPEN') return { postable: true, reason: 'Period is OPEN' };
  const reasons: Record<PeriodStatus, string> = {
    FUTURE: 'Period is FUTURE — not yet opened for business',
    OPEN: 'Period is OPEN',
    SOFT_CLOSED: 'Period is SOFT_CLOSED — postings blocked pending review',
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
