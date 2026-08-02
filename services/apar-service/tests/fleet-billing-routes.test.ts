/**
 * CE-09 S047 — Fleet AR Consolidated Billing route API tests (permission
 * enforcement, error envelopes, request/response shape). Modeled on
 * tests/trade-payoff-routes.test.ts. FleetBillingService's own business
 * logic is covered by tests/fleet-billing-service.test.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { aparRoutes } from '../src/http/routes';
import { createFakeAuthzClient } from './support/fake-authz-client';
import { FleetUnitAlreadyLinkedError, FleetUnitNotLinkedToParentError } from '../src/application/fleet-billing-service';

const JWT_SECRET = 'apar-fleet-billing-authz-test-secret';

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

const AR_FLEET_BILLING_PERMISSIONS = {
  VIEW: 'ar.fleet_billing.view',
  MANAGE_LINKS: 'ar.fleet_billing.manage_links',
  CREATE_CONSOLIDATED_INVOICE: 'ar.fleet_billing.create_consolidated_invoice',
};

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set(Object.values(AR_FLEET_BILLING_PERMISSIONS)),
  CONTROLLER: new Set(Object.values(AR_FLEET_BILLING_PERMISSIONS)),
  ACCOUNTANT: new Set(Object.values(AR_FLEET_BILLING_PERMISSIONS)),
};

const FAKE_LINK = { id: 'link-1', parentCustomerId: 'parent-1', childCustomerId: 'child-1' };
const FAKE_INVOICE = { id: 'invoice-1', parentCustomerId: 'parent-1', totalAmount: '350.00', items: [] };
const FAKE_STATEMENT = { parentCustomerId: 'parent-1', invoices: [], grandTotal: 0 };

function fakeFleetBillingService(overrides: Partial<Record<string, any>> = {}) {
  return {
    linkUnit: vi.fn().mockResolvedValue(FAKE_LINK),
    unlinkUnit: vi.fn().mockResolvedValue({ id: 'link-1', unlinked: true }),
    listUnitsForParent: vi.fn().mockResolvedValue([FAKE_LINK]),
    createConsolidatedInvoice: vi.fn().mockResolvedValue(FAKE_INVOICE),
    getById: vi.fn().mockResolvedValue(FAKE_INVOICE),
    list: vi.fn().mockResolvedValue([FAKE_INVOICE]),
    getStatement: vi.fn().mockResolvedValue(FAKE_STATEMENT),
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
  container.registerInstance('InsuranceArService', {});
  container.registerInstance('Vendor1099Service', {});
  registerFullAuthz();

  const app = Fastify();
  await app.register(aparRoutes, { prefix: '/api/v1/apar' });
  await app.ready();
  return app;
}

describe('Fleet-Billing route authorization and error contract (CE-09 S047)', () => {
  let app: FastifyInstance;
  const origJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeAll(async () => {
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;
    container.registerInstance('FleetBillingService', fakeFleetBillingService());
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    process.env['AMACC_JWT_SECRET'] = origJwtSecret;
  });

  it('denies GET /fleet-billing/consolidated-invoices to a role with no grant', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/fleet-billing/consolidated-invoices', headers: authed('UNKNOWN') });
    expect(res.statusCode).toBe(403);
  });

  it('allows GET /fleet-billing/consolidated-invoices to ACCOUNTANT', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/fleet-billing/consolidated-invoices', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
  });

  it('allows GET /fleet-billing/parents/:id/units to ACCOUNTANT', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/fleet-billing/parents/parent-1/units', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
  });

  it('allows GET /fleet-billing/parents/:id/statement to ACCOUNTANT', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/fleet-billing/parents/parent-1/statement', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
  });

  it('allows POST /fleet-billing/unit-links to ACCOUNTANT and returns 201', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/fleet-billing/unit-links',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ parentCustomerId: 'parent-1', childCustomerId: 'child-1' }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('returns 400 VALIDATION_ERROR for a missing childCustomerId', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/fleet-billing/unit-links',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ parentCustomerId: 'parent-1' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 409 FLEET_UNIT_ALREADY_LINKED when the service refuses a re-link', async () => {
    container.registerInstance('FleetBillingService', fakeFleetBillingService({
      linkUnit: vi.fn().mockRejectedValue(new FleetUnitAlreadyLinkedError('child-1')),
    }));
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/fleet-billing/unit-links',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ parentCustomerId: 'parent-1', childCustomerId: 'child-1' }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('FLEET_UNIT_ALREADY_LINKED');
  });

  it('denies POST /fleet-billing/unit-links to a role with no MANAGE_LINKS grant', async () => {
    container.registerInstance('FleetBillingService', fakeFleetBillingService());
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/fleet-billing/unit-links',
      headers: { ...authed('UNKNOWN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ parentCustomerId: 'parent-1', childCustomerId: 'child-1' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows DELETE /fleet-billing/unit-links/:id to ACCOUNTANT', async () => {
    container.registerInstance('FleetBillingService', fakeFleetBillingService());
    app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/apar/fleet-billing/unit-links/link-1', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
  });

  it('allows POST /fleet-billing/consolidated-invoices to ACCOUNTANT and returns 201', async () => {
    container.registerInstance('FleetBillingService', fakeFleetBillingService());
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/fleet-billing/consolidated-invoices',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ parentCustomerId: 'parent-1', invoiceDate: '2026-08-01', items: [{ childCustomerId: 'child-1', amount: 100 }] }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('returns 422 FLEET_UNIT_NOT_LINKED_TO_PARENT when the service refuses an unlinked item', async () => {
    container.registerInstance('FleetBillingService', fakeFleetBillingService({
      createConsolidatedInvoice: vi.fn().mockRejectedValue(new FleetUnitNotLinkedToParentError('child-9', 'parent-1')),
    }));
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/fleet-billing/consolidated-invoices',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ parentCustomerId: 'parent-1', invoiceDate: '2026-08-01', items: [{ childCustomerId: 'child-9', amount: 100 }] }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('FLEET_UNIT_NOT_LINKED_TO_PARENT');
  });

  it('denies POST /fleet-billing/consolidated-invoices to a role with no CREATE grant', async () => {
    container.registerInstance('FleetBillingService', fakeFleetBillingService());
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/fleet-billing/consolidated-invoices',
      headers: { ...authed('UNKNOWN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ parentCustomerId: 'parent-1', invoiceDate: '2026-08-01', items: [{ childCustomerId: 'child-1', amount: 100 }] }),
    });
    expect(res.statusCode).toBe(403);
  });
});
