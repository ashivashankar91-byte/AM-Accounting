export class DealAccountingError extends Error {
  readonly status: number = 400;
  readonly code: string = 'DEAL_ACCOUNTING_ERROR';
}

export class DealNotFoundError extends DealAccountingError {
  readonly status = 404;
  readonly code = 'DEAL_NOT_FOUND';
  constructor(dealNumber: string) {
    super(`Deal "${dealNumber}" not found`);
    this.name = 'DealNotFoundError';
  }
}

export class RecapNotFoundError extends DealAccountingError {
  readonly status = 404;
  readonly code = 'RECAP_NOT_FOUND';
  constructor(dealNumber: string, recapVersion: number) {
    super(`Recap version ${recapVersion} not found for deal "${dealNumber}"`);
    this.name = 'RecapNotFoundError';
  }
}

export class ReviewCaseNotFoundError extends DealAccountingError {
  readonly status = 404;
  readonly code = 'REVIEW_CASE_NOT_FOUND';
  constructor(dealNumber: string, recapVersion: number) {
    super(`Review case not found for deal "${dealNumber}" v${recapVersion}`);
    this.name = 'ReviewCaseNotFoundError';
  }
}

export class ReviewCaseStateError extends DealAccountingError {
  readonly status = 409;
  readonly code = 'REVIEW_CASE_STATE_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'ReviewCaseStateError';
  }
}

/** S085 SoD boundary: biller releasing must differ from the desking identity that finalized the deal. */
export class BillerSoDViolationError extends DealAccountingError {
  readonly status = 422;
  readonly code = 'BILLER_SOD_VIOLATION';
  constructor(actor: string) {
    super(`"${actor}" finalized this deal and cannot also release its posting (S085 SoD boundary).`);
    this.name = 'BillerSoDViolationError';
  }
}

export class ReasonRequiredError extends DealAccountingError {
  readonly status = 422;
  readonly code = 'REASON_REQUIRED';
  constructor(action: string) {
    super(`A reason (1-500 chars) is required to ${action}.`);
    this.name = 'ReasonRequiredError';
  }
}

/** S086 — named, audited refusal: unwind after CIT funding has been applied. */
export class FundedUnwindRefusedError extends DealAccountingError {
  readonly status = 409;
  readonly code = 'FUNDED_UNWIND_REFUSED';
  constructor(dealNumber: string) {
    super(`Deal "${dealNumber}" has already had CIT funding applied — a raw unwind is refused. Use the recontract (S087) path instead.`);
    this.name = 'FundedUnwindRefusedError';
  }
}

export class OpenItemNotFoundError extends DealAccountingError {
  readonly status = 404;
  readonly code = 'OPEN_ITEM_NOT_FOUND';
  constructor(itemType: string, itemNumber: string) {
    super(`No open ${itemType} item found for "${itemNumber}"`);
    this.name = 'OpenItemNotFoundError';
  }
}

export class AlreadyRelievedError extends DealAccountingError {
  readonly status = 409;
  readonly code = 'ALREADY_RELIEVED';
  constructor(message: string) {
    super(message);
    this.name = 'AlreadyRelievedError';
  }
}

export class TitleNotReleasedError extends DealAccountingError {
  readonly status = 422;
  readonly code = 'TITLE_NOT_RELEASED';
  constructor(titleStatus: string) {
    super(`Wholesale AR cannot be posted — title status is "${titleStatus}", not RELEASED.`);
    this.name = 'TitleNotReleasedError';
  }
}

export class IdempotentReplayConflictError extends DealAccountingError {
  readonly status = 409;
  readonly code = 'IDEMPOTENCY_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'IdempotentReplayConflictError';
  }
}
