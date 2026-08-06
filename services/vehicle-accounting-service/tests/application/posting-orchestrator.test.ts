import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { PostingOrchestrator } from '../../src/application/posting-orchestrator';
import { PostingEngineClient, SubmitEventResult, SimulateEventResult } from '../../src/infrastructure/posting-engine-client';
import { PostingRecoveryClient, IntakeResult, ReportFailureInput } from '../../src/infrastructure/posting-recovery-client';
import { buildEnvelope } from '../../src/domain/event-envelope';

function envelope() {
  return buildEnvelope({
    eventId: 'evt-1', tenantId: 'tenant-1', eventType: 'vehicle.stocked.v1',
    occurredAt: '2026-01-01T00:00:00.000Z', businessDate: '2026-01-01',
    sourceEntityType: 'VEHICLE_UNIT', sourceEntityId: 'STK-1', correlationId: 'corr-1',
    payload: { stockNumber: 'STK-1', invoiceCost: '100.00' },
  });
}

class FakePostingEngineClient implements PostingEngineClient {
  constructor(private readonly result: SubmitEventResult) {}
  async submitEvent(): Promise<SubmitEventResult> { return this.result; }
  async simulate(): Promise<SimulateEventResult> { return { status: 'BLUEPRINT_GENERATED' }; }
  async reverseJournal(): Promise<any> { return {}; }
}

class FakePostingRecoveryClient implements PostingRecoveryClient {
  public calls: ReportFailureInput[] = [];
  constructor(private readonly result: IntakeResult | null, private readonly shouldThrow = false) {}
  async reportFailure(input: ReportFailureInput): Promise<IntakeResult> {
    this.calls.push(input);
    if (this.shouldThrow) throw new Error('posting-recovery-service unreachable');
    return this.result!;
  }
}

describe('PostingOrchestrator', () => {
  it('POSTED: returns the result without reporting a dead letter', async () => {
    const engine = new FakePostingEngineClient({ executionId: 'ex-1', eventId: 'evt-1', status: 'POSTED', idempotent: false, journalEntryId: 'je-1', journalNumber: 'JN-1' });
    const recovery = new FakePostingRecoveryClient({ deadLetterId: 'dl-1', created: true });
    const orch = new PostingOrchestrator(engine, recovery);
    const result = await orch.submitAndRecord(envelope());
    expect(result.status).toBe('POSTED');
    expect(result.deadLetterReported).toBe(false);
    expect(recovery.calls).toHaveLength(0);
  });

  it('idempotent replay: does not report a dead letter even if status is not POSTED (already-recorded outcome)', async () => {
    const engine = new FakePostingEngineClient({ executionId: 'ex-1', eventId: 'evt-1', status: 'REJECTED', idempotent: true, failureReason: 'stale' });
    const recovery = new FakePostingRecoveryClient({ deadLetterId: 'dl-1', created: false });
    const orch = new PostingOrchestrator(engine, recovery);
    const result = await orch.submitAndRecord(envelope());
    expect(result.deadLetterReported).toBe(false);
    expect(recovery.calls).toHaveLength(0);
  });

  it('REJECTED with ACCOUNT_MAPPING_VALUES_PENDING-shaped message classifies as ACCOUNTING_MAPPING_UNRESOLVED / MAPPING stage', async () => {
    const engine = new FakePostingEngineClient({
      executionId: 'ex-1', eventId: 'evt-1', status: 'REJECTED', idempotent: false,
      failureReason: 'Account ACCOUNT_MAPPING_VALUES_PENDING could not be resolved for entity entity-1 at posting time.',
    });
    const recovery = new FakePostingRecoveryClient({ deadLetterId: 'dl-1', created: true });
    const orch = new PostingOrchestrator(engine, recovery);
    const result = await orch.submitAndRecord(envelope());
    expect(result.deadLetterReported).toBe(true);
    expect(result.deadLetterId).toBe('dl-1');
    expect(recovery.calls).toHaveLength(1);
    expect(recovery.calls[0].failureCategory).toBe('ACCOUNTING_MAPPING_UNRESOLVED');
    expect(recovery.calls[0].failureStage).toBe('MAPPING');
  });

  it('NO_RULE_MATCH classifies as RULE_NOT_FOUND / RULE_RESOLUTION stage', async () => {
    const engine = new FakePostingEngineClient({ executionId: 'ex-1', eventId: 'evt-1', status: 'NO_RULE_MATCH', idempotent: false, failureReason: 'no active pack' });
    const recovery = new FakePostingRecoveryClient({ deadLetterId: 'dl-2', created: true });
    const orch = new PostingOrchestrator(engine, recovery);
    const result = await orch.submitAndRecord(envelope());
    expect(recovery.calls[0].failureCategory).toBe('RULE_NOT_FOUND');
    expect(recovery.calls[0].failureStage).toBe('RULE_RESOLUTION');
    expect(result.deadLetterReported).toBe(true);
  });

  it('when posting-recovery-service itself fails, the caller still gets the original coa-service result (never crashes/masks the posting outcome)', async () => {
    const engine = new FakePostingEngineClient({ executionId: 'ex-1', eventId: 'evt-1', status: 'FAILED', idempotent: false, failureReason: 'boom' });
    const recovery = new FakePostingRecoveryClient(null, true);
    const orch = new PostingOrchestrator(engine, recovery);
    const result = await orch.submitAndRecord(envelope());
    expect(result.status).toBe('FAILED');
    expect(result.deadLetterReported).toBe(false);
    expect(result.deadLetterReportError).toContain('unreachable');
  });
});
