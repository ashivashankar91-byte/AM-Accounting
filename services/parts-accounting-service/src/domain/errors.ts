export class AccountMappingPendingError extends Error {
  readonly status = 422;
  readonly code = 'ACCOUNT_MAPPING_VALUES_PENDING';
  constructor(readonly eventFamily: string, readonly role: string) {
    super(`Account mapping for event family "${eventFamily}" role "${role}" is ACCOUNT_MAPPING_VALUES_PENDING — cannot post until a tenant-configured account is resolved.`);
    this.name = 'AccountMappingPendingError';
  }
}

export class NotFoundError extends Error {
  readonly status = 404;
  readonly code = 'NOT_FOUND';
  constructor(message: string) { super(message); this.name = 'NotFoundError'; }
}

export class ValidationError extends Error {
  readonly status = 400;
  readonly code = 'VALIDATION_ERROR';
  constructor(message: string) { super(message); this.name = 'ValidationError'; }
}

export class ConflictError extends Error {
  readonly status = 409;
  readonly code = 'CONFLICT';
  constructor(message: string, readonly conflictCode?: string) { super(message); this.name = 'ConflictError'; }
}

export class RefusedError extends Error {
  readonly status = 422;
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'RefusedError'; this.code = code; }
}

export class PostingBlockedError extends Error {
  readonly status = 422;
  readonly code = 'POSTING_BLOCKED';
  constructor(message: string, readonly reasonCode: string) { super(message); this.name = 'PostingBlockedError'; }
}
