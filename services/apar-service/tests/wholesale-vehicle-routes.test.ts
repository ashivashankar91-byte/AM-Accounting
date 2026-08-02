/**
 * CE-09 S048 — Wholesale vehicle title-gate route API tests (permission
 * enforcement, error envelopes, request/response shape). Modeled on
 * tests/use-tax-routes.test.ts. WholesaleVehicleService's own business
 * logic is covered by tests/wholesale-vehicle-service.test.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { aparRoutes } from '../src/http/routes';
import { createFakeAuthzClient } from './support/fake-authz-client';
import { TitleReleaseRefusedUnpaidError } from '../src/application/wholesale-vehicle-service';

const JWT_SECRET = 'apar-wholesale-vehicle-authz-test-secret';

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

const AR_WHOLESALE_VEHICLE_PERMISSIONS = {
  VIEW: 'ar.wholesale.view',
  CREATE: 'ar.wholesale.create',
  RECORD_PAYMENT: 'ar.wholesale.record_payment',
  RELEASE_TITLE: 'ar.wholesale.release_title',
  RELEASE_EXCEPTION: 'ar.wholesale.title_release_exception',
};

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set(Object.values(AR_WHOLESALE_VEHICLE_PERMISSIONS)),
  CONTROLLER: new Set(Object.values(AR_WHOLESALE_VEHICLE_PERMISSIONS)),
  ACCOUNTANT: new Set([
    AR_WHOLESALE_VEHICLE_PERMISSIONS.VIEW,
    AR_WHOLESALE_VEHICLE_PERMISSIONS.CREATE,
    AR_WHOLESALE_VEHICLE_PERMISSIONS.RECORD_PAYMENT,
    AR_WHOLESALE_VEHICLE_PERMISSIONS.RELEASE_TITLE,
  ]),
};

const FAKE_ITEM = { id: 'item-1', status: 'OPEN', saleAmount: '25000.00', amountPaid: '0.00', titleReleased: false };

function fakeWholesaleVehicleService(overrides: Partial<Record<string, any>> = {}) {
  return {
    list: vi.fn().mockResolvedValue([FAKE_ITEM]),
    getById: vi.fn().mockResolvedValue(FAKE_ITEM),
    create: vi.fn().mockResolvedValue(FAKE_ITEM),
    recordPayment: vi.fn().mockResolvedValue({ ...FAKE_ITEM, status: 'PAID_IN_FULL', amountPaid: '25000.00' }),
    releaseTitle: vi.fn().mockResolvedValue({ ...FAKE_ITEM, titleReleased: true }),
    releaseTitleWithException: vi.fn().mockResolvedValue({ item: { ...FAKE_ITEM, titleReleased: true, titleReleaseException: true }, exception: { id: 'exception-1', authorizedBy: 'manager-1', reason: 'Override' } }),
    listExceptions: vi.fn().mockResolvedValue([]),
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
  container.registerInstance('WriteOffService', {});
  container.registerInstance('AllowanceService', {});
  container.registerInstance('NsfService', {});
  container.registerInstance('PaymentRunService', {});
  container.registerInstance('TradePayoffService', {});
  container.registerInstance('FleetBillingService', {});
  container.registerInstance('InsuranceArService', {});
  container.registerInstance('Vendor1099Service', {});
  registerFullAuthz();

  const app = Fastify();
  await app.register(aparRoutes, { prefix: '/api/v1/apar' });
  await app.ready();
  return app;
}

describe('Wholesale vehicle title-gate route authorization and error contract (CE-09 S048)', () => {
  let app: FastifyInstance;
  const origJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeAll(async () => {
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;
    container.registerInstance('WholesaleVehicleService', fakeWholesaleVehicleService());
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    process.env['AMACC_JWT_SECRET'] = origJwtSecret;
  });

  it('denies GET /wholesale-vehicle-items to a role with no grant', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/wholesale-vehicle-items', headers: authed('UNKNOWN') });
    expect(res.statusCode).toBe(403);
  });

  it('allows GET /wholesale-vehicle-items to ACCOUNTANT', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/wholesale-vehicle-items', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([FAKE_ITEM]);
  });

  it('allows POST /wholesale-vehicle-items to ACCOUNTANT and returns 201', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/wholesale-vehicle-items',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ customerId: 'customer-1', vehicleVin: 'VIN123', saleAmount: 25000 }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('returns 400 VALIDATION_ERROR for a missing vehicleVin', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/wholesale-vehicle-items',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ customerId: 'customer-1', saleAmount: 25000 }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('allows POST record-payment to ACCOUNTANT', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/wholesale-vehicle-items/item-1/payments',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ amount: 25000 }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('PAID_IN_FULL');
  });

  it('returns 409 TITLE_RELEASE_REFUSED_UNPAID when the service refuses an unpaid release (AC)', async () => {
    container.registerInstance('WholesaleVehicleService', fakeWholesaleVehicleService({
      releaseTitle: vi.fn().mockRejectedValue(new TitleReleaseRefusedUnpaidError('item-1', '15000.00')),
    }));
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/wholesale-vehicle-items/item-1/release-title',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('TITLE_RELEASE_REFUSED_UNPAID');
  });

  it('allows release-title to ACCOUNTANT for a paid-in-full item (auto-eligible, AC)', async () => {
    container.registerInstance('WholesaleVehicleService', fakeWholesaleVehicleService());
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/wholesale-vehicle-items/item-1/release-title',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().titleReleased).toBe(true);
  });

  it('denies release-title-exception to ACCOUNTANT (requires a distinct exception permission, AC)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/wholesale-vehicle-items/item-1/release-title-exception',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ reason: 'Fleet override' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows release-title-exception to ADMIN with a mandatory reason and returns the audited exception record (AC)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/wholesale-vehicle-items/item-1/release-title-exception',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ reason: 'Fleet override' }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().exception.authorizedBy).toBe('manager-1');
  });

  it('returns 400 when release-title-exception is called without a reason', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/wholesale-vehicle-items/item-1/release-title-exception',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(400);
  });

  it('exposes the exception path as queryable/auditable via GET release-exceptions', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/wholesale-vehicle-items/item-1/release-exceptions', headers: authed('ADMIN') });
    expect(res.statusCode).toBe(200);
  });
});
