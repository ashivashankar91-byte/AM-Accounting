import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReplayReaperService } from '../src/application/replay-reaper-service';

function staleRow(overrides: Record<string, any> = {}) {
  return {
    id: 'dl-stuck-1',
    tenantId: 'tenant-a',
    status: 'REPLAY_IN_PROGRESS',
    version: 4,
    attemptCount: 1,
    replayLockAcquiredAt: new Date('2026-07-01T00:00:00.000Z'), // long ago
    ...overrides,
  };
}

function makeMockPrisma(rows: any[]) {
  const store = new Map<string, any>(rows.map((r) => [r.id, { ...r }]));
  const attempts: any[] = [];
  const transitions: any[] = [];
  const auditRows: any[] = [];

  const tx = {
    postingReplayAttempt: { create: vi.fn(async ({ data }: any) => { attempts.push(data); return data; }) },
    postingCaseTransition: { create: vi.fn(async ({ data }: any) => { transitions.push(data); return data; }) },
    postingRecoveryAuditReference: { create: vi.fn(async ({ data }: any) => { auditRows.push(data); return data; }) },
  };

  return {
    postingDeadLetter: {
      findMany: vi.fn(async ({ where }: any) => {
        return [...store.values()].filter(
          (r) => r.tenantId === where.tenantId && r.status === where.status && r.replayLockAcquiredAt < where.replayLockAcquiredAt.lt,
        );
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const current = store.get(where.id);
        if (
          !current ||
          current.tenantId !== where.tenantId ||
          current.status !== where.status ||
          !(current.replayLockAcquiredAt < where.replayLockAcquiredAt.lt)
        ) {
          return { count: 0 };
        }
        const next = { ...current };
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === 'object' && 'increment' in (v as any)) {
            next[k] = (current[k] ?? 0) + (v as any).increment;
          } else {
            next[k] = v;
          }
        }
        store.set(where.id, next);
        return { count: 1 };
      }),
    },
    $transaction: vi.fn(async (cb: any) => cb(tx)),
    _store: store,
    _attempts: attempts,
    _transitions: transitions,
    _auditRows: auditRows,
  };
}

describe('ReplayReaperService — crash/restart recovery (CE-07 integration)', () => {
  const NOW = new Date('2026-07-01T00:10:00.000Z'); // 10 min after the stale lock

  it('reclaims a case whose replay lock is older than the staleness threshold', async () => {
    const prisma = makeMockPrisma([staleRow()]);
    const svc = new ReplayReaperService(prisma as any);

    const result = await svc.reapStaleReplays('tenant-a', 'reaper', 5 * 60 * 1000, NOW);

    expect(result.reapedCaseIds).toEqual(['dl-stuck-1']);
    const row = prisma._store.get('dl-stuck-1');
    expect(row.status).toBe('AWAITING_CORRECTION');
    expect(row.replayLockAcquiredAt).toBeNull();
    expect(row.version).toBe(5); // incremented once by the reaper's CAS
    expect(row.attemptCount).toBe(2);

    expect(prisma._attempts).toHaveLength(1);
    expect(prisma._attempts[0]).toMatchObject({ attemptNumber: 2, status: 'TIMED_OUT' });
    expect(prisma._transitions).toHaveLength(1);
    expect(prisma._transitions[0]).toMatchObject({ fromStatus: 'REPLAY_IN_PROGRESS', toStatus: 'AWAITING_CORRECTION' });
    expect(prisma._auditRows).toHaveLength(1);
    expect(prisma._auditRows[0]).toMatchObject({ eventType: 'posting_recovery.replay_lock_reaped' });
  });

  it('never reclaims a lock younger than the staleness threshold (a genuinely in-flight replay)', async () => {
    const recent = staleRow({ id: 'dl-in-flight', replayLockAcquiredAt: new Date(NOW.getTime() - 30_000) }); // 30s old
    const prisma = makeMockPrisma([recent]);
    const svc = new ReplayReaperService(prisma as any);

    const result = await svc.reapStaleReplays('tenant-a', 'reaper', 5 * 60 * 1000, NOW);

    expect(result.reapedCaseIds).toEqual([]);
    expect(prisma._store.get('dl-in-flight').status).toBe('REPLAY_IN_PROGRESS');
    expect(prisma._attempts).toHaveLength(0);
  });

  it('ignores cases not in REPLAY_IN_PROGRESS at all (nothing to reap)', async () => {
    const resolved = staleRow({ id: 'dl-done', status: 'RESOLVED', replayLockAcquiredAt: null });
    const prisma = makeMockPrisma([resolved]);
    const svc = new ReplayReaperService(prisma as any);

    const result = await svc.reapStaleReplays('tenant-a', 'reaper', 5 * 60 * 1000, NOW);
    expect(result.reapedCaseIds).toEqual([]);
  });

  it('is tenant-scoped: a stale case in another tenant is never reaped', async () => {
    const otherTenant = staleRow({ id: 'dl-other-tenant', tenantId: 'tenant-b' });
    const prisma = makeMockPrisma([otherTenant]);
    const svc = new ReplayReaperService(prisma as any);

    const result = await svc.reapStaleReplays('tenant-a', 'reaper', 5 * 60 * 1000, NOW);
    expect(result.reapedCaseIds).toEqual([]);
    expect(prisma._store.get('dl-other-tenant').status).toBe('REPLAY_IN_PROGRESS');
  });

  it('race safety: skips a case that a concurrent legitimate replay completed between the scan and the reclaim UPDATE', async () => {
    const row = staleRow();
    const prisma = makeMockPrisma([row]);
    // Simulate the row completing (status changed away from REPLAY_IN_PROGRESS)
    // between findMany's read and updateMany's write — the CAS's WHERE
    // clause must then affect 0 rows, and the reaper must not fabricate a
    // TIMED_OUT attempt for a case that actually succeeded.
    const originalUpdateMany = prisma.postingDeadLetter.updateMany;
    prisma.postingDeadLetter.updateMany = vi.fn(async (args: any) => {
      prisma._store.set(row.id, { ...prisma._store.get(row.id), status: 'RESOLVED' });
      return originalUpdateMany(args);
    });

    const svc = new ReplayReaperService(prisma as any);
    const result = await svc.reapStaleReplays('tenant-a', 'reaper', 5 * 60 * 1000, NOW);

    expect(result.reapedCaseIds).toEqual([]);
    expect(prisma._attempts).toHaveLength(0);
    expect(prisma._store.get(row.id).status).toBe('RESOLVED');
  });

  it('defaults the staleness threshold to 5 minutes when not specified', async () => {
    const justUnder = staleRow({ id: 'dl-just-under', replayLockAcquiredAt: new Date(NOW.getTime() - (5 * 60 * 1000 - 1000)) });
    const prisma = makeMockPrisma([justUnder]);
    const svc = new ReplayReaperService(prisma as any);

    const result = await svc.reapStaleReplays('tenant-a', 'reaper', undefined as any, NOW);
    expect(result.reapedCaseIds).toEqual([]); // 4m59s old — not yet stale under the 5-minute default
  });
});
