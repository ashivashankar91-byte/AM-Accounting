// Deterministic in-memory test doubles for this service's 4 external HTTP
// boundaries (coa-service posting-engine, posting-recovery-service,
// tax-service, coa-service journal reversal). Live-db tests use these (real
// Postgres + fake external services) to prove THIS service's own
// persistence/business logic — RLS, idempotency races, unwind/recontract/
// CIT/payoff/wholesale flows — exactly the same pattern coa-service's own
// tests/live-db suite uses (a real PostingEngineService constructed
// in-process against a real DB, never a separately-running HTTP server for
// a sibling service). Spinning up a live coa-service/posting-recovery-
// service/tax-service process is out of this service's test boundary.

import { randomUUID } from 'crypto';
import type { SourceEventEnvelope } from '../../src/domain/event-envelope';
import type { IPostingEngineClient, SubmitEventResult, SimulateEventResult } from '../../src/infrastructure/posting-engine-client';
import type { IPostingRecoveryClient, PostingFailureDetail, DeadLetterIntakeResult } from '../../src/infrastructure/posting-recovery-client';
import type { ITaxResultClient, TaxResult } from '../../src/infrastructure/tax-result-client';
import type { IJournalReversalClient, ReverseJournalResult } from '../../src/infrastructure/journal-reversal-client';

export class FakePostingEngineClient implements IPostingEngineClient {
  public readonly submittedEventIds: string[] = [];
  public readonly seenExecutions = new Map<string, SubmitEventResult>();
  /** When set, every eventType in this set returns REJECTED instead of POSTED. */
  public rejectEventTypes = new Set<string>();

  async submitEvent(envelope: SourceEventEnvelope): Promise<SubmitEventResult> {
    const key = `${envelope.tenantId}:${envelope.eventId}`;
    const existing = this.seenExecutions.get(key);
    if (existing) return { ...existing, idempotent: true };

    this.submittedEventIds.push(envelope.eventId);
    const rejected = this.rejectEventTypes.has(envelope.eventType);
    const result: SubmitEventResult = rejected
      ? { executionId: randomUUID(), eventId: envelope.eventId, status: 'REJECTED', idempotent: false, failureReason: `Account could not be resolved for entity (fixture rejection for ${envelope.eventType}).` }
      : {
          executionId: randomUUID(), eventId: envelope.eventId, status: 'POSTED', idempotent: false,
          rulePackVersionId: 'fake-version', ruleId: 'fake-rule',
          journalEntryId: randomUUID(), journalNumber: `FAKE-${this.submittedEventIds.length}`,
        };
    this.seenExecutions.set(key, result);
    return result;
  }

  async simulate(envelope: SourceEventEnvelope): Promise<SimulateEventResult> {
    return {
      status: 'BLUEPRINT_GENERATED', rulePackVersionId: 'fake-version', ruleId: 'fake-rule',
      blueprintHash: `blueprint-${envelope.eventId}`,
      lines: [{ accountNumber: 'ACCOUNT_MAPPING_VALUES_PENDING', storeId: 'STORE-1', dr: 1, cr: 0 }],
    };
  }
}

export class FakePostingRecoveryClient implements IPostingRecoveryClient {
  public readonly filed: Array<{ envelope: SourceEventEnvelope; failure: PostingFailureDetail }> = [];

  async fileDeadLetter(envelope: SourceEventEnvelope, failure: PostingFailureDetail): Promise<DeadLetterIntakeResult> {
    this.filed.push({ envelope, failure });
    return { deadLetterId: randomUUID(), created: true };
  }
}

export class FakeTaxResultClient implements ITaxResultClient {
  public readonly results = new Map<string, TaxResult>();

  seed(taxResultId: string, totalTax: string, status: TaxResult['status'] = 'CALCULATED') {
    this.results.set(taxResultId, { id: taxResultId, tenantId: '*', status, totalTax, totalTaxableBase: totalTax, currency: 'USD' });
  }

  async fetchUsableResult(tenantId: string, taxResultId: string): Promise<TaxResult> {
    const r = this.results.get(taxResultId);
    if (!r) throw new Error(`FakeTaxResultClient: no fixture seeded for ${taxResultId}`);
    return { ...r, tenantId };
  }
}

export class FakeJournalReversalClient implements IJournalReversalClient {
  public readonly reversed: string[] = [];

  async reverse(tenantId: string, journalEntryId: string, reason: string): Promise<ReverseJournalResult> {
    this.reversed.push(journalEntryId);
    return {
      reversalId: randomUUID(), reversalNumber: `REV-${this.reversed.length}`, reversalPeriod: '2026-08',
      originalId: journalEntryId, originalNumber: `ORIG-${journalEntryId}`, reason, reinstatement: false, idempotent: false,
    };
  }
}
