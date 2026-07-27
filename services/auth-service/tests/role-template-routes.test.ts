/**
 * S004A — /iam/role-templates Route Tests
 *
 * Exercises the HTTP contract via Fastify inject with a fake RoleTemplateService
 * + fake AuthzService (real JWT verification via authMiddleware, matching the
 * S206 role-routes.ts hardening — see that file's test header).
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { roleTemplateRoutes } from '../src/http/role-template-routes';
import {
  RoleTemplateNotFoundError,
  RoleTemplateValidationError,
  RoleTemplateInUseError,
  SelfApplyForbiddenError,
} from '../src/application/role-template-service';

const JWT_SECRET = 'role-template-routes-test-secret';
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

let allow: boolean;
let svc: any;

const fakeAuthz = { check: async () => ({ allow, reason: allow ? 'GRANTED' : 'NO_MATCHING_ROLE' }) };

async function makeApp(): Promise<FastifyInstance> {
  container.clearInstances();
  container.registerInstance('AuthzService', fakeAuthz);
  container.registerInstance('RoleTemplateService', svc);
  const app = Fastify();
  await app.register(roleTemplateRoutes, { prefix: '/api/v1/iam' });
  await app.ready();
  return app;
}

const H = authed('admin');

beforeEach(() => {
  allow = true;
  svc = {
    listTemplates: async () => [{ id: 't1', tenantId: null, key: 'CASHIER', name: 'Cashier', permissions: ['ar.receipt.create'], fieldMasks: [], builtIn: true, status: 'ACTIVE', clonedFromId: null }],
    getTemplate: async () => ({ id: 't1', tenantId: null, key: 'CASHIER', name: 'Cashier', permissions: ['ar.receipt.create'], fieldMasks: [], builtIn: true, status: 'ACTIVE', clonedFromId: null }),
    createTemplate: async (dto: any) => ({ id: 't-new', tenantId: dto.tenantId, key: dto.key ?? 'CASHIER', name: dto.name, permissions: dto.permissions ?? ['ar.receipt.create'], fieldMasks: dto.fieldMasks ?? [], builtIn: false, status: 'ACTIVE', clonedFromId: dto.sourceTemplateId ?? null }),
    cloneTemplate: async (_t: string, sourceId: string, name: string) => ({ id: 't-clone', tenantId: 'tenant-a', key: 'CASHIER', name, permissions: ['ar.receipt.create'], fieldMasks: [], builtIn: false, status: 'ACTIVE', clonedFromId: sourceId }),
    updateTemplate: async () => ({ id: 't1', tenantId: 'tenant-a', key: 'CASHIER', name: 'Renamed', permissions: ['ar.receipt.create'], fieldMasks: [], builtIn: false, status: 'ACTIVE', clonedFromId: null }),
    deactivateTemplate: async () => undefined,
    applyTemplate: async (dto: any) => ({ id: 'ta-1', templateId: dto.templateId, templateKey: 'CASHIER', userId: dto.userId, roleAssignmentId: 'a1', entityId: dto.entityId, storeIds: dto.storeIds ?? [], allStores: dto.allStores ?? false, status: 'APPLIED' }),
    listAssignments: async () => [],
    revokeAssignment: async () => undefined,
  };
});

// ── Templates ─────────────────────────────────────────────────────────────────

describe('S004A · /iam/role-templates', () => {
  it('200 list templates', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/iam/role-templates', headers: H });
    expect(res.statusCode).toBe(200);
    expect(res.json().templates).toHaveLength(1);
  });

  it('401 when no verified JWT is present', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/iam/role-templates' });
    expect(res.statusCode).toBe(401);
  });

  it('403 deny-by-default when the S207 guard denies', async () => {
    allow = false;
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/iam/role-templates', headers: H });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN');
  });

  it('201 on create template', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/iam/role-templates', headers: H,
      payload: { name: 'Custom Biller', key: 'BILLER', permissions: ['acct.store.view'] } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Custom Biller', key: 'BILLER' });
  });

  it('400 on invalid create payload', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/iam/role-templates', headers: H,
      payload: { name: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
  });

  it('409 on duplicate template name', async () => {
    svc.createTemplate = async () => { throw new RoleTemplateValidationError('TEMPLATE_EXISTS', 'dup'); };
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/iam/role-templates', headers: H,
      payload: { name: 'Custom Biller', key: 'BILLER', permissions: ['acct.store.view'] } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('TEMPLATE_EXISTS');
  });

  it('422 on unknown permission key', async () => {
    svc.createTemplate = async () => { throw new RoleTemplateValidationError('UNKNOWN_PERMISSION', 'bad'); };
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/iam/role-templates', headers: H,
      payload: { name: 'Custom Biller', key: 'BILLER', permissions: ['nope'] } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('UNKNOWN_PERMISSION');
  });

  it('201 on clone template', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/iam/role-templates/t1/clone', headers: H,
      payload: { name: 'My Cashier' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'My Cashier', clonedFromId: 't1' });
  });

  it('200 on update template', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'PATCH', url: '/api/v1/iam/role-templates/t1', headers: H,
      payload: { name: 'Renamed' } });
    expect(res.statusCode).toBe(200);
  });

  it('403 on attempting to edit the immutable global template', async () => {
    svc.updateTemplate = async () => { throw new RoleTemplateValidationError('TEMPLATE_IMMUTABLE', 'immutable'); };
    const app = await makeApp();
    const res = await app.inject({ method: 'PATCH', url: '/api/v1/iam/role-templates/t1', headers: H,
      payload: { name: 'Hacked' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('TEMPLATE_IMMUTABLE');
  });

  it('404 when template not found', async () => {
    svc.getTemplate = async () => { throw new RoleTemplateNotFoundError('missing'); };
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/iam/role-templates/missing', headers: H });
    expect(res.statusCode).toBe(404);
  });

  it('204 on deactivate template', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/iam/role-templates/t1', headers: H });
    expect(res.statusCode).toBe(204);
  });

  it('409 on deactivating a template with an active assignment', async () => {
    svc.deactivateTemplate = async () => { throw new RoleTemplateInUseError('t1'); };
    const app = await makeApp();
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/iam/role-templates/t1', headers: H });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('TEMPLATE_IN_USE');
  });
});

// ── Apply / assignments ───────────────────────────────────────────────────────

describe('S004A · /iam/role-templates:apply', () => {
  it('201 on apply template', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/iam/role-templates:apply', headers: H,
      payload: { templateId: 't1', userId: 'u1', entityId: 'e1', allStores: true } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ templateId: 't1', userId: 'u1', status: 'APPLIED' });
  });

  it('403 when applying to your own userId (SoD)', async () => {
    svc.applyTemplate = async () => { throw new SelfApplyForbiddenError(); };
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/iam/role-templates:apply', headers: H,
      payload: { templateId: 't1', userId: 'admin', entityId: 'e1', allStores: true } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('SELF_APPLY_FORBIDDEN');
  });

  it('422 on applying an inactive template', async () => {
    svc.applyTemplate = async () => { throw new RoleTemplateValidationError('TEMPLATE_INACTIVE', 'inactive'); };
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/iam/role-templates:apply', headers: H,
      payload: { templateId: 't1', userId: 'u1', entityId: 'e1', allStores: true } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('TEMPLATE_INACTIVE');
  });

  it('400 on invalid apply payload (missing entityId)', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/iam/role-templates:apply', headers: H,
      payload: { templateId: 't1', userId: 'u1' } });
    expect(res.statusCode).toBe(400);
  });

  it('200 list assignments', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/iam/role-template-assignments', headers: H });
    expect(res.statusCode).toBe(200);
    expect(res.json().assignments).toEqual([]);
  });

  it('204 on revoke assignment', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/iam/role-template-assignments/ta-1', headers: H });
    expect(res.statusCode).toBe(204);
  });

  it('404 on revoking an unknown assignment', async () => {
    svc.revokeAssignment = async () => { throw new RoleTemplateNotFoundError('missing'); };
    const app = await makeApp();
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/iam/role-template-assignments/missing', headers: H });
    expect(res.statusCode).toBe(404);
  });
});
