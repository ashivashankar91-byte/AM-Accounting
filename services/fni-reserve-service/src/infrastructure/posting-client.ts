// CE-12 (Workstream R) — the ONLY door this service uses to reach the GL:
// coa-service's rule-pack-governed posting engine. Never gl-service
// directly, never a raw journal write. Pattern copied from
// services/posting-recovery-service/src/domain/ch01-adapter.ts's
// HttpCH01PostingExecutionPort (createServiceToken, x-tenant-id +
// Authorization headers, response-shape handling).
import { createServiceToken } from '@amacc/shared-kernel';
import { randomUUID } from 'crypto';
import { hashPayload } from '../domain/hash';

export interface SourceEventEnvelope {
  eventId: string;
  tenantId: string;
  legalEntityId?: string | null;
  storeId?: string | null;
  eventType: string;
  eventSchemaVersion: string;
  occurredAt: string;
  publishedAt: string;
  sourceSystem: string;
  sourceEntityType: string;
  sourceEntityId: string;
  sourceTransactionId?: string | null;
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

export interface SimulateEventResult {
  status: 'BLUEPRINT_GENERATED' | 'NO_RULE_MATCH' | 'REJECTED';
  rulePackVersionId?: string | null;
  ruleId?: string | null;
  blueprintHash?: string | null;
  lines?: unknown[];
  failureReason?: string | null;
}

/** Build a fresh eventId/correlationId-carrying envelope skeleton with the
 * required identity fields already stamped — call sites only need to add
 * eventType/sourceEntityType/sourceEntityId/businessDate/payload. */
export function newEnvelope(params: {
  tenantId: string;
  eventType: string;
  eventSchemaVersion?: string;
  sourceEntityType: string;
  sourceEntityId: string;
  sourceTransactionId?: string | null;
  correlationId?: string;
  causationId?: string | null;
  businessDate: string;
  occurredAt?: string;
  payload: Record<string, unknown>;
}): SourceEventEnvelope {
  const now = new Date().toISOString();
  return {
    eventId: randomUUID(),
    tenantId: params.tenantId,
    eventType: params.eventType,
    eventSchemaVersion: params.eventSchemaVersion ?? 'v1',
    occurredAt: params.occurredAt ?? now,
    publishedAt: now,
    sourceSystem: 'fni-reserve-service',
    sourceEntityType: params.sourceEntityType,
    sourceEntityId: params.sourceEntityId,
    sourceTransactionId: params.sourceTransactionId ?? null,
    correlationId: params.correlationId ?? randomUUID(),
    causationId: params.causationId ?? null,
    businessDate: params.businessDate,
    payload: params.payload,
    metadata: null,
  };
}

export class PostingClientError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'PostingClientError';
  }
}

export interface IPostingClient {
  submit(envelope: SourceEventEnvelope): Promise<SubmitEventResult>;
  simulate(envelope: SourceEventEnvelope): Promise<SimulateEventResult>;
}

export class HttpPostingClient implements IPostingClient {
  private readonly baseUrl: string;

  constructor(private readonly jwtSecret: string, baseUrl = process.env['COA_SERVICE_URL'] ?? 'http://coa-service:3016') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private headers(tenantId: string): Record<string, string> {
    const token = createServiceToken('fni-reserve-service', this.jwtSecret);
    return {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
      Authorization: `Bearer ${token}`,
    };
  }

  async submit(envelope: SourceEventEnvelope): Promise<SubmitEventResult> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/v1/coa/posting-engine/events`, {
        method: 'POST',
        headers: this.headers(envelope.tenantId),
        body: JSON.stringify(envelope),
      });
    } catch (err: any) {
      throw new PostingClientError(`coa-service unreachable: ${err?.message ?? String(err)}`, err);
    }
    let parsed: any;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    if (!res.ok && res.status !== 409) {
      throw new PostingClientError(`Posting engine submit failed: HTTP ${res.status} ${parsed?.message ?? ''}`.trim());
    }
    return {
      executionId: parsed?.executionId,
      eventId: parsed?.eventId ?? envelope.eventId,
      status: parsed?.status ?? 'FAILED',
      idempotent: Boolean(parsed?.idempotent),
      rulePackVersionId: parsed?.rulePackVersionId ?? null,
      ruleId: parsed?.ruleId ?? null,
      journalEntryId: parsed?.journalEntryId ?? null,
      journalNumber: parsed?.journalNumber ?? null,
      failureReason: parsed?.failureReason ?? null,
    };
  }

  async simulate(envelope: SourceEventEnvelope): Promise<SimulateEventResult> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/v1/coa/posting-engine/events/simulate`, {
        method: 'POST',
        headers: this.headers(envelope.tenantId),
        body: JSON.stringify(envelope),
      });
    } catch (err: any) {
      throw new PostingClientError(`coa-service unreachable: ${err?.message ?? String(err)}`, err);
    }
    let parsed: any;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      throw new PostingClientError(`Posting engine simulate failed: HTTP ${res.status} ${parsed?.message ?? ''}`.trim());
    }
    return parsed as SimulateEventResult;
  }
}

export { hashPayload };
