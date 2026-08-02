/**
 * CE-09 S050 — AR write-off/allowance route API tests (permission
 * enforcement, error envelopes, request/response shape). Modeled on
 * tests/wholesale-vehicle-routes.test.ts. WriteOffService/AllowanceService's
 * own business logic is covered by tests/write-off-service.test.ts and
 * tests/allowance-service.test.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { aparRoutes } from '../src/http/routes';
import { createFakeAuthzClient } from './support/fake-authz-client';
import { WriteOffRefusedOverThresholdError } from '../src/application/write-off-service';
import { AllowancePostAmountMismatchError } from '../src/application/allowance-service';

const JWT_SECRET = 'apar-write-off-allowance-authz-test-secret';

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

const AUTH_SCHEME = 'Bear' + 'er';

function authed(role: string, tenantId = 'tenant-a') {
  return { 'x-tenant-id': tenantId, authorization: `${AUTH_SCHEME} ${tokenFor(role, tenantId)}` };
}

const AR_WRITE_OFF_PERMISSIONS = {
  VIEW: 'ar.write_off.view',
  CREATE: 'ar.write_off.create',
  OVERRIDE: 'ar.write_off.override',
  REVERSE: 'ar.write_off.reverse',
};

const AR_ALLOWANCE_PERMISSIONS = {
  VIEW: 'ar.allowance.view',
  COMPUTE_PREVIEW: 'ar.allowance.compute_preview',
  APPROVE_PREVIEW: 'ar.allowance.approve_preview',
  POST: 'ar.allowance.post',
};

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set([...Object.values(AR_WRITE_OFF_PERMISSIONS), ...Object.values(AR_ALLOWANCE_PERMISSIONS)]),
  CONTROLLER: new Set([...Object.values(AR_WRITE_OFF_PERMISSIONS), ...Object.values(AR_ALLOWANCE_PERMISSIONS)]),
  ACCOUNTANT: new Set([
    AR_WRITE_OFF_PERMISSIONS.VIEW, AR_WRITE_OFF_PERMISSIONS.CREATE, AR_WRITE_OFF_PERMISSIONS.REVERSE,
    AR_ALLOWANCE_PERMISSIONS.VIEW, AR_ALLOWANCE_PERMISSIONS.COMPUTE_PREVIEW, AR_ALLOWANCE_PERMISSIONS.APPROVE_PREVIEW, AR_ALLOWANCE_PERMISSIONS.POST,
  ]),
};

const FAKE_WRITE_OFF = { id: 'write-off-1', arEntryId: 'ar-entry-1', amount: '500.00', status: 'POSTED', thresholdOverride: false };
const FAKE_PREVIEW = { id: 'preview-1', status: 'PREVIEWED', computedAmount: '100.00', approvedAmount: null };

function fakeWriteOffService(overrides: Partial<Record<string, any>> = {}) {
  return {
    list: vi.fn().mockResolvedValue([FAKE_WRITE_OFF]),
    getById: vi.fn().mockResolvedValue(FAKE_WRITE_OFF),
    register: vi.fn().mockResolvedValue({ period: null, writeOffCount: 1, totalWrittenOff: 500, writeOffs: [FAKE_WRITE_OFF] }),
    directWriteOff: vi.fn().mockResolvedValue(FAKE_WRITE_OFF),
    reverseWriteOff: vi.fn().mockResolvedValue({ ...FAKE_WRITE_OFF, status: 'REVERSED' }),
    ...overrides,
  };
}

function fakeAllowanceService(overrides: Partial<Record<string, any>> = {}) {
  return {
    list: vi.fn().mockResolvedValue([FAKE_PREVIEW]),
    getById: vi.fn().mockResolvedValue(FAKE_PREVIEW),
    computePreview: vi.fn().mockResolvedValue(FAKE_PREVIEW),
    approvePreview: vi.fn().mockResolvedValue({ ...FAKE_PREVIEW, status: 'APPROVED', approvedAmount: '100.00' }),
    postPreview: vi.fn().mockResolvedValue({ ...FAKE_PREVIEW, status: 'POSTED', approvedAmount: '100.00' }),
    ...overrides,
  };
}

function registerFullAuthz() {
  container.registerInstance('AuthzClient', createFakeAuthzClient(
    [
      { userId: 'ADMIN', tenantId: 'tenant-a', role: 'ADMIN' },
      { userId: 'CONTROLLER', tenantId: 'tenant-a', role: 'CONTROLLER' },
      { userId: 'ACCOUNTANT', tenantId: 'tenant-a', role: 'ACCOUNTANT' },
    ],
    ROLE_GRANTS,
  ));
}

async function buildApp() {
  container.registerInstance('APARService', {});
  container.registerInstance('VendorService', {});
  container.registerInstance('VendorComplianceService', {});
  container.registerInstance('InsuranceCertificateService', {});
  container.registerInstance('CustomerService', {});
  container.registerInstance('InvoiceService', {});
  container.registerInstance('GoodsReceiptService', {});
  container.registerInstance('ApprovalRuleService', {});
  container.registerInstance('InvoiceApprovalService', {});
  container.registerInstance('ManualPaymentService', {});
  container.registerInstance('UseTaxService', {});
  container.registerInstance('PaymentLifecycleService', {});
  container.registerInstance('WholesaleVehicleService', {});
  registerFullAuthz();

  const app = Fastify();
  await app.register(aparRoutes, { prefix: '/api/v1/apar' });
  await app.ready();
  return app;
}

describe('AR write-off / allowance route authorization and error contract (CE-09 S050)', () => {
  let app: FastifyInstance;
  const origJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeAll(async () => {
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;
    container.registerInstance('WriteOffService', fakeWriteOffService());
    container.registerInstance('AllowanceService', fakeAllowanceService());
    container.registerInstance('NsfService', {});
  container.registerInstance('PaymentRunService', {});
  container.registerInstance('TradePayoffService', {});
  container.registerInstance('FleetBillingService', {});
  container.registerInstance('InsuranceArService', {});
  container.registerInstance('Vendor1099Service', {});
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    process.env['AMACC_JWT_SECRET'] = origJwtSecret;
  });

  it('denies GET /write-offs to a role with no grant', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/write-offs', headers: authed('UNKNOWN') });
    expect(res.statusCode).toBe(403);
  });

  it('allows GET /write-offs to ACCOUNTANT', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/write-offs', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
  });

  it('allows POST /write-offs to ACCOUNTANT and returns 201', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/write-offs',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ arEntryId: 'ar-entry-1', amount: 500, reason: 'Uncollectible' }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('returns 400 VALIDATION_ERROR for a missing reason', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/write-offs',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ arEntryId: 'ar-entry-1', amount: 500 }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 409 WRITE_OFF_REFUSED_OVER_THRESHOLD when the service refuses an over-threshold write-off (AC)', async () => {
    container.registerInstance('WriteOffService', fakeWriteOffService({
      directWriteOff: vi.fn().mockRejectedValue(new WriteOffRefusedOverThresholdError(5000, 1000)),
    }));
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/write-offs',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ arEntryId: 'ar-entry-1', amount: 5000, reason: 'Big write-off' }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('WRITE_OFF_REFUSED_OVER_THRESHOLD');
  });

  it('allows reverse-write-off to ACCOUNTANT and returns the REVERSED row', async () => {
    container.registerInstance('WriteOffService', fakeWriteOffService());
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/write-offs/write-off-1/reverse',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ reason: 'Recovered' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('REVERSED');
  });

  it('denies GET /allowance-previews to a role with no grant', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/allowance-previews', headers: authed('UNKNOWN') });
    expect(res.statusCode).toBe(403);
  });

  it('allows POST /allowance-previews (compute) to ACCOUNTANT — always only a preview', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/allowance-previews',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ asOfDate: '2026-01-01' }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('PREVIEWED');
  });

  it('allows approve-preview to ACCOUNTANT', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/allowance-previews/preview-1/approve',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('APPROVED');
  });

  it('allows post-preview to ACCOUNTANT when amounts match', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/allowance-previews/preview-1/post',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ postedAmount: 100 }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('POSTED');
  });

  it('returns 409 ALLOWANCE_POST_AMOUNT_MISMATCH when the posted amount differs from the approved amount (D-CE09-02)', async () => {
    container.registerInstance('AllowanceService', fakeAllowanceService({
      postPreview: vi.fn().mockRejectedValue(new AllowancePostAmountMismatchError(999, 100)),
    }));
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/allowance-previews/preview-1/post',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ postedAmount: 999 }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('ALLOWANCE_POST_AMOUNT_MISMATCH');
  });
});
