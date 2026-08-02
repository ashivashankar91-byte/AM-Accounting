/**
 * Every migration route is guarded server-side. These tests exercise the real
 * Fastify routes so a missing guard shows up here rather than in production.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  makeHttpHarness, call, signToken, HttpHarness, ALL_MIGRATION_PERMISSIONS,
} from '../helpers/http-harness';

const TENANT = 'tenant-ce16';
const LE = 'LE-CERT-001';
const USER = 'user-operator';

let harness: HttpHarness;
let token: string;

beforeEach(async () => {
  harness = await makeHttpHarness();
  token = signToken(USER, TENANT);
});

afterEach(async () => { await harness.close(); });

describe('authentication', () => {
  it('rejects a request with no bearer token', async () => {
    const res = await call(harness, { url: '/api/v1/migration/runs', tenantId: TENANT });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a forged token', async () => {
    const forged = signToken(USER, TENANT).slice(0, -4) + 'aaaa';
    const res = await call(harness, { url: '/api/v1/migration/runs', token: forged, tenantId: TENANT });
    expect(res.statusCode).toBe(401);
  });

  it('leaves the health endpoint open', async () => {
    const res = await call(harness, { url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ service: 'migration-service' });
  });
});

describe('permission gating', () => {
  const cases: { name: string; permission: string; method: 'GET' | 'POST' | 'PATCH'; url: string; payload?: unknown }[] = [
    { name: 'list runs', permission: 'migration.run.read', method: 'GET', url: '/api/v1/migration/runs' },
    { name: 'create run', permission: 'migration.run.create', method: 'POST', url: '/api/v1/migration/runs', payload: { legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1' } },
    { name: 'list sources', permission: 'migration.source.view', method: 'GET', url: '/api/v1/migration/sources' },
    { name: 'register source', permission: 'migration.source.register', method: 'POST', url: '/api/v1/migration/sources', payload: { systemCode: 'LEGACY', systemName: 'Legacy DMS', sourceType: 'AUTOMATE' } },
    { name: 'list mapping sets', permission: 'migration.mapping.view', method: 'GET', url: '/api/v1/migration/mapping-sets' },
    { name: 'view archive', permission: 'migration.audit.view', method: 'GET', url: '/api/v1/migration/archive' },
    { name: 'view runbooks', permission: 'migration.run.read', method: 'GET', url: '/api/v1/migration/runbooks' },
  ];

  for (const testCase of cases) {
    it(`denies ${testCase.name} without ${testCase.permission}`, async () => {
      const res = await call(harness, {
        method: testCase.method, url: testCase.url, token, tenantId: TENANT, legalEntityId: LE, payload: testCase.payload,
      });
      expect(res.statusCode).toBe(403);
    });

    it(`allows ${testCase.name} with ${testCase.permission}`, async () => {
      harness.authz.grant(USER, testCase.permission);
      const res = await call(harness, {
        method: testCase.method, url: testCase.url, token, tenantId: TENANT, legalEntityId: LE, payload: testCase.payload,
      });
      expect(res.statusCode).toBeLessThan(400);
    });
  }
});

describe('permission granularity', () => {
  it('does not let read permission stand in for write permission', async () => {
    harness.authz.grant(USER, 'migration.run.read');
    const res = await call(harness, {
      method: 'POST', url: '/api/v1/migration/runs', token, tenantId: TENANT, legalEntityId: LE,
      payload: { legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not let mapping.manage stand in for mapping.approve', async () => {
    harness.authz.grant(USER, 'migration.mapping.view', 'migration.mapping.manage', 'migration.source.register', 'migration.extract.import');
    const res = await call(harness, {
      method: 'POST', url: '/api/v1/migration/mapping-sets/mset-1/entries/entry-1/approve',
      token, tenantId: TENANT, legalEntityId: LE, payload: { note: 'looks fine' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not let cutover.prepare stand in for cutover.approve', async () => {
    harness.authz.grant(USER, 'migration.cutover.prepare');
    const res = await call(harness, {
      method: 'POST', url: '/api/v1/migration/runs/MIG-1/cutover/approve',
      token, tenantId: TENANT, legalEntityId: LE, payload: { acknowledgedStatement: 'x' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not let cutover.approve stand in for rollback.execute', async () => {
    harness.authz.grant(USER, 'migration.cutover.approve');
    const res = await call(harness, {
      method: 'POST', url: '/api/v1/migration/runs/MIG-1/rollback',
      token, tenantId: TENANT, legalEntityId: LE, payload: { reason: 'undoing the conversion' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('denies every guarded route to a user holding no permissions at all', async () => {
    const routes = [
      '/api/v1/migration/runs',
      '/api/v1/migration/sources',
      '/api/v1/migration/mapping-sets',
      '/api/v1/migration/archive',
      '/api/v1/migration/runbooks',
      '/api/v1/migration/runs/MIG-1/exceptions',
      '/api/v1/migration/runs/MIG-1/gates',
      '/api/v1/migration/runs/MIG-1/lineage',
    ];
    for (const url of routes) {
      const res = await call(harness, { url, token, tenantId: TENANT, legalEntityId: LE });
      expect({ url, status: res.statusCode }).toEqual({ url, status: 403 });
    }
  });
});

describe('fail-closed behaviour', () => {
  it('denies rather than allows when the authz service is unreachable', async () => {
    harness.authz.grant(USER, 'migration.run.read');
    harness.authz.fail = true;
    const res = await call(harness, { url: '/api/v1/migration/runs', token, tenantId: TENANT });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).not.toBe(200);
  });

  it('masks sensitive values rather than revealing them when the soft check cannot be answered', async () => {
    harness.authz.grant(USER, 'migration.source.register', 'migration.source.view', 'migration.extract.import', 'migration.extract.read');
    const created = await call(harness, {
      method: 'POST', url: '/api/v1/migration/sources', token, tenantId: TENANT, legalEntityId: LE,
      payload: { systemCode: 'LEGACY', systemName: 'Legacy DMS', sourceType: 'AUTOMATE' },
    });
    expect(created.statusCode).toBeLessThan(400);
    const systemId = created.json().id;

    await call(harness, {
      method: 'POST', url: `/api/v1/migration/sources/${systemId}/snapshots`, token, tenantId: TENANT, legalEntityId: LE,
      payload: {
        snapshotRef: 'SNAP-PERM-001',
        files: [{
          filename: 'tb.csv', checksumSha256: 'a'.repeat(64),
          rows: [{ accountCode: '1200', ssn: '123-45-6789', debit: '10.00', credit: '0.00' }],
        }],
      },
    });

    // The caller was never granted migration.sensitive.view, so the SSN must
    // come back masked even though the row itself is legitimately visible.
    const rows = await call(harness, {
      url: `/api/v1/migration/sources/${systemId}/snapshots/SNAP-PERM-001/rows`, token, tenantId: TENANT, legalEntityId: LE,
    });
    expect(rows.statusCode).toBe(200);
    expect(JSON.stringify(rows.json())).not.toContain('123-45-6789');
  });
});

describe('the permission catalog', () => {
  it('covers all 24 CE-16 keys', () => {
    expect(new Set(ALL_MIGRATION_PERMISSIONS).size).toBe(24);
  });

  it('grants a fully-privileged migration lead access to every guarded read route', async () => {
    harness.authz.grant(USER, ...ALL_MIGRATION_PERMISSIONS);
    for (const url of ['/api/v1/migration/runs', '/api/v1/migration/sources', '/api/v1/migration/mapping-sets', '/api/v1/migration/archive', '/api/v1/migration/runbooks']) {
      const res = await call(harness, { url, token, tenantId: TENANT, legalEntityId: LE });
      expect({ url, status: res.statusCode }).toEqual({ url, status: 200 });
    }
  });
});
