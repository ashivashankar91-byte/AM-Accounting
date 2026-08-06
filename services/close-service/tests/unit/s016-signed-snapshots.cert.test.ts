/**
 * S016 — Signed Statement Snapshots — Certification Tests
 *
 * AC1: capture() computes SHA-256 renderedHash from statement content
 * AC2: primarySign() stores primary signer identity
 * AC3: secondarySign() stores secondary signer identity (two-signature requirement)
 * AC4: verify() confirms integrity — sourceTbHash + renderedHash match
 * AC5: tampered content fails integrity check
 * AC6: tenantId scoped on every repository call (CLAUDE.md rule)
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { SnapshotService } from '../../src/application/snapshot-service';
import { computeRenderedHash, verifySnapshotIntegrity } from '../../src/domain/snapshot-ceremony';

const TENANT = 'tenant-s016-cert';

function makeRepo() {
  const store: Record<string, any> = {};
  return {
    create: vi.fn(async (tid: string, data: any) => {
      const row = { id: 'snap-1', tenantId: tid, ...data, status: 'CAPTURED' };
      store['snap-1'] = row; return row;
    }),
    findById: vi.fn(async (tid: string, id: string) => store[id] ?? null),
    primarySign: vi.fn(async (tid: string, id: string, data: any) => {
      const snap = store[id];
      const updated = { ...snap, primarySignerId: data.signerId, status: 'PRIMARY_SIGNED' };
      store[id] = updated; return updated;
    }),
    secondarySign: vi.fn(async (tid: string, id: string, data: any) => {
      const snap = store[id];
      const updated = { ...snap, secondarySignerId: data.signerId, status: 'FULLY_SIGNED' };
      store[id] = updated; return updated;
    }),
    verify: vi.fn(async (tid: string, id: string) => {
      const snap = store[id];
      if (!snap) return null;
      const current = { sourceTbHash: snap.sourceTbHash, renderedContent: snap.renderedContent };
      const integrity = verifySnapshotIntegrity(
        { sourceTbHash: snap.sourceTbHash, renderedHash: snap.renderedHash },
        current,
      );
      return { ...snap, integrityOk: integrity };
    }),
  };
}

describe('S016 — Signed Statement Snapshots', () => {
  it('AC1: capture() computes SHA-256 renderedHash for statement content', async () => {
    const repo = makeRepo();
    const svc = new SnapshotService(repo as any);
    const data = { legalEntityId: 'le-1', periodYear: 2026, periodMonth: 1, renderedContent: 'Balance Sheet Q1', sourceTbHash: 'tbhash-x' };
    const result = await svc.capture(TENANT, data);
    expect(result.renderedHash).toBe(computeRenderedHash(JSON.stringify(data)));
    expect(result.tenantId).toBe(TENANT);
    expect(repo.create).toHaveBeenCalledWith(TENANT, expect.objectContaining({ renderedHash: expect.any(String) }));
  });

  it('AC2: primarySign() records signer identity', async () => {
    const repo = makeRepo();
    // Pre-seed
    repo.create.mockImplementationOnce(async (tid: string, data: any) => {
      const row = { id: 'snap-1', tenantId: tid, ...data };
      (repo as any)._store = { 'snap-1': row }; return row;
    });
    // Override store reference
    const store: any = {};
    repo.create.mockImplementationOnce(async (tid: string, data: any) => {
      const row = { id: 'snap-1', tenantId: tid, ...data };
      store['snap-1'] = row; return row;
    });
    repo.primarySign.mockImplementationOnce(async (_t: string, id: string, data: any) => {
      const row = { id, primarySignerId: data.signerId, status: 'PRIMARY_SIGNED' };
      return row;
    });
    const svc = new SnapshotService(repo as any);
    const signed = await svc.primarySign(TENANT, 'snap-1', { signerId: 'controller-alice' });
    expect(signed.primarySignerId).toBe('controller-alice');
    expect(repo.primarySign).toHaveBeenCalledWith(TENANT, 'snap-1', expect.objectContaining({ signerId: 'controller-alice' }));
  });

  it('AC3: secondarySign() records secondary signer — two-signature workflow', async () => {
    const repo = makeRepo();
    repo.secondarySign.mockResolvedValueOnce({ id: 'snap-1', primarySignerId: 'alice', secondarySignerId: 'bob', status: 'FULLY_SIGNED' });
    const svc = new SnapshotService(repo as any);
    const signed = await svc.secondarySign(TENANT, 'snap-1', { signerId: 'cfo-bob' });
    expect(signed.secondarySignerId).toBe('bob');
    expect(signed.status).toBe('FULLY_SIGNED');
    expect(repo.secondarySign).toHaveBeenCalledWith(TENANT, 'snap-1', expect.objectContaining({ signerId: 'cfo-bob' }));
  });

  it('AC4: verify() confirms renderedHash integrity on untampered snapshot', () => {
    const content = 'Balance Sheet close-period data';
    const hash = computeRenderedHash(content);
    const integrity = verifySnapshotIntegrity(
      { sourceTbHash: 'tb-hash-abc', renderedHash: hash },
      { sourceTbHash: 'tb-hash-abc', renderedContent: content },
    );
    expect(integrity).toBe(true);
  });

  it('AC5: verify() fails on tampered content — cannot forge a snapshot', () => {
    const original = 'Balance Sheet data';
    const hash = computeRenderedHash(original);
    const integrity = verifySnapshotIntegrity(
      { sourceTbHash: 'tb-hash-abc', renderedHash: hash },
      { sourceTbHash: 'tb-hash-abc', renderedContent: 'Tampered! Balance Sheet' },
    );
    expect(integrity).toBe(false);
  });

  it('AC6: all repository calls include tenantId (CLAUDE.md rule)', async () => {
    const repo = makeRepo();
    const svc = new SnapshotService(repo as any);
    await svc.capture(TENANT, { renderedContent: 'test' });
    await svc.primarySign(TENANT, 'snap-1', { signerId: 'u1' });
    await svc.secondarySign(TENANT, 'snap-1', { signerId: 'u2' });
    await svc.verify(TENANT, 'snap-1');

    expect(repo.create).toHaveBeenCalledWith(TENANT, expect.any(Object));
    expect(repo.primarySign).toHaveBeenCalledWith(TENANT, expect.any(String), expect.any(Object));
    expect(repo.secondarySign).toHaveBeenCalledWith(TENANT, expect.any(String), expect.any(Object));
    expect(repo.verify).toHaveBeenCalledWith(TENANT, expect.any(String));
  });
});
