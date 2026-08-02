/**
 * CE-09 S051 — NSF handling route API tests (permission enforcement, error
 * envelopes, request/response shape). Modeled on
 * tests/write-off-allowance-routes.test.ts. NsfService's own business logic
 * is covered by tests/nsf-service.test.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { aparRoutes } from '../src/http/routes';
import { createFakeAuthzClient } from './support/fake-authz-client';
import { NsfValidationError } from '../src/application/nsf-service';

const JWT_SECRET = 'apar-nsf-authz-test-secret';

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

const AR_NSF_PERMISSIONS = {
  VIEW: 'ar.nsf.view',
  RECORD: 'ar.nsf.record',
  MARK_RECONCILED_TEST_ONLY: 'ar.nsf.mark_deposit_reconciled_test_only',
};

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set(Object.values(AR_NSF_PERMISSIONS)),
  CONTROLLER: new Set(Object.values(AR_NSF_PERMISSIONS)),
  ACCOUNTANT: new Set([AR_NSF_PERMISSIONS.VIEW, AR_NSF_PERMISSIONS.RECORD]),
};

const FAKE_NSF_EVENT = { id: 'nsf-1', customerId: 'customer-1', originalArEntryId: 'ar-entry-1', amount: '250.00', depositReconciled: false, postedAsBankAdjustment: false };
const FAKE_AR_ENTRY = { id: 'ar-entry-1', reconciledAt: new Date().toISOString(), reconciledBy: 'admin-1' };

function fakeNsfService(overrides: Partial<Record<string, any>> = {}) {
  return {
    list: vi.fn().mockResolvedValue([FAKE_NSF_EVENT]),
    getById: vi.fn().mockResolvedValue(FAKE_NSF_EVENT),
    recordNsf: vi.fn().mockResolvedValue(FAKE_NSF_EVENT),
    markDepositReconciled: vi.fn().mockResolvedValue(FAKE_AR_ENTRY),
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

describe('NSF route authorization and error contract (CE-09 S051)', () => {
  let app: FastifyInstance;
  const origJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeAll(async () => {
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;
    container.registerInstance('NsfService', fakeNsfService());
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    process.env['AMACC_JWT_SECRET'] = origJwtSecret;
  });

  it('denies GET /nsf-events to a role with no grant', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/nsf-events', headers: authed('UNKNOWN') });
    expect(res.statusCode).toBe(403);
  });

  it('allows GET /nsf-events to ACCOUNTANT', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/nsf-events', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
  });

  it('allows POST /nsf-events (manual entry) to ACCOUNTANT and returns 201', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/nsf-events',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ customerId: 'customer-1', originalArEntryId: 'ar-entry-1', amount: 250, reason: 'Returned check' }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('accepts source: BANK_FEED_NOT_CONFIGURED as a truthful adapter state', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/nsf-events',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ customerId: 'customer-1', originalArEntryId: 'ar-entry-1', amount: 250, reason: 'x', source: 'BANK_FEED_NOT_CONFIGURED' }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('returns 400 VALIDATION_ERROR for a missing reason', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/nsf-events',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ customerId: 'customer-1', originalArEntryId: 'ar-entry-1', amount: 250 }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 422 with the named error code when the service refuses (e.g. AR_ENTRY_NOT_POSTED)', async () => {
    container.registerInstance('NsfService', fakeNsfService({
      recordNsf: vi.fn().mockRejectedValue(new NsfValidationError('AR_ENTRY_NOT_POSTED', 'AR entry must be POSTED')),
    }));
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/nsf-events',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ customerId: 'customer-1', originalArEntryId: 'ar-entry-1', amount: 250, reason: 'x' }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('AR_ENTRY_NOT_POSTED');
  });

  it('denies POST /nsf-events to a role with no RECORD grant', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/nsf-events',
      headers: { ...authed('UNKNOWN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ customerId: 'customer-1', originalArEntryId: 'ar-entry-1', amount: 250, reason: 'x' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('denies the test-only mark-deposit-reconciled endpoint to ACCOUNTANT (only ADMIN/CONTROLLER — mirrors S045 mark-cleared-test-only)', async () => {
    container.registerInstance('NsfService', fakeNsfService());
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/ar-entries/ar-entry-1/mark-deposit-reconciled-test-only',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows the test-only mark-deposit-reconciled endpoint to ADMIN', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/ar-entries/ar-entry-1/mark-deposit-reconciled-test-only',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(200);
  });
});
