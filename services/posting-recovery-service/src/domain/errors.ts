export class PostingRecoveryNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'PostingRecoveryNotFoundError';
  }
}

export class PostingRecoveryValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PostingRecoveryValidationError';
  }
}

export class PostingRecoveryConflictError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PostingRecoveryConflictError';
  }
}
