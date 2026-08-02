/**
 * Migration principle 7 — every record retains exact lineage:
 * source system → file → row → staging → mapping → transformation → target →
 * posting → journal → reconciliation.
 */
import { describe, it, expect } from 'vitest';
import {
  makeServices, driveToReadyForCutover, stageAndValidate,
  OPEN_ITEM_ROWS, TENANT, LE, OPERATOR, CONTROLLER,
} from '../helpers/service-harness';

async function promoted(s: ReturnType<typeof makeServices>) {
  const ctx = await driveToReadyForCutover(s);
  const { results } = await s.promotionService.promote({
    tenantId: TENANT, legalEntityId: LE, runId: ctx.run.runId, actor: CONTROLLER,
  });
  return { ...ctx, results };
}

describe('lineage from a posted conversion journal', () => {
  it('records one lineage row per staged source row', async () => {
    const s = makeServices();
    const { run } = await promoted(s);
    const lineage = (await s.promotionService.listLineage(TENANT, run.runId)) as any[];
    expect(lineage).toHaveLength(4);
  });

  it('carries the source file and source row references', async () => {
    const s = makeServices();
    const { run } = await promoted(s);
    const lineage = (await s.promotionService.listLineage(TENANT, run.runId)) as any[];
    expect(lineage.every((l) => !!l.sourceRowRef)).toBe(true);
    expect(lineage.every((l) => !!l.sourceFileRef)).toBe(true);
    expect(lineage.every((l) => !!l.sourceSystemRef)).toBe(true);
  });

  it('carries the mapping decision and the composite transformation pin', async () => {
    const s = makeServices();
    const { run, mappingSet } = await promoted(s);
    const lineage = (await s.promotionService.listLineage(TENANT, run.runId)) as any[];
    expect(lineage.every((l) => l.mappingDecisionRef === mappingSet.id)).toBe(true);

    // The pin is composite — run version + mapping set + mapping version — so
    // the exact transformation that produced the row can be reconstructed.
    const versions = new Set(lineage.map((l) => l.transformationVersion));
    expect(versions.size).toBe(1);
    const [pinned] = [...versions] as string[];
    expect(pinned).toContain(run.transformationVersion);
    expect(pinned).toContain(mappingSet.id);
  });

  it('carries the staging record, the posting execution and the journal', async () => {
    const s = makeServices();
    const { run, results } = await promoted(s);
    const lineage = (await s.promotionService.listLineage(TENANT, run.runId)) as any[];
    expect(lineage.every((l) => !!l.stagingRecordId)).toBe(true);
    expect(lineage.every((l) => !!l.postingExecutionRef)).toBe(true);
    expect(new Set(lineage.map((l) => l.journalRef))).toEqual(new Set([results[0]!.journalRef]));
  });

  it('names the target record type so a drill knows what it is looking at', async () => {
    const s = makeServices();
    const { run } = await promoted(s);
    const lineage = (await s.promotionService.listLineage(TENANT, run.runId)) as any[];
    expect(new Set(lineage.map((l) => l.targetRecordType))).toEqual(new Set(['JOURNAL_ENTRY']));
  });
});

describe('drilling in both directions', () => {
  it('finds the target journal from a source row reference', async () => {
    const s = makeServices();
    const { run } = await promoted(s);
    const all = (await s.promotionService.listLineage(TENANT, run.runId)) as any[];
    const anchor = all[0];
    const drilled = (await s.promotionService.listLineage(TENANT, run.runId, { sourceRowRef: anchor.sourceRowRef })) as any[];
    expect(drilled).toHaveLength(1);
    expect(drilled[0].journalRef).toBe(anchor.journalRef);
  });

  it('finds every contributing source row from a journal reference', async () => {
    const s = makeServices();
    const { run, results } = await promoted(s);
    const drilled = (await s.promotionService.listLineage(TENANT, run.runId, { journalRef: results[0]!.journalRef! })) as any[];
    expect(drilled).toHaveLength(4);
    expect(new Set(drilled.map((l) => l.sourceRowRef)).size).toBe(4);
  });

  it('reaches the raw legacy row that produced a journal line', async () => {
    const s = makeServices();
    const { run, snapshot } = await promoted(s);
    const lineage = (await s.promotionService.listLineage(TENANT, run.runId)) as any[];
    const files = (await s.sourceService.listFiles(TENANT, snapshot.id)) as any[];
    const { items } = await s.sourceService.listRows(TENANT, files[0].id, 100, 0, true);
    const sourceIds = new Set((items as any[]).map((r) => r.id));
    expect(lineage.every((l) => sourceIds.has(l.sourceRowRef))).toBe(true);
  });

  it('reaches the staged row that produced a journal line', async () => {
    const s = makeServices();
    const { run, staged } = await promoted(s);
    const lineage = (await s.promotionService.listLineage(TENANT, run.runId)) as any[];
    const { items } = await s.stagingService.listRows(TENANT, staged.datasetId, 100, 0, true);
    const stagedIds = new Set((items as any[]).map((r) => r.id));
    expect(lineage.every((l) => stagedIds.has(l.stagingRecordId))).toBe(true);
  });

  it('links the staged row back to its promoted journal', async () => {
    const s = makeServices();
    const { run, staged, results } = await promoted(s);
    const { items } = await s.stagingService.listRows(TENANT, staged.datasetId, 100, 0, true);
    expect((items as any[]).every((r) => r.promotedRecordId === results[0]!.journalRef)).toBe(true);
    expect((items as any[]).every((r) => !!r.promotedAt)).toBe(true);
  });

  it('stores a lineage reference on the staged row itself', async () => {
    const s = makeServices();
    const { run, staged } = await promoted(s);
    const { items } = await s.stagingService.listRows(TENANT, staged.datasetId, 100, 0, true);
    const withLineage = (items as any[]).filter((r) => r.lineageRef);
    expect(withLineage.length).toBe(4);
  });
});

describe('lineage for open items', () => {
  it('records the established open-item reference alongside the source row', async () => {
    const s = makeServices();
    const ctx = await stageAndValidate(s, OPEN_ITEM_ROWS, 'OPEN_ITEMS');
    await s.promotionService.promote({
      tenantId: TENANT, legalEntityId: LE, runId: ctx.run.runId, actor: CONTROLLER,
    });
    const lineage = (await s.promotionService.listLineage(TENANT, ctx.run.runId)) as any[];
    expect(lineage.length).toBeGreaterThan(0);
    expect(lineage.every((l) => l.targetRecordType === 'OPEN_ITEM')).toBe(true);
    expect(lineage.every((l) => !!l.openItemRef && !!l.sourceRowRef)).toBe(true);
  });

  it('leaves the journal reference empty for open items — they are not journals', async () => {
    const s = makeServices();
    const ctx = await stageAndValidate(s, OPEN_ITEM_ROWS, 'OPEN_ITEMS');
    await s.promotionService.promote({
      tenantId: TENANT, legalEntityId: LE, runId: ctx.run.runId, actor: CONTROLLER,
    });
    const lineage = (await s.promotionService.listLineage(TENANT, ctx.run.runId)) as any[];
    expect(lineage.every((l) => !l.journalRef)).toBe(true);
  });
});

describe('lineage is tenant-scoped', () => {
  it('does not leak lineage into another tenant', async () => {
    const s = makeServices();
    const { run } = await promoted(s);
    const leaked = await s.promotionService.listLineage('tenant-other', run.runId);
    expect(leaked as any[]).toHaveLength(0);
  });
});
