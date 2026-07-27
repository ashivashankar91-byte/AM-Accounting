/**
 * S202 — Org Tree Route Authorization Tests (PRM202)
 *
 * HTTP layer: authentication, RBAC (org.tree.view / org.tree.manage),
 * error mapping (422 BR202-1/validation, 404 not-found), CSV export
 * content-type, and route-level cross-tenant denial.
 * Uses a Fastify app with a fake OrgService (matching franchise-routes.test.ts's
 * established pattern for this service).
 */

import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { orgRoutes, ORG_PERMISSIONS } from '../src/http/org-routes';
import {
  OrgValidationError as SvcValidationError,
  OrgNodeNotFoundError as SvcNotFoundError,
} from '../src/application/org-service';
import { createFakeAuthzClient } from './support/fake-authz-client';

const JWT_SECRET = 'org-authz-test-secret';

function b64u(s: string): string {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function tokenFor(role: string, tenantId = 'tenant-a'): string {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ sub: role, tenantId, role, iat: now, exp: now + 3600 }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function authed(role: string, tenantId = 'tenant-a') {
  return { 'x-tenant-id': tenantId, authorization: `Bearer ${tokenFor(role, tenantId)}` };
}

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN:      new Set([ORG_PERMISSIONS.VIEW, ORG_PERMISSIONS.MANAGE]),
  CONTROLLER: new Set([ORG_PERMISSIONS.VIEW, ORG_PERMISSIONS.MANAGE]),
  ACCOUNTANT: new Set([ORG_PERMISSIONS.VIEW]),
};

const FAKE_TREE = {
  type: 'GROUP', id: 'GROUP:tenant-a', code: 'tenant-a', name: 'Organization',
  status: 'ACTIVE', effectiveFrom: null, effectiveTo: null,
  children: [
    {
      type: 'ENTITY', id: 'e1', code: 'E1', name: 'Entity One', status: 'ACTIVE',
      effectiveFrom: '2026-01-01', effectiveTo: null,
      children: [
        {
          type: 'STORE', id: 's1', code: 'S1', name: 'Store One', status: 'ACTIVE',
          effectiveFrom: null, effectiveTo: null, children: [],
        },
      ],
    },
  ],
};

let reparentBehavior: () => Promise<any> = async () => ({
  nodeType: 'STORE', nodeId: 's1', oldParentId: 'e1', newParentId: 'e2', effectiveFrom: '2026-02-01',
});

function fakeOrgService() {
  return {
    getTree: async () => FAKE_TREE,
    toCsvRows: async (tree: any) => [{ type: tree.type, id: tree.id, parentId: null, code: tree.code, name: tree.name, status: tree.status, effectiveFrom: null, effectiveTo: null }],
    reparent: async () => reparentBehavior(),
  };
}

const TREE_URL = '/api/v1/org/tree';
const REPARENT_URL = '/api/v1/org/tree:reparent';
const REPARENT_PAYLOAD = { nodeType: 'STORE', nodeId: 's1', newParentId: 'e2', effectiveFrom: '2026-02-01' };

describe('Org tree route authorization (S202 PRM202)', () => {
  let app: FastifyInstance;
  const origNodeEnv = process.env['NODE_ENV'];
  const origJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;
    container.registerInstance('OrgService', fakeOrgService());
    container.registerInstance('AuthzClient', createFakeAuthzClient(
      [
        { userId: 'ADMIN', tenantId: 'tenant-a', role: 'ADMIN' },
        { userId: 'CONTROLLER', tenantId: 'tenant-a', role: 'CONTROLLER' },
        { userId: 'ACCOUNTANT', tenantId: 'tenant-a', role: 'ACCOUNTANT' },
      ],
      ROLE_GRANTS,
    ));
    app = Fastify();
    await app.register(orgRoutes, { prefix: '/api/v1/org' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    process.env['NODE_ENV'] = origNodeEnv;
    process.env['AMACC_JWT_SECRET'] = origJwtSecret;
    reparentBehavior = async () => ({
      nodeType: 'STORE', nodeId: 's1', oldParentId: 'e1', newParentId: 'e2', effectiveFrom: '2026-02-01',
    });
  });

  it('PRM202-1: rejects unauthenticated GET tree with 401', async () => {
    const res = await app.inject({ method: 'GET', url: TREE_URL, headers: { 'x-tenant-id': 'tenant-a' } });
    expect(res.statusCode).toBe(401);
  });

  it('PRM202-2: 400 when x-tenant-id header is missing', async () => {
    const res = await app.inject({ method: 'GET', url: TREE_URL, headers: { authorization: `Bearer ${tokenFor('ADMIN')}` } });
    expect(res.statusCode).toBe(400);
  });

  it('PRM202-3: denies GET tree to an unknown/unassigned role (403)', async () => {
    const res = await app.inject({ method: 'GET', url: TREE_URL, headers: authed('MECHANIC') });
    expect(res.statusCode).toBe(403);
  });

  it('PRM202-4: ACCOUNTANT may view the tree → 200, nested nodes present', async () => {
    const res = await app.inject({ method: 'GET', url: TREE_URL, headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
    expect(res.json().type).toBe('GROUP');
    expect(res.json().children[0].children[0].id).toBe('s1');
  });

  it('PRM202-5: ACCOUNTANT (view-only) is denied re-parent → 403', async () => {
    const res = await app.inject({ method: 'POST', url: REPARENT_URL, headers: authed('ACCOUNTANT'), payload: REPARENT_PAYLOAD });
    expect(res.statusCode).toBe(403);
  });

  it('PRM202-6: CONTROLLER may re-parent → 200', async () => {
    const res = await app.inject({ method: 'POST', url: REPARENT_URL, headers: authed('CONTROLLER'), payload: REPARENT_PAYLOAD });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ oldParentId: 'e1', newParentId: 'e2' });
  });

  it('PRM202-7: BR202-1 cycle rejection surfaces as 422', async () => {
    reparentBehavior = async () => { throw new SvcValidationError('BR202-1', 'cycle'); };
    const res = await app.inject({ method: 'POST', url: REPARENT_URL, headers: authed('ADMIN'), payload: REPARENT_PAYLOAD });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('BR202-1');
  });

  it('PRM202-8: re-parenting an unknown node surfaces as 404', async () => {
    reparentBehavior = async () => { throw new SvcNotFoundError('Store', 'no-such-store'); };
    const res = await app.inject({ method: 'POST', url: REPARENT_URL, headers: authed('ADMIN'), payload: REPARENT_PAYLOAD });
    expect(res.statusCode).toBe(404);
  });

  it('PRM202-9: BR202-3 CSV export returns text/csv content-type with the same tree data', async () => {
    const res = await app.inject({ method: 'GET', url: `${TREE_URL}?format=csv`, headers: authed('ADMIN') });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('GROUP,GROUP:tenant-a');
  });

  it('PRM202-10: cross-tenant header is rejected before reaching the service (401/403 boundary via JWT tenant mismatch)', async () => {
    // A token minted for tenant-a used against a tenant-b header must not be
    // treated as tenant-b-authorized (authMiddleware's own tenant-consistency
    // check, exercised here rather than re-implemented).
    const res = await app.inject({
      method: 'GET', url: TREE_URL,
      headers: { 'x-tenant-id': 'tenant-b', authorization: `Bearer ${tokenFor('ADMIN', 'tenant-a')}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
