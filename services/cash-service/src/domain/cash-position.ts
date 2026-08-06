// S057 — Daily Cash Position Dashboard domain rules. Pure functions; no
// I/O. This module performs NO financial calculation beyond simple sums —
// per the story's explicit AC, cash-position composition is a read-model
// join, not a computation.

export interface LargeCashFlagCandidate {
  sourceType: 'RECEIPT' | 'DEPOSIT';
  sourceId: string;
  amount: string | number;
  jurisdiction: string;
  businessDate: string;
}

export interface LargeCashThresholdLike {
  jurisdiction: string;
  thresholdAmount: string | number;
  currency: string;
}

/**
 * BR: threshold config is authoritative and per-tenant/jurisdiction. An
 * empty config table means NO flags are raised — never a guessed or
 * hardcoded statutory figure (e.g. the common $10,000 CTR figure must be
 * configured explicitly, not assumed).
 */
export function computeLargeCashFlags(
  candidates: LargeCashFlagCandidate[],
  thresholds: LargeCashThresholdLike[],
): Array<LargeCashFlagCandidate & { thresholdAmount: string | number; currency: string }> {
  if (thresholds.length === 0) return [];
  const byJurisdiction = new Map(thresholds.map((t) => [t.jurisdiction, t]));
  const flags: Array<LargeCashFlagCandidate & { thresholdAmount: string | number; currency: string }> = [];
  for (const c of candidates) {
    const threshold = byJurisdiction.get(c.jurisdiction);
    if (!threshold) continue; // no configured threshold for this jurisdiction => never flagged
    const amountCents = Math.round(Number(c.amount) * 100);
    const thresholdCents = Math.round(Number(threshold.thresholdAmount) * 100);
    if (amountCents >= thresholdCents) {
      flags.push({ ...c, thresholdAmount: threshold.thresholdAmount, currency: threshold.currency });
    }
  }
  return flags;
}

export type IntegrationState = 'OK' | 'MANUAL_ENTRY_REQUIRED' | 'PENDING_SERVICE_INTEGRATION' | 'SERVICE_UNREACHABLE';

export interface SourcedValue<T> {
  state: IntegrationState;
  value: T | null;
  source: string;
  note?: string;
}
