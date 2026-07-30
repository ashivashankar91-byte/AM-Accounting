/**
 * AMACC-CH04 S039 — Vendor invoice route API tests (permission enforcement,
 * error envelopes, request/response shape). Modeled on
 * tests/vendor-routes.test.ts. InvoiceService's own business logic is
 * covered by invoice-service.test.ts — these tests only exercise the HTTP
 * layer.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { aparRoutes } from '../src/http/routes';
import { createFakeAuthzClient } from './support/fake-authz-client';
import {
  InvoiceNotFoundError,
  InvoiceConflictError,
  DuplicateInvoiceAcknowledgementRequiredError,
  MatchExceptionOverrideRequiredError,
} from '../src/application/invoice-service';

const JWT_SECRET = 'apar-invoice-authz-test-secret';

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
    authorization: `Bearer ${tokenFor(role, tenantId)}`,
  };
}

const AP_INVOICE_PERMISSIONS = {
  VIEW: 'ap.invoice.view',
  CREATE: 'ap.invoice.create',
  EDIT: 'ap.invoice.edit',
  MATCH: 'ap.invoice.match',
  MATCH_OVERRIDE: 'ap.invoice.match_override',
  SUBMIT: 'ap.invoice.submit',
  VOID: 'ap.invoice.void',
  DUPLICATE_OVERRIDE: 'ap.invoice.duplicate_override',
  AUDIT_VIEW: 'ap.invoice.audit_view',
};

const AP_GOODS_RECEIPT_PERMISSIONS = {
  VIEW: 'ap.goods_receipt.view',
  CREATE: 'ap.goods_receipt.create',
  VOID: 'ap.goods_receipt.void',
};

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set([...Object.values(AP_INVOICE_PERMISSIONS), ...Object.values(AP_GOODS_RECEIPT_PERMISSIONS)]),
  CONTROLLER: new Set([...Object.values(AP_INVOICE_PERMISSIONS), ...Object.values(AP_GOODS_RECEIPT_PERMISSIONS)]),
  ACCOUNTANT: new Set([
    AP_INVOICE_PERMISSIONS.VIEW, AP_INVOICE_PERMISSIONS.CREATE, AP_INVOICE_PERMISSIONS.EDIT,
    AP_INVOICE_PERMISSIONS.MATCH, AP_INVOICE_PERMISSIONS.SUBMIT,
    AP_GOODS_RECEIPT_PERMISSIONS.VIEW, AP_GOODS_RECEIPT_PERMISSIONS.CREATE,
  ]),
};

const FAKE_INVOICE = {
  id: 'invoice-1',
  tenantId: 'tenant-a',
  vendorId: 'vendor-1',
  invoiceNumber: 'INV-001',
  status: 'DRAFT',
  matchStatus: 'NOT_RUN',
  version: 1,
  lines: [],
};

function fakeInvoiceService(overrides: Partial<Record<string, any>> = {}) {
  return {
    list: vi.fn().mockResolvedValue({ items: [FAKE_INVOICE], total: 1, page: 1, pageSize: 50 }),
    getById: vi.fn().mockResolvedValue(FAKE_INVOICE),
    create: vi.fn().mockResolvedValue(FAKE_INVOICE),
    update: vi.fn().mockResolvedValue(FAKE_INVOICE),
    runMatch: vi.fn().mockResolvedValue({ invoice: FAKE_INVOICE, result: { matchType: 'NONE', status: 'MATCHED', variances: [] } }),
    submit: vi.fn().mockResolvedValue({ ...FAKE_INVOICE, status: 'SUBMITTED' }),
    void: vi.fn().mockResolvedValue({ ...FAKE_INVOICE, status: 'VOID' }),
    checkDuplicates: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function fakeGoodsReceiptService(overrides: Partial<Record<string, any>> = {}) {
  return {
    listForPO: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue({ id: 'receipt-1' }),
    create: vi.fn().mockResolvedValue({ id: 'receipt-1' }),
    void: vi.fn().mockResolvedValue({ id: 'receipt-1', status: 'VOID' }),
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

describe('Vendor invoice route authorization and error contract (AMACC-CH04 S039)', () => {
  let app: FastifyInstance;
  const origJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeAll(async () => {
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;

    container.registerInstance('APARService', {});
    container.registerInstance('VendorService', {});
    container.registerInstance('VendorComplianceService', {});
    container.registerInstance('InsuranceCertificateService', {});
    container.registerInstance('CustomerService', {});
    container.registerInstance('InvoiceService', fakeInvoiceService());
    container.registerInstance('GoodsReceiptService', fakeGoodsReceiptService());
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
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/invoices', headers: { 'x-tenant-id': 'tenant-a' } });
    expect(res.statusCode).toBe(401);
  });

  it('denies GET /invoices to a role with no ap.invoice.view grant', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/invoices', headers: authed('UNKNOWN') });
    expect(res.statusCode).toBe(403);
  });

  it('allows GET /invoices to ACCOUNTANT (view)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/invoices', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ items: expect.any(Array), total: 1 });
  });

  it('allows POST /invoices to ACCOUNTANT and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/invoices',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({
        vendorId: '11111111-1111-1111-1111-111111111111',
        invoiceNumber: 'INV-100',
        invoiceDate: '2026-07-01',
        dueDate: '2026-07-31',
        lines: [{ glAccountId: '22222222-2222-2222-2222-222222222222', description: 'Widget', unitPrice: 100 }],
      }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('returns 400 VALIDATION_ERROR when required fields are missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/invoices',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  it('returns 409 DUPLICATE_INVOICE_ACKNOWLEDGEMENT_REQUIRED when the service throws that conflict', async () => {
    container.registerInstance('InvoiceService', fakeInvoiceService({
      create: vi.fn().mockRejectedValue(new DuplicateInvoiceAcknowledgementRequiredError([{ invoiceId: 'x', invoiceNumber: 'INV-100', status: 'DRAFT', totalAmount: 50 }])),
    }));
    registerFullAuthz();
    const localApp = Fastify();
    await localApp.register(aparRoutes, { prefix: '/api/v1/apar' });
    await localApp.ready();
    const res = await localApp.inject({
      method: 'POST',
      url: '/api/v1/apar/invoices',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({
        vendorId: '11111111-1111-1111-1111-111111111111',
        invoiceNumber: 'INV-100',
        invoiceDate: '2026-07-01',
        dueDate: '2026-07-31',
        lines: [{ glAccountId: '22222222-2222-2222-2222-222222222222', description: 'Widget', unitPrice: 100 }],
      }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'DUPLICATE_INVOICE_ACKNOWLEDGEMENT_REQUIRED' });
    await localApp.close();
    container.registerInstance('InvoiceService', fakeInvoiceService());
  });

  it('denies POST /invoices/:id/void to ACCOUNTANT (no void grant)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/invoices/invoice-1/void',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1, reason: 'test' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows POST /invoices/:id/void to CONTROLLER', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/invoices/invoice-1/void',
      headers: { ...authed('CONTROLLER'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1, reason: 'Entered in error' }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('allows POST /invoices/:id/match to ACCOUNTANT', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/invoices/invoice-1/match',
      headers: authed('ACCOUNTANT'),
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 409 MATCH_EXCEPTION_OVERRIDE_REQUIRED when submit is rejected for an unresolved exception', async () => {
    container.registerInstance('InvoiceService', fakeInvoiceService({
      submit: vi.fn().mockRejectedValue(new MatchExceptionOverrideRequiredError([{ type: 'PRICE_VARIANCE' }])),
    }));
    registerFullAuthz();
    const localApp = Fastify();
    await localApp.register(aparRoutes, { prefix: '/api/v1/apar' });
    await localApp.ready();
    const res = await localApp.inject({
      method: 'POST',
      url: '/api/v1/apar/invoices/invoice-1/submit',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1 }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'MATCH_EXCEPTION_OVERRIDE_REQUIRED' });
    await localApp.close();
    container.registerInstance('InvoiceService', fakeInvoiceService());
  });

  it('denies the match-exception override permission check for ACCOUNTANT (no match_override grant)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/invoices/invoice-1/submit',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1, override: { reason: 'Approved verbally' } }),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'MATCH_OVERRIDE_FORBIDDEN' });
  });

  it('returns 404 NOT_FOUND when the invoice does not exist', async () => {
    container.registerInstance('InvoiceService', fakeInvoiceService({
      getById: vi.fn().mockRejectedValue(new InvoiceNotFoundError('missing')),
    }));
    registerFullAuthz();
    const localApp = Fastify();
    await localApp.register(aparRoutes, { prefix: '/api/v1/apar' });
    await localApp.ready();
    const res = await localApp.inject({ method: 'GET', url: '/api/v1/apar/invoices/missing', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(404);
    await localApp.close();
    container.registerInstance('InvoiceService', fakeInvoiceService());
  });

  it('returns 409 VERSION_CONFLICT when the service throws that conflict', async () => {
    container.registerInstance('InvoiceService', fakeInvoiceService({
      update: vi.fn().mockRejectedValue(new InvoiceConflictError('VERSION_CONFLICT', 'stale')),
    }));
    registerFullAuthz();
    const localApp = Fastify();
    await localApp.register(aparRoutes, { prefix: '/api/v1/apar' });
    await localApp.ready();
    const res = await localApp.inject({
      method: 'PATCH',
      url: '/api/v1/apar/invoices/invoice-1',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ version: 1, notes: 'updated' }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'VERSION_CONFLICT' });
    await localApp.close();
    container.registerInstance('InvoiceService', fakeInvoiceService());
  });

  // ── Goods Receipts ─────────────────────────────────────────────────────

  it('denies POST /goods-receipts/:id/void to ACCOUNTANT (no void grant)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/goods-receipts/receipt-1/void',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ reason: 'test' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows POST /goods-receipts to ACCOUNTANT and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/apar/goods-receipts',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({
        poId: '11111111-1111-1111-1111-111111111111',
        lines: [{ poLineId: '22222222-2222-2222-2222-222222222222', description: 'Widget', qtyReceived: 5 }],
      }),
    });
    expect(res.statusCode).toBe(201);
  });
});
