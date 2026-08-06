export class ApprovalError extends Error {
  constructor(public readonly code: string, public readonly statusCode = 400) {
    super(code);
    this.name = 'ApprovalError';
  }
}
