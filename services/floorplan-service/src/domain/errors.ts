// CE-12 (S079-S082) — typed domain errors. Every mutating application
// service throws one of these instead of a bare Error, so http/routes.ts can
// map each to a stable HTTP status/code (mirrors coa-service/schedule-
// service/tax-service's handleError() convention).

export class FloorplanValidationError extends Error {
  readonly code = 'VALIDATION_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'FloorplanValidationError';
  }
}

export class FloorplanNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'FloorplanNotFoundError';
  }
}

/** S079 — thrown when an operation requires a configured feed adapter and
 * none exists. Never thrown for the manual-entry path, which is always
 * available regardless of adapter status. */
export class FeedNotConfiguredError extends Error {
  readonly code = 'FEED_NOT_CONFIGURED';
  constructor(lenderCode: string) {
    super(`No feed adapter is configured for lender ${lenderCode}. FEED_NOT_CONFIGURED — manual statement entry is always available for this lender.`);
    this.name = 'FeedNotConfiguredError';
  }
}

/** S079 — staged rows are immutable once created; there is no update
 * endpoint. Correcting a row means superseding it via a new import. */
export class StagedRowImmutableError extends Error {
  readonly code = 'STAGED_ROW_IMMUTABLE';
  constructor(rowId: string) {
    super(`Staged row ${rowId} is immutable and cannot be edited. Supersede it with a new import instead.`);
    this.name = 'StagedRowImmutableError';
  }
}

/** S080 — a staged row already has a match record (own-DB idempotency,
 * independent of coa-service's eventId dedup). */
export class AlreadyMatchedError extends Error {
  readonly code = 'ALREADY_MATCHED';
  constructor(rowId: string) {
    super(`Staged row ${rowId} has already been matched.`);
    this.name = 'AlreadyMatchedError';
  }
}

/** S080 — posting is only ever allowed from MATCHED or explicitly-
 * DISPOSITIONED rows, never from a raw staged row still in STAGED status. */
export class RowNotEligibleForPostingError extends Error {
  readonly code = 'ROW_NOT_ELIGIBLE_FOR_POSTING';
  constructor(rowId: string, status: string) {
    super(`Staged row ${rowId} is not eligible for posting (status=${status}). Only MATCHED or DISPOSITIONED rows may post.`);
    this.name = 'RowNotEligibleForPostingError';
  }
}

export class BreakAlreadyDispositionedError extends Error {
  readonly code = 'BREAK_ALREADY_DISPOSITIONED';
  constructor(breakId: string) {
    super(`Break ${breakId} has already been dispositioned.`);
    this.name = 'BreakAlreadyDispositionedError';
  }
}

export class DuplicateIdempotencyKeyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateIdempotencyKeyConflictError';
  }
}

/** Thrown when coa-service's posting engine returns REJECTED/FAILED/
 * NO_RULE_MATCH — the caller must still resolve the local state (worklist
 * row stays actionable) and, separately, the posting-recovery intake must
 * be notified (see infrastructure/posting-recovery-client.ts). */
export class PostingRejectedError extends Error {
  readonly code = 'POSTING_REJECTED';
  constructor(
    public readonly status: 'REJECTED' | 'FAILED' | 'NO_RULE_MATCH',
    public readonly failureReason: string | null,
  ) {
    super(`Posting engine returned ${status}: ${failureReason ?? '(no reason given)'}`);
    this.name = 'PostingRejectedError';
  }
}

export class ReversalReasonRequiredError extends Error {
  readonly code = 'REVERSAL_REASON_REQUIRED';
  constructor() {
    super('A reason is required to reverse a posted accrual (S218).');
    this.name = 'ReversalReasonRequiredError';
  }
}
