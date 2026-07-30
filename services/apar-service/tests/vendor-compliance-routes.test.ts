/**
 * AMACC-CH04 S036B — Vendor compliance route API tests (permission
 * enforcement, error envelopes, request/response shape). Modeled on
 * vendor-routes.test.ts.
 *
 * VendorComplianceService's own business logic is covered by
 * vendor-compliance-service.test.ts — these tests only exercise the HTTP
 * layer: permission gating, status codes, error codes.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { aparRoutes } from '../src/http/routes';
import { createFakeAuthzClient } from './support/fake-authz-client';
import {
  ComplianceCheckNotFoundError,
  ComplianceCheckConflictError,
  ComplianceCheckValidationError,
  VendorNotFoundForComplianceError,
} from '../src/application/vendor-compliance-service';

const JWT_SECRET = 'apar-vendor-compliance-authz-test-secret';

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

const AP_VENDOR_COMPLIANCE_PERMISSIONS = {
  VIEW: 'ap.vendor_compliance.view',
  CREATE: 'ap.vendor_compliance.create',
  EDIT: 'ap.vendor_compliance.edit',
  RUN_VERIFICATION: 'ap.vendor_compliance.run_verification',
  REVIEW: 'ap.vendor_compliance.review',
};

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set(Object.values(AP_VENDOR_COMPLIANCE_PERMISSIONS)),
  CONTROLLER: new Set(Object.values(AP_VENDOR_COMPLIANCE_PERMISSIONS)),
  ACCOUNTANT: new Set([
    AP_VENDOR_COMPLIANCE_PERMISSIONS.VIEW,
    AP_VENDOR_COMPLIANCE_PERMISSIONS.CREATE,
    AP_VENDOR_COMPLIANCE_PERMISSIONS.EDIT,
    AP_VENDOR_COMPLIANCE_PERMISSIONS.RUN_VERIFICATION,
  ]),
};

const FAKE_CHECK = {
  id: 'check-1',
  tenantId: 'tenant-a',
  vendorId: 'vendor-1',
  checkType: 'INSURANCE_CERTIFICATE',
  status: 'PENDING_REVIEW',
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function fakeComplianceService(overrides: Partial<Record<string, any>> = {}) {
  return {
    list: vi.fn().mockResolvedValue([FAKE_CHECK]),
    getById: vi.fn().mockResolvedValue(FAKE_CHECK),
    create: vi.fn().mockResolvedValue(FAKE_CHECK),
    update: vi.fn().mockResolvedValue(FAKE_CHECK),
    runVerification: vi.fn().mockResolvedValue({ ...FAKE_CHECK, status: 'NOT_CONFIGURED', providerName: 'MANUAL' }),
    review: vi.fn().mockResolvedValue({ ...FAKE_CHECK, status: 'VERIFIED' }),
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

async function buildApp(complianceOverrides: Partial<Record<string, any>> = {}) {
  container.registerInstance('APARService', {});
  container.registerInstance('VendorService', {});
  // Route plugin registration also resolves InsuranceCertificateService (S038)
  // and CustomerService (S046); this suite only exercises vendor-compliance
  // routes, so inert stubs are sufficient.
  container.registerInstance('InsuranceCertificateService', {});
  container.registerInstance('CustomerService', {});
  container.registerInstance('VendorComplianceService', fakeComplianceService(complianceOverrides));
    container.registerInstance('InvoiceService', {});
    container.registerInstance('GoodsReceiptService', {});
    container.registerInstance('ApprovalRuleService', {});
    container.registerInstance('InvoiceApprovalService', {});
  registerFullAuthz();
  const app = Fastify();
  await app.register(aparRoutes, { prefix: '/api/v1/apar' });
  await app.ready();
  return app;
}

describe('Vendor compliance route authorization and error contract (AMACC-CH04 S036B)', () => {
  let app: FastifyInstance;
  const origJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeAll(async () => {
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    process.env['AMACC_JWT_SECRET'] = origJwtSecret;
  });

  it('rejects unauthenticated request with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/vendors/vendor-1/compliance-checks', headers: { 'x-tenant-id': 'tenant-a' } });
    expect(res.statusCode).toBe(401);
  });

  it('denies GET compliance-checks to a role with no grant', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/vendors/vendor-1/compliance-checks', headers: authed('UNKNOWN') });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'FORBIDDEN' });
  });

  it('allows GET compliance-checks to ACCOUNTANT (view)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/vendors/vendor-1/compliance-checks', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([FAKE_CHECK]);
  });

  it('allows POST compliance-checks (create) to ACCOUNTANT and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/vendors/vendor-1/compliance-checks',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ checkType: 'INSURANCE_CERTIFICATE' }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('returns 400 VALIDATION_ERROR for an unsupported checkType', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/vendors/vendor-1/compliance-checks',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ checkType: 'NOT_A_TYPE' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  it('returns 404 VENDOR_NOT_FOUND when the service reports the vendor is missing', async () => {
    const localApp = await buildApp({ create: vi.fn().mockRejectedValue(new VendorNotFoundForComplianceError('vendor-1')) });
    const res = await localApp.inject({
      method: 'POST',
      url: '/api/v1/apar/vendors/vendor-1/compliance-checks',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ checkType: 'INSURANCE_CERTIFICATE' }),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'VENDOR_NOT_FOUND' });
    await localApp.close();
  });

  it('denies run-verification to a role without the grant', async () => {
    container.registerInstance('AuthzClient', createFakeAuthzClient(
      [{ userId: 'NOGRANT', tenantId: 'tenant-a', role: 'NOGRANT' }],
      { NOGRANT: new Set([AP_VENDOR_COMPLIANCE_PERMISSIONS.VIEW]) },
    ));
    const localApp = Fastify();
    container.registerInstance('VendorComplianceService', fakeComplianceService());
    await localApp.register(aparRoutes, { prefix: '/api/v1/apar' });
    await localApp.ready();
    const res = await localApp.inject({
      method: 'POST',
      url: '/api/v1/apar/vendors/vendor-1/compliance-checks/check-1/run-verification',
      headers: authed('NOGRANT'),
    });
    expect(res.statusCode).toBe(403);
    await localApp.close();
    registerFullAuthz();
  });

  it('run-verification never returns a fabricated VERIFIED status (manual adapter contract)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/vendors/vendor-1/compliance-checks/check-1/run-verification',
      headers: authed('ACCOUNTANT'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('NOT_CONFIGURED');
  });

  it('denies review to ACCOUNTANT (no review grant) — review is ADMIN/CONTROLLER only', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/vendors/vendor-1/compliance-checks/check-1/review',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1, decision: 'VERIFIED' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows review to CONTROLLER and returns the decision', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/vendors/vendor-1/compliance-checks/check-1/review',
      headers: { ...authed('CONTROLLER'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1, decision: 'VERIFIED' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('VERIFIED');
  });

  it('returns 422 REASON_REQUIRED when rejecting without a reason (service-layer validation)', async () => {
    const localApp = await buildApp({ review: vi.fn().mockRejectedValue(new ComplianceCheckValidationError('REASON_REQUIRED', 'A reason is required to reject a compliance check')) });
    const res = await localApp.inject({
      method: 'POST',
      url: '/api/v1/apar/vendors/vendor-1/compliance-checks/check-1/review',
      headers: { ...authed('CONTROLLER'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1, decision: 'REJECTED' }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'REASON_REQUIRED' });
    await localApp.close();
  });

  it('returns 409 VERSION_CONFLICT on a stale review', async () => {
    const localApp = await buildApp({ review: vi.fn().mockRejectedValue(new ComplianceCheckConflictError('VERSION_CONFLICT', 'stale')) });
    const res = await localApp.inject({
      method: 'POST',
      url: '/api/v1/apar/vendors/vendor-1/compliance-checks/check-1/review',
      headers: { ...authed('CONTROLLER'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1, decision: 'VERIFIED' }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'VERSION_CONFLICT' });
    await localApp.close();
  });

  it('returns 404 COMPLIANCE_CHECK_NOT_FOUND for a check that does not exist', async () => {
    const localApp = await buildApp({ getById: vi.fn().mockRejectedValue(new ComplianceCheckNotFoundError('missing')) });
    const res = await localApp.inject({ method: 'GET', url: '/api/v1/apar/vendors/vendor-1/compliance-checks/missing', headers: authed('ADMIN') });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'COMPLIANCE_CHECK_NOT_FOUND' });
    await localApp.close();
  });

  it('returns 403 when JWT tenantId does not match x-tenant-id header (tenant isolation)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/apar/vendors/vendor-1/compliance-checks',
      headers: { 'x-tenant-id': 'tenant-b', authorization: `Bearer ${tokenFor('ADMIN', 'tenant-a')}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows PATCH compliance-checks/:id (edit) to ADMIN', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/apar/vendors/vendor-1/compliance-checks/check-1',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1, jurisdiction: 'IL' }),
    });
    expect(res.statusCode).toBe(200);
  });
});
