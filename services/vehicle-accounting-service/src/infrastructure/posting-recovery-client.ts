// CE-12 S021 integration — reports a coa-service REJECTED/FAILED posting
// result into posting-recovery-service's production dead-letter intake
// route (POST /posting-recovery/v1/dead-letters), so it becomes a real
// S021 case an operator can triage/replay. Mirrors
// posting-recovery-service's own HttpCH01PostingExecutionPort style (real
// fetch, real error handling, createServiceToken, role SERVICE) — see
// services/posting-recovery-service/src/domain/ch01-adapter.ts.
import { SourceEventEnvelope } from '../domain/event-envelope';
import { hashPayload } from '../domain/hash';
import { postingIdempotencyKey } from '../domain/event-envelope';

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

export interface ReportFailureInput {
  envelope: SourceEventEnvelope;
  legalEntityId?: string | null;
  storeId?: string | null;
  sourceTransactionId?: string | null;
  failureCategory: PostingFailureCategory;
  failureCode: string;
  failureStage: PostingFailureStage;
  failureMessage: string;
}

export interface IntakeResult {
  deadLetterId: string;
  created: boolean;
}

export class PostingRecoveryUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostingRecoveryUnavailableError';
  }
}

export interface PostingRecoveryClient {
  reportFailure(input: ReportFailureInput): Promise<IntakeResult>;
}

export class HttpPostingRecoveryClient implements PostingRecoveryClient {
  private readonly baseUrl: string;

  constructor(
    private readonly jwtSecret: string,
    baseUrl = process.env['POSTING_RECOVERY_SERVICE_URL'] ?? 'http://posting-recovery-service:3049',
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async reportFailure(input: ReportFailureInput): Promise<IntakeResult> {
    const { createServiceToken } = await import('@amacc/shared-kernel');
    const token = createServiceToken('vehicle-accounting-service', this.jwtSecret);
    const { envelope } = input;

    const payloadHash = hashPayload(envelope.payload);
    const body = {
      envelope: {
        event: {
          eventId: envelope.eventId,
          tenantId: envelope.tenantId,
          legalEntityId: input.legalEntityId ?? null,
          storeId: input.storeId ?? null,
          eventType: envelope.eventType,
          eventSchemaVersion: envelope.eventSchemaVersion,
          sourceSystem: envelope.sourceSystem,
          sourceEntityType: envelope.sourceEntityType,
          sourceEntityId: envelope.sourceEntityId,
          sourceTransactionId: input.sourceTransactionId ?? null,
          correlationId: envelope.correlationId,
          causationId: envelope.causationId ?? null,
          occurredAt: envelope.occurredAt,
          publishedAt: envelope.publishedAt,
          businessDate: envelope.businessDate,
          postingIdempotencyKey: postingIdempotencyKey(envelope.tenantId, envelope.eventId),
          payload: envelope.payload,
          payloadHash,
        },
        failure: {
          failureCategory: input.failureCategory,
          failureCode: input.failureCode,
          failureStage: input.failureStage,
          failureMessage: input.failureMessage,
          occurredAt: new Date().toISOString(),
        },
      },
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/posting-recovery/v1/dead-letters`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': envelope.tenantId,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err: any) {
      throw new PostingRecoveryUnavailableError(`posting-recovery-service unreachable: ${err?.message ?? String(err)}`);
    }

    let parsed: any;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      throw new PostingRecoveryUnavailableError(`posting-recovery-service dead-letter intake returned HTTP ${res.status}: ${parsed?.message ?? '(no body)'}`);
    }
    return { deadLetterId: parsed.deadLetterId, created: Boolean(parsed.created) };
  }
}
