/**
 * S204 — Franchise Route Authorization Tests (PRM204)
 *
 * HTTP layer: authentication, RBAC (acct.franchise.view / .manage),
 * error mapping (422 unknown-oem / dealer-code-format, 409 duplicate, 404).
 * Uses a Fastify app with a fake FranchiseService.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import {
  franchiseRoutes,
} from '../src/http/franchise-routes';
import {
  FranchiseValidationError as SvcValidationError,
  FranchiseConflictError as SvcConflictError,
  StoreNotFoundForFranchiseError as SvcStoreNotFound,
} from '../src/application/franchise-service';

// ── JWT helper ────────────────────────────────────────────────────────────────

const JWT_SECRET = 'franchise-authz-test-secret';

function b64u(s: string): string {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function tokenFor(role: string, tenantId = 'tenant-a'): string {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now    = Math.floor(Date.now() / 1000);
  const body   = b64u(JSON.stringify({ sub: 'test-user', tenantId, role, iat: now, exp: now + 3600 }));
  const sig    = Buffer.from(
    crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('binary'),
  ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${header}.${body}.${sig}`;
}

function authed(role: string, tenantId = 'tenant-a') {
  return { 'x-tenant-id': tenantId, authorization: `Bearer ${tokenFor(role, tenantId)}` };
}

// ── Fake service ──────────────────────────────────────────────────────────────

const STORE_ID = 'store-001';
const FR_ID    = 'fr-001';

const FAKE_FR = {
  id:            FR_ID,
  tenantId:      'tenant-a',
  storeId:       STORE_ID,
  oemCode:       'FORD',
  dealerCode:    '54321',
  effectiveFrom: '2026-02-01',
  effectiveTo:   null,
  version:       1,
  createdAt:     new Date().toISOString(),
  updatedAt:     new Date().toISOString(),
};

let createBehavior: () => Promise<any> = async () => FAKE_FR;

function fakeFranchiseService() {
  return {
    list:    async () => ({ items: [FAKE_FR], total: 1 }),
    getById: async () => FAKE_FR,
    create:  async () => createBehavior(),
    update:  async () => ({ ...FAKE_FR, version: 2 }),
  };
}

const CREATE_PAYLOAD = { oemCode: 'FORD', dealerCode: '54321', effectiveFrom: '2026-02-01' };
const BASE_URL = `/api/v1/stores/${STORE_ID}/franchises`;

describe('Franchise route authorization (S204 PRM204)', () => {
  let app: FastifyInstance;
  const origNodeEnv   = process.env['NODE_ENV'];
  const origJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeAll(async () => {
    process.env['NODE_ENV']         = 'test';
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;
    container.registerInstance('FranchiseService', fakeFranchiseService());
    app = Fastify();
    await app.register(franchiseRoutes, { prefix: '/api/v1/stores' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    process.env['NODE_ENV']         = origNodeEnv;
    process.env['AMACC_JWT_SECRET'] = origJwtSecret;
    createBehavior = async () => FAKE_FR;
  });

  it('PRM204-1: rejects unauthenticated GET list with 401', async () => {
    const res = await app.inject({ method: 'GET', url: BASE_URL, headers: { 'x-tenant-id': 'tenant-a' } });
    expect(res.statusCode).toBe(401);
  });

  it('PRM204-2: 400 when x-tenant-id header is missing', async () => {
    const res = await app.inject({ method: 'GET', url: BASE_URL, headers: { authorization: `Bearer ${tokenFor('ADMIN')}` } });
    expect(res.statusCode).toBe(400);
  });

  it('PRM204-3: denies GET list to an unknown role', async () => {
    const res = await app.inject({ method: 'GET', url: BASE_URL, headers: authed('MECHANIC') });
    expect(res.statusCode).toBe(403);
  });

  it('PRM204-4: ACCOUNTANT may view but not create', async () => {
    const view = await app.inject({ method: 'GET', url: BASE_URL, headers: authed('ACCOUNTANT') });
    expect(view.statusCode).toBe(200);
    const create = await app.inject({ method: 'POST', url: BASE_URL, headers: authed('ACCOUNTANT'), payload: CREATE_PAYLOAD });
    expect(create.statusCode).toBe(403);
  });

  it('PRM204-5: CONTROLLER may create → 201', async () => {
    createBehavior = async () => FAKE_FR;
    const res = await app.inject({ method: 'POST', url: BASE_URL, headers: authed('CONTROLLER'), payload: CREATE_PAYLOAD });
    expect(res.statusCode).toBe(201);
    expect(res.json().oemCode).toBe('FORD');
  });

  it('PRM204-6: ADMIN create with unknown OEM → 422', async () => {
    createBehavior = async () => { throw new SvcValidationError('UNKNOWN_OEM', 'nope'); };
    const res = await app.inject({ method: 'POST', url: BASE_URL, headers: authed('ADMIN'), payload: { ...CREATE_PAYLOAD, oemCode: 'TESLA' } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('UNKNOWN_OEM');
  });

  it('PRM204-7: ADMIN create with bad dealer code → 422', async () => {
    createBehavior = async () => { throw new SvcValidationError('DEALER_CODE_FORMAT', 'bad'); };
    const res = await app.inject({ method: 'POST', url: BASE_URL, headers: authed('ADMIN'), payload: { ...CREATE_PAYLOAD, dealerCode: '1' } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('DEALER_CODE_FORMAT');
  });

  it('PRM204-8: duplicate OEM per store → 409', async () => {
    createBehavior = async () => { throw new SvcConflictError('DUPLICATE_OEM_PER_STORE', 'dup'); };
    const res = await app.inject({ method: 'POST', url: BASE_URL, headers: authed('ADMIN'), payload: CREATE_PAYLOAD });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('DUPLICATE_OEM_PER_STORE');
  });

  it('PRM204-9: store not found → 404 STORE_NOT_FOUND', async () => {
    createBehavior = async () => { throw new SvcStoreNotFound('ghost'); };
    const res = await app.inject({ method: 'POST', url: BASE_URL, headers: authed('ADMIN'), payload: CREATE_PAYLOAD });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('STORE_NOT_FOUND');
  });

  it('PRM204-10: malformed body (missing oemCode) → 400', async () => {
    const res = await app.inject({ method: 'POST', url: BASE_URL, headers: authed('ADMIN'), payload: { dealerCode: '54321', effectiveFrom: '2026-02-01' } });
    expect(res.statusCode).toBe(400);
  });
});
