/**
 * S129 — open-item conversion for controlled accounts. Items are established
 * through the CE-08 schedule contract, conserved against the converted TB
 * control balance from S130, and never written straight into a schedule table.
 */
import { describe, it, expect } from 'vitest';
import {
  makeServices, setupSource, decideAndFreeze, mappableFields,
  BALANCED_TB_ROWS, OPEN_ITEM_ROWS, TENANT, LE, OPERATOR, CONTROLLER,
} from '../helpers/service-harness';

/**
 * Stages the converted TB (which establishes the 1200 control balance) and the
 * matching AR open items into one run, exactly as S129 requires.
 */
async function stageTbAndOpenItems(
  s: ReturnType<typeof makeServices>,
  itemRows: Record<string, unknown>[] = OPEN_ITEM_ROWS,
) {
  const tbRows = BALANCED_TB_ROWS;
  const setup = await setupSource(s, [...tbRows, ...itemRows], {
    mappingFields: mappableFields([...tbRows, ...itemRows]),
  });
  await decideAndFreeze(s, TENANT, setup.mappingSet.id);

  const tbSnapshot = await s.sourceService.registerSnapshot({
    tenantId: TENANT, legalEntityId: LE, sourceSystemId: setup.system.id, snapshotRef: 'SNAP-TB-ONLY',
    extractedAt: new Date().toISOString(), actor: OPERATOR,
  });
  await s.sourceService.importRows({
    tenantId: TENANT, legalEntityId: LE, snapshotId: tbSnapshot.id, filename: 'tb-only.csv',
    filePath: '/certification/tb-only.csv', declaredChecksum: '', rows: tbRows, actor: OPERATOR,
  });

  const itemSnapshot = await s.sourceService.registerSnapshot({
    tenantId: TENANT, legalEntityId: LE, sourceSystemId: setup.system.id, snapshotRef: 'SNAP-ITEMS-ONLY',
    extractedAt: new Date().toISOString(), actor: OPERATOR,
  });
  await s.sourceService.importRows({
    tenantId: TENANT, legalEntityId: LE, snapshotId: itemSnapshot.id, filename: 'ar-open-items.csv',
    filePath: '/certification/ar-open-items.csv', declaredChecksum: '', rows: itemRows, actor: OPERATOR,
  });

  const run = await s.runService.create({
    tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1', actor: OPERATOR,
  });
  const tb = await s.stagingService.stage({
    tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: tbSnapshot.id,
    mappingSetId: setup.mappingSet.id, datasetType: 'TB', actor: OPERATOR,
  });
  const items = await s.stagingService.stage({
    tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: itemSnapshot.id,
    mappingSetId: setup.mappingSet.id, datasetType: 'OPEN_ITEMS', actor: OPERATOR,
  });
  return { setup, run, tb, items };
}

describe('subledger conservation against the converted TB', () => {
  it('passes G2 when the open items sum exactly to the converted control balance', async () => {
    const s = makeServices();
    const { run } = await stageTbAndOpenItems(s);
    const validated = await s.stagingService.validate({
      tenantId: TENANT, runId: run.runId, actor: OPERATOR, agingAsOf: '2025-12-31',
    });
    const openItems = validated.datasets.find((d) => d.datasetType === 'OPEN_ITEMS')!;
    expect(openItems.gates.find((g) => g.gateCode === 'G2')!.result).toBe('PASS');
    expect(validated.allPassed).toBe(true);
  });

  it('fails G2 when the subledger does not tie to the control account', async () => {
    const s = makeServices();
    const short = OPEN_ITEM_ROWS.map((r, i) => (i === 0 ? { ...r, openItemAmount: 17999.0 } : r));
    const { run } = await stageTbAndOpenItems(s, short);
    const validated = await s.stagingService.validate({
      tenantId: TENANT, runId: run.runId, actor: OPERATOR, agingAsOf: '2025-12-31',
    });
    const openItems = validated.datasets.find((d) => d.datasetType === 'OPEN_ITEMS')!;
    const g2 = openItems.gates.find((g) => g.gateCode === 'G2')!;
    expect(g2.result).toBe('FAIL');
    expect((g2.details['breaches'] as any[])[0].controlAccount).toBe('1200');
  });

  it('derives the control balance from the run\'s own converted TB, not from operator input', async () => {
    const s = makeServices();
    const { run } = await stageTbAndOpenItems(s);
    const balances = await s.stagingService.deriveControlBalances(TENANT, run.runId);
    expect(balances['1200']).toBeCloseTo(48250.75, 2);
  });

  it('evaluates aging integrity on the open items', async () => {
    const s = makeServices();
    const { run } = await stageTbAndOpenItems(s);
    const validated = await s.stagingService.validate({
      tenantId: TENANT, runId: run.runId, actor: OPERATOR, agingAsOf: '2025-12-31',
    });
    const g4 = validated.datasets.find((d) => d.datasetType === 'OPEN_ITEMS')!.gates.find((g) => g.gateCode === 'G4')!;
    expect(g4.details['itemLevel']).not.toBe(false);
    expect(g4.result).toBe('PASS');
  });

  it('blocks G4 when no aging as-of date is supplied for an item dataset', async () => {
    const s = makeServices();
    const { run } = await stageTbAndOpenItems(s);
    const validated = await s.stagingService.validate({
      tenantId: TENANT, runId: run.runId, actor: OPERATOR, agingAsOf: null,
    });
    const g4 = validated.datasets.find((d) => d.datasetType === 'OPEN_ITEMS')!.gates.find((g) => g.gateCode === 'G4')!;
    expect(['BLOCKED', 'FAIL']).toContain(g4.result);
  });
});

describe('establishing items through the CE-08 schedule contract', () => {
  it('creates modern items through the schedule client rather than a direct insert', async () => {
    const s = makeServices();
    const { run } = await stageTbAndOpenItems(s);
    await s.stagingService.validate({ tenantId: TENANT, runId: run.runId, actor: OPERATOR, agingAsOf: '2025-12-31' });
    await s.promotionService.promote({ tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: CONTROLLER });
    expect(s.h.schedules.requests.length).toBeGreaterThan(0);
    expect(s.h.schedules.requests[0]!.items).toHaveLength(3);
  });

  it('establishes items as a migration item-establishment event carrying source lineage', async () => {
    const s = makeServices();
    const { run } = await stageTbAndOpenItems(s);
    await s.stagingService.validate({ tenantId: TENANT, runId: run.runId, actor: OPERATOR, agingAsOf: '2025-12-31' });
    await s.promotionService.promote({ tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: CONTROLLER });
    const request = s.h.schedules.requests[0]!;
    expect(request.runId).toBe(run.runId);
    expect(request.items.every((i) => !!i.sourceRowRef)).toBe(true);
  });

  it('reports ESTABLISHED and marks the item rows promoted', async () => {
    const s = makeServices();
    const { run, items } = await stageTbAndOpenItems(s);
    await s.stagingService.validate({ tenantId: TENANT, runId: run.runId, actor: OPERATOR, agingAsOf: '2025-12-31' });
    const { results } = await s.promotionService.promote({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: CONTROLLER,
    });
    const openItemResult = results.find((r) => r.datasetType === 'OPEN_ITEMS')!;
    expect(openItemResult.status).toBe('ESTABLISHED');
    expect(openItemResult.promotedRows).toBe(3);

    const { items: rows } = await s.stagingService.listRows(TENANT, items.datasetId, 100, 0, true);
    expect((rows as any[]).every((r) => r.state === 'PROMOTED')).toBe(true);
  });

  it('does not establish the same items twice on a repeated promotion', async () => {
    const s = makeServices();
    const { run } = await stageTbAndOpenItems(s);
    await s.stagingService.validate({ tenantId: TENANT, runId: run.runId, actor: OPERATOR, agingAsOf: '2025-12-31' });
    await s.promotionService.promote({ tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: CONTROLLER });
    const requestCount = s.h.schedules.requests.length;
    const second = await s.promotionService.promote({ tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: CONTROLLER });
    expect(second.results.find((r) => r.datasetType === 'OPEN_ITEMS')!.status).toBe('ALREADY_PROMOTED');
    expect(s.h.schedules.requests).toHaveLength(requestCount);
  });

  it('fails G3 when an item identity was already promoted by an earlier run', async () => {
    const s = makeServices();
    const { run } = await stageTbAndOpenItems(s);
    await s.stagingService.validate({ tenantId: TENANT, runId: run.runId, actor: OPERATOR, agingAsOf: '2025-12-31' });
    await s.promotionService.promote({ tenantId: TENANT, legalEntityId: LE, runId: run.runId, actor: CONTROLLER });

    const revalidated = await s.stagingService.validate({
      tenantId: TENANT, runId: run.runId, actor: OPERATOR, agingAsOf: '2025-12-31',
    });
    const g3 = revalidated.datasets.find((d) => d.datasetType === 'OPEN_ITEMS')!.gates.find((g) => g.gateCode === 'G3')!;
    expect(g3.result).toBe('FAIL');
    expect(g3.details['alreadyPromotedCount']).toBe(3);
  });
});
