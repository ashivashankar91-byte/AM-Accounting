import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { legalEntityRoutes } from '../src/http/legal-entity-routes';
import { createFakeAuthzClient } from './support/fake-authz-client';
import { LEGAL_ENTITY_PERMISSIONS } from '../src/http/legal-entity-routes';

// ── JWT helper (mirrors @amacc/shared-kernel's HS256 scheme) ──────────────────

const JWT_SECRET = 'authz-test-secret';

function b64u(s: string): string {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// R0 Stabilization Phase 3: sub is now the role name itself. Permission
// decisions no longer come from the JWT's role claim (the central S207
// engine ignores it and resolves persisted role assignments by userId+scope
// instead — see fake-authz-client.ts) but the claim is kept on the token
// since JWTPayload still carries it for other legitimate uses, and reusing
// it as a stable per-test-case user id keeps every existing test's shape
// and intent unchanged.
function tokenFor(role: string, tenantId = 'tenant-a'): string {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ sub: role, tenantId, role, iat: now, exp: now + 3600 }));
  // NOTE: digest('base64url') directly — not digest('binary') fed through
  // Buffer.from() (which defaults to utf8 and corrupts bytes >= 0x80). This
  // matches shared-kernel's verifyJWT/createServiceToken fix (see auth.ts).
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function authed(role: string, tenantId = 'tenant-a') {
  return { 'x-tenant-id': tenantId, authorization: `Bearer ${tokenFor(role, tenantId)}` };
}

// Mirrors legal-entity-routes.ts's former local ROLE_PERMISSIONS stub exactly
// (now centralized in auth-service's catalog — see the R0 Stabilization
// migration); used here to drive the fake AuthzClient so this test still
// proves the same grant matrix, just resolved through the real guard shape.
const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN:      new Set([LEGAL_ENTITY_PERMISSIONS.VIEW, LEGAL_ENTITY_PERMISSIONS.MANAGE]),
  CONTROLLER: new Set([LEGAL_ENTITY_PERMISSIONS.VIEW, LEGAL_ENTITY_PERMISSIONS.MANAGE]),
  ACCOUNTANT: new Set([LEGAL_ENTITY_PERMISSIONS.VIEW]),
  SERVICE:    new Set([LEGAL_ENTITY_PERMISSIONS.VIEW, LEGAL_ENTITY_PERMISSIONS.MANAGE]),
};

// ── Fake service (route-layer test — business logic already covered elsewhere) ─

const FAKE_ENTITY = {
  id: 'le-1', tenantId: 'tenant-a', entityCode: 'ACME', legalName: 'Acme Corp',
  status: 'ACTIVE', version: 1, hasPostedJournals: false,
};

function fakeService() {
  return {
    list:                  async () => ({ items: [FAKE_ENTITY], total: 1, page: 1, pageSize: 50 }),
    getById:                async () => FAKE_ENTITY,
    create:                 async () => ({ entity: FAKE_ENTITY, warnDuplicateStatutoryId: false }),
    update:                 async () => ({ entity: FAKE_ENTITY, warnDuplicateStatutoryId: false }),
    deactivate:             async () => ({ ...FAKE_ENTITY, status: 'INACTIVE' }),
    markHasPostedJournals:  async () => undefined,
  };
}

const CREATE_PAYLOAD = {
  entityCode: 'X', legalName: 'X Corp', functionalCurrency: 'USD',
  country: 'US', fiscalYearEndMonth: 12, effectiveDate: '2025-01-01',
};

describe('Legal Entity route authorization (PRM200-1: deny-by-default acct.entity.view / acct.entity.manage)', () => {
  let app: FastifyInstance;
  const originalNodeEnv = process.env['NODE_ENV'];
  const originalJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeAll(async () => {
    // Force the "real" (non-dev-bypass) auth path so permission checks are actually exercised.
    process.env['NODE_ENV'] = 'test';
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;

    container.registerInstance('LegalEntityService', fakeService());
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
    await app.register(legalEntityRoutes, { prefix: '/api/v1/legal-entities' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    process.env['NODE_ENV'] = originalNodeEnv;
    process.env['AMACC_JWT_SECRET'] = originalJwtSecret;
  });

  it('rejects an unauthenticated request (no Authorization header) with 401 before any permission check', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/legal-entities',
      headers: { 'x-tenant-id': 'tenant-a' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('denies GET / (view) to an authenticated role with no granted permissions — deny-by-default', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/legal-entities',
      headers: authed('NO_PERMISSIONS_ROLE'),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'FORBIDDEN', message: expect.stringContaining('acct.entity.view') });
  });

  it('denies GET /:id (view) to an unknown role', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/legal-entities/le-1',
      headers: authed('UNKNOWN_ROLE'),
    });
    expect(res.statusCode).toBe(403);
  });

  it('denies GET /:id/audit (view) to an unknown role', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/legal-entities/le-1/audit',
      headers: authed('UNKNOWN_ROLE'),
    });
    expect(res.statusCode).toBe(403);
  });

  it('denies POST / (manage) to a view-only role (ACCOUNTANT)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/legal-entities',
      headers: authed('ACCOUNTANT'),
      payload: CREATE_PAYLOAD,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain('acct.entity.manage');
  });

  it('denies PUT /:id (manage) to an unknown role', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/legal-entities/le-1',
      headers: authed('RANDOM_ROLE'),
      payload: { version: 1, effectiveDate: '2025-01-01' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('denies POST /:id/deactivate (manage) to a view-only role', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/legal-entities/le-1/deactivate',
      headers: authed('ACCOUNTANT'),
      payload: { version: 1, reason: 'x', deactivatedBy: 'y' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('denies POST /:id/mark-posted (manage) to a view-only role', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/legal-entities/le-1/mark-posted',
      headers: authed('ACCOUNTANT'),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows GET / (view) for a view-only role (ACCOUNTANT)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/legal-entities',
      headers: authed('ACCOUNTANT'),
    });
    expect(res.statusCode).toBe(200);
  });

  it('allows POST / (manage) for ADMIN', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/legal-entities',
      headers: authed('ADMIN'),
      payload: CREATE_PAYLOAD,
    });
    expect(res.statusCode).toBe(201);
  });

  it('allows POST / (manage) for CONTROLLER', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/legal-entities',
      headers: authed('CONTROLLER'),
      payload: CREATE_PAYLOAD,
    });
    expect(res.statusCode).toBe(201);
  });

  it('allows POST /:id/mark-posted (manage) for the trusted SERVICE role (e.g. gl-service callback)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/legal-entities/le-1/mark-posted',
      headers: authed('SERVICE'),
      payload: {},
    });
    expect(res.statusCode).toBe(204);
  });

  it('still enforces tenant isolation: a permitted role without x-tenant-id gets 400, not data', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/legal-entities',
      headers: { authorization: `Bearer ${tokenFor('ADMIN')}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('still enforces tenant isolation: JWT tenantId / x-tenant-id header mismatch is rejected (403) even for ADMIN', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/legal-entities',
      headers: { 'x-tenant-id': 'tenant-b', authorization: `Bearer ${tokenFor('ADMIN', 'tenant-a')}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('cross-tenant negative (assignment-scope, distinct from the JWT/header check above): an ADMIN grant that only exists for tenant-a does not authorize the same user in tenant-c, even with a matching header+JWT tenantId', async () => {
    // A matching header+JWT tenantId means authMiddleware's own mismatch guard
    // passes — this exercises the central S207 engine's per-tenant assignment
    // scoping specifically (fake-authz-client's FakeAssignment.tenantId filter),
    // proving deny-by-default holds per-tenant, not just per-role-string. The
    // local stub this replaced had no concept of tenant scope at all: any JWT
    // bearing role:'ADMIN' was trusted for every tenant.
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/legal-entities',
      headers: { 'x-tenant-id': 'tenant-c', authorization: `Bearer ${tokenFor('ADMIN', 'tenant-c')}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'FORBIDDEN', reason: 'NO_MATCHING_ROLE' });
  });
});
