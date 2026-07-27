/**
 * S206 — /iam Route Tests
 *
 * Exercises the HTTP contract via Fastify inject with fake RoleService + AuthzService.
 * Covers §9 status codes: 201 create, 409 retire-assigned (BR206-2), 201 assign,
 * 422 assign-outside-entity, 403 deny-by-default guard, 204 revoke.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { roleRoutes } from '../src/http/role-routes';
import {
  RoleInUseError,
  AssignmentScopeError,
  RoleValidationError,
  RoleNotFoundError,
} from '../src/application/role-service';

// ── JWT helper ────────────────────────────────────────────────────────────────
// FINAL-R0: role-routes.ts now requires a real verified JWT (authMiddleware) —
// the caller's identity comes from the JWT's `sub` claim, not a spoofable
// x-user-id header. See auth-service/src/http/role-routes.ts header comment.

const JWT_SECRET = 'role-routes-test-secret';
process.env['AMACC_JWT_SECRET'] = JWT_SECRET;

function b64u(s: string): string {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function tokenFor(userId: string, tenantId = 'tenant-a'): string {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ sub: userId, tenantId, iat: now, exp: now + 3600 }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function authed(userId = 'admin', tenantId = 'tenant-a') {
  return { 'x-tenant-id': tenantId, authorization: `Bearer ${tokenFor(userId, tenantId)}` };
}

// ── Fakes ─────────────────────────────────────────────────────────────────────

let allow: boolean;
let roleSvc: any;

const fakeAuthz = { check: async () => ({ allow, reason: allow ? 'GRANTED' : 'NO_MATCHING_ROLE' }) };

async function makeApp(): Promise<FastifyInstance> {
  container.clearInstances();
  container.registerInstance('AuthzService', fakeAuthz);
  container.registerInstance('RoleService', roleSvc);
  const app = Fastify();
  await app.register(roleRoutes, { prefix: '/api/v1/iam' });
  await app.ready();
  return app;
}

const H = authed('admin');

beforeEach(() => {
  allow = true;
  roleSvc = {
    listRoles: async () => [{ id: 'r1', key: 'ADMIN', name: 'Administrator', permissions: ['iam.role.view'], builtIn: true, status: 'ACTIVE' }],
    getRole: async () => ({ id: 'r1', key: 'ADMIN', name: 'Administrator', permissions: [], builtIn: true, status: 'ACTIVE' }),
    createRole: async (dto: any) => ({ id: 'r-new', key: 'SALES', name: dto.name, permissions: dto.permissions, builtIn: false, status: 'ACTIVE' }),
    updateRole: async () => ({ id: 'r1', key: 'ADMIN', name: 'Administrator', permissions: [], builtIn: true, status: 'ACTIVE' }),
    retireRole: async () => undefined,
    listAssignments: async () => [],
    grantAssignment: async (dto: any) => ({ id: 'a1', userId: dto.userId, roleId: dto.roleId, roleKey: 'ACCOUNTANT', entityId: dto.entityId, storeIds: dto.storeIds ?? [], allStores: dto.allStores ?? false, status: 'GRANTED' }),
    revokeAssignment: async () => undefined,
  };
});

// ── Roles ─────────────────────────────────────────────────────────────────────

describe('S206 · /iam/roles', () => {
  it('PRM206-1: 201 on create role', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/iam/roles', headers: H,
      payload: { name: 'Sales', permissions: ['acct.store.view'] } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Sales', builtIn: false });
  });

  it('PRM206-2: 403 deny-by-default when the guard denies', async () => {
    allow = false;
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/iam/roles', headers: H,
      payload: { name: 'Sales', permissions: ['acct.store.view'] } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN');
  });

  it('PRM206-3: 401 when no Authorization header (no verified JWT) is present', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/iam/roles' });   // no headers
    expect(res.statusCode).toBe(401);
  });

  it('FINAL-R0 defect closure: a spoofed x-user-id header with no real JWT is rejected, not trusted', async () => {
    const app = await makeApp();
    // Previously (pre-fix) this exact request would have been trusted as
    // userId="root-attacker" with zero proof of identity.
    const res = await app.inject({
      method: 'GET', url: '/api/v1/iam/roles',
      headers: { 'x-tenant-id': 'tenant-a', 'x-user-id': 'root-attacker' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('PRM206-4: 200 list roles', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/iam/roles', headers: H });
    expect(res.statusCode).toBe(200);
    expect(res.json().roles).toHaveLength(1);
  });

  it('PRM206-5: 400 on invalid create payload', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/iam/roles', headers: H,
      payload: { name: '', permissions: [] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
  });

  it('PRM206-6: 409 on retiring an assigned role (BR206-2)', async () => {
    roleSvc.retireRole = async () => { throw new RoleInUseError('r1'); };
    const app = await makeApp();
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/iam/roles/r1', headers: H });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('ROLE_IN_USE');
  });

  it('PRM206-7: 204 on retiring an unassigned role', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/iam/roles/r1', headers: H });
    expect(res.statusCode).toBe(204);
  });

  it('PRM206-8: 422 on role validation error (unknown permission)', async () => {
    roleSvc.createRole = async () => { throw new RoleValidationError('UNKNOWN_PERMISSION', 'bad'); };
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/iam/roles', headers: H,
      payload: { name: 'X', permissions: ['nope'] } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('UNKNOWN_PERMISSION');
  });

  it('PRM206-9: 404 when role not found', async () => {
    roleSvc.getRole = async () => { throw new RoleNotFoundError('missing'); };
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/iam/roles/missing', headers: H });
    expect(res.statusCode).toBe(404);
  });
});

// ── Assignments ───────────────────────────────────────────────────────────────

describe('S206 · /iam/role-assignments', () => {
  it('PRM206-10: 201 on grant assignment', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/iam/role-assignments', headers: H,
      payload: { userId: 'u1', roleId: 'r-acct', entityId: 'e1', storeIds: ['s1'] } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ userId: 'u1', roleKey: 'ACCOUNTANT' });
  });

  it('PRM206-11: 422 on assigning outside the tenant entity (AC negative)', async () => {
    roleSvc.grantAssignment = async () => { throw new AssignmentScopeError('ENTITY_OUTSIDE_TENANT', 'nope'); };
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/iam/role-assignments', headers: H,
      payload: { userId: 'u1', roleId: 'r-acct', entityId: 'e-other', allStores: true } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('ENTITY_OUTSIDE_TENANT');
  });

  it('PRM206-12: 204 on revoke assignment', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/iam/role-assignments/a1', headers: H });
    expect(res.statusCode).toBe(204);
  });
});
