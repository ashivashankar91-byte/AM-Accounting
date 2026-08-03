// CE-13 — Certification-only labeled tenant for the payroll TestFixtureSource.
// Mirrors tax-service's TEST_TENANT_CE10_CERTIFICATION_ONLY convention.
export const TEST_TENANT_CE13_CERTIFICATION_ONLY = 'TEST-TENANT-CE13-CERTIFICATION-ONLY' as const;

export class NonTestTenantRefusedError extends Error {
  constructor(tenantId: string) {
    super(`TestFixtureSource refuses to run for tenant '${tenantId}' — fixtures are certification-only, restricted to the labeled TEST-TENANT`);
    this.name = 'NonTestTenantRefusedError';
  }
}

export class PayrollSourceNotConfiguredError extends Error {
  readonly status = 422;
  readonly code = 'PAYROLL_SOURCE_NOT_CONFIGURED';
  constructor(message: string) {
    super(message);
    this.name = 'PayrollSourceNotConfiguredError';
  }
}

export class MissingGLMappingError extends Error {
  readonly status = 422;
  readonly code = 'ACCOUNT_MAPPING_VALUES_PENDING';
  constructor(message: string) {
    super(message);
    this.name = 'MissingGLMappingError';
  }
}

export class DuplicatePayrollRunError extends Error {
  readonly status = 409;
  readonly code = 'DUPLICATE_PAYROLL_RUN';
  constructor(message: string) {
    super(message);
    this.name = 'DuplicatePayrollRunError';
  }
}

/**
 * fix(integration): thrown for any row whose legalEntityId is null (predates
 * the legal-entity dimension and was never backfilled — no ambiguous row is
 * ever silently assigned tenantId as its legal entity) or whenever an
 * action's inputs would mix two different legal entities on one batch.
 * Blocks validate/approve/post/void/activate until reconciled.
 */
export class LegalEntityReconciliationRequiredError extends Error {
  readonly status = 422;
  readonly code = 'LEGAL_ENTITY_RECONCILIATION_REQUIRED';
  constructor(message: string) {
    super(message);
    this.name = 'LegalEntityReconciliationRequiredError';
  }
}

export class LegalEntityMismatchError extends Error {
  readonly status = 422;
  readonly code = 'LEGAL_ENTITY_MISMATCH';
  constructor(message: string) {
    super(message);
    this.name = 'LegalEntityMismatchError';
  }
}

export class SegregationOfDutiesError extends Error {
  readonly status = 403;
  readonly code = 'SEGREGATION_OF_DUTIES_VIOLATION';
  constructor(message = 'The same user cannot both prepare/import and approve a payroll batch.') {
    super(message);
    this.name = 'SegregationOfDutiesError';
  }
}

/**
 * fix(integration): thrown when coa-service (CE-07) itself refuses to
 * register/validate/activate the shadow posting-engine rule pack this
 * payroll rule pack's own lifecycle now drives — e.g. the caller lacks
 * CE-07's own posting_engine.rule_pack.* permission for this legal entity,
 * or CE-07's own author != activator SoD check refuses the activation. The
 * real CE-07 status code/message is always forwarded verbatim (never
 * swallowed, never retried into a fabricated success) so the caller sees
 * the true reason governed GL posting is not yet possible for this pack.
 */
export class Ce07RulePackRegistrationError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'Ce07RulePackRegistrationError';
  }
}

/** Thrown when a payroll rule-pack action that must drive a CE-07 registration call has no caller bearer token to forward (e.g. a service-to-service call with no real human session). */
export class MissingBearerTokenError extends Error {
  readonly status = 401;
  readonly code = 'MISSING_BEARER_TOKEN';
  constructor(message = 'A real, authenticated bearer token is required to register/activate the corresponding CE-07 posting-engine rule pack.') {
    super(message);
    this.name = 'MissingBearerTokenError';
  }
}
