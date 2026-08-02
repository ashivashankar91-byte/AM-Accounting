/**
 * Migration principle 6 — ambiguous, invalid or unmapped input goes to the
 * exception queue. It is never guessed at, and it never silently disappears.
 */
import { describe, it, expect } from 'vitest';
import {
  makeServices, setupSource, decideAndFreeze, TENANT, LE, OPERATOR, CONTROLLER, BALANCED_TB_ROWS,
} from '../helpers/service-harness';

async function stageWithUnmappedValue(s: ReturnType<typeof makeServices>) {
  const setup = await setupSource(s, BALANCED_TB_ROWS);
  await decideAndFreeze(s, TENANT, setup.mappingSet.id);

  const later = await s.sourceService.registerSnapshot({
    tenantId: TENANT, legalEntityId: LE, sourceSystemId: setup.system.id, snapshotRef: 'SNAP-UNMAPPED-001',
    extractedAt: new Date().toISOString(), actor: OPERATOR,
  });
  await s.sourceService.importRows({
    tenantId: TENANT, legalEntityId: LE, snapshotId: later.id, filename: 'tb-unmapped.csv',
    filePath: '/certification/tb-unmapped.csv', declaredChecksum: '', actor: OPERATOR,
    rows: [{ accountCode: '7777', accountName: 'Unknown Legacy Bucket', debit: 250, credit: 0, description: 'no decision exists' }],
  });

  const run = await s.runService.create({
    tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1', actor: OPERATOR,
  });
  const staged = await s.stagingService.stage({
    tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: later.id,
    mappingSetId: setup.mappingSet.id, datasetType: 'TB', actor: OPERATOR,
  });
  return { setup, run, staged };
}

describe('exception creation', () => {
  it('queues an unmapped value instead of staging the row', async () => {
    const s = makeServices();
    const { run, staged } = await stageWithUnmappedValue(s);
    expect(staged.inserted).toBe(0);
    const { items } = await s.exceptionService.list(TENANT, run.runId);
    expect((items as any[]).some((e) => e.exceptionType === 'UNMAPPED')).toBe(true);
  });

  it('records the offending field and value so a human can decide', async () => {
    const s = makeServices();
    const { run } = await stageWithUnmappedValue(s);
    const { items } = await s.exceptionService.list(TENANT, run.runId);
    const unmapped = (items as any[]).find((e) => e.exceptionType === 'UNMAPPED' && e.sourceField === 'accountCode');
    expect(unmapped.sourceValue).toBe('7777');
    expect(unmapped.reason).toMatch(/never inferred|No mapping decision/i);
  });

  it('links the exception back to the source row it came from', async () => {
    const s = makeServices();
    const { run } = await stageWithUnmappedValue(s);
    const { items } = await s.exceptionService.list(TENANT, run.runId);
    expect((items as any[])[0].sourceRowId).toBeTruthy();
  });

  it('starts every exception PENDING and blocking', async () => {
    const s = makeServices();
    const { run } = await stageWithUnmappedValue(s);
    const { items } = await s.exceptionService.list(TENANT, run.runId);
    expect((items as any[]).every((e) => e.disposition === 'PENDING')).toBe(true);
    expect((items as any[]).every((e) => e.blocking)).toBe(true);
  });

  it('does not re-queue the same exception when staging is replayed', async () => {
    const s = makeServices();
    const { setup, run } = await stageWithUnmappedValue(s);
    const before = (await s.exceptionService.list(TENANT, run.runId)).items as any[];
    const snapshots = await s.sourceService.listSnapshots(TENANT, setup.system.id);
    const later = (snapshots as any[]).find((sn) => sn.snapshotRef === 'SNAP-UNMAPPED-001');
    await s.stagingService.stage({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: later.id,
      mappingSetId: setup.mappingSet.id, datasetType: 'TB', actor: OPERATOR,
    });
    const after = (await s.exceptionService.list(TENANT, run.runId)).items as any[];
    expect(after).toHaveLength(before.length);
  });
});

describe('exception disposition', () => {
  it('blocks G5 while an exception is pending', async () => {
    const s = makeServices();
    const { run } = await stageWithUnmappedValue(s);
    const validated = await s.stagingService.validate({ tenantId: TENANT, runId: run.runId, actor: OPERATOR });
    const g5 = validated.datasets[0]!.gates.find((g) => g.gateCode === 'G5')!;
    expect(g5.result).toBe('FAIL');
  });

  it('records who dispositioned an exception, when, and why', async () => {
    const s = makeServices();
    const { run } = await stageWithUnmappedValue(s);
    const { items } = await s.exceptionService.list(TENANT, run.runId);
    const { exception } = await s.exceptionService.disposition({
      tenantId: TENANT, runId: run.runId, exceptionId: (items as any[])[0].id,
      disposition: 'REJECTED', reason: 'Legacy bucket 7777 is out of scope for conversion', actor: CONTROLLER,
    });
    expect(exception.disposition).toBe('REJECTED');
    expect(exception.dispositionedBy).toBe(CONTROLLER);
    expect(exception.dispositionedAt).toBeTruthy();
    expect(exception.dispositionReason).toMatch(/out of scope/);
  });

  it('refuses a disposition with no stated reason', async () => {
    const s = makeServices();
    const { run } = await stageWithUnmappedValue(s);
    const { items } = await s.exceptionService.list(TENANT, run.runId);
    await expect(s.exceptionService.disposition({
      tenantId: TENANT, runId: run.runId, exceptionId: (items as any[])[0].id,
      disposition: 'APPROVED', reason: '   ', actor: CONTROLLER,
    })).rejects.toThrow(/reason/i);
  });

  it('refuses an unrecognised disposition value', async () => {
    const s = makeServices();
    const { run } = await stageWithUnmappedValue(s);
    const { items } = await s.exceptionService.list(TENANT, run.runId);
    await expect(s.exceptionService.disposition({
      tenantId: TENANT, runId: run.runId, exceptionId: (items as any[])[0].id,
      disposition: 'IGNORED', reason: 'not a real disposition', actor: CONTROLLER,
    })).rejects.toThrow();
  });

  it('lets G5 pass once every exception has been dispositioned', async () => {
    const s = makeServices();
    const { run } = await stageWithUnmappedValue(s);
    const { items } = await s.exceptionService.list(TENANT, run.runId);
    for (const exception of items as any[]) {
      await s.exceptionService.disposition({
        tenantId: TENANT, runId: run.runId, exceptionId: exception.id,
        disposition: 'REJECTED', reason: 'Out of conversion scope, confirmed with controller', actor: CONTROLLER,
      });
    }
    const validated = await s.stagingService.validate({ tenantId: TENANT, runId: run.runId, actor: OPERATOR });
    expect(validated.datasets[0]!.gates.find((g) => g.gateCode === 'G5')!.result).toBe('PASS');
  });

  it('filters the queue by disposition so a reviewer sees only outstanding work', async () => {
    const s = makeServices();
    const { run } = await stageWithUnmappedValue(s);
    const { items } = await s.exceptionService.list(TENANT, run.runId);
    await s.exceptionService.disposition({
      tenantId: TENANT, runId: run.runId, exceptionId: (items as any[])[0].id,
      disposition: 'CORRECTED', reason: 'Mapping added in version 2', actor: CONTROLLER,
    });
    const pending = await s.exceptionService.list(TENANT, run.runId, { disposition: 'PENDING' });
    expect((pending.items as any[]).some((e) => e.id === (items as any[])[0].id)).toBe(false);
  });

  it('never deletes a dispositioned exception — the evidence stays', async () => {
    const s = makeServices();
    const { run } = await stageWithUnmappedValue(s);
    const { items } = await s.exceptionService.list(TENANT, run.runId);
    await s.exceptionService.disposition({
      tenantId: TENANT, runId: run.runId, exceptionId: (items as any[])[0].id,
      disposition: 'REJECTED', reason: 'Out of scope', actor: CONTROLLER,
    });
    const all = await s.exceptionService.list(TENANT, run.runId);
    expect((all.items as any[]).some((e) => e.id === (items as any[])[0].id)).toBe(true);
  });
});
