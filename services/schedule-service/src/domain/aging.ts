// @wave S027 — Schedule Aging Engine
// @trace-cobol schedprn.cbl — age = cutoffDate - transactionDate (Julian
// date diff), extended with a configurable bucket boundary set rather than
// the undocumented-exact-boundary legacy CUR/OVR30/OVR60/OVR90 convention
// (komdetail.extraction.md:151).

export interface AgingBucketDef {
  label: string;
  // Inclusive day-count upper boundary for this bucket. An item ages into
  // the FIRST bucket (in array order) whose upperBoundDays >= its age in
  // days. The last bucket's upperBoundDays MUST be null (catch-all).
  upperBoundDays: number | null;
}

// Extends the legacy CUR/OVR30/OVR60/OVR90 4-bucket convention with the
// standard AR 1-30 split, since no source documents the exact legacy day
// boundaries (see S026_S027_IMPLEMENTATION_CONTRACT.md). Tenants may
// override via ScheduleAgingBucketConfig — this is a default, not a
// hard-coded requirement.
export const DEFAULT_AGING_BUCKETS: AgingBucketDef[] = [
  { label: 'Current', upperBoundDays: 0 },
  { label: '1-30', upperBoundDays: 30 },
  { label: '31-60', upperBoundDays: 60 },
  { label: '61-90', upperBoundDays: 90 },
  { label: '90+', upperBoundDays: null },
];

export class InvalidAgingBucketConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAgingBucketConfigError';
  }
}

export function validateAgingBuckets(buckets: unknown): AgingBucketDef[] {
  if (!Array.isArray(buckets) || buckets.length === 0) {
    throw new InvalidAgingBucketConfigError('buckets must be a non-empty array.');
  }
  let prevBound = -Infinity;
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i] as any;
    if (!b || typeof b.label !== 'string' || !b.label.trim()) {
      throw new InvalidAgingBucketConfigError(`bucket[${i}] must have a non-empty label.`);
    }
    const isLast = i === buckets.length - 1;
    if (isLast) {
      if (b.upperBoundDays !== null) {
        throw new InvalidAgingBucketConfigError('The last bucket must have upperBoundDays = null (catch-all).');
      }
    } else {
      if (typeof b.upperBoundDays !== 'number' || b.upperBoundDays <= prevBound) {
        throw new InvalidAgingBucketConfigError(
          `bucket[${i}] (${b.label}) upperBoundDays must be a number strictly greater than the previous bucket's boundary.`,
        );
      }
      prevBound = b.upperBoundDays;
    }
  }
  return buckets as AgingBucketDef[];
}

export function classifyBucket(ageDays: number, buckets: AgingBucketDef[]): string {
  for (const b of buckets) {
    if (b.upperBoundDays === null || ageDays <= b.upperBoundDays) return b.label;
  }
  // Unreachable given validateAgingBuckets guarantees a null-terminated
  // catch-all, but fail safe rather than return undefined.
  return buckets[buckets.length - 1]?.label ?? 'Unclassified';
}

export function ageInDays(referenceDate: Date, asOfDate: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((asOfDate.getTime() - referenceDate.getTime()) / msPerDay);
}
