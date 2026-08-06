import 'reflect-metadata';
import { describe, it, expect } from 'vitest';

import { RoReportService } from '../../src/application/ro-report-service';
import { FakePrismaClient } from '../support/fake-prisma';

function makeService() {
  const prisma = new FakePrismaClient();
  const service = new RoReportService(prisma as any);
  return { prisma, service };
}

// The fake Prisma client's `include` is a no-op for nested relations (it has
// no real relation graph), so — exactly like a real Prisma `include` would —
// we attach `closeSubmissions`/`lines` directly onto the repairOrder row.
// `create()` returns the SAME object reference stored in the fake table, so
// mutating it here is visible to every later `findMany({ include })` call.
async function seedOpenRo(prisma: FakePrismaClient, overrides: Record<string, unknown>, submissions: Array<{ payTypeMix: string; lines: Array<{ category: string; saleAmount: string }> }>) {
  const ro = await (prisma as any).repairOrder.create({
    data: { tenantId: 't1', legalEntityId: 'le1', storeId: 's1', roNumber: 'RO-1', status: 'OPEN', openedAt: new Date('2026-07-01'), wipMode: 'WIP_MODE', ...overrides },
  });
  ro.closeSubmissions = submissions.map((s) => ({
    payTypeMix: s.payTypeMix,
    lines: s.lines.map((l) => ({ category: l.category, saleAmount: l.saleAmount })),
  }));
  return ro;
}

describe('RoReportService.openRoReport() — S061 open-RO / WIP report', () => {
  it('lists only OPEN/REOPENED ROs, with age in days and the last submission\'s accumulated value', async () => {
    const { prisma, service } = makeService();
    await seedOpenRo(prisma, { roNumber: 'RO-OPEN' }, [{ payTypeMix: 'C', lines: [{ category: 'LABOR', saleAmount: '100.00' }, { category: 'PARTS', saleAmount: '50.00' }] }]);
    await (prisma as any).repairOrder.create({ data: { tenantId: 't1', legalEntityId: 'le1', storeId: 's1', roNumber: 'RO-CLOSED', status: 'CLOSED', openedAt: new Date('2026-07-01') } });

    const { rows } = await service.openRoReport('t1');

    expect(rows).toHaveLength(1);
    expect(rows[0].roNumber).toBe('RO-OPEN');
    expect(rows[0].accumulatedValue).toBe(150);
    expect(rows[0].ageDays).toBeGreaterThanOrEqual(0);
  });

  it('includes REOPENED ROs alongside OPEN ones', async () => {
    const { prisma, service } = makeService();
    await seedOpenRo(prisma, { roNumber: 'RO-REOPENED', status: 'REOPENED' }, []);

    const { rows } = await service.openRoReport('t1');
    expect(rows).toHaveLength(1);
  });

  it('filters by storeId when provided', async () => {
    const { prisma, service } = makeService();
    await seedOpenRo(prisma, { roNumber: 'RO-S1', storeId: 's1' }, []);
    await seedOpenRo(prisma, { roNumber: 'RO-S2', storeId: 's2' }, []);

    const { rows } = await service.openRoReport('t1', 's1');
    expect(rows).toHaveLength(1);
    expect(rows[0].roNumber).toBe('RO-S1');
  });

  it('an open RO with no close submissions yet reports zero accumulated value, not a crash', async () => {
    const { prisma, service } = makeService();
    await seedOpenRo(prisma, { roNumber: 'RO-FRESH' }, []);

    const { rows } = await service.openRoReport('t1');
    expect(rows[0].accumulatedValue).toBe(0);
  });
});

describe('RoReportService.wipTieOut() — WIP-mode GL tie strip', () => {
  // wipTieOut's real query narrows `lines` to category=LABOR via a nested
  // Prisma `include...where` (see ro-report-service.ts) — this fake has no
  // nested-include filtering, so the fixture below seeds already-LABOR-only
  // lines to stand in for what that query would return; the DB-level
  // category filter itself is not exercised by this in-memory test, only
  // the aggregation/BALANCED-VARIANCE arithmetic that runs after it.
  it('sums LABOR-line values from WIP-mode open ROs into the report total', async () => {
    const { prisma, service } = makeService();
    await seedOpenRo(prisma, { roNumber: 'RO-WIP', wipMode: 'WIP_MODE' }, [{ payTypeMix: 'C', lines: [{ category: 'LABOR', saleAmount: '100.00' }] }]);

    const result = await service.wipTieOut('t1', 'le1', undefined, 100);

    expect(result.reportTotal).toBe(100);
    expect(result.status).toBe('BALANCED');
  });

  it('never includes a DIRECT_MODE RO in the WIP tie-out total', async () => {
    const { prisma, service } = makeService();
    await seedOpenRo(prisma, { roNumber: 'RO-DIRECT', wipMode: 'DIRECT_MODE' }, [{ payTypeMix: 'C', lines: [{ category: 'LABOR', saleAmount: '500.00' }] }]);

    const result = await service.wipTieOut('t1', 'le1', undefined, 0);
    expect(result.reportTotal).toBe(0);
  });

  it('renders GL_BALANCE_UNAVAILABLE (never a fabricated BALANCED) when no glWipBalance is supplied', async () => {
    const { prisma, service } = makeService();
    await seedOpenRo(prisma, { roNumber: 'RO-WIP' }, [{ payTypeMix: 'C', lines: [{ category: 'LABOR', saleAmount: '100.00' }] }]);

    const result = await service.wipTieOut('t1', 'le1', undefined, null);
    expect(result.status).toBe('GL_BALANCE_UNAVAILABLE');
    expect(result.glWipBalance).toBeNull();
  });

  it('renders VARIANCE (not BALANCED) when the report total and GL balance genuinely disagree', async () => {
    const { prisma, service } = makeService();
    await seedOpenRo(prisma, { roNumber: 'RO-WIP' }, [{ payTypeMix: 'C', lines: [{ category: 'LABOR', saleAmount: '100.00' }] }]);

    const result = await service.wipTieOut('t1', 'le1', undefined, 250);
    expect(result.status).toBe('VARIANCE');
    expect(result.reportTotal).toBe(100);
    expect(result.glWipBalance).toBe(250);
  });
});
