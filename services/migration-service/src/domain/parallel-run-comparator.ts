/**
 * CE-16 / S131 — Parallel-run comparison harness.
 *
 * Ingests legacy-side period outputs (TB, schedule control balances, statement
 * figures) and compares them against the modern equivalents for the same
 * period and legal entity.
 *
 * The exit criterion is deliberately NOT "zero differences" — it is "100% of
 * differences explained and dispositioned". A difference classified TIMING,
 * MAPPING, LEGACY_ERROR or MODERN_ERROR with a reason and an approval is a
 * satisfied difference; anything still UNEXPLAINED blocks the cutover
 * recommendation.
 *
 * Pure module — no I/O, no clock reads.
 */

export type DiffType = 'TB_ACCOUNT' | 'SCHEDULE_CONTROL' | 'STATEMENT_LINE';
export type DiffClassification = 'TIMING' | 'MAPPING' | 'LEGACY_ERROR' | 'MODERN_ERROR' | 'UNEXPLAINED';
export type DiffDisposition = 'PENDING' | 'APPROVED';

export const EXPLAINED_CLASSIFICATIONS: DiffClassification[] = ['TIMING', 'MAPPING', 'LEGACY_ERROR', 'MODERN_ERROR'];

export interface ComparableFigure {
  diffType: DiffType;
  /** Account number, control account, or statement line code. */
  dimension: string;
  value: number;
}

export interface ComputedDiff {
  diffType: DiffType;
  dimension: string;
  sourceValue: number;
  targetValue: number;
  variance: number;
  classification: DiffClassification;
}

export interface ClassifiedDiff {
  classification: DiffClassification;
  reason: string | null;
  disposition: DiffDisposition;
}

const CENT = 0.005;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Computes the full difference set. A dimension present on only one side is a
 * real difference (value 0 on the missing side), never silently dropped.
 */
export function computeDiffs(legacy: ComparableFigure[], modern: ComparableFigure[]): ComputedDiff[] {
  const key = (f: { diffType: DiffType; dimension: string }) => `${f.diffType}\u0000${f.dimension}`;
  const legacyMap = new Map(legacy.map((f) => [key(f), f]));
  const modernMap = new Map(modern.map((f) => [key(f), f]));
  const allKeys = [...new Set([...legacyMap.keys(), ...modernMap.keys()])].sort();

  const diffs: ComputedDiff[] = [];
  for (const k of allKeys) {
    const l = legacyMap.get(k);
    const m = modernMap.get(k);
    const sourceValue = round2(l?.value ?? 0);
    const targetValue = round2(m?.value ?? 0);
    const variance = round2(targetValue - sourceValue);
    if (Math.abs(variance) <= CENT) continue;
    const [diffType, dimension] = k.split('\u0000');
    diffs.push({
      diffType: diffType as DiffType,
      dimension,
      sourceValue,
      targetValue,
      variance,
      classification: 'UNEXPLAINED',
    });
  }
  return diffs;
}

export function isExplained(diff: ClassifiedDiff): boolean {
  return (
    EXPLAINED_CLASSIFICATIONS.includes(diff.classification) &&
    !!diff.reason &&
    diff.reason.trim().length > 0 &&
    diff.disposition === 'APPROVED'
  );
}

export interface ComparisonSummary {
  totalDiffs: number;
  explainedDiffs: number;
  unexplainedDiffs: number;
  byClassification: Record<DiffClassification, number>;
  /** True only when every difference is explained AND dispositioned. */
  exitCriterionMet: boolean;
}

export function summarize(diffs: ClassifiedDiff[]): ComparisonSummary {
  const byClassification: Record<DiffClassification, number> = {
    TIMING: 0,
    MAPPING: 0,
    LEGACY_ERROR: 0,
    MODERN_ERROR: 0,
    UNEXPLAINED: 0,
  };
  let explained = 0;
  for (const d of diffs) {
    byClassification[d.classification] += 1;
    if (isExplained(d)) explained += 1;
  }
  const unexplained = diffs.length - explained;
  return {
    totalDiffs: diffs.length,
    explainedDiffs: explained,
    unexplainedDiffs: unexplained,
    byClassification,
    exitCriterionMet: unexplained === 0,
  };
}

export class ComparisonSignOffError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = 'ComparisonSignOffError';
  }
}

export interface SignOffInput {
  operatorId: string | null;
  signerId: string;
  diffs: ClassifiedDiff[];
}

/**
 * Controller sign-off per period. SoD: the operator who ran the comparison may
 * not be the signer, and no period may be signed while a difference is still
 * unexplained.
 */
export function validateSignOff(input: SignOffInput): ComparisonSummary {
  if (input.operatorId && input.operatorId === input.signerId) {
    throw new ComparisonSignOffError(
      `Comparison operator ${input.operatorId} may not also sign off the period`,
      'SOD_VIOLATION',
    );
  }
  const summary = summarize(input.diffs);
  if (!summary.exitCriterionMet) {
    throw new ComparisonSignOffError(
      `${summary.unexplainedDiffs} difference(s) remain unexplained or undispositioned`,
      'UNEXPLAINED_DIFFERENCES',
    );
  }
  return summary;
}
