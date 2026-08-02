// Shared live-db test doubles for the two OUT-OF-PROCESS dependencies
// (coa-service, posting-recovery-service) these tests deliberately do not
// spin up — mirrors services/schedule-service/scripts/seed-e2e-fixtures.ts's
// NoopGlPostingClient pattern (a real, in-process double standing in for a
// genuinely external service boundary, not a mock of THIS service's own
// code). Every table write/transaction/idempotency/P2002-race path in the
// application services under test IS real (real Postgres, real Prisma,
// real $transaction) — only the HTTP call to coa-service is scripted.
import { randomUUID } from 'crypto';
import { SourceEventEnvelope } from '../../src/domain/event-envelope';
import { PostingEngineClient, SubmitEventResult, SimulateEventResult, ReverseJournalResult } from '../../src/infrastructure/posting-engine-client';
import { PostingRecoveryClient, ReportFailureInput, IntakeResult } from '../../src/infrastructure/posting-recovery-client';
import { ScheduleServiceClient, OpenItemsBalance, RelieveResult } from '../../src/infrastructure/schedule-client';

export type ScriptedOutcome = 'POSTED' | 'REJECTED' | 'FAILED' | 'NO_RULE_MATCH';

/** Scriptable stand-in for coa-service's posting engine — POSTED by default
 * (idempotent per eventId, exactly like the real PostingEngineService). */
export class ScriptedPostingEngineClient implements PostingEngineClient {
  private readonly seen = new Map<string, SubmitEventResult>();
  public readonly submittedEnvelopes: SourceEventEnvelope[] = [];
  public nextOutcome: ScriptedOutcome = 'POSTED';
  public nextFailureReason = 'Account ACCOUNT_MAPPING_VALUES_PENDING could not be resolved for entity at posting time.';

  async submitEvent(envelope: SourceEventEnvelope): Promise<SubmitEventResult> {
    this.submittedEnvelopes.push(envelope);
    const key = `${envelope.tenantId}:${envelope.eventId}`;
    const existing = this.seen.get(key);
    if (existing) return { ...existing, idempotent: true };

    const result: SubmitEventResult =
      this.nextOutcome === 'POSTED'
        ? { executionId: randomUUID(), eventId: envelope.eventId, status: 'POSTED', idempotent: false, journalEntryId: randomUUID(), journalNumber: `JN-${randomUUID().slice(0, 8)}`, rulePackVersionId: randomUUID(), ruleId: 'r1' }
        : { executionId: randomUUID(), eventId: envelope.eventId, status: this.nextOutcome, idempotent: false, failureReason: this.nextFailureReason };

    this.seen.set(key, result);
    return result;
  }

  async simulate(): Promise<SimulateEventResult> {
    return { status: 'BLUEPRINT_GENERATED' };
  }

  async reverseJournal(_tenantId: string, journalEntryId: string, _reason: string): Promise<ReverseJournalResult> {
    return { id: randomUUID(), journalNumber: `REV-${randomUUID().slice(0, 8)}`, reversalOf: journalEntryId };
  }
}

export class RecordingPostingRecoveryClient implements PostingRecoveryClient {
  public readonly calls: ReportFailureInput[] = [];
  async reportFailure(input: ReportFailureInput): Promise<IntakeResult> {
    this.calls.push(input);
    return { deadLetterId: randomUUID(), created: true };
  }
}

/** Never hits the network — stands in for schedule-service in every live-db
 * suite that scripts coa-service too (S074/S075/S076/S077's existing
 * suites), where the real coa-service -> schedule-service bridge never
 * fires anyway (coa-service itself is a scripted double there). Degrades
 * exactly like the real client's documented "not wired yet" outcome:
 * getOpenItemsBalance -> null, relieveOpenItem -> NOT_FOUND. The genuinely
 * real schedule-service linkage is proven separately, over real HTTP to
 * both real coa-service and real schedule-service, in
 * tests/live-db/schedule-linkage-live.test.ts. */
export class StubScheduleServiceClient extends ScheduleServiceClient {
  public readonly relieveCalls: Array<{ scheduleNumber: string; controlNumber: string; amount: string }> = [];
  async getOpenItems(): Promise<null> {
    return null;
  }
  async getOpenItemsBalance(): Promise<OpenItemsBalance | null> {
    return null;
  }
  async relieveOpenItem(_tenantId: string, scheduleNumber: string, controlNumber: string, amount: string): Promise<RelieveResult> {
    this.relieveCalls.push({ scheduleNumber, controlNumber, amount });
    return { outcome: 'NOT_FOUND' };
  }
}
