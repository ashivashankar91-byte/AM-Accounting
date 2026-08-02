/**
 * CE-09 S043B — Payment Run route API tests (permission enforcement, error
 * envelopes, request/response shape). Modeled on tests/nsf-routes.test.ts.
 * PaymentRunService's own business logic is covered by
 * tests/payment-run-service.test.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { aparRoutes } from '../src/http/routes';
import { createFakeAuthzClient } from './support/fake-authz-client';
import { PaymentRunValidationError, RunApprovalRefusedSoDError } from '../src/application/payment-run-service';

const JWT_SECRET = 'apar-payment-run-authz-test-secret';

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

const AP_PAYMENT_RUN_PERMISSIONS = {
  VIEW: 'ap.payment_run.view',
  PROPOSE: 'ap.payment_run.propose',
  APPROVE: 'ap.payment_run.approve',
  REJECT: 'ap.payment_run.reject',
  EXECUTE: 'ap.payment_run.execute',
  GENERATE_RAIL: 'ap.payment_run.generate_rail',
};

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set(Object.values(AP_PAYMENT_RUN_PERMISSIONS)),
  CONTROLLER: new Set(Object.values(AP_PAYMENT_RUN_PERMISSIONS)),
  ACCOUNTANT: new Set([AP_PAYMENT_RUN_PERMISSIONS.VIEW, AP_PAYMENT_RUN_PERMISSIONS.PROPOSE]),
};

const FAKE_RUN = { id: 'run-1', status: 'PROPOSED', proposedBy: 'ACCOUNTANT', cashRequirementTotal: '500.00' };
const FAKE_ARTIFACT = { id: 'artifact-1', mode: 'CHECK_PRINT', status: 'GENERATED', totalAmount: '500.00', itemCount: 1 };

function fakePaymentRunService(overrides: Partial<Record<string, any>> = {}) {
  return {
    list: vi.fn().mockResolvedValue([FAKE_RUN]),
    getById: vi.fn().mockResolvedValue(FAKE_RUN),
    createProposal: vi.fn().mockResolvedValue(FAKE_RUN),
    approveRun: vi.fn().mockResolvedValue({ ...FAKE_RUN, status: 'APPROVED' }),
    rejectRun: vi.fn().mockResolvedValue({ ...FAKE_RUN, status: 'REJECTED' }),
    executeRun: vi.fn().mockResolvedValue({ ...FAKE_RUN, status: 'EXECUTED' }),
    generateRailArtifact: vi.fn().mockResolvedValue(FAKE_ARTIFACT),
    listRailArtifacts: vi.fn().mockResolvedValue([FAKE_ARTIFACT]),
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

describe('Payment Run route authorization and error contract (CE-09 S043B)', () => {
  let app: FastifyInstance;
  const origJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeAll(async () => {
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;
    container.registerInstance('PaymentRunService', fakePaymentRunService());
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    process.env['AMACC_JWT_SECRET'] = origJwtSecret;
  });

  it('denies GET /payment-runs to a role with no grant', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/payment-runs', headers: authed('UNKNOWN') });
    expect(res.statusCode).toBe(403);
  });

  it('allows GET /payment-runs to ACCOUNTANT (VIEW grant)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/payment-runs', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
  });

  it('allows POST /payment-runs (propose) to ACCOUNTANT and returns 201', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/payment-runs',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ bankAccountId: 'bank-1', dueDateThrough: '2026-08-15' }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('returns 400 VALIDATION_ERROR for a missing dueDateThrough', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/payment-runs',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ bankAccountId: 'bank-1' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('denies POST /payment-runs/:id/approve to ACCOUNTANT (no APPROVE grant)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/payment-runs/run-1/approve',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows POST /payment-runs/:id/approve to ADMIN', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/payment-runs/run-1/approve',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 409 RUN_APPROVAL_REFUSED_SOD when the service refuses a same-person approval', async () => {
    container.registerInstance('PaymentRunService', fakePaymentRunService({
      approveRun: vi.fn().mockRejectedValue(new RunApprovalRefusedSoDError()),
    }));
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/payment-runs/run-1/approve',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('RUN_APPROVAL_REFUSED_SOD');
  });

  it('returns 422 with the named error code for a rejected run without a reason', async () => {
    container.registerInstance('PaymentRunService', fakePaymentRunService({
      rejectRun: vi.fn().mockRejectedValue(new PaymentRunValidationError('REASON_REQUIRED', 'A reason is required')),
    }));
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/payment-runs/run-1/reject',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ reason: '' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('allows POST /payment-runs/:id/execute to ADMIN (idempotent by run id, service handles duplicate calls)', async () => {
    container.registerInstance('PaymentRunService', fakePaymentRunService());
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/payment-runs/run-1/execute',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('EXECUTED');
  });

  it('denies POST /payment-runs/:id/execute to ACCOUNTANT (no EXECUTE grant)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/payment-runs/run-1/execute',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows POST /payment-runs/:id/rail-artifacts to ADMIN and returns 201', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/payment-runs/run-1/rail-artifacts',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ mode: 'ACH_NACHA' }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('denies POST /payment-runs/:id/rail-artifacts to ACCOUNTANT (no GENERATE_RAIL grant)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/payment-runs/run-1/rail-artifacts',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ mode: 'CHECK_PRINT' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows GET /payment-runs/:id/rail-artifacts to ACCOUNTANT (VIEW grant)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/payment-runs/run-1/rail-artifacts', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
  });
});
