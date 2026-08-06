// CE-10 — the OUTPUT shape this service hands back to a consuming
// transaction (CE-07/CE-09/CE-11), to be carried INSIDE that transaction's
// own SourceEventEnvelope/MatrixRowEnvelope (owned by CE-07). tax-service
// never builds or posts a MatrixRowEnvelope itself — it has ZERO direct GL
// writes (see tests/zero-gl-writes.test.ts). This is deliberately a
// separate, narrower shape from src/domain/tax-adapter-contract.ts's
// TaxCalculationResult: it is the pinned reference a consuming envelope
// attaches (PUTR: field name on the final envelope, per the epic package),
// not the full stored evidence record.

export interface TaxAttachmentRef {
  taxResultId: string;
  status: 'CALCULATED' | 'EXEMPT_APPLIED';
  totalTax: string;
  currency: string;
  /** Whether the account mapping for this event type is resolved. When
   * PENDING, the caller must not proceed to attach/post — see
   * AccountMappingPendingError. */
  taxAccountMappingRef: string;
}

/**
 * S023 governed account-mapping matrix boundary standing rule: every new
 * matrix row is added BLANK and only a labeled TEST-TENANT fixture may
 * exercise a resolved value — never a real/production GL account number.
 * tax-service's TaxAccountMappingRef table stores only this opaque status
 * string (or the labeled fixture's opaque resolved value) — it never knows
 * or stores an actual GL account number.
 */
export const ACCOUNT_MAPPING_VALUES_PENDING = 'ACCOUNT_MAPPING_VALUES_PENDING' as const;

/** Opaque, non-numeric resolved value — certification-only, for the
 * labeled TEST-TENANT fixture below. Never a real GL account number. */
export const TEST_FIXTURE_MAPPING_RESOLVED = 'TEST-FIXTURE-MAPPING-RESOLVED' as const;

/** The one tenant permitted to exercise a resolved (still-opaque) mapping
 * status, and the only tenant TestFixtureEngine will run for. */
export const TEST_TENANT_CE10_CERTIFICATION_ONLY = 'TEST-TENANT-CE10-CERTIFICATION-ONLY' as const;
