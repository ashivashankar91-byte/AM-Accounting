// CE-07 integration boundary — the single real posting door. Mirrors
// services/posting-recovery-service/src/domain/ch01-adapter.ts's
// HttpCH01PostingExecutionPort exactly: coa-service's merged S019/S020
// posting-engine event endpoint, called service-to-service with a
// freshly-signed short-lived HS256 service JWT (createServiceToken), never
// a static shared secret. No second posting engine, no direct journal
// writes anywhere in this service (see tests/zero-gl-writes.test.ts).

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

export interface SubmitEventResult {
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

export interface PostingEventProducer {
  submit(envelope: SourceEventEnvelope): Promise<SubmitEventResult>;
}

export class PostingEngineUnreachableError extends Error {
  readonly code = 'POSTING_ENGINE_UNREACHABLE';
  constructor(message: string) { super(message); this.name = 'PostingEngineUnreachableError'; }
}

export class PostingEngineIdentityConflictError extends Error {
  readonly code = 'EVENT_IDENTITY_CONFLICT';
  constructor(readonly executionId: string, message: string) { super(message); this.name = 'PostingEngineIdentityConflictError'; }
}

export class HttpPostingEventProducer implements PostingEventProducer {
  private readonly baseUrl: string;

  constructor(
    private readonly jwtSecret: string,
    baseUrl = process.env['COA_SERVICE_URL'] ?? 'http://coa-service:3016',
    private readonly sourceSystem = 'parts-accounting-service',
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async submit(envelope: SourceEventEnvelope): Promise<SubmitEventResult> {
    const { createServiceToken } = await import('@amacc/shared-kernel');
    const serviceToken = createServiceToken(this.sourceSystem, this.jwtSecret);

    const body: SourceEventEnvelope = { ...envelope, sourceSystem: this.sourceSystem };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/v1/coa/posting-engine/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': envelope.tenantId,
          Authorization: `Bearer ${serviceToken}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err: any) {
      throw new PostingEngineUnreachableError(`coa-service unreachable: ${err?.message ?? String(err)}`);
    }

    let parsed: any;
    try { parsed = await res.json(); } catch { parsed = null; }

    if (res.status === 409) {
      throw new PostingEngineIdentityConflictError(
        parsed?.executionId ?? 'unknown',
        `Posting engine rejected as EVENT_IDENTITY_CONFLICT for event ${envelope.eventId} (executionId=${parsed?.executionId ?? 'unknown'}).`,
      );
    }
    if (!res.ok) {
      throw new PostingEngineUnreachableError(`Posting engine call failed: ${parsed?.message ?? `HTTP ${res.status}`}`);
    }
    return parsed as SubmitEventResult;
  }
}

/** In-memory fake for unit tests — records submitted envelopes, returns a scripted result. */
export class FakePostingEventProducer implements PostingEventProducer {
  readonly submitted: SourceEventEnvelope[] = [];
  private readonly seen = new Map<string, SubmitEventResult>();
  constructor(private readonly script: (envelope: SourceEventEnvelope) => SubmitEventResult) {}

  async submit(envelope: SourceEventEnvelope): Promise<SubmitEventResult> {
    const key = `${envelope.tenantId}:${envelope.eventId}`;
    const existing = this.seen.get(key);
    if (existing) return { ...existing, idempotent: true };
    this.submitted.push(envelope);
    const result = this.script(envelope);
    this.seen.set(key, result);
    return result;
  }
}
