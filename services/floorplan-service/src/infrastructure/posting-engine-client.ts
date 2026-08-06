// CE-12 — the canonical posting path. Every financial event this service
// produces is submitted here, never written directly to gl-service/
// coa-service tables. Adapted, field-for-field, from
// services/posting-recovery-service/src/domain/ch01-adapter.ts's
// HttpCH01PostingExecutionPort — same createServiceToken pattern, same
// response-shape handling.
import type { SourceEventEnvelope } from '../domain/envelope';

export type PostingEngineStatus = 'POSTED' | 'NO_RULE_MATCH' | 'REJECTED' | 'FAILED';

export interface SubmitEventResult {
  executionId: string;
  eventId: string;
  status: PostingEngineStatus;
  idempotent: boolean;
  rulePackVersionId: string | null;
  ruleId: string | null;
  journalEntryId: string | null;
  journalNumber: string | null;
  failureReason: string | null;
}

export interface SimulateResult {
  status: string;
  rulePackVersionId?: string | null;
  ruleId?: string | null;
  blueprintHash?: string | null;
  lines?: unknown[];
  failureReason?: string | null;
}

export interface ReverseJournalInput {
  journalEntryId: string;
  reason: string;
  targetPeriod?: string | null;
}

export interface PostingEngineClient {
  submitEvent(envelope: SourceEventEnvelope): Promise<SubmitEventResult>;
  simulate(envelope: SourceEventEnvelope): Promise<SimulateResult>;
  reverseJournal(tenantId: string, input: ReverseJournalInput): Promise<{ id: string; journalNumber: string }>;
}

export class HttpPostingEngineClient implements PostingEngineClient {
  private readonly baseUrl: string;

  constructor(
    private readonly jwtSecret: string = (() => {
      const secret = process.env['AMACC_JWT_SECRET'];
      if (!secret) throw new Error('AMACC_JWT_SECRET environment variable is required but not set');
      return secret;
    })(),
    baseUrl = process.env['COA_SERVICE_URL'] ?? 'http://coa-service:3016',
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async token(): Promise<string> {
    const { createServiceToken } = await import('@amacc/shared-kernel');
    return createServiceToken('floorplan-service', this.jwtSecret);
  }

  async submitEvent(envelope: SourceEventEnvelope): Promise<SubmitEventResult> {
    const serviceToken = await this.token();
    const res = await fetch(`${this.baseUrl}/api/v1/coa/posting-engine/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': envelope.tenantId,
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify(envelope),
    });
    const parsed: any = await res.json().catch(() => null);
    if (!res.ok && res.status !== 409) {
      throw new Error(`coa-service posting-engine/events returned ${res.status}: ${parsed?.message ?? '(no message)'}`);
    }
    if (res.status === 409) {
      // EVENT_IDENTITY_CONFLICT — same eventId, different payload. Never
      // silently swallowed; the caller must not have replayed a stale
      // eventId against a changed envelope.
      throw new Error(
        `coa-service rejected this submission as EVENT_IDENTITY_CONFLICT for event ${envelope.eventId} ` +
          `(executionId=${parsed?.executionId ?? 'unknown'}).`,
      );
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

  async simulate(envelope: SourceEventEnvelope): Promise<SimulateResult> {
    const serviceToken = await this.token();
    const res = await fetch(`${this.baseUrl}/api/v1/coa/posting-engine/events/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': envelope.tenantId,
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify(envelope),
    });
    const parsed: any = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`coa-service posting-engine/events/simulate returned ${res.status}: ${parsed?.message ?? '(no message)'}`);
    }
    return parsed as SimulateResult;
  }

  async reverseJournal(tenantId: string, input: ReverseJournalInput): Promise<{ id: string; journalNumber: string }> {
    const serviceToken = await this.token();
    const res = await fetch(`${this.baseUrl}/api/v1/coa/journals/${encodeURIComponent(input.journalEntryId)}:reverse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantId,
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify({ reason: input.reason, targetPeriod: input.targetPeriod ?? null }),
    });
    const parsed: any = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`coa-service journals:reverse returned ${res.status}: ${parsed?.message ?? '(no message)'}`);
    }
    // coa-service's ReversalService.reverse() (services/coa-service/src/
    // application/reversal-service.ts's ReverseResult) returns
    // {reversalId, reversalNumber, ...} — NOT {id, journalNumber}. Confirmed
    // against a real running coa-service (gap-close cert run): calling this
    // with the raw `parsed` object previously left every caller's
    // `reversal.id`/`reversal.journalNumber` silently undefined (e.g.
    // InterestService.reverseAccrual persisted a null
    // reversalJournalEntryId/reversalJournalNumber despite a genuinely
    // successful 201 reversal) — never surfaced because nothing threw.
    return { id: parsed.reversalId, journalNumber: parsed.reversalNumber };
  }
}

/** Deterministic in-memory test double. */
export class InMemoryPostingEngineClient implements PostingEngineClient {
  public submitted: SourceEventEnvelope[] = [];
  constructor(private readonly scriptedResult: (envelope: SourceEventEnvelope) => SubmitEventResult) {}

  async submitEvent(envelope: SourceEventEnvelope): Promise<SubmitEventResult> {
    this.submitted.push(envelope);
    return this.scriptedResult(envelope);
  }

  async simulate(envelope: SourceEventEnvelope): Promise<SimulateResult> {
    const r = this.scriptedResult(envelope);
    return { status: r.status, rulePackVersionId: r.rulePackVersionId, ruleId: r.ruleId, lines: [] };
  }

  async reverseJournal(): Promise<{ id: string; journalNumber: string }> {
    return { id: 'reversal-journal-id', journalNumber: 'REV-1' };
  }
}
