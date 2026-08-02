/**
 * Migration principle 9 — a financial rollback is a set of governed reversal
 * entries carrying the original lineage. Evidence is never deleted.
 */
import { describe, it, expect } from 'vitest';
import {
  makeServices, stageAndValidate, driveToReadyForCutover,
  BALANCED_TB_ROWS, TENANT, LE, OPERATOR, APPROVER, CONTROLLER,
} from '../helpers/service-harness';

async function promotedRun(s: ReturnType<typeof makeServices>) {
  const { run } = await driveToReadyForCutover(s);
  const { irreversibleEffectStatement } = await s.cutoverService.getCeremony(TENANT, run.runId);
  await s.cutoverService.approve({
    tenantId: TENANT, runId: run.runId, actor: APPROVER, acknowledgedStatement: irreversibleEffectStatement,
  });
  const { results } = await s.promotionService.promote({
    tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: CONTROLLER,
  });
  await s.cutoverService.execute({ tenantId: TENANT, runId: run.runId, actor: APPROVER });
  return { run, journalRef: results[0]!.journalRef! };
}

describe('rollback before anything was promoted', () => {
  it('cancels the run without touching the posting engine', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    const result = await s.cutoverService.rollback({
      tenantId: TENANT, runId: run.runId, actor: CONTROLLER, reason: 'Source extract was incomplete',
    });
    expect(result.plan.kind).toBe('PRE_PROMOTION_CANCEL');
    expect(result.reversals).toHaveLength(0);
    expect(s.h.posting.requests).toHaveLength(0);
  });

  it('resets staged rows on an explicit reset request while keeping the source rows', async () => {
    const s = makeServices();
    const { run, staged } = await stageAndValidate(s, BALANCED_TB_ROWS);
    const result = await s.cutoverService.rollback({
      tenantId: TENANT, runId: run.runId, actor: CONTROLLER, requestedKind: 'STAGED_DATA_RESET',
      reason: 'Mapping was wrong; re-deriving staged rows from the same extract',
    });
    expect(result.plan.kind).toBe('STAGED_DATA_RESET');

    const [dataset] = (await s.stagingService.listDatasets(TENANT, run.runId)) as any[];
    expect(dataset.state).toBe('RESET');
    expect(staged.datasetId).toBe(dataset.id);

    // The extract itself is untouched — a reset re-derives, it does not re-import.
    const files = await s.sourceService.listFiles(TENANT, (await s.sourceService.listSnapshots(TENANT, (await s.sourceService.listSystems(TENANT) as any[])[0].id) as any[])[0].id);
    expect((files as any[]).length).toBeGreaterThan(0);

    const audit = await s.runService.getAudit(TENANT, run.runId);
    expect((audit as any[]).map((a) => a.action)).toContain('ROLLBACK_COMPLETE');
  });

  it('moves the run to ROLLED_BACK with a timestamp', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    await s.cutoverService.rollback({
      tenantId: TENANT, runId: run.runId, actor: CONTROLLER, reason: 'Source extract was incomplete',
    });
    const final = await s.runService.get(TENANT, run.runId);
    expect(final.state).toBe('ROLLED_BACK');
    expect(final.rolledBackAt).toBeTruthy();
  });

  it('refuses a rollback with no stated reason', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    await expect(s.cutoverService.rollback({
      tenantId: TENANT, runId: run.runId, actor: CONTROLLER, reason: '',
    })).rejects.toThrow(/reason/i);
  });
});

describe('rollback after financial promotion', () => {
  it('plans a financial reversal rather than a data reset', async () => {
    const s = makeServices();
    const { run } = await promotedRun(s);
    const result = await s.cutoverService.rollback({
      tenantId: TENANT, runId: run.runId, actor: CONTROLLER, reason: 'Conversion balances were wrong; reversing',
    });
    expect(result.plan.kind).toBe('PROMOTED_FINANCIAL_REVERSAL');
    expect(result.reversals).toHaveLength(1);
  });

  it('posts the reversal through the governed posting engine under a reversal family', async () => {
    const s = makeServices();
    const { run } = await promotedRun(s);
    await s.cutoverService.rollback({
      tenantId: TENANT, runId: run.runId, actor: CONTROLLER, reason: 'Conversion balances were wrong; reversing',
    });
    const reversalRequest = s.h.posting.requests.find((r) => r.journalFamily === 'CONVERSION_REVERSAL');
    expect(reversalRequest).toBeTruthy();
    expect(reversalRequest!.originalJournalRef).toBeTruthy();
  });

  it('mirrors the original debits and credits exactly', async () => {
    const s = makeServices();
    const { run } = await promotedRun(s);
    const original = s.h.posting.requests.find((r) => r.journalFamily === 'CONVERSION')!;
    await s.cutoverService.rollback({
      tenantId: TENANT, runId: run.runId, actor: CONTROLLER, reason: 'Conversion balances were wrong; reversing',
    });
    const reversal = s.h.posting.requests.find((r) => r.journalFamily === 'CONVERSION_REVERSAL')!;
    const originalDebit = original.lines.reduce((sum, l) => sum + l.debit, 0);
    const reversalCredit = reversal.lines.reduce((sum, l) => sum + l.credit, 0);
    expect(Math.round(reversalCredit * 100)).toBe(Math.round(originalDebit * 100));
  });

  it('records a new lineage row pointing back at the reversed journal', async () => {
    const s = makeServices();
    const { run, journalRef } = await promotedRun(s);
    await s.cutoverService.rollback({
      tenantId: TENANT, runId: run.runId, actor: CONTROLLER, reason: 'Conversion balances were wrong; reversing',
    });
    const lineage = await s.promotionService.listLineage(TENANT, run.runId);
    const reversalRow = (lineage as any[]).find((l) => l.targetRecordType === 'JOURNAL_ENTRY_REVERSAL');
    expect(reversalRow).toBeTruthy();
    expect(reversalRow.evidence.reversalOf).toBe(journalRef);
    expect(reversalRow.evidence.evidencePreserved).toBe(true);
  });

  it('leaves the original lineage rows untouched', async () => {
    const s = makeServices();
    const { run, journalRef } = await promotedRun(s);
    const before = (await s.promotionService.listLineage(TENANT, run.runId, { journalRef })) as any[];
    await s.cutoverService.rollback({
      tenantId: TENANT, runId: run.runId, actor: CONTROLLER, reason: 'Conversion balances were wrong; reversing',
    });
    const after = (await s.promotionService.listLineage(TENANT, run.runId, { journalRef })) as any[];
    expect(after.length).toBeGreaterThanOrEqual(before.length);
    expect(after.some((l) => l.journalRef === journalRef)).toBe(true);
  });

  it('never deletes the promoted staged rows', async () => {
    const s = makeServices();
    const { run } = await promotedRun(s);
    await s.cutoverService.rollback({
      tenantId: TENANT, runId: run.runId, actor: CONTROLLER, reason: 'Conversion balances were wrong; reversing',
    });
    const [dataset] = (await s.stagingService.listDatasets(TENANT, run.runId)) as any[];
    const { items } = await s.stagingService.listRows(TENANT, dataset.id, 100, 0, true);
    expect((items as any[])).toHaveLength(4);
    expect((items as any[]).every((r) => r.state === 'PROMOTED')).toBe(true);
  });

  it('publishes rollback initiated and complete events', async () => {
    const s = makeServices();
    const { run } = await promotedRun(s);
    await s.cutoverService.rollback({
      tenantId: TENANT, runId: run.runId, actor: CONTROLLER, reason: 'Conversion balances were wrong; reversing',
    });
    const types = s.h.events.types();
    expect(types).toContain('migration.rollback.initiated');
    expect(types).toContain('migration.rollback.complete');
  });

  it('keeps the rollback reason and the plan in the audit evidence', async () => {
    const s = makeServices();
    const { run } = await promotedRun(s);
    await s.cutoverService.rollback({
      tenantId: TENANT, runId: run.runId, actor: CONTROLLER, reason: 'Conversion balances were wrong; reversing',
    });
    const audit = await s.runService.getAudit(TENANT, run.runId);
    const complete = (audit as any[]).find((a) => a.action === 'ROLLBACK_COMPLETE');
    expect(complete.reason).toMatch(/reversing/);
    expect(complete.evidence.evidencePreserved).toBe(true);
    expect(complete.evidence.reversalResults).toHaveLength(1);
  });
});
