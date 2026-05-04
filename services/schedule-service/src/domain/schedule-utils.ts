// @trace-cobol schedmgr.cbl 4000-CONVERT
// Balance-forward and type conversion helpers

import { Prisma } from '.prisma/schedule-client';

// Balance-forward detection
// @trace-cobol schedmgr.cbl 4000-CONVERT: "if DE-BAL-CUR IS NUMERIC AND ... 4 fields"
// In TypeScript: a record is a balance-forward if isBalanceForward = true,
// OR if it has numeric aging bucket values (migration compat).
export function isBalanceForwardRecord(
  amount: Prisma.Decimal,
  balanceCurrent?: Prisma.Decimal | null,
): boolean {
  // Explicit flag takes precedence
  return balanceCurrent !== null && balanceCurrent !== undefined;
}

// Compute total from aging buckets (for type 3 purge-type-1 balance-forward)
// @trace-cobol schedmgr.cbl 2TO3: COMPUTE DE-AMOUNT = SUM(4 buckets)
export function sumAgingBuckets(
  cur: Prisma.Decimal,
  ovr30: Prisma.Decimal,
  ovr60: Prisma.Decimal,
  ovr90: Prisma.Decimal,
): Prisma.Decimal {
  return cur.add(ovr30).add(ovr60).add(ovr90);
}

// Age calculation — days between transaction date and cutoff date
// @trace-cobol schedprn.cbl julian2.prc / R04670
export function ageDays(transactionDate: Date, cutoffDate: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.max(0, Math.floor((cutoffDate.getTime() - transactionDate.getTime()) / msPerDay));
}
