/**
 * AMACC-CH04 S043A — Manual payment route API tests (permission
 * enforcement, error envelopes, request/response shape). Modeled on
 * tests/invoice-routes.test.ts. ManualPaymentService's own business logic
 * is covered by tests/manual-payment-service.test.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { aparRoutes } from '../src/http/routes';
import { createFakeAuthzClient } from './support/fake-authz-client';
import { InvoiceAlreadyPaidError } from '../src/application/manual-payment-service';

const JWT_SECRET = 'apar-payment-authz-test-secret';

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

function authed(role: string, tenantId = 'tenant-a') {
  return { 'x-tenant-id': tenantId, authorization: `Bearer ${tokenFor(role, tenantId)}` };
}

const AP_MANUAL_PAYMENT_PERMISSIONS = {
  VIEW: 'ap.manual_payment.view',
  CREATE: 'ap.manual_payment.create',
  VOID: 'ap.manual_payment.void',
  RETRY_SCHEDULE_RELIEF: 'ap.manual_payment.retry_schedule_relief',
};

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set(Object.values(AP_MANUAL_PAYMENT_PERMISSIONS)),
  CONTROLLER: new Set(Object.values(AP_MANUAL_PAYMENT_PERMISSIONS)),
  ACCOUNTANT: new Set([AP_MANUAL_PAYMENT_PERMISSIONS.VIEW, AP_MANUAL_PAYMENT_PERMISSIONS.CREATE]),
};

const FAKE_PAYMENT = { id: 'payment-1', invoiceId: 'invoice-1', status: 'POSTED', version: 1, checkNumber: 1001 };

function fakeManualPaymentService(overrides: Partial<Record<string, any>> = {}) {
  return {
    list: vi.fn().mockResolvedValue([FAKE_PAYMENT]),
    getById: vi.fn().mockResolvedValue(FAKE_PAYMENT),
    create: vi.fn().mockResolvedValue(FAKE_PAYMENT),
    void: vi.fn().mockResolvedValue({ ...FAKE_PAYMENT, status: 'VOID' }),
    retryScheduleRelief: vi.fn().mockResolvedValue({ ...FAKE_PAYMENT, scheduleReliefStatus: 'RELIEVED' }),
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

describe('Manual payment route authorization and error contract (AMACC-CH04 S043A)', () => {
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
    container.registerInstance('ManualPaymentService', fakeManualPaymentService());
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

  it('denies GET /manual-payments to a role with no view grant', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/manual-payments', headers: authed('UNKNOWN') });
    expect(res.statusCode).toBe(403);
  });

  it('allows GET /manual-payments to ACCOUNTANT (view)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/manual-payments', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([FAKE_PAYMENT]);
  });

  it('allows POST /manual-payments to ACCOUNTANT and returns 201', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/manual-payments',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ invoiceId: '11111111-1111-1111-1111-111111111111', bankAccountId: '22222222-2222-2222-2222-222222222222' }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('returns 400 VALIDATION_ERROR when required fields are missing', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/manual-payments',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 409 ALREADY_PAID when the service throws that conflict', async () => {
    container.registerInstance('ManualPaymentService', fakeManualPaymentService({
      create: vi.fn().mockRejectedValue(new InvoiceAlreadyPaidError('invoice-1')),
    }));
    registerFullAuthz();
    const localApp = Fastify();
    await localApp.register(aparRoutes, { prefix: '/api/v1/apar' });
    await localApp.ready();
    const res = await localApp.inject({
      method: 'POST', url: '/api/v1/apar/manual-payments',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ invoiceId: '11111111-1111-1111-1111-111111111111', bankAccountId: '22222222-2222-2222-2222-222222222222' }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'ALREADY_PAID' });
    await localApp.close();
    container.registerInstance('ManualPaymentService', fakeManualPaymentService());
  });

  it('denies POST /manual-payments/:id/void to ACCOUNTANT (no void grant)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/manual-payments/payment-1/void',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1, reason: 'test' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows POST /manual-payments/:id/void to CONTROLLER', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/manual-payments/payment-1/void',
      headers: { ...authed('CONTROLLER'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1, reason: 'Wrong vendor' }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('denies POST /manual-payments/:id/retry-schedule-relief to ACCOUNTANT (no grant)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/apar/manual-payments/payment-1/retry-schedule-relief', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(403);
  });

  it('allows POST /manual-payments/:id/retry-schedule-relief to ADMIN', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/apar/manual-payments/payment-1/retry-schedule-relief', headers: authed('ADMIN') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ scheduleReliefStatus: 'RELIEVED' });
  });
});
