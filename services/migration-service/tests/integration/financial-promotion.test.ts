/**
 * Migration principle 3 — financial promotion goes staged data → conversion
 * transaction → CE-07 governed posting → authoritative conversion journal.
 * Nothing writes directly to the GL.
 */
import { describe, it, expect } from 'vitest';
import {
  makeServices, setupSource, decideAndFreeze, stageAndValidate, mappableFields,
  BALANCED_TB_ROWS, UNBALANCED_TB_ROWS, TENANT, LE, OPERATOR, CONTROLLER,
} from '../helpers/service-harness';

describe('governed promotion of a balanced conversion batch', () => {
  it('routes the batch through the CE-07 posting client rather than writing the GL directly', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    await s.promotionService.promote({ tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: OPERATOR });
    expect(s.h.posting.requests).toHaveLength(1);
    expect(s.h.posting.requests[0]!.runId).toBe(run.runId);
  });

  it('posts under the conversion journal family, not an ordinary manual journal', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    await s.promotionService.promote({ tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: OPERATOR });
    expect(s.h.posting.requests[0]!.journalFamily).toBe('CONVERSION');
  });

  it('returns an authoritative journal reference', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    const { results } = await s.promotionService.promote({ tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: OPERATOR });
    const tb = results.find((r) => r.datasetType === 'TB')!;
    expect(tb.status).toBe('POSTED');
    expect(tb.journalRef).toBeTruthy();
    expect(tb.promotedRows).toBe(4);
  });

  it('sends debits equal to credits to the posting engine', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    await s.promotionService.promote({ tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: OPERATOR });
    const lines = s.h.posting.requests[0]!.lines;
    const debits = lines.reduce((sum, l) => sum + l.debit, 0);
    const credits = lines.reduce((sum, l) => sum + l.credit, 0);
    expect(Math.round(debits * 100)).toBe(Math.round(credits * 100));
  });

  it('marks the staged rows PROMOTED with their target record id', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    await s.promotionService.promote({ tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: OPERATOR });
    const [dataset] = (await s.stagingService.listDatasets(TENANT, run.runId)) as any[];
    const { items } = await s.stagingService.listRows(TENANT, dataset.id, 100, 0, true);
    expect((items as any[]).every((r) => r.state === 'PROMOTED')).toBe(true);
    expect((items as any[]).every((r) => !!r.promotedRecordId)).toBe(true);
  });
});

describe('an unbalanced batch cannot promote', () => {
  it('refuses promotion and never calls the posting engine', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, UNBALANCED_TB_ROWS);
    await expect(s.promotionService.promote({ tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: OPERATOR }))
      .rejects.toThrow(/imbalance|balanced|debits/i);
    expect(s.h.posting.requests).toHaveLength(0);
  });

  it('reports the structural imbalance as the reason', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, UNBALANCED_TB_ROWS);
    let thrown: any;
    try {
      await s.promotionService.promote({ tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: OPERATOR });
    } catch (error) { thrown = error; }
    expect(thrown.code).toBe('STRUCTURAL_IMBALANCE');
  });

  it('queues the imbalance as a blocking exception rather than losing it', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, UNBALANCED_TB_ROWS);
    await s.promotionService.promote({ tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: OPERATOR }).catch(() => undefined);
    const { items } = await s.exceptionService.list(TENANT, run.runId);
    const conservation = (items as any[]).find((e) => e.exceptionType === 'CONSERVATION_FAILED');
    expect(conservation).toBeTruthy();
    expect(conservation.blocking).toBe(true);
  });

  it('leaves the staged rows unpromoted', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, UNBALANCED_TB_ROWS);
    await s.promotionService.promote({ tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: OPERATOR }).catch(() => undefined);
    const [dataset] = (await s.stagingService.listDatasets(TENANT, run.runId)) as any[];
    const { items } = await s.stagingService.listRows(TENANT, dataset.id, 100, 0, true);
    expect((items as any[]).some((r) => r.state === 'PROMOTED')).toBe(false);
  });
});

describe('promotion preconditions', () => {
  it('refuses to promote a run that has not been staged', async () => {
    const s = makeServices();
    const run = await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1', actor: OPERATOR,
    });
    await expect(s.promotionService.promote({ tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: OPERATOR }))
      .rejects.toThrow(/staged and validated/i);
  });

  it('refuses to promote while a blocking exception is still pending', async () => {
    const s = makeServices();
    const setup = await setupSource(s, BALANCED_TB_ROWS);
    await decideAndFreeze(s, TENANT, setup.mappingSet.id);
    const later = await s.sourceService.registerSnapshot({
      tenantId: TENANT, legalEntityId: LE, sourceSystemId: setup.system.id, snapshotRef: 'SNAP-BLOCK-001',
      extractedAt: new Date().toISOString(), actor: OPERATOR,
    });
    await s.sourceService.importRows({
      tenantId: TENANT, legalEntityId: LE, snapshotId: later.id, filename: 'blocked.csv',
      filePath: '/certification/blocked.csv', declaredChecksum: '', actor: OPERATOR,
      rows: [...BALANCED_TB_ROWS, { accountCode: '8888', accountName: 'Unmapped', debit: 0, credit: 0, description: 'no decision' }],
    });
    const run = await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1', actor: OPERATOR,
    });
    await s.stagingService.stage({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: later.id,
      mappingSetId: setup.mappingSet.id, datasetType: 'TB', actor: OPERATOR,
    });
    await expect(s.promotionService.promote({ tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: OPERATOR }))
      .rejects.toThrow(/blocking exception/i);
  });
});

describe('promotion idempotency', () => {
  it('does not post a second journal when promotion is repeated', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    const first = await s.promotionService.promote({ tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: OPERATOR });
    const second = await s.promotionService.promote({ tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: OPERATOR });
    expect(second.results[0]!.status).toBe('ALREADY_PROMOTED');
    expect(second.results[0]!.promotedRows).toBe(0);
    expect(s.h.posting.requests).toHaveLength(1);
    expect(first.results[0]!.journalRef).toBeTruthy();
  });

  it('uses a deterministic idempotency identity derived from run, dataset and control checksum', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    await s.promotionService.promote({ tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: OPERATOR });
    const identity = s.h.posting.requests[0]!.idempotencyIdentity;
    expect(identity).toMatch(new RegExp(`^migration-conversion:${run.runId}:`));
  });
});

describe('upstream targets that are not yet reconciled', () => {
  it('reports PENDING_UPSTREAM_TECHNICAL_RECONCILIATION instead of fabricating a target id', async () => {
    const s = makeServices();
    const rows = [{ bankAccount: 'BOA-4471', statementRef: 'STMT-2025-12', amount: 1000, documentDate: '2025-12-31' }];
    const setup = await setupSource(s, rows, { mappingFields: mappableFields(rows) });
    await decideAndFreeze(s, TENANT, setup.mappingSet.id);
    const run = await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1', actor: OPERATOR,
    });
    await s.stagingService.stage({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: setup.snapshot.id,
      mappingSetId: setup.mappingSet.id, datasetType: 'BANK_REC', actor: OPERATOR,
    });
    const { results, anyPending } = await s.promotionService.promote({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: OPERATOR,
    });
    expect(anyPending).toBe(true);
    expect(results[0]!.status).toBe('PENDING_UPSTREAM_TECHNICAL_RECONCILIATION');
    expect(results[0]!.journalRef).toBeFalsy();
  });

  it('leaves the rows unpromoted so nothing is ever recorded as migrated on a guess', async () => {
    const s = makeServices();
    const rows = [{ payrollBatch: 'PR-2025-26', earningsCode: 'REG', amount: 5000, documentDate: '2025-12-26' }];
    const setup = await setupSource(s, rows, { mappingFields: mappableFields(rows) });
    await decideAndFreeze(s, TENANT, setup.mappingSet.id);
    const run = await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1', actor: OPERATOR,
    });
    const staged = await s.stagingService.stage({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: setup.snapshot.id,
      mappingSetId: setup.mappingSet.id, datasetType: 'PAYROLL', actor: OPERATOR,
    });
    await s.promotionService.promote({ tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: CONTROLLER });
    const { items } = await s.stagingService.listRows(TENANT, staged.datasetId, 100, 0, true);
    expect((items as any[]).some((r) => r.state === 'PROMOTED')).toBe(false);
    expect((items as any[]).some((r) => r.promotedRecordId)).toBe(false);
  });
});
