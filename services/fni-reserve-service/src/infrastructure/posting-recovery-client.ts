// CE-12 — when coa-service's posting engine returns REJECTED/FAILED (most
// commonly ACCOUNTING_MAPPING_UNRESOLVED — a rule-pack row still pinned to
// ACCOUNT_MAPPING_VALUES_PENDING), this service calls posting-recovery-
// service's production intake route so the failure lands in the real
// recovery queue rather than being silently dropped. Service-to-service
// only (role SERVICE), createServiceToken auth — mirrors
// services/posting-recovery-service/src/http/dead-letter-routes.ts's own
// POST /dead-letters producer-boundary contract exactly.
import { createServiceToken } from '@amacc/shared-kernel';
import { hashPayload } from '../domain/hash';
import type { SourceEventEnvelope } from './posting-client';

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

export interface PostingFailureDetail {
  failureCategory: PostingFailureCategory;
  failureCode: string;
  failureStage: PostingFailureStage;
  failureMessage: string;
  fieldErrors?: Record<string, unknown> | null;
  ruleContext?: Record<string, unknown> | null;
  occurredAt: string;
}

export class PostingRecoveryClientError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'PostingRecoveryClientError';
  }
}

export interface IPostingRecoveryClient {
  reportFailure(envelope: SourceEventEnvelope, failure: PostingFailureDetail): Promise<{ deadLetterId: string; created: boolean }>;
}

export class HttpPostingRecoveryClient implements IPostingRecoveryClient {
  private readonly baseUrl: string;

  constructor(
    private readonly jwtSecret: string,
    baseUrl = process.env['POSTING_RECOVERY_SERVICE_URL'] ?? 'http://posting-recovery-service:3049',
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async reportFailure(envelope: SourceEventEnvelope, failure: PostingFailureDetail): Promise<{ deadLetterId: string; created: boolean }> {
    const token = createServiceToken('fni-reserve-service', this.jwtSecret);
    const body = {
      envelope: {
        event: {
          eventId: envelope.eventId,
          tenantId: envelope.tenantId,
          legalEntityId: envelope.legalEntityId ?? null,
          storeId: envelope.storeId ?? null,
          eventType: envelope.eventType,
          eventSchemaVersion: envelope.eventSchemaVersion,
          sourceSystem: envelope.sourceSystem,
          sourceEntityType: envelope.sourceEntityType,
          sourceEntityId: envelope.sourceEntityId,
          sourceTransactionId: envelope.sourceTransactionId ?? null,
          correlationId: envelope.correlationId,
          causationId: envelope.causationId ?? null,
          occurredAt: envelope.occurredAt,
          publishedAt: envelope.publishedAt,
          businessDate: envelope.businessDate,
          postingIdempotencyKey: `${envelope.tenantId}:${envelope.eventId}`,
          payload: envelope.payload,
          payloadHash: hashPayload(envelope.payload),
        },
        failure,
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
      throw new PostingRecoveryClientError(`posting-recovery-service unreachable: ${err?.message ?? String(err)}`, err);
    }
    let parsed: any;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      throw new PostingRecoveryClientError(`posting-recovery-service intake failed: HTTP ${res.status} ${parsed?.message ?? ''}`.trim());
    }
    return { deadLetterId: parsed?.deadLetterId, created: Boolean(parsed?.created) };
  }
}
