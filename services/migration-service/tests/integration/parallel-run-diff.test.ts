/**
 * S131 — parallel-run comparison harness. The exit criterion is that every
 * difference is explained and dispositioned, not that there are no differences.
 */
import { describe, it, expect } from 'vitest';
import {
  makeServices, stageAndValidate, BALANCED_TB_ROWS, TENANT, LE, OPERATOR, CONTROLLER, APPROVER,
} from '../helpers/service-harness';

async function comparisonWithDiffs(s: ReturnType<typeof makeServices>) {
  const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
  const modern = await s.comparisonService.deriveModernFigures(TENANT, run.runId);
  // Legacy shows cash 1,500 lower and carries an account the modern side lacks.
  const legacy = [
    ...modern.map((f) => (f.dimension === '1000' ? { ...f, value: f.value - 1500 } : f)),
    { diffType: 'TB_ACCOUNT' as const, dimension: '4500', value: 250 },
  ];
  const comparison = await s.comparisonService.createComparison({
    tenantId: TENANT, legalEntityId: LE, runId: run.runId, periodYear: 2025, periodMonth: 12,
    legacyFigures: legacy, legacySnapshotRef: 'LEGACY-TB-2025-12', actor: OPERATOR,
  });
  return { run, comparison };
}

describe('deriving the modern side', () => {
  it('reads the run\'s own converted TB rather than re-keying figures', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    const modern = await s.comparisonService.deriveModernFigures(TENANT, run.runId);
    expect(modern.map((f) => f.dimension).sort()).toEqual(['1000', '1200', '2000', '3000']);
    expect(modern.find((f) => f.dimension === '1000')!.value).toBeCloseTo(125000, 2);
    expect(modern.find((f) => f.dimension === '2000')!.value).toBeCloseTo(-61300.25, 2);
  });
});

describe('creating a comparison', () => {
  it('records zero differences when the two sides agree', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    const result = await s.comparisonService.createComparison({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, periodYear: 2025, periodMonth: 12,
      legacyFigures: await s.comparisonService.deriveModernFigures(TENANT, run.runId), actor: OPERATOR,
    });
    expect(result.totalDiffs).toBe(0);
    expect(result.unexplainedDiffs).toBe(0);
  });

  it('finds every difference and starts them all unexplained', async () => {
    const s = makeServices();
    const { comparison } = await comparisonWithDiffs(s);
    expect(comparison.totalDiffs).toBe(2);
    expect(comparison.unexplainedDiffs).toBe(2);
  });

  it('versions repeat comparisons of the same period instead of overwriting them', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    const figures = await s.comparisonService.deriveModernFigures(TENANT, run.runId);
    const first = await s.comparisonService.createComparison({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, periodYear: 2025, periodMonth: 12,
      legacyFigures: figures, actor: OPERATOR,
    });
    const second = await s.comparisonService.createComparison({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, periodYear: 2025, periodMonth: 12,
      legacyFigures: figures, actor: OPERATOR,
    });
    expect(first.comparisonVersion).toBe(1);
    expect(second.comparisonVersion).toBe(2);
    expect(second.comparisonRunId).not.toBe(first.comparisonRunId);
  });

  it('reports the CE-06 consolidation history status truthfully', async () => {
    const s = makeServices();
    const { comparison } = await comparisonWithDiffs(s);
    expect(comparison.consolidationHistory.status).toBe('PENDING_UPSTREAM_TECHNICAL_RECONCILIATION');
  });
});

describe('classifying differences', () => {
  it('records the classification, reason, and who made the call', async () => {
    const s = makeServices();
    const { comparison } = await comparisonWithDiffs(s);
    const { diffs } = await s.comparisonService.getComparison(TENANT, comparison.comparisonRunId);
    const { diff } = await s.comparisonService.classifyDiff({
      tenantId: TENANT, comparisonRunId: comparison.comparisonRunId, diffId: (diffs as any[])[0].id,
      classification: 'TIMING', reason: 'Legacy posted the December deposit in January', actor: CONTROLLER,
    });
    expect(diff.classification).toBe('TIMING');
    expect(diff.classifiedBy).toBe(CONTROLLER);
    expect(diff.classifiedAt).toBeTruthy();
  });

  it('refuses a classification with no explanation', async () => {
    const s = makeServices();
    const { comparison } = await comparisonWithDiffs(s);
    const { diffs } = await s.comparisonService.getComparison(TENANT, comparison.comparisonRunId);
    await expect(s.comparisonService.classifyDiff({
      tenantId: TENANT, comparisonRunId: comparison.comparisonRunId, diffId: (diffs as any[])[0].id,
      classification: 'MAPPING', reason: '  ', actor: CONTROLLER,
    })).rejects.toThrow(/explanation is required/i);
  });

  it('refuses an unrecognised classification', async () => {
    const s = makeServices();
    const { comparison } = await comparisonWithDiffs(s);
    const { diffs } = await s.comparisonService.getComparison(TENANT, comparison.comparisonRunId);
    await expect(s.comparisonService.classifyDiff({
      tenantId: TENANT, comparisonRunId: comparison.comparisonRunId, diffId: (diffs as any[])[0].id,
      classification: 'PROBABLY_FINE', reason: 'looks alright to me', actor: CONTROLLER,
    })).rejects.toThrow();
  });

  it('counts a classified but undispositioned difference as still unexplained', async () => {
    const s = makeServices();
    const { comparison } = await comparisonWithDiffs(s);
    const { diffs } = await s.comparisonService.getComparison(TENANT, comparison.comparisonRunId);
    await s.comparisonService.classifyDiff({
      tenantId: TENANT, comparisonRunId: comparison.comparisonRunId, diffId: (diffs as any[])[0].id,
      classification: 'TIMING', reason: 'Cut-off difference awaiting approval',
      disposition: 'PENDING', actor: CONTROLLER,
    });
    const { summary } = await s.comparisonService.getComparison(TENANT, comparison.comparisonRunId);
    expect(summary.unexplainedDiffs).toBe(2);
  });

  it('counts a classified and approved difference as explained', async () => {
    const s = makeServices();
    const { comparison } = await comparisonWithDiffs(s);
    const { diffs } = await s.comparisonService.getComparison(TENANT, comparison.comparisonRunId);
    await s.comparisonService.classifyDiff({
      tenantId: TENANT, comparisonRunId: comparison.comparisonRunId, diffId: (diffs as any[])[0].id,
      classification: 'TIMING', reason: 'Cut-off difference, agreed with controller',
      disposition: 'APPROVED', actor: CONTROLLER,
    });
    const { summary } = await s.comparisonService.getComparison(TENANT, comparison.comparisonRunId);
    expect(summary.explainedDiffs).toBe(1);
    expect(summary.unexplainedDiffs).toBe(1);
  });
});

describe('controller sign-off', () => {
  async function explainEverything(s: ReturnType<typeof makeServices>, comparisonRunId: string) {
    const { diffs } = await s.comparisonService.getComparison(TENANT, comparisonRunId);
    for (const diff of diffs as any[]) {
      await s.comparisonService.classifyDiff({
        tenantId: TENANT, comparisonRunId, diffId: diff.id,
        classification: diff.dimension === '4500' ? 'LEGACY_ERROR' : 'TIMING',
        reason: diff.dimension === '4500'
          ? 'Legacy suspense account 4500 was never a real balance'
          : 'Deposit in transit recognised in the following legacy period',
        disposition: 'APPROVED', actor: CONTROLLER,
      });
    }
  }

  it('blocks sign-off while any difference is unexplained', async () => {
    const s = makeServices();
    const { comparison } = await comparisonWithDiffs(s);
    await expect(s.comparisonService.signOff({
      tenantId: TENANT, comparisonRunId: comparison.comparisonRunId, actor: CONTROLLER,
    })).rejects.toThrow(/unexplained|undispositioned/i);
  });

  it('signs off once every difference is explained and dispositioned', async () => {
    const s = makeServices();
    const { comparison } = await comparisonWithDiffs(s);
    await explainEverything(s, comparison.comparisonRunId);
    const result = await s.comparisonService.signOff({
      tenantId: TENANT, comparisonRunId: comparison.comparisonRunId, actor: APPROVER,
    });
    expect(result.summary.exitCriterionMet).toBe(true);
    expect(result.comparison.state).toBe('SIGNED_OFF');
    expect(result.comparison.signedOffBy).toBe(APPROVER);
  });

  it('refuses sign-off by the operator who ran the comparison', async () => {
    const s = makeServices();
    const { comparison } = await comparisonWithDiffs(s);
    await explainEverything(s, comparison.comparisonRunId);
    await expect(s.comparisonService.signOff({
      tenantId: TENANT, comparisonRunId: comparison.comparisonRunId, actor: OPERATOR,
    })).rejects.toThrow(/may not also sign off/i);
  });

  it('moves the run to RECONCILED once every period is signed off', async () => {
    const s = makeServices();
    const { run, comparison } = await comparisonWithDiffs(s);
    await explainEverything(s, comparison.comparisonRunId);
    const result = await s.comparisonService.signOff({
      tenantId: TENANT, comparisonRunId: comparison.comparisonRunId, actor: CONTROLLER,
    });
    expect(result.cutoverRecommended).toBe(true);
    expect((await s.runService.get(TENANT, run.runId)).state).toBe('RECONCILED');
  });

  it('withholds the cutover recommendation while another period is still open', async () => {
    const s = makeServices();
    const { run, comparison } = await comparisonWithDiffs(s);
    const figures = await s.comparisonService.deriveModernFigures(TENANT, run.runId);
    await s.comparisonService.createComparison({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, periodYear: 2025, periodMonth: 11,
      legacyFigures: figures.map((f) => ({ ...f, value: f.value + 10 })), actor: OPERATOR,
    });
    await explainEverything(s, comparison.comparisonRunId);
    const result = await s.comparisonService.signOff({
      tenantId: TENANT, comparisonRunId: comparison.comparisonRunId, actor: CONTROLLER,
    });
    expect(result.cutoverRecommended).toBe(false);
    expect((await s.runService.get(TENANT, run.runId)).state).toBe('VALIDATED');
  });
});
