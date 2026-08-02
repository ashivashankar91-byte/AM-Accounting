// The ONLY door this service uses to get a financial event onto the ledger:
// coa-service's rule-pack-governed posting engine. Never gl-service
// directly, never a raw journal write. Mirrors services/posting-recovery-
// service/src/domain/ch01-adapter.ts's HttpCH01PostingExecutionPort call
// shape exactly (same body fields, same createServiceToken pattern), plus
// the S085 preview (`/events/simulate`) endpoint that adapter doesn't need.

import { SourceEventEnvelope } from '../domain/event-envelope';

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

export interface BlueprintLine {
  accountNumber: string;
  storeId: string;
  deptCode?: string | null;
  dr: number;
  cr: number;
  memo?: string | null;
  controlNumber?: string | null;
  applyNumber?: string | null;
}

export interface SimulateEventResult {
  status: 'BLUEPRINT_GENERATED' | 'NO_RULE_MATCH' | 'REJECTED';
  rulePackVersionId?: string | null;
  ruleId?: string | null;
  blueprintHash?: string | null;
  lines?: BlueprintLine[];
  failureReason?: string | null;
}

export class PostingEngineUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostingEngineUnavailableError';
  }
}

export interface IPostingEngineClient {
  submitEvent(envelope: SourceEventEnvelope): Promise<SubmitEventResult>;
  simulate(envelope: SourceEventEnvelope): Promise<SimulateEventResult>;
}

function envelopeBody(envelope: SourceEventEnvelope) {
  return {
    eventId: envelope.eventId,
    tenantId: envelope.tenantId,
    eventType: envelope.eventType,
    eventSchemaVersion: envelope.eventSchemaVersion,
    occurredAt: envelope.occurredAt,
    publishedAt: envelope.publishedAt,
    sourceSystem: envelope.sourceSystem,
    sourceEntityType: envelope.sourceEntityType,
    sourceEntityId: envelope.sourceEntityId,
    correlationId: envelope.correlationId,
    causationId: envelope.causationId ?? null,
    businessDate: envelope.businessDate,
    payload: envelope.payload,
    metadata: envelope.metadata ?? null,
  };
}

export class HttpPostingEngineClient implements IPostingEngineClient {
  private readonly baseUrl: string;

  constructor(
    private readonly jwtSecret: string,
    baseUrl = process.env['COA_SERVICE_URL'] ?? 'http://coa-service:3016',
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async serviceToken(): Promise<string> {
    const { createServiceToken } = await import('@amacc/shared-kernel');
    return createServiceToken('deal-accounting-service', this.jwtSecret);
  }

  async submitEvent(envelope: SourceEventEnvelope): Promise<SubmitEventResult> {
    const token = await this.serviceToken();
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/v1/coa/posting-engine/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': envelope.tenantId,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(envelopeBody(envelope)),
      });
    } catch (err: any) {
      throw new PostingEngineUnavailableError(`coa-service unreachable: ${err?.message ?? String(err)}`);
    }
    let parsed: any;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    if (res.status === 409) {
      // EVENT_IDENTITY_CONFLICT — a different envelope was already recorded
      // under this eventId. Surface as a FAILED-shaped result the caller
      // must escalate (never silently retried unmodified).
      return {
        executionId: parsed?.executionId ?? '',
        eventId: envelope.eventId,
        status: 'FAILED',
        idempotent: false,
        failureReason: `EVENT_IDENTITY_CONFLICT: envelope for event ${envelope.eventId} does not match the one coa-service already recorded (executionId=${parsed?.executionId ?? 'unknown'}).`,
      };
    }
    if (!res.ok) {
      throw new PostingEngineUnavailableError(`coa-service posting-engine call failed: HTTP ${res.status} ${parsed?.message ?? ''}`);
    }
    return parsed as SubmitEventResult;
  }

  async simulate(envelope: SourceEventEnvelope): Promise<SimulateEventResult> {
    const token = await this.serviceToken();
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/v1/coa/posting-engine/events/simulate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': envelope.tenantId,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(envelopeBody(envelope)),
      });
    } catch (err: any) {
      throw new PostingEngineUnavailableError(`coa-service unreachable: ${err?.message ?? String(err)}`);
    }
    let parsed: any;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      throw new PostingEngineUnavailableError(`coa-service posting-engine simulate call failed: HTTP ${res.status} ${parsed?.message ?? ''}`);
    }
    return parsed as SimulateEventResult;
  }
}
