import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { storeRoutes } from '../src/http/store-routes';

// ── JWT helper ────────────────────────────────────────────────────────────────

const JWT_SECRET = 'store-authz-test-secret';

function b64u(s: string): string {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function tokenFor(role: string, tenantId = 'tenant-a'): string {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ sub: 'test-user', tenantId, role, iat: now, exp: now + 3600 }));
  const sig = Buffer.from(
    crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('binary'),
  ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${header}.${body}.${sig}`;
}

function authed(role: string, tenantId = 'tenant-a') {
  return { 'x-tenant-id': tenantId, authorization: `Bearer ${tokenFor(role, tenantId)}` };
}

// ── Fake service ──────────────────────────────────────────────────────────────

const FAKE_STORE = {
  id:             'store-1',
  tenantId:       'tenant-a',
  entityId:       'a0000000-0000-0000-0000-000000000001',
  storeCode:      '01',
  storeName:      'Main Store',
  stateProvince:  'IL',
  addressLine1:   null,
  addressLine2:   null,
  city:           null,
  postalCode:     null,
  dmvId:          null,
  status:         'ACTIVE',
  version:        1,
  deactivatedAt:  null,
  deactivatedBy:  null,
  deactivationReason: null,
  createdAt:      new Date().toISOString(),
  updatedAt:      new Date().toISOString(),
};

function fakeStoreService() {
  return {
    list:       async () => ({ items: [FAKE_STORE], total: 1, page: 1, pageSize: 50 }),
    getById:    async () => FAKE_STORE,
    create:     async () => FAKE_STORE,
    update:     async () => FAKE_STORE,
    deactivate: async () => ({ ...FAKE_STORE, status: 'INACTIVE' }),
  };
}

const CREATE_PAYLOAD = {
  entityId:      'a0000000-0000-0000-0000-000000000001',
  storeCode:     '01',
  storeName:     'Main Store',
  stateProvince: 'IL',
};

describe('Store route authorization (PRM201-1: deny-by-default acct.store.view / acct.store.manage)', () => {
  let app: FastifyInstance;
  const origNodeEnv   = process.env['NODE_ENV'];
  const origJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeAll(async () => {
    process.env['NODE_ENV']        = 'test';
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;

    container.registerInstance('StoreService', fakeStoreService());

    app = Fastify();
    await app.register(storeRoutes, { prefix: '/api/v1/stores' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    process.env['NODE_ENV']        = origNodeEnv;
    process.env['AMACC_JWT_SECRET'] = origJwtSecret;
  });

  // ── Unauthenticated ───────────────────────────────────────────────────────

  it('rejects unauthenticated request (no Authorization) with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/stores',
      headers: { 'x-tenant-id': 'tenant-a' },
    });
    expect(res.statusCode).toBe(401);
  });

  // ── Missing tenant header ─────────────────────────────────────────────────

  it('returns 400 when x-tenant-id header is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/stores',
      headers: { authorization: `Bearer ${tokenFor('ADMIN')}` },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── Unknown role (deny-by-default) ────────────────────────────────────────

  it('denies GET / to an unknown role (deny-by-default)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/stores',
      headers: authed('UNKNOWN_ROLE'),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'FORBIDDEN', message: expect.stringContaining('acct.store.view') });
  });

  it('denies POST / to ACCOUNTANT role (view-only)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/stores',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify(CREATE_PAYLOAD),
    });
    expect(res.statusCode).toBe(403);
  });

  // ── ACCOUNTANT has view ───────────────────────────────────────────────────

  it('allows GET / to ACCOUNTANT role', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/stores',
      headers: authed('ACCOUNTANT'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ items: expect.any(Array) });
  });

  it('allows GET /:id to ACCOUNTANT role', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/stores/store-1',
      headers: authed('ACCOUNTANT'),
    });
    expect(res.statusCode).toBe(200);
  });

  // ── ADMIN has view + manage ───────────────────────────────────────────────

  it('allows POST / to ADMIN role (201 created)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/stores',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify(CREATE_PAYLOAD),
    });
    expect(res.statusCode).toBe(201);
  });

  it('allows PUT /:id to ADMIN role', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/stores/store-1',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1, storeName: 'Updated Name' }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('allows POST /:id/deactivate to ADMIN role', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/stores/store-1/deactivate',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1, reason: 'closing', deactivatedBy: 'admin' }),
    });
    expect(res.statusCode).toBe(200);
  });

  // ── Tenant isolation ──────────────────────────────────────────────────────

  it('returns 403 when JWT tenantId does not match x-tenant-id header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/stores',
      headers: {
        'x-tenant-id':  'tenant-b',              // header says B
        authorization:  `Bearer ${tokenFor('ADMIN', 'tenant-a')}`, // JWT says A
      },
    });
    expect(res.statusCode).toBe(403);
  });
});
