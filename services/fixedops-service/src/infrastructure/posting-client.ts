// CE-07 integration boundary — the ONLY door this service posts a journal
// through. Mirrors services/posting-recovery-service/src/domain/ch01-adapter.ts's
// HttpCH01PostingExecutionPort exactly: createServiceToken + Bearer auth +
// x-tenant-id header, POST to coa-service's real S013/S019/S020
// posting-engine. No second posting engine is invented anywhere in this
// service.

export interface SourceEventEnvelope {
  eventId: string;
  tenantId: string;
  eventType: string;
  eventSchemaVersion: string;
  occurredAt: string;
  publishedAt: string;
  sourceSystem: string;
  sourceEntityType: string;
  sourceEntityId: string;
  correlationId: string;
  causationId?: string | null;
  businessDate: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
}

export interface PostingEventResult {
  executionId: string;
  eventId: string;
  status: 'POSTED' | 'NO_RULE_MATCH' | 'REJECTED' | 'FAILED';
  idempotent: boolean;
  rulePackVersionId?: string | null;
  ruleId?: string | null;
  journalEntryId?: string | null;
  journalNumber?: string | null;
  failureReason?: string | null;
}

export class PostingEngineUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostingEngineUnreachableError';
  }
}

export interface PostingEventProducer {
  submit(envelope: SourceEventEnvelope): Promise<PostingEventResult>;
}

export class HttpPostingEventProducer implements PostingEventProducer {
  private readonly baseUrl: string;

  constructor(
    private readonly jwtSecret: string,
    baseUrl = process.env['COA_SERVICE_URL'] ?? 'http://coa-service:3016',
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async submit(envelope: SourceEventEnvelope): Promise<PostingEventResult> {
    const { createServiceToken } = await import('@amacc/shared-kernel');
    const serviceToken = createServiceToken('fixedops-service', this.jwtSecret);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/v1/coa/posting-engine/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': envelope.tenantId,
          Authorization: `Bearer ${serviceToken}`,
        },
        body: JSON.stringify(envelope),
      });
    } catch (err: any) {
      throw new PostingEngineUnreachableError(`coa-service unreachable: ${err?.message ?? String(err)}`);
    }

    let parsed: any;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }

    if (res.status === 409) {
      return {
        executionId: parsed?.executionId ?? 'unknown',
        eventId: envelope.eventId,
        status: 'REJECTED',
        idempotent: false,
        failureReason: `EVENT_IDENTITY_CONFLICT: ${parsed?.message ?? 'reconstructed envelope does not match original event'}`,
      };
    }

    if (!res.ok) {
      throw new PostingEngineUnreachableError(`Posting engine call failed: HTTP ${res.status} ${parsed?.message ?? ''}`);
    }

    return {
      executionId: parsed.executionId,
      eventId: parsed.eventId,
      status: parsed.status,
      idempotent: Boolean(parsed.idempotent),
      rulePackVersionId: parsed.rulePackVersionId ?? null,
      ruleId: parsed.ruleId ?? null,
      journalEntryId: parsed.journalEntryId ?? null,
      journalNumber: parsed.journalNumber ?? null,
      failureReason: parsed.failureReason ?? null,
    };
  }
}
