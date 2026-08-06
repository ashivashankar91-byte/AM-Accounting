/**
 * Concurrent operators must not be able to produce a double-load, a double
 * post, a second cutover, or a torn state transition.
 */
import { describe, it, expect } from 'vitest';
import {
  makeServices, setupSource, decideAndFreeze, stageAndValidate, driveToReadyForCutover,
  BALANCED_TB_ROWS, OPEN_ITEM_ROWS, TENANT, LE, OPERATOR, APPROVER, CONTROLLER,
} from '../helpers/service-harness';

describe('concurrent staging', () => {
  it('inserts each source row exactly once when two operators stage at the same time', async () => {
    const s = makeServices();
    const setup = await setupSource(s, BALANCED_TB_ROWS);
    await decideAndFreeze(s, TENANT, setup.mappingSet.id);
    const run = await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1', actor: OPERATOR,
    });
    const stageOnce = () => s.stagingService.stage({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: setup.snapshot.id,
      mappingSetId: setup.mappingSet.id, datasetType: 'TB', actor: OPERATOR,
    });

    const [a, b] = await Promise.all([stageOnce(), stageOnce()]);
    const totalInserted = a.inserted + b.inserted;
    expect(totalInserted).toBe(BALANCED_TB_ROWS.length);

    const datasets = (await s.stagingService.listDatasets(TENANT, run.runId)) as any[];
    expect(datasets).toHaveLength(1);
    const { total } = await s.stagingService.listRows(TENANT, datasets[0].id, 100, 0, true);
    expect(total).toBe(BALANCED_TB_ROWS.length);
  });

  it('creates one dataset even when five stagings race', async () => {
    const s = makeServices();
    const setup = await setupSource(s, BALANCED_TB_ROWS);
    await decideAndFreeze(s, TENANT, setup.mappingSet.id);
    const run = await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1', actor: OPERATOR,
    });
    await Promise.all(Array.from({ length: 5 }, () => s.stagingService.stage({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: setup.snapshot.id,
      mappingSetId: setup.mappingSet.id, datasetType: 'TB', actor: OPERATOR,
    })));
    expect(((await s.stagingService.listDatasets(TENANT, run.runId)) as any[])).toHaveLength(1);
  });

  it('does not multiply exceptions when a failing stage is retried concurrently', async () => {
    const s = makeServices();
    const setup = await setupSource(s, BALANCED_TB_ROWS, { mappingFields: ['accountCode'] });
    await decideAndFreeze(s, TENANT, setup.mappingSet.id);
    const run = await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1', actor: OPERATOR,
    });
    const stageOnce = () => s.stagingService.stage({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: setup.snapshot.id,
      mappingSetId: setup.mappingSet.id, datasetType: 'TB', actor: OPERATOR,
    });
    await Promise.all([stageOnce(), stageOnce(), stageOnce()]);

    const { items } = await s.exceptionService.list(TENANT, run.runId);
    const keys = (items as any[]).map((e) => `${e.exceptionType}|${e.sourceRowId}|${e.sourceField}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('concurrent extract import', () => {
  it('imports a duplicated file only once when two imports race', async () => {
    const s = makeServices();
    const system = await s.sourceService.registerSystem({
      tenantId: TENANT, systemCode: 'LEGACY-CONC', systemName: 'Legacy DMS', sourceType: 'AUTOMATE', actor: OPERATOR,
    });
    const register = () => s.sourceService.registerSnapshot({
      tenantId: TENANT, legalEntityId: LE, sourceSystemId: system.id, snapshotRef: 'SNAP-CONC-001',
      extractedAt: new Date().toISOString(), actor: OPERATOR,
    });
    const registered = await Promise.allSettled([register(), register()]);
    expect(registered.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);

    const snapshot = await s.sourceService.registerSnapshot({
      tenantId: TENANT, legalEntityId: LE, sourceSystemId: system.id, snapshotRef: 'SNAP-CONC-001',
      extractedAt: new Date().toISOString(), actor: OPERATOR,
    });
    const importOnce = () => s.sourceService.importRows({
      tenantId: TENANT, legalEntityId: LE, snapshotId: snapshot.id, filename: 'tb.csv',
      filePath: '/certification/tb.csv', declaredChecksum: '', rows: BALANCED_TB_ROWS, actor: OPERATOR,
    });
    const imports = await Promise.allSettled([importOnce(), importOnce()]);
    expect(imports.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);

    // Whichever import won, the extract holds each legacy row exactly once.
    const snapshots = (await s.sourceService.listSnapshots(TENANT, system.id)) as any[];
    expect(snapshots).toHaveLength(1);
    const files = (await s.sourceService.listFiles(TENANT, snapshots[0].id)) as any[];
    expect(files).toHaveLength(1);
    const { total } = await s.sourceService.listRows(TENANT, files[0].id, 100, 0, true);
    expect(total).toBe(BALANCED_TB_ROWS.length);
  });
});

describe('concurrent promotion', () => {
  it('posts one conversion journal when two promotions race', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    const promoteOnce = () => s.promotionService.promote({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: CONTROLLER,
    });
    await Promise.all([promoteOnce(), promoteOnce()]);
    expect(s.h.posting.seenIdentities()).toHaveLength(1);
  });

  it('establishes each open item exactly once when two promotions race', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, OPEN_ITEM_ROWS, 'OPEN_ITEMS');
    const promoteOnce = () => s.promotionService.promote({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: CONTROLLER,
    });
    await Promise.all([promoteOnce(), promoteOnce()]);

    const lineage = (await s.promotionService.listLineage(TENANT, run.runId)) as any[];
    const refs = lineage.map((l) => l.openItemRef).filter(Boolean);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('records one lineage row per staged record no matter how many promotions race', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    await Promise.all(Array.from({ length: 4 }, () => s.promotionService.promote({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: CONTROLLER,
    })));
    const lineage = (await s.promotionService.listLineage(TENANT, run.runId)) as any[];
    expect(lineage).toHaveLength(BALANCED_TB_ROWS.length);
  });
});

describe('concurrent cutover', () => {
  it('executes once when two approvers press the button simultaneously', async () => {
    const s = makeServices();
    const { run } = await driveToReadyForCutover(s);
    const { irreversibleEffectStatement } = await s.cutoverService.getCeremony(TENANT, run.runId);
    await s.cutoverService.approve({
      tenantId: TENANT, runId: run.runId, actor: APPROVER, acknowledgedStatement: irreversibleEffectStatement,
    });

    const results = await Promise.all([
      s.cutoverService.execute({ tenantId: TENANT, runId: run.runId, actor: APPROVER }),
      s.cutoverService.execute({ tenantId: TENANT, runId: run.runId, actor: APPROVER }),
    ]);
    // Exactly one caller runs the ceremony; the other is told it is a replay
    // rather than being allowed to execute the irreversible path again.
    expect(results.filter((r) => r.idempotentReplay === false)).toHaveLength(1);
    expect(results.filter((r) => r.idempotentReplay === true)).toHaveLength(1);

    const audit = await s.runService.getAudit(TENANT, run.runId);
    expect((audit as any[]).filter((a) => a.action === 'CUTOVER_EXECUTED')).toHaveLength(1);
    expect(s.h.events.types().filter((t) => t === 'migration.cutover.complete')).toHaveLength(1);
  });

  it('leaves the run in exactly one final state', async () => {
    const s = makeServices();
    const { run } = await driveToReadyForCutover(s);
    const { irreversibleEffectStatement } = await s.cutoverService.getCeremony(TENANT, run.runId);
    await s.cutoverService.approve({
      tenantId: TENANT, runId: run.runId, actor: APPROVER, acknowledgedStatement: irreversibleEffectStatement,
    });
    await Promise.all(Array.from({ length: 3 }, () => s.cutoverService.execute({
      tenantId: TENANT, runId: run.runId, actor: APPROVER,
    })));
    expect((await s.runService.get(TENANT, run.runId)).state).toBe('CUTOVER_COMPLETE');
  });
});

describe('concurrent mapping decisions', () => {
  it('keeps the last decision for a field rather than creating two entries', async () => {
    const s = makeServices();
    const setup = await setupSource(s, BALANCED_TB_ROWS);
    const decide = (targetValue: string, classification: string, note: string) => s.mappingService.upsertEntries({
      tenantId: TENANT, mappingSetId: setup.mappingSet.id, actor: OPERATOR,
      entries: [{
        sourceField: 'accountCode', sourceValue: '1200', targetField: 'accountCode',
        targetValue, classification, provenanceNote: note,
      }],
    });
    await Promise.all([
      decide('1200', 'ALIGN', 'Chart aligns one-to-one'),
      decide('1201', 'MAP', 'Remapped to the modern AR control'),
    ]);
    const { items } = await s.mappingService.listEntries(TENANT, setup.mappingSet.id);
    const forField = (items as any[]).filter((e) => e.sourceField === 'accountCode' && e.sourceValue === '1200');
    expect(forField).toHaveLength(1);
  });

  it('freezes a mapping set only once under concurrent freeze attempts', async () => {
    const s = makeServices();
    const setup = await setupSource(s, BALANCED_TB_ROWS);
    await decideAndFreeze(s, TENANT, setup.mappingSet.id, { skipFreeze: true });
    const results = await Promise.allSettled([
      s.mappingService.freeze({ tenantId: TENANT, mappingSetId: setup.mappingSet.id, actor: CONTROLLER }),
      s.mappingService.freeze({ tenantId: TENANT, mappingSetId: setup.mappingSet.id, actor: CONTROLLER }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    const set = await s.mappingService.getSet(TENANT, setup.mappingSet.id);
    expect(set.status).toBe('FROZEN');
    expect(set.version).toBe(1);
  });
});

describe('concurrent exception disposition', () => {
  it('applies one disposition per exception', async () => {
    const s = makeServices();
    const setup = await setupSource(s, BALANCED_TB_ROWS, { mappingFields: ['accountCode'] });
    await decideAndFreeze(s, TENANT, setup.mappingSet.id);
    const run = await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1', actor: OPERATOR,
    });
    await s.stagingService.stage({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: setup.snapshot.id,
      mappingSetId: setup.mappingSet.id, datasetType: 'TB', actor: OPERATOR,
    });
    const { items } = await s.exceptionService.list(TENANT, run.runId);
    const target = (items as any[])[0];

    await Promise.allSettled([
      s.exceptionService.disposition({
        tenantId: TENANT, runId: run.runId, exceptionId: target.id, disposition: 'APPROVED',
        reason: 'Confirmed with the controller', actor: CONTROLLER,
      }),
      s.exceptionService.disposition({
        tenantId: TENANT, runId: run.runId, exceptionId: target.id, disposition: 'REJECTED',
        reason: 'Rejected on second look', actor: CONTROLLER,
      }),
    ]);

    const after = await s.exceptionService.list(TENANT, run.runId);
    const settled = (after.items as any[]).find((e) => e.id === target.id);
    expect(['APPROVED', 'REJECTED']).toContain(settled.disposition);
    expect(settled.dispositionedBy).toBe(CONTROLLER);
  });
});
