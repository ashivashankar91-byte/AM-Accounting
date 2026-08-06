/**
 * CE-16 / S129 — Item-level migration gates G1–G5.
 *
 * G1 item-level validity        — every staged item is individually valid.
 * G2 subledger conservation     — Σ staged items == converted TB control
 *                                 balance produced by S130 for that control
 *                                 account. This is the load-bearing gate:
 *                                 an item set that does not tie to its own
 *                                 control account cannot be promoted.
 * G3 duplicate / identity       — no duplicate source identity inside the
 *                                 batch and none already promoted.
 * G4 aging integrity            — aging buckets reconstruct to the item
 *                                 balance, and no item ages before its own
 *                                 document date.
 * G5 exception queue            — zero blocking exceptions, or every one of
 *                                 them explicitly dispositioned.
 *
 * Pure module: no I/O, no clock reads, no randomness — so gate outcomes are
 * reproducible from the persisted evidence alone.
 */

export type GateCode = 'G1' | 'G2' | 'G3' | 'G4' | 'G5';
export type GateOutcome = 'PASS' | 'FAIL' | 'BLOCKED';

export interface GateEvaluation {
  gateCode: GateCode;
  result: GateOutcome;
  details: Record<string, unknown>;
}

/** Cents-precision tolerance; monetary equality is exact to the cent. */
const CENT = 0.005;

export interface StagedItem {
  /** Stable identity of the source row this item came from. */
  sourceIdentity: string;
  /** Control account this open item rolls up to. */
  controlAccount: string;
  amount: number;
  documentDate: string | null;
  dueDate?: string | null;
  agingBucket?: string | null;
  /** Item-level validity errors already recorded by the transformation. */
  validationErrors?: string[];
  /** Set when this identity was promoted by an earlier run. */
  alreadyPromoted?: boolean;
}

export interface GateInput {
  items: StagedItem[];
  /**
   * True for controlled-account datasets (AP/AR/schedules) where S129's
   * item-level gates apply in full. False for whole-balance datasets such as a
   * converted trial balance, where individual document dates and aging buckets
   * do not exist and must not be invented.
   */
  itemLevel?: boolean;
  /** Converted TB control balances from S130, keyed by control account. */
  convertedControlBalances: Record<string, number>;
  /** As-of date used to compute aging buckets (ISO yyyy-mm-dd). */
  agingAsOf: string | null;
  exceptions: { blocking: boolean; disposition: string }[];
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function evaluateG1(items: StagedItem[], options: { itemLevel?: boolean } = {}): GateEvaluation {
  const itemLevel = options.itemLevel ?? true;
  const invalid = items.filter(
    (i) =>
      (i.validationErrors?.length ?? 0) > 0 ||
      !i.controlAccount ||
      !i.sourceIdentity ||
      !Number.isFinite(i.amount) ||
      (itemLevel && !i.documentDate),
  );
  return {
    gateCode: 'G1',
    result: invalid.length === 0 ? 'PASS' : 'FAIL',
    details: {
      itemLevel,
      itemCount: items.length,
      invalidCount: invalid.length,
      invalidIdentities: invalid.slice(0, 50).map((i) => i.sourceIdentity),
    },
  };
}

export function evaluateG2(
  items: StagedItem[],
  convertedControlBalances: Record<string, number>,
): GateEvaluation {
  const staged: Record<string, number> = {};
  for (const item of items) {
    staged[item.controlAccount] = round2((staged[item.controlAccount] ?? 0) + item.amount);
  }

  const accounts = new Set([...Object.keys(staged), ...Object.keys(convertedControlBalances)]);
  const breaches: { controlAccount: string; stagedTotal: number; controlBalance: number; variance: number }[] = [];

  for (const account of accounts) {
    const stagedTotal = round2(staged[account] ?? 0);
    const controlBalance = round2(convertedControlBalances[account] ?? 0);
    const variance = round2(stagedTotal - controlBalance);
    if (Math.abs(variance) > CENT) {
      breaches.push({ controlAccount: account, stagedTotal, controlBalance, variance });
    }
  }

  return {
    gateCode: 'G2',
    result: breaches.length === 0 ? 'PASS' : 'FAIL',
    details: { comparedAccounts: accounts.size, breachCount: breaches.length, breaches },
  };
}

export function evaluateG3(items: StagedItem[]): GateEvaluation {
  const seen = new Map<string, number>();
  for (const item of items) seen.set(item.sourceIdentity, (seen.get(item.sourceIdentity) ?? 0) + 1);
  const duplicatesInBatch = [...seen.entries()].filter(([, n]) => n > 1).map(([id, n]) => ({ sourceIdentity: id, occurrences: n }));
  const alreadyPromoted = items.filter((i) => i.alreadyPromoted).map((i) => i.sourceIdentity);

  const failed = duplicatesInBatch.length > 0 || alreadyPromoted.length > 0;
  return {
    gateCode: 'G3',
    result: failed ? 'FAIL' : 'PASS',
    details: {
      duplicateCount: duplicatesInBatch.length,
      duplicatesInBatch,
      alreadyPromotedCount: alreadyPromoted.length,
      alreadyPromoted: alreadyPromoted.slice(0, 50),
    },
  };
}

const KNOWN_BUCKETS = ['CURRENT', '1_30', '31_60', '61_90', 'OVER_90'];

function bucketFor(documentDate: string, asOf: string): string {
  const days = Math.floor((Date.parse(asOf) - Date.parse(documentDate)) / 86_400_000);
  if (days <= 0) return 'CURRENT';
  if (days <= 30) return '1_30';
  if (days <= 60) return '31_60';
  if (days <= 90) return '61_90';
  return 'OVER_90';
}

export function evaluateG4(
  items: StagedItem[],
  agingAsOf: string | null,
  options: { itemLevel?: boolean } = {},
): GateEvaluation {
  if (options.itemLevel === false) {
    // Aging is a property of open items. A whole-balance dataset has no aging
    // to check, and fabricating buckets for it would be inventing meaning.
    return {
      gateCode: 'G4',
      result: 'PASS',
      details: { itemLevel: false, reason: 'AGING_NOT_APPLICABLE_TO_BALANCE_DATASET', itemCount: items.length },
    };
  }
  if (!agingAsOf) {
    return {
      gateCode: 'G4',
      result: 'BLOCKED',
      details: { reason: 'AGING_AS_OF_NOT_SUPPLIED' },
    };
  }

  const futureDated: string[] = [];
  const bucketMismatch: { sourceIdentity: string; declared: string; expected: string }[] = [];
  const unknownBucket: string[] = [];
  const bucketTotals: Record<string, number> = {};
  let itemTotal = 0;

  for (const item of items) {
    itemTotal = round2(itemTotal + item.amount);
    if (!item.documentDate) continue;
    if (Date.parse(item.documentDate) > Date.parse(agingAsOf)) futureDated.push(item.sourceIdentity);
    const expected = bucketFor(item.documentDate, agingAsOf);
    const declared = item.agingBucket ?? expected;
    if (!KNOWN_BUCKETS.includes(declared)) unknownBucket.push(item.sourceIdentity);
    else if (declared !== expected) bucketMismatch.push({ sourceIdentity: item.sourceIdentity, declared, expected });
    bucketTotals[declared] = round2((bucketTotals[declared] ?? 0) + item.amount);
  }

  const bucketSum = round2(Object.values(bucketTotals).reduce((a, b) => a + b, 0));
  const reconstructs = Math.abs(round2(bucketSum - itemTotal)) <= CENT;

  const passed = futureDated.length === 0 && bucketMismatch.length === 0 && unknownBucket.length === 0 && reconstructs;
  return {
    gateCode: 'G4',
    result: passed ? 'PASS' : 'FAIL',
    details: {
      agingAsOf,
      itemTotal,
      bucketSum,
      bucketTotals,
      futureDatedCount: futureDated.length,
      bucketMismatchCount: bucketMismatch.length,
      unknownBucketCount: unknownBucket.length,
      bucketMismatch: bucketMismatch.slice(0, 50),
    },
  };
}

export function evaluateG5(exceptions: { blocking: boolean; disposition: string }[]): GateEvaluation {
  const outstanding = exceptions.filter((e) => e.blocking && e.disposition === 'PENDING');
  return {
    gateCode: 'G5',
    result: outstanding.length === 0 ? 'PASS' : 'FAIL',
    details: { totalExceptions: exceptions.length, outstandingBlocking: outstanding.length },
  };
}

export function evaluateAllGates(input: GateInput): GateEvaluation[] {
  const itemLevel = input.itemLevel ?? true;
  return [
    evaluateG1(input.items, { itemLevel }),
    evaluateG2(input.items, input.convertedControlBalances),
    evaluateG3(input.items),
    evaluateG4(input.items, input.agingAsOf, { itemLevel }),
    evaluateG5(input.exceptions),
  ];
}

export function allGatesPassed(results: { result: GateOutcome }[]): boolean {
  return results.length > 0 && results.every((r) => r.result === 'PASS');
}
