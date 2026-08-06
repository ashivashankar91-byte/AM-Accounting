/**
 * CE-17 — Domain errors.
 *
 * Every refusal in this service is a named, typed refusal that carries the
 * truthful state it leaves behind. A gate that fires does not return "false"
 * into a boolean soup; it throws something a queue screen can render and an
 * auditor can read.
 */

export class AutomationError extends Error {
  statusCode: number;
  code: string;
  truthfulState?: string;
  details?: Record<string, unknown>;

  constructor(message: string, opts: { statusCode?: number; code: string; truthfulState?: string; details?: Record<string, unknown> }) {
    super(message);
    this.name = 'AutomationError';
    this.statusCode = opts.statusCode ?? 422;
    this.code = opts.code;
    this.truthfulState = opts.truthfulState;
    this.details = opts.details;
  }
}

/** A policy gate refused the action. The item is left FAILED_CLOSED. */
export class PolicyGateViolationError extends AutomationError {
  gate: string;
  constructor(gate: string, message: string, details?: Record<string, unknown>) {
    super(message, { statusCode: 422, code: `POLICY_GATE_${gate}`, truthfulState: 'FAILED_CLOSED', details });
    this.name = 'PolicyGateViolationError';
    this.gate = gate;
  }
}

/** The action is legitimate but needs a human approval first. */
export class ApprovalRequiredError extends AutomationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { statusCode: 409, code: 'APPROVAL_REQUIRED', truthfulState: 'APPROVAL_REQUIRED', details });
    this.name = 'ApprovalRequiredError';
  }
}

/** Separation of duties: the same identity may not stand on both sides. */
export class SoDViolationError extends AutomationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { statusCode: 403, code: 'SOD_VIOLATION', details });
    this.name = 'SoDViolationError';
  }
}

/** A grant above the capability's declared ceiling. */
export class AuthorityCeilingError extends AutomationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { statusCode: 422, code: 'AUTHORITY_CEILING_EXCEEDED', details });
    this.name = 'AuthorityCeilingError';
  }
}

export class InvalidAuthorityTransitionError extends AutomationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { statusCode: 422, code: 'INVALID_AUTHORITY_TRANSITION', details });
    this.name = 'InvalidAuthorityTransitionError';
  }
}

export class InvalidStateTransitionError extends AutomationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { statusCode: 422, code: 'INVALID_STATE_TRANSITION', details });
    this.name = 'InvalidStateTransitionError';
  }
}

export class CapabilitySuspendedError extends AutomationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { statusCode: 423, code: 'CAPABILITY_SUSPENDED', truthfulState: 'SUSPENDED', details });
    this.name = 'CapabilitySuspendedError';
  }
}

export class NotConfiguredError extends AutomationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { statusCode: 404, code: 'NOT_CONFIGURED', truthfulState: 'NOT_CONFIGURED', details });
    this.name = 'NotConfiguredError';
  }
}

export class ModelOrRuleUnavailableError extends AutomationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { statusCode: 424, code: 'MODEL_OR_RULE_UNAVAILABLE', truthfulState: 'MODEL_OR_RULE_UNAVAILABLE', details });
    this.name = 'ModelOrRuleUnavailableError';
  }
}

/** Sandbox invariant breach — a simulation attempted to touch the real world. */
export class SandboxMutationError extends AutomationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { statusCode: 500, code: 'SANDBOX_MUTATION_ATTEMPT', details });
    this.name = 'SandboxMutationError';
  }
}

export class IdempotencyConflictError extends AutomationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { statusCode: 409, code: 'IDEMPOTENCY_CONFLICT', details });
    this.name = 'IdempotencyConflictError';
  }
}

export class ItemNotFoundError extends AutomationError {
  constructor(message: string) {
    super(message, { statusCode: 404, code: 'ITEM_NOT_FOUND' });
    this.name = 'ItemNotFoundError';
  }
}

export const DOMAIN_ERROR_NAMES = new Set([
  'AutomationError', 'PolicyGateViolationError', 'ApprovalRequiredError', 'SoDViolationError',
  'AuthorityCeilingError', 'InvalidAuthorityTransitionError', 'InvalidStateTransitionError',
  'CapabilitySuspendedError', 'NotConfiguredError', 'ModelOrRuleUnavailableError',
  'SandboxMutationError', 'IdempotencyConflictError', 'ItemNotFoundError', 'UnknownCapabilityError',
]);
