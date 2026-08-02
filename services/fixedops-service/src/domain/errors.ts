// CE-11 fixedops-service — typed domain errors. Every "we cannot proceed"
// path raises one of these rather than estimating, partially posting, or
// silently proceeding (see CE11_FABLE_EPIC_PACKAGE.md global rules).

export class FixedOpsValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'FixedOpsValidationError';
  }
}

export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

/** S023 boundary — deterministic rejection when an event family/role
 * mapping is still ACCOUNT_MAPPING_VALUES_PENDING. The whole RO close (or
 * other posting attempt) is rejected BEFORE any posting-engine call — never
 * a partial post. */
export class AccountMappingPendingError extends Error {
  constructor(public readonly tenantId: string, public readonly legalEntityId: string, public readonly eventFamily: string, public readonly role: string) {
    super(
      `Account mapping is ACCOUNT_MAPPING_VALUES_PENDING for tenant=${tenantId} legalEntity=${legalEntityId} ` +
      `eventFamily=${eventFamily} role=${role} — the transaction cannot post until Accounting resolves this mapping row.`,
    );
    this.name = 'AccountMappingPendingError';
  }
}

/** Raised when the customer-pay tax result is unavailable — the RO close
 * blocks (BLOCKED_TAX_UNAVAILABLE) rather than estimating or defaulting to
 * zero tax. */
export class TaxResultUnavailableError extends Error {
  constructor(public readonly parkedExceptionId: string | null, message: string) {
    super(message);
    this.name = 'TaxResultUnavailableError';
  }
}

/** Mixed-pay / distribution conservation failure — never partially posted. */
export class DistributionConservationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DistributionConservationError';
  }
}

/** S060 — reopen/void refused with a named, audited reason. */
export class ReversalRefusedError extends Error {
  constructor(public readonly refusalCode: 'CLAIM_CASH_APPLIED' | 'PAYMENT_APPLIED', message: string) {
    super(message);
    this.name = 'ReversalRefusedError';
  }
}

/** Event identity conflict — same idempotency key, different content. */
export class EventIdentityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventIdentityConflictError';
  }
}

/** S063 gap-closure — no LaborRateConfig row resolves for this
 * (tenant, legalEntity, techId, deptCode, asOfDate): neither a
 * technician-specific rate nor a department-default rate exists. Raised
 * BEFORE any posting-engine call or DB write — never an estimated/zero
 * rate, never a partial post. */
export class RateGapError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly legalEntityId: string,
    public readonly techId: string,
    public readonly deptCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'RateGapError';
  }
}
