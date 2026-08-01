// CE-10 — typed domain errors. Every "we cannot proceed" path in this
// service raises one of these rather than estimating or silently
// proceeding — see the epic's governing safety principle.

export class TaxServiceValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'TaxServiceValidationError';
  }
}

export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

export class OptimisticConcurrencyError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} was modified by another request — refresh and retry (If-Match/version mismatch)`);
    this.name = 'OptimisticConcurrencyError';
  }
}

/** Raised at CREATE/UPDATE time when a new effective-dated row overlaps an
 * existing active row for the same (tenantId, legalEntityId, scope key) —
 * never at runtime (S124 AC / S125 AC2). */
export class OverlappingEffectiveDateError extends Error {
  constructor(scopeKey: string, conflictingId: string) {
    super(`Overlapping active date range for '${scopeKey}' with existing row ${conflictingId}`);
    this.name = 'OverlappingEffectiveDateError';
  }
}

/** S023 boundary — deterministic rejection when a consuming transaction
 * attempts to attach tax to its envelope but the account mapping for
 * (tenantId, legalEntityId, eventType) is still ACCOUNT_MAPPING_VALUES_PENDING. */
export class AccountMappingPendingError extends Error {
  constructor(public readonly tenantId: string, public readonly legalEntityId: string, public readonly eventType: string) {
    super(
      `Tax/fee account mapping is ACCOUNT_MAPPING_VALUES_PENDING for tenant=${tenantId} legalEntity=${legalEntityId} eventType=${eventType} — ` +
      'the transaction cannot attach tax to its envelope until Accounting resolves the S023 matrix row.',
    );
    this.name = 'AccountMappingPendingError';
  }
}

/** Raised when the TestFixtureEngine is invoked for any tenant that is not
 * the labeled certification test tenant. */
export class NonTestTenantRefusedError extends Error {
  constructor(tenantId: string) {
    super(`TestFixtureEngine refuses to run for tenant '${tenantId}' — fixtures are certification-only, restricted to the labeled TEST-TENANT`);
    this.name = 'NonTestTenantRefusedError';
  }
}

/** Raised when a second calculation request under the same idempotencyKey
 * would have produced a materially different engine response — an
 * integrity alert is recorded, the stored result is never overwritten. */
export class DivergentResultIntegrityAlertError extends Error {
  constructor(public readonly idempotencyKey: string, public readonly alertId: string) {
    super(`Divergent engine response for idempotencyKey '${idempotencyKey}' — integrity alert ${alertId} recorded; original stored result is unchanged`);
    this.name = 'DivergentResultIntegrityAlertError';
  }
}

/** Raised when a legal-entity-scoped query is issued with a legalEntityId
 * that does not match the record's actual legal entity (cross-entity
 * denial, enforced at the application layer). */
export class CrossEntityAccessDeniedError extends Error {
  constructor(entity: string, id: string) {
    super(`Access denied: ${entity} ${id} does not belong to the requested legal entity`);
    this.name = 'CrossEntityAccessDeniedError';
  }
}

/** Deactivating a fee table (or other referenced config) that has real
 * usage references — never hard-deleted once referenced. */
export class ReferencedRowCannotBeDeactivatedError extends Error {
  constructor(public readonly referenceCount: number) {
    super(`Cannot deactivate: referenced by ${referenceCount} resolved-fee-usage record(s). Deactivation is blocked, not the reference history.`);
    this.name = 'ReferencedRowCannotBeDeactivatedError';
  }
}
