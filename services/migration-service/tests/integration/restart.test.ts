/**
 * Migration principle 4 — every run is repeatable, restartable and idempotent.
 * A restart resumes from the last completed phase; it never re-loads work that
 * is already there and never abandons evidence.
 */
import { describe, it, expect } from 'vitest';
import {
  makeServices, stageAndValidate, driveToReadyForCutover,
  BALANCED_TB_ROWS, TENANT, LE, OPERATOR, APPROVER, CONTROLLER,
} from '../helpers/service-harness';

describe('restart', () => {
  it('returns the same run when the same run id is re-issued', async () => {
    const s = makeServices();
    const first = await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1',
      actor: OPERATOR, runId: 'MIG-RESTART-001',
    });
    const second = await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1',
      actor: OPERATOR, runId: 'MIG-RESTART-001',
    });
    expect(second.id).toBe(first.id);
    expect(((await s.runService.list(TENANT, {})) as any[])).toHaveLength(1);
  });

  it('does not publish a second run created event on re-issue', async () => {
    const s = makeServices();
    await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'v', actor: OPERATOR, runId: 'MIG-RESTART-002',
    });
    await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'v', actor: OPERATOR, runId: 'MIG-RESTART-002',
    });
    expect(s.h.events.types().filter((t) => t === 'migration.run.created')).toHaveLength(1);
  });

  it('reports which phases are already complete so a restart resumes rather than repeats', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    const plan = await s.cutoverService.restartPlan(TENANT, run.runId);
    expect(plan.resumeFromState).toBe('VALIDATED');
    expect(plan.completedPhases).toEqual(['DISCOVERED', 'MAPPED', 'STAGED', 'VALIDATED']);
    expect(plan.restartable).toBe(true);
  });

  it('reports a rolled-back run as not restartable', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    await s.cutoverService.rollback({
      tenantId: TENANT, runId: run.runId, actor: CONTROLLER, reason: 'Abandoning this attempt',
    });
    const plan = await s.cutoverService.restartPlan(TENANT, run.runId);
    expect(plan.restartable).toBe(false);
    expect(plan.completedPhases).toEqual([]);
  });

  it('resumes staging from where it stopped without reloading what is already there', async () => {
    const s = makeServices();
    const ctx = await stageAndValidate(s, BALANCED_TB_ROWS);
    const resumed = await s.stagingService.stage({
      tenantId: TENANT, legalEntityId: LE, runId: ctx.run.runId, snapshotId: ctx.snapshot.id,
      mappingSetId: ctx.mappingSet.id, datasetType: 'TB', actor: OPERATOR,
    });
    expect(resumed.inserted).toBe(0);
    expect(resumed.skippedDuplicates).toBe(4);
    expect(resumed.controlTotals.rowCount).toBe(4);
  });
});

describe('restart after a completed cutover', () => {
  it('refuses to treat a promoted cutover as restartable', async () => {
    const s = makeServices();
    const { run } = await driveToReadyForCutover(s);
    const { irreversibleEffectStatement } = await s.cutoverService.getCeremony(TENANT, run.runId);
    await s.cutoverService.approve({
      tenantId: TENANT, runId: run.runId, actor: APPROVER, acknowledgedStatement: irreversibleEffectStatement,
    });
    await s.promotionService.promote({ tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: CONTROLLER });
    await s.cutoverService.execute({ tenantId: TENANT, runId: run.runId, actor: APPROVER });

    const plan = await s.cutoverService.restartPlan(TENANT, run.runId);
    expect(plan.resumeFromState).toBe('CUTOVER_COMPLETE');
    expect(plan.restartable).toBe(false);
  });
});

describe('restart preserves prior evidence', () => {
  it('keeps the original audit trail across a resumed staging pass', async () => {
    const s = makeServices();
    const ctx = await stageAndValidate(s, BALANCED_TB_ROWS);
    const before = ((await s.runService.getAudit(TENANT, ctx.run.runId)) as any[]).length;
    await s.stagingService.stage({
      tenantId: TENANT, legalEntityId: LE, runId: ctx.run.runId, snapshotId: ctx.snapshot.id,
      mappingSetId: ctx.mappingSet.id, datasetType: 'TB', actor: OPERATOR,
    });
    const after = ((await s.runService.getAudit(TENANT, ctx.run.runId)) as any[]).length;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('keeps the control totals stable across a resumed staging pass', async () => {
    const s = makeServices();
    const ctx = await stageAndValidate(s, BALANCED_TB_ROWS);
    const before = (await s.stagingService.listControlTotals(TENANT, ctx.run.runId)) as any[];
    await s.stagingService.stage({
      tenantId: TENANT, legalEntityId: LE, runId: ctx.run.runId, snapshotId: ctx.snapshot.id,
      mappingSetId: ctx.mappingSet.id, datasetType: 'TB', actor: OPERATOR,
    });
    const after = (await s.stagingService.listControlTotals(TENANT, ctx.run.runId)) as any[];
    const latest = after[after.length - 1];
    expect(Number(latest.totalDebit)).toBe(Number(before[0].totalDebit));
    expect(Number(latest.rowCount)).toBe(Number(before[0].rowCount));
  });
});
