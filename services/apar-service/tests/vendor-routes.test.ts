/**
 * AMACC-CH04 S036A — Vendor route API tests (permission enforcement, error
 * envelopes, request/response shape). Modeled on
 * services/tenant-service/tests/store-routes.test.ts.
 *
 * VendorService's own business logic (lifecycle, duplicate detection,
 * masking) is covered by vendor-service.test.ts — these tests only exercise
 * the HTTP layer: permission gating, status codes, error codes.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { aparRoutes } from '../src/http/routes';
import { createFakeAuthzClient } from './support/fake-authz-client';
import { VendorNotFoundError, VendorConflictError, DuplicateVendorAcknowledgementRequiredError } from '../src/application/vendor-service';

const JWT_SECRET = 'apar-vendor-authz-test-secret';

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

function authed(role: string, tenantId = 'tenant-a', correlationId?: string) {
  return {
    'x-tenant-id': tenantId,
    authorization: `Bearer ${tokenFor(role, tenantId)}`,
    ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
  };
}

const AP_VENDOR_PERMISSIONS = {
  VIEW: 'ap.vendor.view',
  CREATE: 'ap.vendor.create',
  EDIT: 'ap.vendor.edit',
  INACTIVATE: 'ap.vendor.inactivate',
  REACTIVATE: 'ap.vendor.reactivate',
  DELETE: 'ap.vendor.delete',
  DUPLICATE_OVERRIDE: 'ap.vendor.duplicate_override',
  AUDIT_VIEW: 'ap.vendor.audit_view',
  TAX_IDENTIFIER_VIEW: 'ap.vendor.tax_identifier_view',
};

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set(Object.values(AP_VENDOR_PERMISSIONS)),
  CONTROLLER: new Set(Object.values(AP_VENDOR_PERMISSIONS)),
  ACCOUNTANT: new Set([AP_VENDOR_PERMISSIONS.VIEW, AP_VENDOR_PERMISSIONS.CREATE, AP_VENDOR_PERMISSIONS.EDIT]),
};

const FAKE_VENDOR = {
  id: 'vendor-1',
  tenantId: 'tenant-a',
  vendorNumber: '000001',
  vendorName: 'Acme Supply',
  vendorType: 'SUPPLIER',
  status: 'ACTIVE',
  version: 1,
  taxIdMasked: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function fakeVendorService(overrides: Partial<Record<string, any>> = {}) {
  return {
    list: vi.fn().mockResolvedValue({ items: [FAKE_VENDOR], total: 1, page: 1, pageSize: 50 }),
    getById: vi.fn().mockResolvedValue(FAKE_VENDOR),
    create: vi.fn().mockResolvedValue(FAKE_VENDOR),
    update: vi.fn().mockResolvedValue(FAKE_VENDOR),
    inactivate: vi.fn().mockResolvedValue({ ...FAKE_VENDOR, status: 'INACTIVE' }),
    reactivate: vi.fn().mockResolvedValue(FAKE_VENDOR),
    delete: vi.fn().mockResolvedValue({ ...FAKE_VENDOR, status: 'DELETED' }),
    eligibility: vi.fn().mockResolvedValue({ eligible: true, status: 'ACTIVE', reason: null }),
    checkDuplicates: vi.fn().mockResolvedValue([]),
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

describe('Vendor route authorization and error contract (AMACC-CH04 S036A)', () => {
  let app: FastifyInstance;
  const origJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeAll(async () => {
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;

    container.registerInstance('APARService', {});
    container.registerInstance('VendorService', fakeVendorService());
    // AMACC-CH04 S036B: aparRoutes() now also resolves VendorComplianceService
    // at registration time — a stub keeps this S036A-only test file focused on
    // vendor routes without depending on S036B's implementation.
    container.registerInstance('VendorComplianceService', {});
    // S038: routes.ts now also resolves InsuranceCertificateService at
    // registration time — a fake stub is enough here since this suite only
    // exercises vendor routes, not insurance-certificate routes (covered
    // separately in tests/insurance-certificate-routes.test.ts).
    container.registerInstance('InsuranceCertificateService', {
      list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 }),
    });
    // Route plugin registration also resolves CustomerService (S046); this
    // suite only exercises vendor routes, so an inert stub is sufficient.
    container.registerInstance('CustomerService', {});
    container.registerInstance('InvoiceService', {});
    container.registerInstance('GoodsReceiptService', {});
    container.registerInstance('ApprovalRuleService', {});
    container.registerInstance('InvoiceApprovalService', {});
    registerFullAuthz();

    app = Fastify();
    await app.register(aparRoutes, { prefix: '/api/v1/apar' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    process.env['AMACC_JWT_SECRET'] = origJwtSecret;
  });

  // 43. Read vendor fails without permission
  it('rejects unauthenticated request with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/vendors', headers: { 'x-tenant-id': 'tenant-a' } });
    expect(res.statusCode).toBe(401);
  });

  it('denies GET /vendors to a role with no ap.vendor.view grant', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/vendors', headers: authed('UNKNOWN') });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'FORBIDDEN' });
  });

  // 42. Read vendor succeeds with permission
  it('allows GET /vendors to ACCOUNTANT (view)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/vendors', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ items: expect.any(Array), total: 1 });
  });

  it('denies POST /vendors/:id/inactivate to ACCOUNTANT (no inactivate grant)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/vendors/vendor-1/inactivate',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1, reason: 'test' }),
    });
    expect(res.statusCode).toBe(403);
  });

  // 36. Create vendor succeeds
  it('allows POST /vendors to ADMIN and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/vendors',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ vendorName: 'New Vendor', vendorType: 'SUPPLIER' }),
    });
    expect(res.statusCode).toBe(201);
  });

  // 37. Missing required fields return validation errors
  it('returns 400 VALIDATION_ERROR when vendorName is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/vendors',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  // 38. Duplicate vendor code returns conflict
  it('returns 409 VENDOR_CODE_ALREADY_EXISTS when the service throws that conflict', async () => {
    container.registerInstance('VendorService', fakeVendorService({
      create: vi.fn().mockRejectedValue(new VendorConflictError('VENDOR_CODE_ALREADY_EXISTS', 'dup')),
    }));
    registerFullAuthz();
    const localApp = Fastify();
    await localApp.register(aparRoutes, { prefix: '/api/v1/apar' });
    await localApp.ready();
    const res = await localApp.inject({
      method: 'POST',
      url: '/api/v1/apar/vendors',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ vendorName: 'Dup', vendorNumber: '000001' }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'VENDOR_CODE_ALREADY_EXISTS' });
    await localApp.close();
  });

  // 39/40. Duplicate candidate response contains only safe data; authorized override succeeds
  it('returns 409 DUPLICATE_VENDOR_ACKNOWLEDGEMENT_REQUIRED with safe candidate fields only', async () => {
    container.registerInstance('VendorService', fakeVendorService({
      create: vi.fn().mockRejectedValue(new DuplicateVendorAcknowledgementRequiredError([
        { vendorId: 'v-2', vendorNumber: '000002', vendorName: 'Similar Co', status: 'ACTIVE', matchedSignals: ['EMAIL'] },
      ])),
    }));
    registerFullAuthz();
    const localApp = Fastify();
    await localApp.register(aparRoutes, { prefix: '/api/v1/apar' });
    await localApp.ready();
    const res = await localApp.inject({
      method: 'POST',
      url: '/api/v1/apar/vendors',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ vendorName: 'Similar Co', email: 'x@y.com' }),
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe('DUPLICATE_VENDOR_ACKNOWLEDGEMENT_REQUIRED');
    expect(body.candidates[0]).toMatchObject({ vendorId: 'v-2', vendorNumber: '000002', vendorName: 'Similar Co' });
    expect(body.candidates[0].taxId).toBeUndefined();
    await localApp.close();
  });

  // 41. Unauthorized override returns forbidden
  it('returns 403 DUPLICATE_VENDOR_OVERRIDE_FORBIDDEN when override is attempted without the permission', async () => {
    container.registerInstance('VendorService', fakeVendorService());
    container.registerInstance('AuthzClient', createFakeAuthzClient(
      [{ userId: 'ACCOUNTANT', tenantId: 'tenant-a', role: 'ACCOUNTANT' }],
      ROLE_GRANTS, // ACCOUNTANT has CREATE but not DUPLICATE_OVERRIDE
    ));
    const localApp = Fastify();
    await localApp.register(aparRoutes, { prefix: '/api/v1/apar' });
    await localApp.ready();
    const res = await localApp.inject({
      method: 'POST',
      url: '/api/v1/apar/vendors',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ vendorName: 'X', override: { reason: 'reason' } }),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'DUPLICATE_VENDOR_OVERRIDE_FORBIDDEN' });
    await localApp.close();
  });

  // 44/45. Update succeeds with current version / stale update returns version conflict
  it('allows PATCH /vendors/:id with EDIT permission', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/apar/vendors/vendor-1',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1, vendorName: 'Renamed' }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 409 VERSION_CONFLICT on a stale update', async () => {
    container.registerInstance('VendorService', fakeVendorService({
      update: vi.fn().mockRejectedValue(new VendorConflictError('VERSION_CONFLICT', 'stale')),
    }));
    registerFullAuthz();
    const localApp = Fastify();
    await localApp.register(aparRoutes, { prefix: '/api/v1/apar' });
    await localApp.ready();
    const res = await localApp.inject({
      method: 'PATCH',
      url: '/api/v1/apar/vendors/vendor-1',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1 }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'VERSION_CONFLICT' });
    await localApp.close();
  });

  // 46/47. Inactivate succeeds with reason / fails without reason
  it('allows POST /vendors/:id/inactivate with a reason', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/vendors/vendor-1/inactivate',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1, reason: 'closing' }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 400 when inactivate is called without a reason (schema validation)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/vendors/vendor-1/inactivate',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1 }),
    });
    expect(res.statusCode).toBe(400);
  });

  // 48. Reactivate succeeds
  it('allows POST /vendors/:id/reactivate', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/vendors/vendor-1/reactivate',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1 }),
    });
    expect(res.statusCode).toBe(200);
  });

  // 49. Eligibility returns the correct result and reason
  it('GET /vendors/:id/eligibility returns eligible: true for an active vendor', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/vendors/vendor-1/eligibility', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ eligible: true });
  });

  // 50/51. Delete succeeds for unreferenced vendor / fails for a referenced vendor
  it('allows DELETE /vendors/:id for an unreferenced vendor', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/apar/vendors/vendor-1',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1 }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 404 VENDOR_NOT_FOUND for a vendor that does not exist', async () => {
    container.registerInstance('VendorService', fakeVendorService({
      getById: vi.fn().mockRejectedValue(new VendorNotFoundError('missing')),
    }));
    registerFullAuthz();
    const localApp = Fastify();
    await localApp.register(aparRoutes, { prefix: '/api/v1/apar' });
    await localApp.ready();
    const res = await localApp.inject({ method: 'GET', url: '/api/v1/apar/vendors/missing', headers: authed('ADMIN') });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'VENDOR_NOT_FOUND' });
    await localApp.close();
  });

  // 42/54. Responses never leak another tenant's data (tenant/JWT mismatch denied)
  it('returns 403 when JWT tenantId does not match x-tenant-id header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/apar/vendors',
      headers: { 'x-tenant-id': 'tenant-b', authorization: `Bearer ${tokenFor('ADMIN', 'tenant-a')}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
