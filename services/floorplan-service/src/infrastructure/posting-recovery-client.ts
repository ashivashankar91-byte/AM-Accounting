// CE-12 — producer-side dead-letter intake. Called whenever coa-service's
// posting engine returns REJECTED/FAILED for an event this service
// submitted (most commonly ACCOUNTING_MAPPING_UNRESOLVED — a rule-pack row
// still pinned to ACCOUNT_MAPPING_VALUES_PENDING). Mirrors
// services/posting-recovery-service/src/http/dead-letter-routes.ts's
// POST /dead-letters production intake contract exactly, and
// services/posting-recovery-service/src/domain/hash.ts's hashPayload
// canonicalization exactly (byte-for-byte — the intake service recomputes
// this hash server-side and 400s on any mismatch).
import crypto from 'crypto';
import type { SourceEventEnvelope } from '../domain/envelope';

// ── Canonical JSON hash — copied verbatim from posting-recovery-service's
// hash.ts so the digest this service computes matches what the intake
// endpoint recomputes. ──────────────────────────────────────────────────
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, canonicalize(v)] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries);
  }
  return value;
}

export function hashPayload(payload: unknown): string {
  const canonical = JSON.stringify(canonicalize(payload));
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export type PostingFailureCategory =
  | 'EVENT_CONTRACT_INVALID'
  | 'RULE_NOT_FOUND'
  | 'RULE_CONFIGURATION_INVALID'
  | 'ACCOUNTING_MAPPING_UNRESOLVED'
  | 'REFERENCE_DATA_MISSING'
  | 'ACCOUNTING_PERIOD_BLOCKED'
  | 'SOURCE_STATE_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'AUTHORIZATION_FAILURE'
  | 'DOWNSTREAM_TRANSIENT'
  | 'DOWNSTREAM_PERMANENT'
  | 'INFRASTRUCTURE_FAILURE'
  | 'UNKNOWN_FAILURE';

export type PostingFailureStage = 'CONTRACT_VALIDATION' | 'RULE_RESOLUTION' | 'MAPPING' | 'PERIOD_CHECK' | 'DOWNSTREAM_POST' | 'UNKNOWN';

export interface DeadLetterInput {
  envelope: SourceEventEnvelope;
  postingIdempotencyKey: string;
  legalEntityId?: string | null;
  storeId?: string | null;
  sourceTransactionId?: string | null;
  failureCategory: PostingFailureCategory;
  failureCode: string;
  failureStage: PostingFailureStage;
  failureMessage: string;
  occurredAt?: string;
}

export interface PostingRecoveryClient {
  reportFailure(input: DeadLetterInput): Promise<{ deadLetterId: string; created: boolean }>;
}

export class HttpPostingRecoveryClient implements PostingRecoveryClient {
  private readonly baseUrl: string;

  constructor(
    private readonly jwtSecret: string = (() => {
      const secret = process.env['AMACC_JWT_SECRET'];
      if (!secret) throw new Error('AMACC_JWT_SECRET environment variable is required but not set');
      return secret;
    })(),
    baseUrl = process.env['POSTING_RECOVERY_SERVICE_URL'] ?? 'http://posting-recovery-service:3049',
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async reportFailure(input: DeadLetterInput): Promise<{ deadLetterId: string; created: boolean }> {
    const { createServiceToken } = await import('@amacc/shared-kernel');
    const serviceToken = createServiceToken('floorplan-service', this.jwtSecret);

    const event = {
      eventId: input.envelope.eventId,
      tenantId: input.envelope.tenantId,
      legalEntityId: input.legalEntityId ?? null,
      storeId: input.storeId ?? null,
      eventType: input.envelope.eventType,
      eventSchemaVersion: input.envelope.eventSchemaVersion,
      sourceSystem: input.envelope.sourceSystem,
      sourceEntityType: input.envelope.sourceEntityType,
      sourceEntityId: input.envelope.sourceEntityId,
      sourceTransactionId: input.sourceTransactionId ?? null,
      correlationId: input.envelope.correlationId,
      causationId: input.envelope.causationId ?? null,
      occurredAt: input.envelope.occurredAt,
      publishedAt: input.envelope.publishedAt,
      businessDate: input.envelope.businessDate,
      postingIdempotencyKey: input.postingIdempotencyKey,
      payload: input.envelope.payload,
      payloadHash: hashPayload(input.envelope.payload),
    };

    const failure = {
      failureCategory: input.failureCategory,
      failureCode: input.failureCode,
      failureStage: input.failureStage,
      failureMessage: input.failureMessage,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
    };

    const res = await fetch(`${this.baseUrl}/posting-recovery/v1/dead-letters`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': input.envelope.tenantId,
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify({ envelope: { event, failure } }),
    });
    const parsed: any = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`posting-recovery-service /dead-letters returned ${res.status}: ${parsed?.message ?? '(no message)'}`);
    }
    return { deadLetterId: parsed.deadLetterId, created: Boolean(parsed.created) };
  }
}

/** Deterministic in-memory test double. */
export class InMemoryPostingRecoveryClient implements PostingRecoveryClient {
  public reported: DeadLetterInput[] = [];
  async reportFailure(input: DeadLetterInput): Promise<{ deadLetterId: string; created: boolean }> {
    this.reported.push(input);
    return { deadLetterId: `dlq-${this.reported.length}`, created: true };
  }
}
