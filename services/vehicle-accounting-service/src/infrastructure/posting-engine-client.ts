// CE-12 canonical posting path — the ONLY door this service ever posts a
// financial event through. Mirrors posting-recovery-service's
// HttpCH01PostingExecutionPort (src/domain/ch01-adapter.ts) exactly: real
// fetch, real error handling, createServiceToken for service-to-service
// auth, no mocking. Never calls gl-service directly and never writes a
// journal_entry/journal_line row of its own (CE-12 GLOBAL RULES).
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

export interface SimulateEventResult {
  status: 'BLUEPRINT_GENERATED' | 'NO_RULE_MATCH' | 'REJECTED';
  rulePackVersionId?: string | null;
  ruleId?: string | null;
  blueprintHash?: string | null;
  lines?: unknown[];
  failureReason?: string | null;
}

export class PostingEngineUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostingEngineUnavailableError';
  }
}

export interface ReverseJournalResult {
  id: string;
  journalNumber?: string;
  reversalOf?: string;
  [key: string]: unknown;
}

export interface PostingEngineClient {
  submitEvent(envelope: SourceEventEnvelope): Promise<SubmitEventResult>;
  simulate(envelope: SourceEventEnvelope): Promise<SimulateEventResult>;
  reverseJournal(tenantId: string, journalEntryId: string, reason: string): Promise<ReverseJournalResult>;
}

export class HttpPostingEngineClient implements PostingEngineClient {
  private readonly baseUrl: string;

  constructor(
    private readonly jwtSecret: string,
    baseUrl = process.env['COA_SERVICE_URL'] ?? 'http://coa-service:3016',
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async serviceToken(): Promise<string> {
    const { createServiceToken } = await import('@amacc/shared-kernel');
    return createServiceToken('vehicle-accounting-service', this.jwtSecret);
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
        body: JSON.stringify(envelope),
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
    if (!res.ok && res.status !== 409) {
      throw new PostingEngineUnavailableError(`coa-service posting-engine returned HTTP ${res.status}: ${parsed?.message ?? '(no body)'}`);
    }
    if (res.status === 409) {
      // EVENT_IDENTITY_CONFLICT — same eventId, different content. Never
      // silently swallowed; the caller must treat this as a hard failure
      // (never retry unmodified).
      throw new PostingEngineUnavailableError(
        `Event ${envelope.eventId} was already submitted with different content (EVENT_IDENTITY_CONFLICT, executionId=${parsed?.executionId ?? 'unknown'}).`,
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
        body: JSON.stringify(envelope),
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
      throw new PostingEngineUnavailableError(`coa-service posting-engine simulate returned HTTP ${res.status}: ${parsed?.message ?? '(no body)'}`);
    }
    return parsed as SimulateEventResult;
  }

  /** S218 reversal — POST /api/v1/coa/journals/:id:reverse, reason required (1-500 chars). Used by S075's demo-value-adjustment reversal path. */
  async reverseJournal(tenantId: string, journalEntryId: string, reason: string): Promise<ReverseJournalResult> {
    const token = await this.serviceToken();
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/v1/coa/journals/${encodeURIComponent(journalEntryId)}:reverse`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason }),
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
      throw new PostingEngineUnavailableError(`coa-service journal reversal returned HTTP ${res.status}: ${parsed?.message ?? '(no body)'}`);
    }
    return parsed as ReverseJournalResult;
  }
}
