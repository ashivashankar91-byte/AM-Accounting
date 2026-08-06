/**
 * S130 — staging writes only to controlled staging, never to production GL.
 * Control totals must survive the extract → staging transition.
 */
import { describe, it, expect } from 'vitest';
import {
  makeServices, setupSource, decideAndFreeze, stageAndValidate, mappableFields,
  BALANCED_TB_ROWS, OPEN_ITEM_ROWS, TENANT, LE, OPERATOR,
} from '../helpers/service-harness';

describe('staging a converted trial balance', () => {
  it('stages every accepted row into a controlled dataset', async () => {
    const s = makeServices();
    const { staged } = await stageAndValidate(s, BALANCED_TB_ROWS);
    expect(staged.inserted).toBe(4);
    expect(staged.exceptions).toBe(0);
    expect(staged.datasetType).toBe('TB');
  });

  it('captures debit and credit control totals that reconcile to the extract', async () => {
    const s = makeServices();
    const { staged } = await stageAndValidate(s, BALANCED_TB_ROWS);
    expect(staged.controlTotals.totalDebit).toBeCloseTo(173250.75, 2);
    expect(staged.controlTotals.totalCredit).toBeCloseTo(173250.75, 2);
    expect(staged.phaseReconciliation.reconciled).toBe(true);
    expect(staged.phaseReconciliation.discrepancies).toEqual([]);
  });

  it('records a control-total snapshot for every phase it passes through', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    const totals = await s.stagingService.listControlTotals(TENANT, run.runId);
    const phases = new Set((totals as any[]).map((t) => t.phase));
    expect(phases.has('EXTRACT')).toBe(true);
    expect(phases.has('STAGING')).toBe(true);
    expect(phases.has('TRANSFORM')).toBe(true);
  });

  it('advances the run to VALIDATED only after every gate passes', async () => {
    const s = makeServices();
    const { run, validated } = await stageAndValidate(s, BALANCED_TB_ROWS);
    expect(validated.allPassed).toBe(true);
    expect((await s.runService.get(TENANT, run.runId)).state).toBe('VALIDATED');
  });

  it('marks the dataset VALIDATED so downstream promotion has a precondition to check', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    const [dataset] = (await s.stagingService.listDatasets(TENANT, run.runId)) as any[];
    expect(dataset.state).toBe('VALIDATED');
  });

  it('leaves the run in STAGED when a gate fails on an account that appeared after the freeze', async () => {
    const s = makeServices();
    const setup = await setupSource(s, BALANCED_TB_ROWS);
    await decideAndFreeze(s, TENANT, setup.mappingSet.id);

    // A new legacy account appears in a later extract. The frozen mapping set
    // has no decision for it, so the row must not be staged.
    const later = await s.sourceService.registerSnapshot({
      tenantId: TENANT, legalEntityId: LE, sourceSystemId: setup.system.id,
      snapshotRef: 'SNAP-LATER-001', extractedAt: new Date().toISOString(), actor: OPERATOR,
    });
    await s.sourceService.importRows({
      tenantId: TENANT, legalEntityId: LE, snapshotId: later.id, filename: 'tb-later.csv',
      filePath: '/certification/tb-later.csv', declaredChecksum: '', actor: OPERATOR,
      rows: [...BALANCED_TB_ROWS, { accountCode: '4500', accountName: 'New Legacy Account', debit: 0, credit: 0, description: 'appeared after freeze' }],
    });

    const run = await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1', actor: OPERATOR,
    });
    const staged = await s.stagingService.stage({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: later.id,
      mappingSetId: setup.mappingSet.id, datasetType: 'TB', actor: OPERATOR,
    });
    expect(staged.exceptions).toBeGreaterThan(0);

    const validated = await s.stagingService.validate({ tenantId: TENANT, runId: run.runId, actor: OPERATOR });
    expect(validated.allPassed).toBe(false);
    expect((await s.runService.get(TENANT, run.runId)).state).toBe('STAGED');
  });
});

describe('preview before staging', () => {
  it('shows what the transformation would produce without writing anything', async () => {
    const s = makeServices();
    const setup = await setupSource(s, BALANCED_TB_ROWS);
    await decideAndFreeze(s, TENANT, setup.mappingSet.id);
    const run = await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1', actor: OPERATOR,
    });
    const preview = await s.stagingService.preview({
      tenantId: TENANT, runId: run.runId, snapshotId: setup.snapshot.id, mappingSetId: setup.mappingSet.id, limit: 10,
    });
    expect(preview.rows.length).toBe(4);
    expect((await s.stagingService.listDatasets(TENANT, run.runId)) as any[]).toHaveLength(0);
  });

  it('previews against a draft set so the workbench can show consequences before freeze', async () => {
    const s = makeServices();
    const setup = await setupSource(s, BALANCED_TB_ROWS);
    const run = await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1', actor: OPERATOR,
    });
    const preview = await s.stagingService.preview({
      tenantId: TENANT, runId: run.runId, snapshotId: setup.snapshot.id, mappingSetId: setup.mappingSet.id, limit: 10,
    });
    expect(preview.exceptions.length).toBeGreaterThan(0);
    expect(preview.rows).toHaveLength(0);
  });
});

describe('staging open items', () => {
  it('rolls open item amounts into a schedule balance', async () => {
    const s = makeServices();
    const setup = await setupSource(s, OPEN_ITEM_ROWS, { mappingFields: mappableFields(OPEN_ITEM_ROWS) });
    await decideAndFreeze(s, TENANT, setup.mappingSet.id);
    const run = await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1', actor: OPERATOR,
    });
    const staged = await s.stagingService.stage({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: setup.snapshot.id,
      mappingSetId: setup.mappingSet.id, datasetType: 'OPEN_ITEMS', actor: OPERATOR,
    });
    expect(staged.inserted).toBe(3);
    expect(staged.controlTotals.openItemTotal).toBeCloseTo(48250.75, 2);
    expect(staged.controlTotals.scheduleBalance).toBeCloseTo(48250.75, 2);
  });
});

describe('unknown dataset types', () => {
  it('rejects a dataset type the migration model does not define', async () => {
    const s = makeServices();
    const setup = await setupSource(s, BALANCED_TB_ROWS);
    await decideAndFreeze(s, TENANT, setup.mappingSet.id);
    const run = await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1', actor: OPERATOR,
    });
    await expect(s.stagingService.stage({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: setup.snapshot.id,
      mappingSetId: setup.mappingSet.id, datasetType: 'SOMETHING_ELSE', actor: OPERATOR,
    })).rejects.toThrow(/Unknown datasetType/i);
  });
});
