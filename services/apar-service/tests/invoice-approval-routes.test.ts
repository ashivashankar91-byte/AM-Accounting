/**
 * AMACC-CH04 S041 — Invoice approval route API tests (permission
 * enforcement, error envelopes, request/response shape). Modeled on
 * tests/invoice-routes.test.ts. InvoiceApprovalService/ApprovalRuleService's
 * own business logic is covered by their dedicated service test files.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { aparRoutes } from '../src/http/routes';
import { createFakeAuthzClient } from './support/fake-authz-client';
import { WrongApproverRoleError, ApprovalAlreadyDecidedError } from '../src/application/invoice-approval-service';

const JWT_SECRET = 'apar-approval-authz-test-secret';

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

const AP_INVOICE_APPROVAL_PERMISSIONS = {
  VIEW: 'ap.invoice_approval.view',
  CONFIGURE: 'ap.invoice_approval.configure',
  START: 'ap.invoice_approval.start',
  APPROVE: 'ap.invoice_approval.approve',
  REJECT: 'ap.invoice_approval.reject',
  RETRY_GL_POSTING: 'ap.invoice_approval.retry_gl_posting',
};

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set(Object.values(AP_INVOICE_APPROVAL_PERMISSIONS)),
  CONTROLLER: new Set(Object.values(AP_INVOICE_APPROVAL_PERMISSIONS)),
  ACCOUNTANT: new Set([
    AP_INVOICE_APPROVAL_PERMISSIONS.VIEW, AP_INVOICE_APPROVAL_PERMISSIONS.START,
    AP_INVOICE_APPROVAL_PERMISSIONS.APPROVE, AP_INVOICE_APPROVAL_PERMISSIONS.REJECT,
  ]),
};

const FAKE_INSTANCE = { id: 'instance-1', invoiceId: 'invoice-1', status: 'PENDING', steps: [] };
const FAKE_RULE = { id: 'rule-1', tenantId: 'tenant-a', thresholdAmount: '1000.00', requiredRole: 'CONTROLLER', sequence: 1, isActive: true };

function fakeApprovalRuleService(overrides: Partial<Record<string, any>> = {}) {
  return {
    list: vi.fn().mockResolvedValue([FAKE_RULE]),
    create: vi.fn().mockResolvedValue(FAKE_RULE),
    update: vi.fn().mockResolvedValue(FAKE_RULE),
    ...overrides,
  };
}

function fakeInvoiceApprovalService(overrides: Partial<Record<string, any>> = {}) {
  return {
    getInstance: vi.fn().mockResolvedValue(FAKE_INSTANCE),
    start: vi.fn().mockResolvedValue(FAKE_INSTANCE),
    approveStep: vi.fn().mockResolvedValue({ ...FAKE_INSTANCE, status: 'APPROVED' }),
    rejectStep: vi.fn().mockResolvedValue({ ...FAKE_INSTANCE, status: 'REJECTED' }),
    retryGlPosting: vi.fn().mockResolvedValue('je-999'),
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

describe('Invoice approval route authorization and error contract (AMACC-CH04 S041)', () => {
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
    container.registerInstance('ApprovalRuleService', fakeApprovalRuleService());
    container.registerInstance('InvoiceApprovalService', fakeInvoiceApprovalService());
    container.registerInstance('ManualPaymentService', {});
    registerFullAuthz();

    app = Fastify();
    await app.register(aparRoutes, { prefix: '/api/v1/apar' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    process.env['AMACC_JWT_SECRET'] = origJwtSecret;
  });

  it('denies GET /invoice-approval-rules to a role with no view grant', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/invoice-approval-rules', headers: authed('UNKNOWN') });
    expect(res.statusCode).toBe(403);
  });

  it('allows GET /invoice-approval-rules to ACCOUNTANT (view)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/invoice-approval-rules', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([FAKE_RULE]);
  });

  it('denies POST /invoice-approval-rules to ACCOUNTANT (no configure grant)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/invoice-approval-rules',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ thresholdAmount: 1000, requiredRole: 'CONTROLLER', sequence: 1 }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows POST /invoice-approval-rules to ADMIN and returns 201', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/invoice-approval-rules',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ thresholdAmount: 1000, requiredRole: 'CONTROLLER', sequence: 1 }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('returns 400 VALIDATION_ERROR for an invalid role in the rule payload', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/invoice-approval-rules',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ thresholdAmount: 1000, requiredRole: 'BOGUS_ROLE', sequence: 1 }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('allows POST /invoices/:id/approval/start to ACCOUNTANT and returns 201', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/apar/invoices/invoice-1/approval/start', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(201);
  });

  it('allows POST /invoices/:id/approval/approve to ACCOUNTANT', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/invoices/invoice-1/approval/approve',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1 }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 403 WRONG_APPROVER_ROLE when the service throws that error', async () => {
    container.registerInstance('InvoiceApprovalService', fakeInvoiceApprovalService({
      approveStep: vi.fn().mockRejectedValue(new WrongApproverRoleError('CONTROLLER')),
    }));
    registerFullAuthz();
    const localApp = Fastify();
    await localApp.register(aparRoutes, { prefix: '/api/v1/apar' });
    await localApp.ready();
    const res = await localApp.inject({
      method: 'POST', url: '/api/v1/apar/invoices/invoice-1/approval/approve',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1 }),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'WRONG_APPROVER_ROLE', requiredRole: 'CONTROLLER' });
    await localApp.close();
    container.registerInstance('InvoiceApprovalService', fakeInvoiceApprovalService());
  });

  it('returns 409 ALREADY_DECIDED when the service throws that error on reject', async () => {
    container.registerInstance('InvoiceApprovalService', fakeInvoiceApprovalService({
      rejectStep: vi.fn().mockRejectedValue(new ApprovalAlreadyDecidedError('APPROVED')),
    }));
    registerFullAuthz();
    const localApp = Fastify();
    await localApp.register(aparRoutes, { prefix: '/api/v1/apar' });
    await localApp.ready();
    const res = await localApp.inject({
      method: 'POST', url: '/api/v1/apar/invoices/invoice-1/approval/reject',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1, reason: 'test' }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'ALREADY_DECIDED' });
    await localApp.close();
    container.registerInstance('InvoiceApprovalService', fakeInvoiceApprovalService());
  });

  it('denies POST /invoices/:id/approval/retry-gl-posting to ACCOUNTANT (no grant)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/apar/invoices/invoice-1/approval/retry-gl-posting', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(403);
  });

  it('allows POST /invoices/:id/approval/retry-gl-posting to CONTROLLER', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/apar/invoices/invoice-1/approval/retry-gl-posting', headers: authed('CONTROLLER') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ journalEntryId: 'je-999' });
  });
});
