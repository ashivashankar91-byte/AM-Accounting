/**
 * S207 — /authz Route Tests
 *
 * Exercises the HTTP contract via Fastify inject with a fake AuthzService.
 * Covers §9 status-code mapping: 200 check, 400 unknown-permission, 200 catalog,
 * 404 unknown-version, 403 catalog guard.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { authzRoutes } from '../src/http/authz-routes';
import { UnknownPermissionError, CatalogVersionNotFoundError } from '../src/application/authz-service';

// ── Fake service with injectable behavior ─────────────────────────────────────

let checkBehavior: (req: any) => any;
let catalogBehavior: (opts: any) => any;

const fakeAuthz = {
  check: async (req: any) => checkBehavior(req),
  catalog: async (opts: any) => catalogBehavior(opts),
};

async function makeApp(): Promise<FastifyInstance> {
  container.clearInstances();
  container.registerInstance('AuthzService', fakeAuthz);
  const app = Fastify();
  await app.register(authzRoutes, { prefix: '/api/v1/authz' });
  await app.ready();
  return app;
}

beforeEach(() => {
  checkBehavior = () => ({ allow: false, reason: 'NO_MATCHING_ROLE' });
  catalogBehavior = () => ({ version: '1.0.0', releasedAt: new Date().toISOString(), permissions: [] });
});

// ── check ─────────────────────────────────────────────────────────────────────

describe('GET /authz/check', () => {
  it('PRM207-1: 200 with allow=true when granted', async () => {
    checkBehavior = () => ({ allow: true, matchedRole: 'ADMIN', reason: 'GRANTED' });
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/authz/check?user=u1&permission=acct.store.view&tenant=t1' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ allow: true, matchedRole: 'ADMIN' });
  });

  it('PRM207-2: 200 with allow=false when denied', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/authz/check?user=u1&permission=acct.store.view&tenant=t1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().allow).toBe(false);
  });

  it('PRM207-3: 400 on unknown permission key', async () => {
    checkBehavior = () => { throw new UnknownPermissionError('acct.store.boom'); };
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/authz/check?user=u1&permission=acct.store.boom&tenant=t1' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('UNKNOWN_PERMISSION');
  });

  it('PRM207-4: 400 on missing required query params', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/authz/check?user=u1' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_REQUEST');
  });

  it('PRM207-5: passes entity+store scope through', async () => {
    let captured: any;
    checkBehavior = (req) => { captured = req; return { allow: true, matchedRole: 'ADMIN', reason: 'GRANTED' }; };
    const app = await makeApp();
    await app.inject({ method: 'GET', url: '/api/v1/authz/check?user=u1&permission=acct.store.view&tenant=t1&entity=e1&store=s1' });
    expect(captured.scope).toMatchObject({ tenantId: 't1', entityId: 'e1', storeId: 's1' });
  });
});

// ── catalog ─────────────────────────────────────────────────────────────────

describe('GET /authz/catalog', () => {
  it('PRM207-6: 200 versioned list', async () => {
    catalogBehavior = () => ({ version: '1.0.0', releasedAt: new Date().toISOString(), permissions: [{ key: 'je.post', description: 'x', sinceVersion: '1.0.0', status: 'SHIPPED' }] });
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/authz/catalog' });
    expect(res.statusCode).toBe(200);
    expect(res.json().permissions[0].key).toBe('je.post');
  });

  it('PRM207-7: 200 with diff report', async () => {
    catalogBehavior = (opts) => ({ version: '1.1.0', releasedAt: new Date().toISOString(), permissions: [], diff: { fromVersion: opts.diffFrom, toVersion: '1.1.0', added: ['je.post'], removed: [], unchanged: 5 } });
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/authz/catalog?diffFrom=1.0.0' });
    expect(res.statusCode).toBe(200);
    expect(res.json().diff.added).toEqual(['je.post']);
  });

  it('PRM207-8: 404 on unknown version', async () => {
    catalogBehavior = () => { throw new CatalogVersionNotFoundError('9.9.9'); };
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/authz/catalog?version=9.9.9' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('VERSION_NOT_FOUND');
  });

  it('PRM207-9: 403 when user context lacks iam.catalog.view', async () => {
    checkBehavior = () => ({ allow: false, reason: 'NO_MATCHING_ROLE' });
    const app = await makeApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/authz/catalog',
      headers: { 'x-user-id': 'u1', 'x-tenant-id': 't1' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('PRM207-10: 200 when user context holds iam.catalog.view', async () => {
    checkBehavior = () => ({ allow: true, matchedRole: 'ADMIN', reason: 'GRANTED' });
    const app = await makeApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/authz/catalog',
      headers: { 'x-user-id': 'u1', 'x-tenant-id': 't1' },
    });
    expect(res.statusCode).toBe(200);
  });
});
