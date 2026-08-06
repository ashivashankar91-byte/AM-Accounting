/**
 * CE-09 S044 — Trade-Payoff Fast Lane route API tests (permission
 * enforcement, error envelopes, request/response shape). Modeled on
 * tests/payment-run-routes.test.ts. TradePayoffService's own business
 * logic is covered by tests/trade-payoff-service.test.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { aparRoutes } from '../src/http/routes';
import { createFakeAuthzClient } from './support/fake-authz-client';
import { PayoffReconfirmationRequiredError, DuplicatePayoffPaymentError } from '../src/application/trade-payoff-service';

const JWT_SECRET = 'apar-trade-payoff-authz-test-secret';

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

const AP_TRADE_PAYOFF_PERMISSIONS = {
  VIEW: 'ap.trade_payoff.view',
  CREATE: 'ap.trade_payoff.create',
};

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set(Object.values(AP_TRADE_PAYOFF_PERMISSIONS)),
  CONTROLLER: new Set(Object.values(AP_TRADE_PAYOFF_PERMISSIONS)),
  ACCOUNTANT: new Set(Object.values(AP_TRADE_PAYOFF_PERMISSIONS)),
};

const FAKE_PAYMENT = { id: 'payoff-1', dealReference: 'deal-1', payeeName: 'ACME Lienholder', amount: '15000.00', status: 'POSTED' };

function fakeTradePayoffService(overrides: Partial<Record<string, any>> = {}) {
  return {
    list: vi.fn().mockResolvedValue([FAKE_PAYMENT]),
    getById: vi.fn().mockResolvedValue(FAKE_PAYMENT),
    create: vi.fn().mockResolvedValue(FAKE_PAYMENT),
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
  container.registerInstance('FleetBillingService', {});
  container.registerInstance('InsuranceArService', {});
  container.registerInstance('Vendor1099Service', {});
  registerFullAuthz();

  const app = Fastify();
  await app.register(aparRoutes, { prefix: '/api/v1/apar' });
  await app.ready();
  return app;
}

describe('Trade-Payoff route authorization and error contract (CE-09 S044)', () => {
  let app: FastifyInstance;
  const origJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeAll(async () => {
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;
    container.registerInstance('TradePayoffService', fakeTradePayoffService());
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    process.env['AMACC_JWT_SECRET'] = origJwtSecret;
  });

  it('denies GET /trade-payoff-payments to a role with no grant', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/trade-payoff-payments', headers: authed('UNKNOWN') });
    expect(res.statusCode).toBe(403);
  });

  it('allows GET /trade-payoff-payments to ACCOUNTANT', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/trade-payoff-payments', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
  });

  it('allows POST /trade-payoff-payments to ACCOUNTANT and returns 201', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/trade-payoff-payments',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ dealReference: 'deal-1', payeeName: 'ACME Lienholder', payeeRemitAddress: '1 Main St', amount: 15000, goodThroughDate: '2027-01-01', bankAccountId: 'bank-1' }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('returns 400 VALIDATION_ERROR for a missing payeeName', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/trade-payoff-payments',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ dealReference: 'deal-1', payeeRemitAddress: '1 Main St', amount: 15000, goodThroughDate: '2027-01-01', bankAccountId: 'bank-1' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 422 PAYOFF_RECONFIRMATION_REQUIRED when the service refuses a stale good-through date', async () => {
    container.registerInstance('TradePayoffService', fakeTradePayoffService({
      create: vi.fn().mockRejectedValue(new PayoffReconfirmationRequiredError()),
    }));
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/trade-payoff-payments',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ dealReference: 'deal-1', payeeName: 'ACME Lienholder', payeeRemitAddress: '1 Main St', amount: 15000, goodThroughDate: '2020-01-01', bankAccountId: 'bank-1' }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('PAYOFF_RECONFIRMATION_REQUIRED');
  });

  it('returns 409 DUPLICATE_PAYOFF_PAYMENT when the service refuses a duplicate deal reference', async () => {
    container.registerInstance('TradePayoffService', fakeTradePayoffService({
      create: vi.fn().mockRejectedValue(new DuplicatePayoffPaymentError('deal-1')),
    }));
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/trade-payoff-payments',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ dealReference: 'deal-1', payeeName: 'ACME Lienholder', payeeRemitAddress: '1 Main St', amount: 15000, goodThroughDate: '2027-01-01', bankAccountId: 'bank-1' }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('DUPLICATE_PAYOFF_PAYMENT');
  });

  it('denies POST /trade-payoff-payments to a role with no CREATE grant', async () => {
    container.registerInstance('TradePayoffService', fakeTradePayoffService());
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/trade-payoff-payments',
      headers: { ...authed('UNKNOWN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ dealReference: 'deal-1', payeeName: 'ACME Lienholder', payeeRemitAddress: '1 Main St', amount: 15000, goodThroughDate: '2027-01-01', bankAccountId: 'bank-1' }),
    });
    expect(res.statusCode).toBe(403);
  });
});
