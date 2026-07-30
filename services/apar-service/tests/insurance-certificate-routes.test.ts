/**
 * AMACC-CH04 S038 — Vendor Insurance Certificate route API tests
 * (permission enforcement, error envelopes, request/response shape).
 * Modeled directly on tests/vendor-routes.test.ts (S036A).
 *
 * InsuranceCertificateService's own business logic (lifecycle, expiration,
 * duplicate protection, optimistic concurrency) is covered by
 * insurance-certificate-service.test.ts — these tests only exercise the HTTP
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
  InsuranceCertificateNotFoundError,
  VendorNotFoundForCertificateError,
  InsuranceCertificateConflictError,
  InsuranceCertificateValidationError,
} from '../src/application/insurance-certificate-service';

const JWT_SECRET = 'apar-insurance-authz-test-secret';

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
    authorization: 'Bearer ' + tokenFor(role, tenantId),
  };
}

const AP_VENDOR_INSURANCE_PERMISSIONS = {
  VIEW: 'ap.vendor_insurance.view',
  CREATE: 'ap.vendor_insurance.create',
  EDIT: 'ap.vendor_insurance.edit',
  RENEW: 'ap.vendor_insurance.renew',
  REVOKE: 'ap.vendor_insurance.revoke',
  AUDIT_VIEW: 'ap.vendor_insurance.audit_view',
};

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set(Object.values(AP_VENDOR_INSURANCE_PERMISSIONS)),
  CONTROLLER: new Set(Object.values(AP_VENDOR_INSURANCE_PERMISSIONS)),
  ACCOUNTANT: new Set([
    AP_VENDOR_INSURANCE_PERMISSIONS.VIEW,
    AP_VENDOR_INSURANCE_PERMISSIONS.CREATE,
    AP_VENDOR_INSURANCE_PERMISSIONS.EDIT,
    AP_VENDOR_INSURANCE_PERMISSIONS.RENEW,
  ]),
  // A role with NO ap.vendor_insurance.* grant at all — used to prove an
  // unauthorized user is rejected, not merely un-tested.
  NO_GRANT: new Set<string>(),
};

const FAKE_CERT = {
  id: 'cert-1',
  tenantId: 'tenant-a',
  vendorId: 'vendor-1',
  certificateNumber: 'POL-100',
  insuranceProvider: 'Acme Insurance Co',
  insuranceType: 'GENERAL_LIABILITY',
  effectiveDate: new Date('2026-01-01').toISOString(),
  expirationDate: new Date('2027-01-01').toISOString(),
  status: 'ACTIVE',
  isCurrent: true,
  version: 1,
  expirationStatus: 'CURRENT',
};

function fakeInsuranceService(overrides: Partial<Record<string, any>> = {}) {
  return {
    list: vi.fn().mockResolvedValue({ items: [FAKE_CERT], total: 1, page: 1, pageSize: 50 }),
    getById: vi.fn().mockResolvedValue(FAKE_CERT),
    getVendorInsuranceSummary: vi.fn().mockResolvedValue({ vendorId: 'vendor-1', certificates: [FAKE_CERT] }),
    create: vi.fn().mockResolvedValue(FAKE_CERT),
    update: vi.fn().mockResolvedValue(FAKE_CERT),
    renew: vi.fn().mockResolvedValue({ ...FAKE_CERT, id: 'cert-2' }),
    revoke: vi.fn().mockResolvedValue({ ...FAKE_CERT, status: 'REVOKED' }),
    ...overrides,
  };
}

function registerFullAuthz() {
  container.registerInstance('AuthzClient', createFakeAuthzClient(
    [
      { userId: 'ADMIN', tenantId: 'tenant-a', role: 'ADMIN' },
      { userId: 'CONTROLLER', tenantId: 'tenant-a', role: 'CONTROLLER' },
      { userId: 'ACCOUNTANT', tenantId: 'tenant-a', role: 'ACCOUNTANT' },
      { userId: 'NO_GRANT', tenantId: 'tenant-a', role: 'NO_GRANT' },
    ],
    ROLE_GRANTS,
  ));
}

const validCreateBody = {
  certificateNumber: 'POL-100',
  insuranceProvider: 'Acme Insurance Co',
  insuranceType: 'GENERAL_LIABILITY',
  effectiveDate: '2026-01-01',
  expirationDate: '2027-01-01',
};

describe('Vendor Insurance Certificate route authorization and error contract (AMACC-CH04 S038)', () => {
  let app: FastifyInstance;
  const origJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeAll(async () => {
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;

    container.registerInstance('APARService', {});
    container.registerInstance('VendorService', { list: vi.fn().mockResolvedValue({ items: [], total: 0 }) });
    // Route plugin registration also resolves VendorComplianceService (S036B)
    // and CustomerService (S046); this suite only exercises insurance-
    // certificate routes, so inert stubs are sufficient.
    container.registerInstance('VendorComplianceService', {});
    container.registerInstance('CustomerService', {});
    container.registerInstance('InsuranceCertificateService', fakeInsuranceService());
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
    if (origJwtSecret === undefined) delete process.env['AMACC_JWT_SECRET'];
    else process.env['AMACC_JWT_SECRET'] = origJwtSecret;
  });

  // ── Permission-aware controls ─────────────────────────────────────────────
  it('rejects list without any ap.vendor_insurance.* grant (401/403, not data)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/vendors/vendor-1/insurance-certificates', headers: authed('NO_GRANT') });
    expect([401, 403]).toContain(res.statusCode);
  });

  it('allows list for a role with ap.vendor_insurance.view', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/vendors/vendor-1/insurance-certificates', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBe(1);
  });

  it('rejects revoke for ACCOUNTANT (no ap.vendor_insurance.revoke grant)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/insurance-certificates/cert-1/revoke',
      headers: authed('ACCOUNTANT'),
      payload: { version: 1, reason: 'Policy cancelled' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows revoke for CONTROLLER (has ap.vendor_insurance.revoke grant)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/insurance-certificates/cert-1/revoke',
      headers: authed('CONTROLLER'),
      payload: { version: 1, reason: 'Policy cancelled' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects audit-events view for ACCOUNTANT (no ap.vendor_insurance.audit_view grant)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/insurance-certificates/cert-1/audit-events', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(403);
  });

  // ── Create ─────────────────────────────────────────────────────────────────
  it('creates a certificate for an authorized role', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/vendors/vendor-1/insurance-certificates',
      headers: authed('ADMIN'),
      payload: validCreateBody,
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects create with a 400 validation error for a malformed body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/vendors/vendor-1/insurance-certificates',
      headers: authed('ADMIN'),
      payload: { ...validCreateBody, insuranceType: 'NOT_A_TYPE' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
  });

  it('maps VendorNotFoundForCertificateError to 404', async () => {
    container.registerInstance('InsuranceCertificateService', fakeInsuranceService({
      create: vi.fn().mockRejectedValue(new VendorNotFoundForCertificateError('vendor-x')),
    }));
    registerFullAuthz();
    const localApp = Fastify();
    await localApp.register(aparRoutes, { prefix: '/api/v1/apar' });
    await localApp.ready();
    const res = await localApp.inject({
      method: 'POST',
      url: '/api/v1/apar/vendors/vendor-x/insurance-certificates',
      headers: authed('ADMIN'),
      payload: validCreateBody,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('VENDOR_NOT_FOUND');
    await localApp.close();
    container.registerInstance('InsuranceCertificateService', fakeInsuranceService());
  });

  it('maps InsuranceCertificateConflictError (duplicate active) to 409', async () => {
    container.registerInstance('InsuranceCertificateService', fakeInsuranceService({
      create: vi.fn().mockRejectedValue(new InsuranceCertificateConflictError('DUPLICATE_ACTIVE_CERTIFICATE', 'dup')),
    }));
    registerFullAuthz();
    const localApp = Fastify();
    await localApp.register(aparRoutes, { prefix: '/api/v1/apar' });
    await localApp.ready();
    const res = await localApp.inject({
      method: 'POST',
      url: '/api/v1/apar/vendors/vendor-1/insurance-certificates',
      headers: authed('ADMIN'),
      payload: validCreateBody,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('DUPLICATE_ACTIVE_CERTIFICATE');
    await localApp.close();
    container.registerInstance('InsuranceCertificateService', fakeInsuranceService());
  });

  // ── Update (optimistic concurrency) ─────────────────────────────────────────
  it('maps a version-conflict update to 409', async () => {
    container.registerInstance('InsuranceCertificateService', fakeInsuranceService({
      update: vi.fn().mockRejectedValue(new InsuranceCertificateConflictError('VERSION_CONFLICT', 'stale')),
    }));
    registerFullAuthz();
    const localApp = Fastify();
    await localApp.register(aparRoutes, { prefix: '/api/v1/apar' });
    await localApp.ready();
    const res = await localApp.inject({
      method: 'PATCH',
      url: '/api/v1/apar/insurance-certificates/cert-1',
      headers: authed('ADMIN'),
      payload: { version: 1, notes: 'x' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('VERSION_CONFLICT');
    await localApp.close();
    container.registerInstance('InsuranceCertificateService', fakeInsuranceService());
  });

  it('404s update for an unknown certificate', async () => {
    container.registerInstance('InsuranceCertificateService', fakeInsuranceService({
      update: vi.fn().mockRejectedValue(new InsuranceCertificateNotFoundError('missing')),
    }));
    registerFullAuthz();
    const localApp = Fastify();
    await localApp.register(aparRoutes, { prefix: '/api/v1/apar' });
    await localApp.ready();
    const res = await localApp.inject({
      method: 'PATCH',
      url: '/api/v1/apar/insurance-certificates/missing',
      headers: authed('ADMIN'),
      payload: { version: 1, notes: 'x' },
    });
    expect(res.statusCode).toBe(404);
    await localApp.close();
    container.registerInstance('InsuranceCertificateService', fakeInsuranceService());
  });

  // ── Renew ────────────────────────────────────────────────────────────────
  it('renews for an authorized role and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/insurance-certificates/cert-1/renew',
      headers: authed('ADMIN'),
      payload: { ...validCreateBody, version: 1 },
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects renew for a role without ap.vendor_insurance.renew', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/insurance-certificates/cert-1/renew',
      headers: authed('NO_GRANT'),
      payload: { ...validCreateBody, version: 1 },
    });
    expect([401, 403]).toContain(res.statusCode);
  });

  // ── S036B integration point ─────────────────────────────────────────────
  it('exposes the vendor insurance summary with no verification/compliance field', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/vendors/vendor-1/insurance-summary', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.vendorId).toBe('vendor-1');
    for (const cert of body.certificates) {
      expect(cert).not.toHaveProperty('verified');
      expect(cert).not.toHaveProperty('complianceStatus');
    }
  });

  // ── Expiring list requires withinDays (no invented default) ──────────────
  it('rejects the expiring list without withinDays', async () => {
    container.registerInstance('InsuranceCertificateService', fakeInsuranceService({
      list: vi.fn().mockRejectedValue(new InsuranceCertificateValidationError('WITHIN_DAYS_REQUIRED', 'withinDays is required')),
    }));
    registerFullAuthz();
    const localApp = Fastify();
    await localApp.register(aparRoutes, { prefix: '/api/v1/apar' });
    await localApp.ready();
    const res = await localApp.inject({ method: 'GET', url: '/api/v1/apar/insurance-certificates/expiring', headers: authed('ADMIN') });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('WITHIN_DAYS_REQUIRED');
    await localApp.close();
    container.registerInstance('InsuranceCertificateService', fakeInsuranceService());
  });

  it('accepts the expiring list with withinDays', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/insurance-certificates/expiring?withinDays=30', headers: authed('ADMIN') });
    expect(res.statusCode).toBe(200);
  });
});
