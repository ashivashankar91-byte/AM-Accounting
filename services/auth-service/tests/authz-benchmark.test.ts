/**
 * S207 — Check p99 Benchmark (BR207-2)
 *
 * Warms the cache, then measures check() latency across many cached calls and
 * asserts the p99 stays within the proposed target. Uses an in-memory Prisma
 * mock so the measurement reflects the authz logic + cache path, not DB I/O.
 */

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { container } from 'tsyringe';
import { AuthzService } from '../src/application/authz-service';

const TENANT = 'tenant-bench';
const USER = 'user-bench';

function makePrisma() {
  const perms = ['acct.store.view', 'acct.store.manage', 'je.post'];
  return {
    permission: { findMany: async (a: any = {}) => perms.map((k) => (a.select?.key ? { key: k } : { key: k, description: '', sinceVersion: '1.0.0', status: 'SHIPPED' })) },
    rolePermission: { findMany: async () => perms.map((k) => ({ role: 'ADMIN', permissionKey: k })) },
    authzRoleAssignment: { findMany: async () => [{ tenantId: TENANT, userId: USER, role: 'ADMIN', entityId: null, storeId: null }] },
    catalogVersion: { findUnique: async () => ({ version: '1.0.0', releasedAt: new Date() }), findMany: async () => [{ version: '1.0.0', releasedAt: new Date() }] },
    authzOutboxEvent: { create: async () => ({}) },
  } as any;
}

function makeSvc() {
  container.clearInstances();
  container.registerInstance('PrismaClient', makePrisma());
  container.registerInstance('IEventPublisher', { publish: async () => {} } as any);
  container.register('AuthzService', { useClass: AuthzService });
  return container.resolve<AuthzService>('AuthzService');
}

describe('AuthzService check — p99 benchmark (BR207-2)', () => {
  it('cached check p99 stays within proposed target', async () => {
    const svc = makeSvc();
    const req = { userId: USER, permissionKey: 'acct.store.view', scope: { tenantId: TENANT } };

    // Warm the cache.
    for (let i = 0; i < 50; i++) await svc.check(req);

    const N = 2000;
    const samples: number[] = new Array(N);
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      await svc.check(req);
      samples[i] = performance.now() - t0;
    }
    samples.sort((a, b) => a - b);
    const p99 = samples[Math.floor(N * 0.99)];

    // Proposed target is <10 ms cached; allow generous CI headroom (25 ms) so the
    // benchmark is meaningful but not flaky on shared runners.
    expect(p99).toBeLessThan(25);
  });
});
