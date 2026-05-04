/**
 * @module duplicate-detector
 * @why-built Without duplicate detection, COBOL batch submissions had no guard
 *   against double-posting the same payroll run — a known COBOL-era audit risk.
 * @intelligence-additions
 *   - Exact period match: same employee + same pay period in any non-void batch
 *   - Similar gross check: within 5% tolerance, 14-day window, requires human review
 *   - Separated from transport so tests run without DB
 */

export interface BatchSummary {
  id: string;
  status: string;      // DRAFT | VALIDATED | APPROVED | POSTED | VOID
  payPeriodStart: Date;
  payPeriodEnd: Date;
  payDate: Date;
  totalGrossPay: number;
  employeeCount: number;
}

export interface ItemSummary {
  employeeId: string;
  grossPay: number;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  type?: 'EXACT_PERIOD' | 'SIMILAR_GROSS';
  conflictingBatchId?: string;
  message?: string;
}

const SIMILAR_GROSS_TOLERANCE = 0.05;   // 5%
const SIMILAR_GROSS_WINDOW_DAYS = 14;

/**
 * Check whether a proposed batch is an exact duplicate of an existing batch.
 * "Exact" = same pay period start + end, and the existing batch is not VOID.
 *
 * @param proposed   The new batch about to be approved
 * @param existing   All non-void batches for the same tenant
 * @param proposedItems  Line items in the proposed batch
 * @param existingItemsByBatch  Map of batchId → items for each existing batch
 */
export function detectExactDuplicate(
  proposed: Pick<BatchSummary, 'payPeriodStart' | 'payPeriodEnd' | 'employeeCount'>,
  existing: BatchSummary[],
  proposedItems: ItemSummary[],
  existingItemsByBatch: Map<string, ItemSummary[]>,
): DuplicateCheckResult {
  const candidates = existing.filter(
    (b) =>
      b.status !== 'VOID' &&
      b.payPeriodStart.getTime() === proposed.payPeriodStart.getTime() &&
      b.payPeriodEnd.getTime() === proposed.payPeriodEnd.getTime(),
  );

  for (const candidate of candidates) {
    const candidateItems = existingItemsByBatch.get(candidate.id) ?? [];
    if (candidateItems.length === 0) continue;

    // Check employee overlap: if any employee appears in both batches, it's a duplicate
    const proposedEmployeeIds = new Set(proposedItems.map((i) => i.employeeId));
    const overlap = candidateItems.some((ci) => proposedEmployeeIds.has(ci.employeeId));
    if (overlap) {
      return {
        isDuplicate: true,
        type: 'EXACT_PERIOD',
        conflictingBatchId: candidate.id,
        message: `Batch overlaps with existing batch ${candidate.id} for the same pay period.`,
      };
    }
  }

  return { isDuplicate: false };
}

/**
 * Check whether a proposed batch has a suspiciously similar gross amount to a
 * recent batch within a 14-day window. Flags for human review, not hard-block.
 *
 * @param proposed   The new batch about to be approved
 * @param existing   All non-void batches for the same tenant
 */
export function detectSimilarGross(
  proposed: Pick<BatchSummary, 'payDate' | 'totalGrossPay'>,
  existing: BatchSummary[],
): DuplicateCheckResult {
  const windowMs = SIMILAR_GROSS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const proposedTime = proposed.payDate.getTime();
  const proposedGross = proposed.totalGrossPay;

  for (const batch of existing) {
    if (batch.status === 'VOID') continue;
    const dateDiff = Math.abs(batch.payDate.getTime() - proposedTime);
    if (dateDiff > windowMs) continue;

    if (batch.totalGrossPay === 0 || proposedGross === 0) continue;

    const diff = Math.abs(batch.totalGrossPay - proposedGross);
    const tolerance = batch.totalGrossPay * SIMILAR_GROSS_TOLERANCE;

    if (diff <= tolerance && batch.totalGrossPay !== proposedGross) {
      return {
        isDuplicate: true,
        type: 'SIMILAR_GROSS',
        conflictingBatchId: batch.id,
        message: `Proposed gross $${proposedGross.toFixed(2)} is within 5% of batch ${batch.id} gross $${batch.totalGrossPay.toFixed(2)} within ${SIMILAR_GROSS_WINDOW_DAYS} days. Requires review.`,
      };
    }
  }

  return { isDuplicate: false };
}
