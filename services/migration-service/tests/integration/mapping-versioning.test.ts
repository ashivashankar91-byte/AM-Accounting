/**
 * S130 — versioned mapping sets. A mapping set that has been used to stage
 * data is immutable; changing a decision means a new version.
 */
import { describe, it, expect } from 'vitest';
import { makeServices, setupSource, decideAndFreeze, TENANT, LE, OPERATOR, CONTROLLER, BALANCED_TB_ROWS } from '../helpers/service-harness';

describe('mapping set versioning', () => {
  it('creates the first set at version 1 in DRAFT', async () => {
    const s = makeServices();
    const { mappingSet } = await setupSource(s, BALANCED_TB_ROWS);
    expect(mappingSet.version).toBe(1);
    expect(mappingSet.status).toBe('DRAFT');
  });

  it('seeds one entry per distinct source value found in the snapshot', async () => {
    const s = makeServices();
    const { mappingSet } = await setupSource(s, BALANCED_TB_ROWS);
    const { items } = await s.mappingService.listEntries(TENANT, mappingSet.id);
    const accountEntries = (items as any[]).filter((e) => e.sourceField === 'accountCode');
    expect(accountEntries.map((e) => e.sourceValue).sort()).toEqual(['1000', '1200', '2000', '3000']);
  });

  it('starts every seeded entry as MANUAL_REVIEW_REQUIRED — nothing is auto-decided', async () => {
    const s = makeServices();
    const { mappingSet } = await setupSource(s, BALANCED_TB_ROWS);
    const { items } = await s.mappingService.listEntries(TENANT, mappingSet.id);
    expect((items as any[]).every((e) => e.status === 'MANUAL_REVIEW_REQUIRED')).toBe(true);
  });

  it('reports a coverage meter that only reaches 100% when every entry is disposed', async () => {
    const s = makeServices();
    const { mappingSet } = await setupSource(s, BALANCED_TB_ROWS);
    const before = await s.mappingService.listEntries(TENANT, mappingSet.id);
    expect(before.coverage.complete).toBe(false);

    await decideAndFreeze(s, TENANT, mappingSet.id);
    const after = await s.mappingService.listEntries(TENANT, mappingSet.id);
    expect(after.coverage.coveragePercent).toBe(100);
    expect(after.coverage.complete).toBe(true);
  });

  it('refuses to freeze while coverage is incomplete', async () => {
    const s = makeServices();
    const { mappingSet } = await setupSource(s, BALANCED_TB_ROWS);
    await expect(s.mappingService.freeze({ tenantId: TENANT, mappingSetId: mappingSet.id, actor: CONTROLLER }))
      .rejects.toThrow(/MANUAL_REVIEW_REQUIRED/);
  });

  it('records who froze the set and when', async () => {
    const s = makeServices();
    const { mappingSet } = await setupSource(s, BALANCED_TB_ROWS);
    const frozen = await decideAndFreeze(s, TENANT, mappingSet.id);
    expect(frozen.status).toBe('FROZEN');
    expect(frozen.frozenBy).toBe(CONTROLLER);
    expect(frozen.frozenAt).toBeTruthy();
  });

  it('refuses to mutate an entry of a frozen set', async () => {
    const s = makeServices();
    const { mappingSet } = await setupSource(s, BALANCED_TB_ROWS);
    await decideAndFreeze(s, TENANT, mappingSet.id);
    const { items } = await s.mappingService.listEntries(TENANT, mappingSet.id);
    await expect(s.mappingService.updateEntry({
      tenantId: TENANT, mappingSetId: mappingSet.id, entryId: (items as any[])[0].id,
      actor: OPERATOR, patch: { targetValue: '9999', classification: 'MAP' },
    })).rejects.toThrow(/frozen|immutable/i);
  });

  it('refuses to add entries to a frozen set', async () => {
    const s = makeServices();
    const { mappingSet } = await setupSource(s, BALANCED_TB_ROWS);
    await decideAndFreeze(s, TENANT, mappingSet.id);
    await expect(s.mappingService.upsertEntries({
      tenantId: TENANT, mappingSetId: mappingSet.id, actor: OPERATOR,
      entries: [{ sourceField: 'accountCode', sourceValue: '4000', targetField: 'accountCode', targetValue: '4000', classification: 'ALIGN' }],
    })).rejects.toThrow(/frozen|immutable/i);
  });

  it('issues version 2 for the same source system so history is never rewritten', async () => {
    const s = makeServices();
    const { mappingSet, system } = await setupSource(s, BALANCED_TB_ROWS);
    await decideAndFreeze(s, TENANT, mappingSet.id);

    const v2 = await s.mappingService.createSet({
      tenantId: TENANT, legalEntityId: LE, sourceSystemId: system.id, actor: OPERATOR,
    });
    expect(v2.version).toBe(2);
    expect(v2.status).toBe('DRAFT');

    const v1 = await s.mappingService.getSet(TENANT, mappingSet.id);
    expect(v1.status).toBe('FROZEN');
    expect(v1.version).toBe(1);
  });

  it('records the run that consumed a frozen set so its immutability has a reason', async () => {
    const s = makeServices();
    const { mappingSet, snapshot } = await setupSource(s, BALANCED_TB_ROWS);
    await decideAndFreeze(s, TENANT, mappingSet.id);
    const run = await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1', actor: OPERATOR,
    });
    await s.stagingService.stage({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: snapshot.id,
      mappingSetId: mappingSet.id, datasetType: 'TB', actor: OPERATOR,
    });
    const used = await s.mappingService.getSet(TENANT, mappingSet.id);
    expect(used.usedByRunId).toBe(run.runId);
  });

  it('pins the transformation version to the mapping set identity and version', async () => {
    const s = makeServices();
    const { mappingSet, snapshot } = await setupSource(s, BALANCED_TB_ROWS);
    await decideAndFreeze(s, TENANT, mappingSet.id);
    const run = await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1', actor: OPERATOR,
    });
    const staged = await s.stagingService.stage({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: snapshot.id,
      mappingSetId: mappingSet.id, datasetType: 'TB', actor: OPERATOR,
    });
    expect(staged.transformationVersion).toBe(`ce16.v1:mapping-${mappingSet.id}:v1`);
  });

  it('refuses to stage from a DRAFT mapping set', async () => {
    const s = makeServices();
    const { mappingSet, snapshot } = await setupSource(s, BALANCED_TB_ROWS);
    const run = await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1', actor: OPERATOR,
    });
    await expect(s.stagingService.stage({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: snapshot.id,
      mappingSetId: mappingSet.id, datasetType: 'TB', actor: OPERATOR,
    })).rejects.toThrow(/FROZEN/i);
  });
});
