// On REJECTED/FAILED from coa-service's posting engine, this service files a
// dead-letter case with posting-recovery-service's production intake route
// — POST /posting-recovery/v1/dead-letters — exactly per its documented
// contract (services/posting-recovery-service/src/http/dead-letter-
// routes.ts's `app.post('/dead-letters', ...)`, service-role-gated) and
// domain shape (services/posting-recovery-service/src/domain/ch01-
// adapter.ts's PostingFailureEnvelope / services/posting-recovery-service/
// src/domain/hash.ts's hashPayload).

import { SourceEventEnvelope } from '../domain/event-envelope';
import { hashPayload } from '../domain/hash';
import { PostingFailureCategory } from './posting-failure-taxonomy';

export interface PostingFailureDetail {
  failureCategory: PostingFailureCategory;
  failureCode: string;
  failureStage: 'CONTRACT_VALIDATION' | 'RULE_RESOLUTION' | 'MAPPING' | 'PERIOD_CHECK' | 'DOWNSTREAM_POST' | 'UNKNOWN';
  failureMessage: string;
  occurredAt: string;
}

export interface DeadLetterIntakeResult {
  deadLetterId: string;
  created: boolean;
}

export interface IPostingRecoveryClient {
  fileDeadLetter(envelope: SourceEventEnvelope, failure: PostingFailureDetail, opts?: { legalEntityId?: string | null; storeId?: string | null; sourceTransactionId?: string | null }): Promise<DeadLetterIntakeResult>;
}

export class PostingRecoveryUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostingRecoveryUnavailableError';
  }
}

export class HttpPostingRecoveryClient implements IPostingRecoveryClient {
  private readonly baseUrl: string;

  constructor(
    private readonly jwtSecret: string,
    baseUrl = process.env['POSTING_RECOVERY_SERVICE_URL'] ?? 'http://posting-recovery-service:3049',
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async fileDeadLetter(
    envelope: SourceEventEnvelope,
    failure: PostingFailureDetail,
    opts?: { legalEntityId?: string | null; storeId?: string | null; sourceTransactionId?: string | null },
  ): Promise<DeadLetterIntakeResult> {
    const { createServiceToken } = await import('@amacc/shared-kernel');
    const token = createServiceToken('deal-accounting-service', this.jwtSecret);

    const payloadHash = hashPayload(envelope.payload);
    const body = {
      envelope: {
        event: {
          eventId: envelope.eventId,
          tenantId: envelope.tenantId,
          legalEntityId: opts?.legalEntityId ?? null,
          storeId: opts?.storeId ?? null,
          eventType: envelope.eventType,
          eventSchemaVersion: envelope.eventSchemaVersion,
          sourceSystem: envelope.sourceSystem,
          sourceEntityType: envelope.sourceEntityType,
          sourceEntityId: envelope.sourceEntityId,
          sourceTransactionId: opts?.sourceTransactionId ?? null,
          correlationId: envelope.correlationId,
          causationId: envelope.causationId ?? null,
          occurredAt: envelope.occurredAt,
          publishedAt: envelope.publishedAt,
          businessDate: envelope.businessDate,
          postingIdempotencyKey: `${envelope.tenantId}:${envelope.eventId}`,
          payload: envelope.payload,
          payloadHash,
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
      throw new PostingRecoveryUnavailableError(`posting-recovery-service unreachable: ${err?.message ?? String(err)}`);
    }
    let parsed: any;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      throw new PostingRecoveryUnavailableError(`posting-recovery-service intake failed: HTTP ${res.status} ${parsed?.message ?? ''}`);
    }
    return parsed as DeadLetterIntakeResult;
  }
}
