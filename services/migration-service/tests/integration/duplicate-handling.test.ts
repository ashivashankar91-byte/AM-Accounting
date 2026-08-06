/**
 * Migration principle 5 — a rerun must not double-load. Identity is the
 * source-row hash, so replaying the same extract is a no-op.
 */
import { describe, it, expect } from 'vitest';
import {
  makeServices, setupSource, decideAndFreeze, BALANCED_TB_ROWS, TENANT, LE, OPERATOR,
} from '../helpers/service-harness';

describe('duplicate file import', () => {
  it('refuses to import the identical file twice into the same snapshot', async () => {
    const s = makeServices();
    const { snapshot } = await setupSource(s, BALANCED_TB_ROWS);
    await expect(s.sourceService.importRows({
      tenantId: TENANT, legalEntityId: LE, snapshotId: snapshot.id, filename: 'tb.csv',
      filePath: '/certification/tb.csv', declaredChecksum: '', rows: BALANCED_TB_ROWS, actor: OPERATOR,
    })).rejects.toThrow(/duplicate|already/i);
  });

  it('reports the checksum and the existing file so the refusal is diagnosable', async () => {
    const s = makeServices();
    const { snapshot, imported } = await setupSource(s, BALANCED_TB_ROWS);
    let thrown: any;
    try {
      await s.sourceService.importRows({
        tenantId: TENANT, legalEntityId: LE, snapshotId: snapshot.id, filename: 'renamed.csv',
        filePath: '/certification/renamed.csv', declaredChecksum: '', rows: BALANCED_TB_ROWS, actor: OPERATOR,
      });
    } catch (error) { thrown = error; }
    expect(thrown.checksum).toBe(imported.checksum);
    expect(thrown.existingFileId).toBe(imported.file.id);
  });

  it('rejects a file whose declared checksum does not match its content', async () => {
    const s = makeServices();
    const { snapshot } = await setupSource(s, BALANCED_TB_ROWS);
    await expect(s.sourceService.importRows({
      tenantId: TENANT, legalEntityId: LE, snapshotId: snapshot.id, filename: 'tampered.csv',
      filePath: '/certification/tampered.csv', declaredChecksum: 'deadbeef', actor: OPERATOR,
      rows: [{ accountCode: '9999', accountName: 'Tampered', debit: 1, credit: 0 }],
    })).rejects.toThrow(/checksum/i);
  });

  it('accepts a genuinely different file into the same snapshot', async () => {
    const s = makeServices();
    const { snapshot } = await setupSource(s, BALANCED_TB_ROWS);
    const second = await s.sourceService.importRows({
      tenantId: TENANT, legalEntityId: LE, snapshotId: snapshot.id, filename: 'ap.csv',
      filePath: '/certification/ap.csv', declaredChecksum: '', actor: OPERATOR,
      rows: [{ accountCode: '2000', accountName: 'Accounts Payable', debit: 0, credit: 500 }],
    });
    expect(second.inserted).toBe(1);
    expect((await s.sourceService.listFiles(TENANT, snapshot.id) as any[])).toHaveLength(2);
  });
});

describe('duplicate rows within a file', () => {
  it('skips a byte-identical row rather than loading it twice', async () => {
    const s = makeServices();
    const { system } = await setupSource(s, BALANCED_TB_ROWS);
    const snapshot = await s.sourceService.registerSnapshot({
      tenantId: TENANT, legalEntityId: LE, sourceSystemId: system.id, snapshotRef: 'SNAP-DUP-001',
      extractedAt: new Date().toISOString(), actor: OPERATOR,
    });
    const result = await s.sourceService.importRows({
      tenantId: TENANT, legalEntityId: LE, snapshotId: snapshot.id, filename: 'dupes.csv',
      filePath: '/certification/dupes.csv', declaredChecksum: '', actor: OPERATOR,
      rows: [BALANCED_TB_ROWS[0]!, BALANCED_TB_ROWS[0]!, BALANCED_TB_ROWS[1]!],
    });
    expect(result.inserted).toBe(2);
    expect(result.skippedDuplicates).toBe(1);
  });
});

describe('idempotent restage', () => {
  async function stageOnce(s: ReturnType<typeof makeServices>) {
    const setup = await setupSource(s, BALANCED_TB_ROWS);
    await decideAndFreeze(s, TENANT, setup.mappingSet.id);
    const run = await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1', actor: OPERATOR,
    });
    const first = await s.stagingService.stage({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: setup.snapshot.id,
      mappingSetId: setup.mappingSet.id, datasetType: 'TB', actor: OPERATOR,
    });
    return { setup, run, first };
  }

  it('loads nothing new when the same batch is staged again', async () => {
    const s = makeServices();
    const { setup, run, first } = await stageOnce(s);
    expect(first.inserted).toBe(4);

    const second = await s.stagingService.stage({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: setup.snapshot.id,
      mappingSetId: setup.mappingSet.id, datasetType: 'TB', actor: OPERATOR,
    });
    expect(second.inserted).toBe(0);
    expect(second.skippedDuplicates).toBe(4);
  });

  it('reuses the same staging dataset rather than creating a parallel one', async () => {
    const s = makeServices();
    const { setup, run, first } = await stageOnce(s);
    const second = await s.stagingService.stage({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: setup.snapshot.id,
      mappingSetId: setup.mappingSet.id, datasetType: 'TB', actor: OPERATOR,
    });
    expect(second.datasetId).toBe(first.datasetId);
    expect((await s.stagingService.listDatasets(TENANT, run.runId) as any[])).toHaveLength(1);
  });

  it('keeps control totals unchanged after a replay', async () => {
    const s = makeServices();
    const { setup, run, first } = await stageOnce(s);
    const second = await s.stagingService.stage({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: setup.snapshot.id,
      mappingSetId: setup.mappingSet.id, datasetType: 'TB', actor: OPERATOR,
    });
    expect(second.controlTotals.totalDebit).toBeCloseTo(first.controlTotals.totalDebit, 2);
    expect(second.controlTotals.rowCount).toBe(first.controlTotals.rowCount);
  });

  it('still stages a row whose content genuinely changed, under a new hash', async () => {
    // Rows carrying a natural identity let a later extract be recognised as a
    // correction of the same fact rather than four new facts.
    const identified = BALANCED_TB_ROWS.map((r) => ({ ...r, sourceIdentity: `TB-${r.accountCode}` }));
    const s = makeServices();
    const setup = await setupSource(s, identified);
    await decideAndFreeze(s, TENANT, setup.mappingSet.id);
    const run = await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1', actor: OPERATOR,
    });
    const first = await s.stagingService.stage({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: setup.snapshot.id,
      mappingSetId: setup.mappingSet.id, datasetType: 'TB', actor: OPERATOR,
    });
    expect(first.inserted).toBe(4);

    const corrected = await s.sourceService.registerSnapshot({
      tenantId: TENANT, legalEntityId: LE, sourceSystemId: setup.system.id, snapshotRef: 'SNAP-CORRECTED-001',
      extractedAt: new Date().toISOString(), actor: OPERATOR,
    });
    await s.sourceService.importRows({
      tenantId: TENANT, legalEntityId: LE, snapshotId: corrected.id, filename: 'tb-corrected.csv',
      filePath: '/certification/tb-corrected.csv', declaredChecksum: '', actor: OPERATOR,
      rows: identified.map((r) => (r.accountCode === '1000' ? { ...r, debit: 125100.0 } : r)),
    });
    const restaged = await s.stagingService.stage({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: corrected.id,
      mappingSetId: setup.mappingSet.id, datasetType: 'TB', actor: OPERATOR,
    });
    expect(restaged.inserted).toBe(1);
    expect(restaged.skippedDuplicates).toBe(3);
  });
});
