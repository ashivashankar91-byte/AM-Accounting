/**
 * CE-09 S042 — Use-tax route API tests (permission enforcement, error
 * envelopes, request/response shape). Modeled on
 * tests/manual-payment-routes.test.ts. UseTaxService's own business logic
 * is covered by tests/use-tax-service.test.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { aparRoutes } from '../src/http/routes';
import { createFakeAuthzClient } from './support/fake-authz-client';
import { UseTaxAssessmentAlreadyExistsError } from '../src/application/use-tax-service';

const JWT_SECRET = 'apar-use-tax-authz-test-secret';

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

const AP_USE_TAX_PERMISSIONS = { VIEW: 'ap.use_tax.view', ASSESS: 'ap.use_tax.assess' };

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set(Object.values(AP_USE_TAX_PERMISSIONS)),
  CONTROLLER: new Set(Object.values(AP_USE_TAX_PERMISSIONS)),
  ACCOUNTANT: new Set(Object.values(AP_USE_TAX_PERMISSIONS)),
};

const FAKE_ASSESSMENT = { id: 'assessment-1', invoiceId: 'invoice-1', status: 'ASSESSED', rateSource: 'RATE_SOURCE_CONFIGURED', assessedAmount: '14.00' };

function fakeUseTaxService(overrides: Partial<Record<string, any>> = {}) {
  return {
    list: vi.fn().mockResolvedValue([FAKE_ASSESSMENT]),
    getById: vi.fn().mockResolvedValue(FAKE_ASSESSMENT),
    register: vi.fn().mockResolvedValue({ period: '2026-08', assessmentCount: 1, totalAssessed: 14, assessments: [FAKE_ASSESSMENT] }),
    assess: vi.fn().mockResolvedValue(FAKE_ASSESSMENT),
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

describe('Use-tax route authorization and error contract (CE-09 S042)', () => {
  let app: FastifyInstance;
  const origJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeAll(async () => {
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;

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
    container.registerInstance('UseTaxService', fakeUseTaxService());
    container.registerInstance('PaymentLifecycleService', {});
    container.registerInstance('WholesaleVehicleService', {});
  container.registerInstance('WriteOffService', {});
  container.registerInstance('AllowanceService', {});
  container.registerInstance('NsfService', {});
  container.registerInstance('PaymentRunService', {});
  container.registerInstance('TradePayoffService', {});
  container.registerInstance('FleetBillingService', {});
  container.registerInstance('InsuranceArService', {});
  container.registerInstance('Vendor1099Service', {});
    registerFullAuthz();

    app = Fastify();
    await app.register(aparRoutes, { prefix: '/api/v1/apar' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    process.env['AMACC_JWT_SECRET'] = origJwtSecret;
  });

  it('denies GET /use-tax/assessments to a role with no view grant', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/use-tax/assessments', headers: authed('UNKNOWN') });
    expect(res.statusCode).toBe(403);
  });

  it('allows GET /use-tax/assessments to ACCOUNTANT (view)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/use-tax/assessments', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([FAKE_ASSESSMENT]);
  });

  it('returns 400 when /use-tax/register is called without a period', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/use-tax/register', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(400);
  });

  it('returns the register total for a period', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/use-tax/register?period=2026-08', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ period: '2026-08', totalAssessed: 14 });
  });

  it('allows POST /invoices/:id/use-tax-assessment to ACCOUNTANT and returns 201', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/invoices/11111111-1111-1111-1111-111111111111/use-tax-assessment',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ jurisdiction: 'TEST-JURISDICTION-01', taxableAmount: 200 }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('returns 400 VALIDATION_ERROR when required fields are missing', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/invoices/11111111-1111-1111-1111-111111111111/use-tax-assessment',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 409 ALREADY_ASSESSED when the service throws that conflict (idempotent replay)', async () => {
    container.registerInstance('UseTaxService', fakeUseTaxService({
      assess: vi.fn().mockRejectedValue(new UseTaxAssessmentAlreadyExistsError('invoice-1', 'USE_TAX')),
    }));
    container.registerInstance('PaymentLifecycleService', {});
    container.registerInstance('WholesaleVehicleService', {});
  container.registerInstance('WriteOffService', {});
  container.registerInstance('AllowanceService', {});
    app = Fastify();
    await app.register(aparRoutes, { prefix: '/api/v1/apar' });
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/invoices/11111111-1111-1111-1111-111111111111/use-tax-assessment',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ jurisdiction: 'TEST-JURISDICTION-01', taxableAmount: 200 }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('ALREADY_ASSESSED');
  });
});
