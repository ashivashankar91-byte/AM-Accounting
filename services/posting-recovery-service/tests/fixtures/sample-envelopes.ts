import { hashPayload } from '../../src/domain/hash';
import { PostingFailureEnvelope } from '../../src/domain/ch01-adapter';

// S021 deterministic test/demo fixtures. Symbolic source-event data only —
// no production AP/AR/Cash accounting mapping appears anywhere here (per
// the story's explicit "do not invent accounting mappings" boundary). Used
// by the browser journey (via the POSTING_RECOVERY_FIXTURES_ENABLED-gated
// /_fixtures endpoints) and available for manual verification.

// UUID-shaped (not readable slugs): auth-service's real login endpoint
// validates tenantId as a UUID (matching tenant-service's Tenant.id shape),
// so these must be UUID-shaped for the browser journey to log in against a
// real auth-service — these are obviously-fake, clustered, non-random UUIDs
// (0xA.../0xB...) never resembling a real production tenant id.
export const FIXTURE_TENANT_A = 'aaaaaaaa-fa11-4000-a000-000000000001';
export const FIXTURE_TENANT_B = 'bbbbbbbb-fa11-4000-b000-000000000002';

function envelope(overrides: {
  tenantId: string;
  eventId: string;
  correlationId: string;
  sourceTransactionId: string;
  failureCategory: PostingFailureEnvelope['failure']['failureCategory'];
  failureCode: string;
  failureMessage: string;
  payload: Record<string, unknown>;
  /** CE-07 integration — only set on fixtures meant to exercise a REAL
   * replay against CH01 (see FIXTURE_REPLAY_ELIGIBLE below). Omitted on
   * every other fixture deliberately: ReplayService.replay() requires
   * eventSchemaVersion + sourceEntityId to be present (BR from the S021
   * completion slice) and rejects with REPLAY_ENVELOPE_INCOMPLETE
   * otherwise — most of these fixtures exist only to demonstrate DLQ
   * inspection, not replay. */
  replayEligible?: boolean;
}): PostingFailureEnvelope {
  const payload = overrides.payload;
  return {
    event: {
      eventId: overrides.eventId,
      tenantId: overrides.tenantId,
      eventType: 'TEST_DEAL_POSTED',
      eventSchemaVersion: overrides.replayEligible ? '1.0' : undefined,
      sourceSystem: 'test-deal-service',
      sourceEntityType: 'DEAL',
      sourceEntityId: overrides.replayEligible ? overrides.sourceTransactionId : undefined,
      sourceTransactionId: overrides.sourceTransactionId,
      correlationId: overrides.correlationId,
      occurredAt: '2026-07-25T14:00:00.000Z',
      businessDate: '2026-07-25',
      postingIdempotencyKey: `idem-${overrides.eventId}`,
      payload,
      payloadHash: hashPayload(payload),
    },
    failure: {
      failureCategory: overrides.failureCategory,
      failureCode: overrides.failureCode,
      failureStage: 'RULE_RESOLUTION',
      failureMessage: overrides.failureMessage,
      occurredAt: '2026-07-25T14:00:05.000Z',
    },
  };
}

/** 1. Invalid event-contract failure — CH01 rejected the source event's own contract. */
export const FIXTURE_INVALID_CONTRACT = envelope({
  tenantId: FIXTURE_TENANT_A,
  eventId: 'fixture-evt-invalid-contract',
  correlationId: 'fixture-corr-invalid-contract',
  sourceTransactionId: 'DEAL-9001',
  failureCategory: 'EVENT_CONTRACT_INVALID',
  failureCode: 'MISSING_REQUIRED_FIELD_AMOUNT',
  failureMessage: 'Source event is missing the required "amount" field',
  payload: { dealNumber: 'DEAL-9001', customerSsn: '123-45-6789', amount: null },
});

/** 2. No-rule-match failure. */
export const FIXTURE_NO_RULE_MATCH = envelope({
  tenantId: FIXTURE_TENANT_A,
  eventId: 'fixture-evt-no-rule-match',
  correlationId: 'fixture-corr-no-rule-match',
  sourceTransactionId: 'DEAL-9002',
  failureCategory: 'RULE_NOT_FOUND',
  failureCode: 'RULE_PACK_NOT_FOUND_FOR_EVENT_TYPE',
  failureMessage: 'No rule pack is configured for event type TEST_DEAL_POSTED in this tenant',
  payload: { dealNumber: 'DEAL-9002', amount: '18250.00' },
});

/** 3. Transient downstream failure. */
export const FIXTURE_TRANSIENT_DOWNSTREAM = envelope({
  tenantId: FIXTURE_TENANT_A,
  eventId: 'fixture-evt-transient-downstream',
  correlationId: 'fixture-corr-transient-downstream',
  sourceTransactionId: 'DEAL-9003',
  failureCategory: 'DOWNSTREAM_TRANSIENT',
  failureCode: 'GL_SERVICE_TIMEOUT',
  failureMessage: 'gl-service did not respond within the posting timeout window',
  payload: { dealNumber: 'DEAL-9003', amount: '4200.00' },
});

/** 4. A case that will get a failed replay-attempt appended after intake (see loader). */
export const FIXTURE_WITH_FAILED_REPLAY = envelope({
  tenantId: FIXTURE_TENANT_A,
  eventId: 'fixture-evt-failed-replay',
  correlationId: 'fixture-corr-failed-replay',
  sourceTransactionId: 'DEAL-9004',
  failureCategory: 'ACCOUNTING_MAPPING_UNRESOLVED',
  failureCode: 'GL_ACCOUNT_MAPPING_NOT_FOUND',
  failureMessage: 'No GL account mapping resolved for department code 47',
  payload: { dealNumber: 'DEAL-9004', amount: '950.00', departmentCode: '47' },
});

/** 5. Second-tenant fixture, for RLS isolation proof at the API layer. */
export const FIXTURE_TENANT_B_CASE = envelope({
  tenantId: FIXTURE_TENANT_B,
  eventId: 'fixture-evt-tenant-b',
  correlationId: 'fixture-corr-tenant-b',
  sourceTransactionId: 'DEAL-B-9001',
  failureCategory: 'REFERENCE_DATA_MISSING',
  failureCode: 'STORE_REFERENCE_NOT_FOUND',
  failureMessage: 'Referenced store code does not exist in tenant-service',
  payload: { dealNumber: 'DEAL-B-9001', amount: '3100.00' },
});

/** 6. CE-07 integration — the one fixture with a complete envelope
 * (eventSchemaVersion + sourceEntityId), used to exercise a REAL replay
 * call to CH01 (services/coa-service's merged S019/S020 posting engine) in
 * the browser journey. No tenant has a rule pack for TEST_DEAL_POSTED (this
 * is a symbolic fixture event type, never a real AP/AR/Cash one), so CH01
 * genuinely evaluates it and returns NO_RULE_MATCH — proving the full
 * replay wire-up end-to-end without authoring any accounting rule content
 * (that boundary belongs to S023, not this integration).
 */
export const FIXTURE_REPLAY_ELIGIBLE = envelope({
  tenantId: FIXTURE_TENANT_A,
  eventId: 'fixture-evt-replay-eligible',
  correlationId: 'fixture-corr-replay-eligible',
  sourceTransactionId: 'DEAL-9005',
  failureCategory: 'RULE_NOT_FOUND',
  failureCode: 'RULE_PACK_NOT_FOUND_FOR_EVENT_TYPE',
  failureMessage: 'No rule pack is configured for event type TEST_DEAL_POSTED in this tenant',
  payload: { dealNumber: 'DEAL-9005', amount: '2750.00' },
  replayEligible: true,
});

export const ALL_FIXTURE_ENVELOPES: PostingFailureEnvelope[] = [
  FIXTURE_INVALID_CONTRACT,
  FIXTURE_NO_RULE_MATCH,
  FIXTURE_TRANSIENT_DOWNSTREAM,
  FIXTURE_WITH_FAILED_REPLAY,
  FIXTURE_TENANT_B_CASE,
  FIXTURE_REPLAY_ELIGIBLE,
];
