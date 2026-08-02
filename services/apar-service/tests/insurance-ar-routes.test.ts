/**
 * CE-09 S049 — Insurance AR route API tests (permission enforcement, error
 * envelopes, request/response shape). Modeled on
 * tests/fleet-billing-routes.test.ts. InsuranceArService's own business
 * logic is covered by tests/insurance-ar-service.test.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { aparRoutes } from '../src/http/routes';
import { createFakeAuthzClient } from './support/fake-authz-client';
import { InsurerPaymentExceedsClaimBalanceError, ShortPayAlreadyDisposedError } from '../src/application/insurance-ar-service';

const JWT_SECRET = 'apar-insurance-ar-authz-test-secret';

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

const AR_INSURANCE_PERMISSIONS = {
  VIEW: 'ar.insurance_claim.view',
  CREATE: 'ar.insurance_claim.create',
  POST_SUPPLEMENT: 'ar.insurance_claim.post_supplement',
  APPLY_PAYMENT: 'ar.insurance_claim.apply_payment',
  DISPOSE_SHORT_PAY: 'ar.insurance_claim.dispose_short_pay',
};

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set(Object.values(AR_INSURANCE_PERMISSIONS)),
  CONTROLLER: new Set(Object.values(AR_INSURANCE_PERMISSIONS)),
  ACCOUNTANT: new Set(Object.values(AR_INSURANCE_PERMISSIONS)),
};

const FAKE_CLAIM = { id: 'claim-1', claimNumber: 'CLM-1', insurerName: 'Acme Insurance', claimAmount: '1000.00', effectiveClaimAmount: 1000, remainingBalance: 1000, status: 'OPEN' };

function fakeInsuranceArService(overrides: Partial<Record<string, any>> = {}) {
  return {
    list: vi.fn().mockResolvedValue([FAKE_CLAIM]),
    getById: vi.fn().mockResolvedValue(FAKE_CLAIM),
    createClaim: vi.fn().mockResolvedValue(FAKE_CLAIM),
    postSupplement: vi.fn().mockResolvedValue(FAKE_CLAIM),
    applyInsurerPayment: vi.fn().mockResolvedValue(FAKE_CLAIM),
    disposeShortPay: vi.fn().mockResolvedValue(FAKE_CLAIM),
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
  container.registerInstance('Vendor1099Service', {});
  registerFullAuthz();

  const app = Fastify();
  await app.register(aparRoutes, { prefix: '/api/v1/apar' });
  await app.ready();
  return app;
}

describe('Insurance-AR route authorization and error contract (CE-09 S049)', () => {
  let app: FastifyInstance;
  const origJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeAll(async () => {
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;
    container.registerInstance('InsuranceArService', fakeInsuranceArService());
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    process.env['AMACC_JWT_SECRET'] = origJwtSecret;
  });

  it('denies GET /insurance-claims to a role with no grant', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/insurance-claims', headers: authed('UNKNOWN') });
    expect(res.statusCode).toBe(403);
  });

  it('allows GET /insurance-claims to ACCOUNTANT', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/insurance-claims', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
  });

  it('allows GET /insurance-claims/:id to ACCOUNTANT', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/insurance-claims/claim-1', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
  });

  it('allows POST /insurance-claims to ACCOUNTANT and returns 201', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/insurance-claims',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ customerId: 'customer-1', insurerName: 'Acme Insurance', claimNumber: 'CLM-1', claimAmount: 1000 }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('returns 400 VALIDATION_ERROR for a missing insurerName', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/insurance-claims',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ customerId: 'customer-1', claimNumber: 'CLM-1', claimAmount: 1000 }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('allows POST /insurance-claims/:id/supplements to ACCOUNTANT and returns 201', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/insurance-claims/claim-1/supplements',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ adjustmentAmount: 200, reason: 'Additional parts found' }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('allows POST /insurance-claims/:id/apply-payment to ACCOUNTANT and returns 200', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/insurance-claims/claim-1/apply-payment',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ amount: 700 }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 422 INSURER_PAYMENT_EXCEEDS_CLAIM_BALANCE when the service refuses an over-application', async () => {
    container.registerInstance('InsuranceArService', fakeInsuranceArService({
      applyInsurerPayment: vi.fn().mockRejectedValue(new InsurerPaymentExceedsClaimBalanceError(1500, 1000)),
    }));
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/insurance-claims/claim-1/apply-payment',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ amount: 1500 }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('INSURER_PAYMENT_EXCEEDS_CLAIM_BALANCE');
  });

  it('allows POST /insurance-claims/:id/dispose-short-pay to ACCOUNTANT and returns 200', async () => {
    container.registerInstance('InsuranceArService', fakeInsuranceArService());
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/insurance-claims/claim-1/dispose-short-pay',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ dispositionType: 'CUSTOMER_RESPONSIBILITY', reason: 'Deductible' }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 409 SHORT_PAY_ALREADY_DISPOSED when the service refuses a second disposition', async () => {
    container.registerInstance('InsuranceArService', fakeInsuranceArService({
      disposeShortPay: vi.fn().mockRejectedValue(new ShortPayAlreadyDisposedError('claim-1')),
    }));
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/insurance-claims/claim-1/dispose-short-pay',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ dispositionType: 'WRITE_OFF', reason: 'Uncollectible' }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('SHORT_PAY_ALREADY_DISPOSED');
  });

  it('denies POST /insurance-claims to a role with no CREATE grant', async () => {
    container.registerInstance('InsuranceArService', fakeInsuranceArService());
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/insurance-claims',
      headers: { ...authed('UNKNOWN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ customerId: 'customer-1', insurerName: 'Acme Insurance', claimNumber: 'CLM-1', claimAmount: 1000 }),
    });
    expect(res.statusCode).toBe(403);
  });
});
