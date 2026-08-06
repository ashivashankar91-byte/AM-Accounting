import 'reflect-metadata';
/**
 * @test-suite TieOutService — S026 nightly GL-to-schedule tie-out
 *
 * @proves
 *   - runTieOut records MATCHED when schedule balance equals GL balance
 *   - runTieOut records DISCREPANCY (with signed variance) when they differ,
 *     and never mutates either side
 *   - runTieOut records GL_UNAVAILABLE (not MATCHED, not silently dropped)
 *     when gl-service is unreachable
 *   - runTieOut writes an audit_outbox row when a discrepancy is found
 *   - listTieOuts / getLatestRun delegate to the repository
 */

import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '.prisma/schedule-client';
import { TieOutService } from '../src/application/tie-out-service';

function dec(n: number | string) {
  return new Prisma.Decimal(n);
}

const TENANT = 'tenant-acme';

function makeDeps(overrides: Partial<any> = {}) {
  const scheduleRepo = { findAll: vi.fn().mockResolvedValue([{ scheduleNumber: '01' }]) };
  const openItemRepo = {
    sumRemainingBalanceByGlAccount: vi.fn().mockResolvedValue([{ glAccountNumber: '1200', totalRemaining: '150.00' }]),
  };
  const tieOutRepo = {
    create: vi.fn().mockImplementation((_t, dto) => Promise.resolve({ id: 'tie-1', ...dto })),
    list: vi.fn().mockResolvedValue([]),
    listByRun: vi.fn().mockResolvedValue([]),
    latestRunId: vi.fn().mockResolvedValue(null),
  };
  const glBalanceClient = { getEndingBalance: vi.fn().mockResolvedValue(150) };
  const prisma: any = { auditOutboxEvent: { create: vi.fn().mockResolvedValue({}) } };
  return { scheduleRepo, openItemRepo, tieOutRepo, glBalanceClient, prisma, ...overrides };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new TieOutService(
    deps.scheduleRepo as any,
    deps.openItemRepo as any,
    deps.tieOutRepo as any,
    deps.glBalanceClient as any,
    deps.prisma as any,
  );
}

describe('TieOutService.runTieOut', () => {
  it('records MATCHED when schedule and GL balances agree', async () => {
    const deps = makeDeps();
    const svc = makeService(deps);
    const { rows } = await svc.runTieOut(TENANT, new Date('2026-07-31'), 'ops-user');
    expect(rows).toHaveLength(1);
    expect(deps.tieOutRepo.create).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ status: 'MATCHED', scheduleNumber: '01', glAccountNumber: '1200' }),
    );
    expect(deps.prisma.auditOutboxEvent.create).not.toHaveBeenCalled();
  });

  it('records DISCREPANCY with signed variance and never mutates either balance', async () => {
    const deps = makeDeps({
      openItemRepo: { sumRemainingBalanceByGlAccount: vi.fn().mockResolvedValue([{ glAccountNumber: '1200', totalRemaining: '150.00' }]) },
      glBalanceClient: { getEndingBalance: vi.fn().mockResolvedValue(100) },
    });
    const svc = makeService(deps);
    const { rows } = await svc.runTieOut(TENANT, new Date('2026-07-31'), 'ops-user');
    expect(rows[0]).toMatchObject({ status: 'DISCREPANCY' });
    expect(deps.tieOutRepo.create).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({
        status: 'DISCREPANCY',
        scheduleBalance: expect.any(Prisma.Decimal),
        glBalance: expect.any(Prisma.Decimal),
        variance: expect.any(Prisma.Decimal),
      }),
    );
    // Persisted, not silently corrected: only a tie-out row and an audit
    // event are written — nothing touches scheduleOpenItem or GL.
    expect(deps.prisma.auditOutboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ docType: 'SCHEDULE_GL_TIE_OUT', action: 'DISCREPANCY_DETECTED' }),
      }),
    );
  });

  it('records GL_UNAVAILABLE when gl-service cannot be reached', async () => {
    const deps = makeDeps({
      glBalanceClient: { getEndingBalance: vi.fn().mockRejectedValue(new Error('gl-service /trial-balance returned 503')) },
    });
    const svc = makeService(deps);
    const { rows } = await svc.runTieOut(TENANT, new Date('2026-07-31'));
    expect(rows[0]).toMatchObject({ status: 'GL_UNAVAILABLE' });
    expect(deps.tieOutRepo.create).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ status: 'GL_UNAVAILABLE', glBalance: null, variance: null, glQueryError: expect.stringContaining('503') }),
    );
  });

  it('skips GL accounts with no linkage (null glAccountNumber)', async () => {
    const deps = makeDeps({
      openItemRepo: { sumRemainingBalanceByGlAccount: vi.fn().mockResolvedValue([{ glAccountNumber: null, totalRemaining: '10.00' }]) },
    });
    const svc = makeService(deps);
    const { rows } = await svc.runTieOut(TENANT, new Date('2026-07-31'));
    expect(rows).toHaveLength(0);
    expect(deps.tieOutRepo.create).not.toHaveBeenCalled();
  });
});

describe('TieOutService read-side', () => {
  it('listTieOuts delegates to the repository with filters', async () => {
    const deps = makeDeps();
    const svc = makeService(deps);
    await svc.listTieOuts(TENANT, { status: 'DISCREPANCY' });
    expect(deps.tieOutRepo.list).toHaveBeenCalledWith(TENANT, { status: 'DISCREPANCY' });
  });

  it('getLatestRun returns [] when no run has ever completed', async () => {
    const deps = makeDeps();
    const svc = makeService(deps);
    const rows = await svc.getLatestRun(TENANT);
    expect(rows).toEqual([]);
    expect(deps.tieOutRepo.listByRun).not.toHaveBeenCalled();
  });
});
