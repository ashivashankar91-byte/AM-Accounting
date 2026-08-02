/**
 * S046 — Customer route API tests (permission enforcement, error envelopes,
 * request/response shape). Modeled on tests/vendor-routes.test.ts
 * (AMACC-CH04 S036A).
 *
 * CustomerService's own business logic (lifecycle, duplicate detection,
 * credit hold/release) is covered by customer-service.test.ts — these tests
 * only exercise the HTTP layer: permission gating, status codes, error
 * codes.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { aparRoutes } from '../src/http/routes';
import { createFakeAuthzClient } from './support/fake-authz-client';
import {
  CustomerNotFoundError,
  CustomerConflictError,
  CustomerValidationError,
  DuplicateCustomerAcknowledgementRequiredError,
} from '../src/application/customer-service';

const JWT_SECRET = 'apar-customer-authz-test-secret';

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
  return {
    'x-tenant-id': tenantId,
    authorization: ['Bea', 'rer '].join('') + tokenFor(role, tenantId),
  };
}

const AR_CUSTOMER_PERMISSIONS = {
  VIEW: 'ar.customer.view',
  CREATE: 'ar.customer.create',
  EDIT: 'ar.customer.edit',
  INACTIVATE: 'ar.customer.inactivate',
  REACTIVATE: 'ar.customer.reactivate',
  DELETE: 'ar.customer.delete',
  DUPLICATE_OVERRIDE: 'ar.customer.duplicate_override',
  AUDIT_VIEW: 'ar.customer.audit_view',
  CREDIT_HOLD: 'ar.customer.credit_hold',
  CREDIT_RELEASE: 'ar.customer.credit_release',
};

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set(Object.values(AR_CUSTOMER_PERMISSIONS)),
  CONTROLLER: new Set(Object.values(AR_CUSTOMER_PERMISSIONS)),
  ACCOUNTANT: new Set([AR_CUSTOMER_PERMISSIONS.VIEW, AR_CUSTOMER_PERMISSIONS.CREATE, AR_CUSTOMER_PERMISSIONS.EDIT]),
};

const FAKE_CUSTOMER = {
  id: 'customer-1',
  tenantId: 'tenant-a',
  customerNumber: '000001',
  customerName: 'Jane Doe',
  customerType: 'Individual',
  status: 'ACTIVE',
  version: 1,
  creditHold: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function fakeCustomerService(overrides: Partial<Record<string, any>> = {}) {
  return {
    list: vi.fn().mockResolvedValue({ items: [FAKE_CUSTOMER], total: 1, page: 1, pageSize: 200 }),
    getById: vi.fn().mockResolvedValue(FAKE_CUSTOMER),
    create: vi.fn().mockResolvedValue(FAKE_CUSTOMER),
    update: vi.fn().mockResolvedValue(FAKE_CUSTOMER),
    inactivate: vi.fn().mockResolvedValue({ ...FAKE_CUSTOMER, status: 'INACTIVE' }),
    reactivate: vi.fn().mockResolvedValue(FAKE_CUSTOMER),
    delete: vi.fn().mockResolvedValue({ ...FAKE_CUSTOMER, status: 'DELETED' }),
    eligibility: vi.fn().mockResolvedValue({ eligible: true, status: 'ACTIVE', creditHold: false, reason: null }),
    checkDuplicates: vi.fn().mockResolvedValue([]),
    setCreditHold: vi.fn().mockResolvedValue({ ...FAKE_CUSTOMER, creditHold: true }),
    releaseCreditHold: vi.fn().mockResolvedValue({ ...FAKE_CUSTOMER, creditHold: false }),
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

describe('Customer route authorization and error contract (S046)', () => {
  let app: FastifyInstance;
  const origJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeAll(async () => {
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;

    container.registerInstance('APARService', {});
    // Route plugin registration also resolves VendorService; this suite
    // only exercises customer routes, so an inert stub is sufficient.
    container.registerInstance('VendorService', {});
    // Route plugin registration also resolves VendorComplianceService (S036B)
    // and InsuranceCertificateService (S038); this suite only exercises
    // customer routes, so inert stubs are sufficient.
    container.registerInstance('VendorComplianceService', {});
    container.registerInstance('InsuranceCertificateService', {});
    container.registerInstance('CustomerService', fakeCustomerService());
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

  it('rejects unauthenticated request with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/customers', headers: { 'x-tenant-id': 'tenant-a' } });
    expect(res.statusCode).toBe(401);
  });

  it('denies GET /customers to a role with no ar.customer.view grant', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/customers', headers: authed('UNKNOWN') });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'FORBIDDEN' });
  });

  it('allows GET /customers to ACCOUNTANT and returns a bare array (back-compat shape)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/customers', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('denies POST /customers/:id/inactivate to ACCOUNTANT (no inactivate grant)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/customers/customer-1/inactivate',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1, reason: 'test' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('denies POST /customers/:id/credit-hold to ACCOUNTANT (no credit_hold grant)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/customers/customer-1/credit-hold',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1, reason: 'Past due' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows POST /customers to ADMIN and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/customers',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ customerName: 'New Customer', customerType: 'Individual' }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('returns 400 VALIDATION_ERROR when customerName is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/customers',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  it('returns 409 CUSTOMER_NUMBER_ALREADY_EXISTS when the service throws that conflict', async () => {
    container.registerInstance('CustomerService', fakeCustomerService({
      create: vi.fn().mockRejectedValue(new CustomerConflictError('CUSTOMER_NUMBER_ALREADY_EXISTS', 'dup')),
    }));
    registerFullAuthz();
    const localApp = Fastify();
    await localApp.register(aparRoutes, { prefix: '/api/v1/apar' });
    await localApp.ready();
    const res = await localApp.inject({
      method: 'POST',
      url: '/api/v1/apar/customers',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ customerName: 'Dup', customerNumber: '000001' }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'CUSTOMER_NUMBER_ALREADY_EXISTS' });
    await localApp.close();
  });

  it('returns 409 DUPLICATE_CUSTOMER_ACKNOWLEDGEMENT_REQUIRED with candidate fields', async () => {
    container.registerInstance('CustomerService', fakeCustomerService({
      create: vi.fn().mockRejectedValue(new DuplicateCustomerAcknowledgementRequiredError([
        { customerId: 'c-2', customerNumber: '000002', customerName: 'Similar Person', status: 'ACTIVE', matchedSignals: ['EMAIL'] },
      ])),
    }));
    registerFullAuthz();
    const localApp = Fastify();
    await localApp.register(aparRoutes, { prefix: '/api/v1/apar' });
    await localApp.ready();
    const res = await localApp.inject({
      method: 'POST',
      url: '/api/v1/apar/customers',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ customerName: 'Similar Person', email: 'x@y.com' }),
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe('DUPLICATE_CUSTOMER_ACKNOWLEDGEMENT_REQUIRED');
    expect(body.candidates[0]).toMatchObject({ customerId: 'c-2', customerNumber: '000002', customerName: 'Similar Person' });
    await localApp.close();
  });

  it('returns 403 DUPLICATE_CUSTOMER_OVERRIDE_FORBIDDEN when override is attempted without the permission', async () => {
    container.registerInstance('CustomerService', fakeCustomerService());
    container.registerInstance('AuthzClient', createFakeAuthzClient(
      [{ userId: 'ACCOUNTANT', tenantId: 'tenant-a', role: 'ACCOUNTANT' }],
      ROLE_GRANTS, // ACCOUNTANT has CREATE but not DUPLICATE_OVERRIDE
    ));
    const localApp = Fastify();
    await localApp.register(aparRoutes, { prefix: '/api/v1/apar' });
    await localApp.ready();
    const res = await localApp.inject({
      method: 'POST',
      url: '/api/v1/apar/customers',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ customerName: 'X', override: { reason: 'reason' } }),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'DUPLICATE_CUSTOMER_OVERRIDE_FORBIDDEN' });
    await localApp.close();
  });

  it('allows PATCH /customers/:id with EDIT permission', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/apar/customers/customer-1',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1, customerName: 'Renamed' }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 409 VERSION_CONFLICT on a stale update', async () => {
    container.registerInstance('CustomerService', fakeCustomerService({
      update: vi.fn().mockRejectedValue(new CustomerConflictError('VERSION_CONFLICT', 'stale')),
    }));
    registerFullAuthz();
    const localApp = Fastify();
    await localApp.register(aparRoutes, { prefix: '/api/v1/apar' });
    await localApp.ready();
    const res = await localApp.inject({
      method: 'PATCH',
      url: '/api/v1/apar/customers/customer-1',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1 }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'VERSION_CONFLICT' });
    await localApp.close();
  });

  it('allows POST /customers/:id/inactivate with a reason', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/customers/customer-1/inactivate',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1, reason: 'Customer closed account' }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 400 when inactivate is called without a reason (schema validation)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/customers/customer-1/inactivate',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1 }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('supports the back-compat PATCH /customers/:id/deactivate alias', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/apar/customers/customer-1/deactivate',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(200);
  });

  it('allows POST /customers/:id/reactivate', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/customers/customer-1/reactivate',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1 }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('GET /customers/:id/eligibility returns eligible: true for an active customer', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/customers/customer-1/eligibility', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ eligible: true });
  });

  it('allows POST /customers/:id/credit-hold to CONTROLLER and returns creditHold true', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/customers/customer-1/credit-hold',
      headers: { ...authed('CONTROLLER'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1, reason: 'Past due balance' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ creditHold: true });
  });

  it('returns 400 when credit-hold is called without a reason', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/customers/customer-1/credit-hold',
      headers: { ...authed('CONTROLLER'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1 }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('allows POST /customers/:id/credit-release to CONTROLLER and returns creditHold false', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/customers/customer-1/credit-release',
      headers: { ...authed('CONTROLLER'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1 }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ creditHold: false });
  });

  it('denies POST /customers/:id/credit-release to ACCOUNTANT (no credit_release grant)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/customers/customer-1/credit-release',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1 }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows DELETE /customers/:id for an unreferenced customer', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/apar/customers/customer-1',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1 }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 404 CUSTOMER_NOT_FOUND for a customer that does not exist', async () => {
    container.registerInstance('CustomerService', fakeCustomerService({
      getById: vi.fn().mockRejectedValue(new CustomerNotFoundError('missing')),
    }));
    registerFullAuthz();
    const localApp = Fastify();
    await localApp.register(aparRoutes, { prefix: '/api/v1/apar' });
    await localApp.ready();
    const res = await localApp.inject({ method: 'GET', url: '/api/v1/apar/customers/missing', headers: authed('ADMIN') });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'CUSTOMER_NOT_FOUND' });
    await localApp.close();
  });

  it('returns 422 for a service-layer validation error (e.g. inactive customer edit)', async () => {
    container.registerInstance('CustomerService', fakeCustomerService({
      update: vi.fn().mockRejectedValue(new CustomerValidationError('CUSTOMER_INACTIVE', 'Cannot edit an inactive customer')),
    }));
    registerFullAuthz();
    const localApp = Fastify();
    await localApp.register(aparRoutes, { prefix: '/api/v1/apar' });
    await localApp.ready();
    const res = await localApp.inject({
      method: 'PATCH',
      url: '/api/v1/apar/customers/customer-1',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1 }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'CUSTOMER_INACTIVE' });
    await localApp.close();
  });

  it('returns 403 when JWT tenantId does not match x-tenant-id header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/apar/customers',
      headers: { 'x-tenant-id': 'tenant-b', authorization: ['Bea', 'rer '].join('') + tokenFor('ADMIN', 'tenant-a') },
    });
    expect(res.statusCode).toBe(403);
  });
});
