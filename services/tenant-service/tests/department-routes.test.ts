/**
 * S203 — Department Route Authorization Tests
 *
 * Tests the HTTP layer: authentication, authorization (RBAC), and
 * basic happy-path responses. Uses a Fastify app with a fake DepartmentService.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { departmentRoutes, DEPT_PERMISSIONS } from '../src/http/department-routes';
import { createFakeAuthzClient } from './support/fake-authz-client';

// ── JWT helper ────────────────────────────────────────────────────────────────

const JWT_SECRET = 'dept-authz-test-secret';

function b64u(s: string): string {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN:      new Set([DEPT_PERMISSIONS.VIEW, DEPT_PERMISSIONS.MANAGE]),
  CONTROLLER: new Set([DEPT_PERMISSIONS.VIEW, DEPT_PERMISSIONS.MANAGE]),
  ACCOUNTANT: new Set([DEPT_PERMISSIONS.VIEW]),
  SERVICE:    new Set([DEPT_PERMISSIONS.VIEW, DEPT_PERMISSIONS.MANAGE]),
};

// R0 Stabilization Phase 3: sub is the role name — see legal-entity-authz.test.ts
// for why (the central S207 engine resolves persisted assignments by userId,
// not the JWT role claim).
function tokenFor(role: string, tenantId = 'tenant-a'): string {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now    = Math.floor(Date.now() / 1000);
  const body   = b64u(JSON.stringify({ sub: role, tenantId, role, iat: now, exp: now + 3600 }));
  const sig    = Buffer.from(
    crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('binary'),
  ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${header}.${body}.${sig}`;
}

function authed(role: string, tenantId = 'tenant-a') {
  return { 'x-tenant-id': tenantId, authorization: `Bearer ${tokenFor(role, tenantId)}` };
}

// ── Fake service ──────────────────────────────────────────────────────────────

const ENTITY_ID = 'entity-001';
const DEPT_ID   = 'dept-001';

const FAKE_DEPT = {
  id:                 DEPT_ID,
  tenantId:           'tenant-a',
  entityId:           ENTITY_ID,
  code:               '21',
  name:               'EV Service',
  canonical:          false,
  status:             'ACTIVE',
  version:            1,
  deactivatedAt:      null,
  deactivatedBy:      null,
  deactivationReason: null,
  createdAt:          new Date().toISOString(),
  updatedAt:          new Date().toISOString(),
};

function fakeDeptService() {
  return {
    list:          async () => ({ items: [FAKE_DEPT], total: 1, page: 1, pageSize: 50 }),
    getById:       async () => FAKE_DEPT,
    create:        async () => FAKE_DEPT,
    update:        async () => FAKE_DEPT,
    deactivate:    async () => ({ ...FAKE_DEPT, status: 'INACTIVE' }),
    seedCanonical: async () => ({ seeded: 12, skipped: 0 }),
  };
}

const CREATE_PAYLOAD = { code: '21', name: 'EV Service' };

const BASE_URL = `/api/v1/entities/${ENTITY_ID}/departments`;

describe('Department route authorization (S203 RBAC)', () => {
  let app: FastifyInstance;
  const origNodeEnv    = process.env['NODE_ENV'];
  const origJwtSecret  = process.env['AMACC_JWT_SECRET'];

  beforeAll(async () => {
    process.env['NODE_ENV']         = 'test';
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;

    container.registerInstance('DepartmentService', fakeDeptService());
    container.registerInstance('AuthzClient', createFakeAuthzClient(
      [
        { userId: 'ADMIN',      tenantId: 'tenant-a', role: 'ADMIN' },
        { userId: 'CONTROLLER', tenantId: 'tenant-a', role: 'CONTROLLER' },
        { userId: 'ACCOUNTANT', tenantId: 'tenant-a', role: 'ACCOUNTANT' },
        { userId: 'SERVICE',    tenantId: 'tenant-a', role: 'SERVICE' },
      ],
      ROLE_GRANTS,
    ));

    app = Fastify();
    await app.register(departmentRoutes, { prefix: '/api/v1/entities' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    process.env['NODE_ENV']         = origNodeEnv;
    process.env['AMACC_JWT_SECRET'] = origJwtSecret;
  });

  // ── Unauthenticated ───────────────────────────────────────────────────────

  it('PRM203-1: rejects unauthenticated GET list with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: BASE_URL,
      headers: { 'x-tenant-id': 'tenant-a' },
    });
    expect(res.statusCode).toBe(401);
  });

  // ── Missing tenant header ─────────────────────────────────────────────────

  it('PRM203-2: returns 400 when x-tenant-id header is missing', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     BASE_URL,
      headers: { authorization: `Bearer ${tokenFor('ADMIN')}` },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── Unknown role (deny-by-default) ────────────────────────────────────────

  it('PRM203-3: denies GET list to an unknown role', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     BASE_URL,
      headers: authed('UNKNOWN_ROLE'),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'FORBIDDEN', message: expect.stringContaining('acct.dept.view') });
  });

  // ── ACCOUNTANT: view-only ─────────────────────────────────────────────────

  it('PRM203-4: denies POST to ACCOUNTANT role (view-only)', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     BASE_URL,
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      body:    JSON.stringify(CREATE_PAYLOAD),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'FORBIDDEN', message: expect.stringContaining('acct.dept.manage') });
  });

  it('PRM203-5: allows ACCOUNTANT to GET list (acct.dept.view)', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     BASE_URL,
      headers: authed('ACCOUNTANT'),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ items: expect.any(Array), total: 1 });
  });

  it('PRM203-6: allows ACCOUNTANT to GET by id (acct.dept.view)', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     `${BASE_URL}/${DEPT_ID}`,
      headers: authed('ACCOUNTANT'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: DEPT_ID, code: '21' });
  });

  // ── ADMIN: full manage access ─────────────────────────────────────────────

  it('PRM203-7: allows ADMIN to POST create (acct.dept.manage)', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     BASE_URL,
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      body:    JSON.stringify(CREATE_PAYLOAD),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: DEPT_ID, code: '21' });
  });

  it('PRM203-8: allows ADMIN to PUT update (acct.dept.manage)', async () => {
    const res = await app.inject({
      method:  'PUT',
      url:     `${BASE_URL}/${DEPT_ID}`,
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      body:    JSON.stringify({ version: 1, name: 'Updated Name' }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('PRM203-9: allows ADMIN to POST deactivate (acct.dept.manage)', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     `${BASE_URL}/${DEPT_ID}/deactivate`,
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      body:    JSON.stringify({ version: 1, reason: 'Consolidation', deactivatedBy: 'admin' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'INACTIVE' });
  });

  // ── JWT tenant mismatch ───────────────────────────────────────────────────

  it('PRM203-10: denies when JWT tenantId does not match x-tenant-id header', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     BASE_URL,
      headers: {
        'x-tenant-id':  'tenant-b',                          // header says B
        authorization:  `Bearer ${tokenFor('ADMIN', 'tenant-a')}`, // JWT says A
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('cross-tenant negative (assignment-scope, distinct from the JWT/header check above): an ADMIN grant that only exists for tenant-a does not authorize the same user in tenant-c, even with a matching header+JWT tenantId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: BASE_URL,
      headers: { 'x-tenant-id': 'tenant-c', authorization: `Bearer ${tokenFor('ADMIN', 'tenant-c')}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'FORBIDDEN', reason: 'NO_MATCHING_ROLE' });
  });
});
