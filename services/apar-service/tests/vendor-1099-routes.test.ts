/**
 * CE-09 S037 — 1099/T4A route API tests (permission enforcement, error
 * envelopes, request/response shape). Modeled on
 * tests/insurance-ar-routes.test.ts. Vendor1099Service's own business
 * logic is covered by tests/vendor-1099-service.test.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { aparRoutes } from '../src/http/routes';
import { createFakeAuthzClient } from './support/fake-authz-client';
import { Vendor1099VendorNotFoundError } from '../src/application/vendor-1099-service';

const JWT_SECRET = 'apar-vendor-1099-authz-test-secret';

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

const VENDOR_1099_PERMISSIONS = {
  VIEW: 'ap.vendor_1099.view',
  MANAGE_BOX_RULES: 'ap.vendor_1099.manage_box_rules',
  MANAGE_THRESHOLDS: 'ap.vendor_1099.manage_thresholds',
  POST_CORRECTION: 'ap.vendor_1099.post_correction',
};

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set(Object.values(VENDOR_1099_PERMISSIONS)),
  CONTROLLER: new Set(Object.values(VENDOR_1099_PERMISSIONS)),
  ACCOUNTANT: new Set(Object.values(VENDOR_1099_PERMISSIONS)),
};

const FAKE_RULE = { id: 'rule-1', vendorId: 'vendor-1', taxYear: 2026, formType: '1099-NEC', boxCode: '1' };
const FAKE_THRESHOLD = { id: 'threshold-1', formType: '1099-NEC', taxYear: 2026, thresholdAmount: '600.00' };
const FAKE_CORRECTION = { id: 'correction-1', vendorId: 'vendor-1', taxYear: 2026, formType: '1099-NEC', originalAmount: 400, correctedAmount: 700, reason: 'test' };
const FAKE_PREVIEW = { tenantId: 'tenant-a', taxYear: 2026, lines: [], totalReported: 0, efileTransmissionStatus: 'NOT_IN_SCOPE_COMPLIANCE_VENDOR' };

function fakeVendor1099Service(overrides: Partial<Record<string, any>> = {}) {
  return {
    setVendorBoxRule: vi.fn().mockResolvedValue(FAKE_RULE),
    listVendorBoxRules: vi.fn().mockResolvedValue([FAKE_RULE]),
    setThresholdConfig: vi.fn().mockResolvedValue(FAKE_THRESHOLD),
    listThresholdConfigs: vi.fn().mockResolvedValue([FAKE_THRESHOLD]),
    postCorrection: vi.fn().mockResolvedValue(FAKE_CORRECTION),
    listCorrections: vi.fn().mockResolvedValue([FAKE_CORRECTION]),
    getYearPreview: vi.fn().mockResolvedValue(FAKE_PREVIEW),
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
  container.registerInstance('WriteOffService', {});
  container.registerInstance('AllowanceService', {});
  container.registerInstance('NsfService', {});
  container.registerInstance('PaymentRunService', {});
  container.registerInstance('TradePayoffService', {});
  container.registerInstance('FleetBillingService', {});
  container.registerInstance('InsuranceArService', {});
  registerFullAuthz();

  const app = Fastify();
  await app.register(aparRoutes, { prefix: '/api/v1/apar' });
  await app.ready();
  return app;
}

describe('1099/T4A route authorization and error contract (CE-09 S037)', () => {
  let app: FastifyInstance;
  const origJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeAll(async () => {
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;
    container.registerInstance('Vendor1099Service', fakeVendor1099Service());
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    process.env['AMACC_JWT_SECRET'] = origJwtSecret;
  });

  it('denies GET /vendor-1099/box-rules to a role with no grant', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/vendor-1099/box-rules', headers: authed('UNKNOWN') });
    expect(res.statusCode).toBe(403);
  });

  it('allows GET /vendor-1099/box-rules to ACCOUNTANT', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/vendor-1099/box-rules', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
  });

  it('allows POST /vendor-1099/box-rules to ACCOUNTANT and returns 201', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/vendor-1099/box-rules',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ vendorId: 'vendor-1', taxYear: 2026, formType: '1099-NEC', boxCode: '1' }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('returns 400 VALIDATION_ERROR for an invalid formType', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/vendor-1099/box-rules',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ vendorId: 'vendor-1', taxYear: 2026, formType: 'W2', boxCode: '1' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 NOT_FOUND when the service reports an unknown vendor', async () => {
    container.registerInstance('Vendor1099Service', fakeVendor1099Service({
      setVendorBoxRule: vi.fn().mockRejectedValue(new Vendor1099VendorNotFoundError('vendor-x')),
    }));
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/vendor-1099/box-rules',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ vendorId: 'vendor-x', taxYear: 2026, formType: '1099-NEC', boxCode: '1' }),
    });
    expect(res.statusCode).toBe(404);
  });

  it('allows POST /vendor-1099/threshold-configs to ACCOUNTANT and returns 201', async () => {
    container.registerInstance('Vendor1099Service', fakeVendor1099Service());
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/vendor-1099/threshold-configs',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ formType: '1099-NEC', taxYear: 2026, thresholdAmount: 600 }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('denies POST /vendor-1099/threshold-configs to a role with no MANAGE_THRESHOLDS grant', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/vendor-1099/threshold-configs',
      headers: { ...authed('UNKNOWN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ formType: '1099-NEC', taxYear: 2026, thresholdAmount: 600 }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows GET /vendor-1099/threshold-configs to ACCOUNTANT', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/vendor-1099/threshold-configs', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
  });

  it('allows POST /vendor-1099/corrections to ACCOUNTANT and returns 201', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/vendor-1099/corrections',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ vendorId: 'vendor-1', taxYear: 2026, formType: '1099-NEC', correctedAmount: 700, reason: 'Missed payment' }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('returns 400 VALIDATION_ERROR for a missing reason on a correction', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/vendor-1099/corrections',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ vendorId: 'vendor-1', taxYear: 2026, formType: '1099-NEC', correctedAmount: 700 }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('allows GET /vendor-1099/corrections to ACCOUNTANT', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/vendor-1099/corrections', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
  });

  it('allows GET /vendor-1099/year-preview/:taxYear to ACCOUNTANT', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/vendor-1099/year-preview/2026', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
    expect(res.json().efileTransmissionStatus).toBe('NOT_IN_SCOPE_COMPLIANCE_VENDOR');
  });

  it('denies GET /vendor-1099/year-preview/:taxYear to a role with no VIEW grant', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/vendor-1099/year-preview/2026', headers: authed('UNKNOWN') });
    expect(res.statusCode).toBe(403);
  });
});
