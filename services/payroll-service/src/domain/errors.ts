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
