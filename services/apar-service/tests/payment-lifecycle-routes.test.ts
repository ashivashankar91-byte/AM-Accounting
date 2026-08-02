/**
 * CE-09 S045 — Payment lifecycle route API tests (void-refused-when-
 * reconciled, mark-cleared PUTR boundary, stop-payment, reissue, escheat
 * lifecycle). Modeled on tests/use-tax-routes.test.ts. PaymentLifecycleService's
 * own business logic is covered by tests/payment-lifecycle-service.test.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { aparRoutes } from '../src/http/routes';
import { createFakeAuthzClient } from './support/fake-authz-client';
import { VoidRefusedPaymentReconciledError } from '../src/application/manual-payment-service';
import { EscheatConfigNotFoundError } from '../src/application/payment-lifecycle-service';

const JWT_SECRET = 'apar-payment-lifecycle-authz-test-secret';

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

const AP_PAYMENT_LIFECYCLE_PERMISSIONS = {
  MARK_CLEARED_TEST_ONLY: 'ap.payment_lifecycle.mark_cleared_test_only',
  REISSUE: 'ap.payment_lifecycle.reissue',
  STOP_PAYMENT_REQUEST: 'ap.payment_lifecycle.stop_payment_request',
  STOP_PAYMENT_RESOLVE: 'ap.payment_lifecycle.stop_payment_resolve',
  ESCHEAT_VIEW: 'ap.payment_lifecycle.escheat_view',
  ESCHEAT_DUE_DILIGENCE: 'ap.payment_lifecycle.escheat_due_diligence',
  ESCHEAT_TRANSFER: 'ap.payment_lifecycle.escheat_transfer',
};

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set(Object.values(AP_PAYMENT_LIFECYCLE_PERMISSIONS)),
  CONTROLLER: new Set(Object.values(AP_PAYMENT_LIFECYCLE_PERMISSIONS)),
  ACCOUNTANT: new Set([
    AP_PAYMENT_LIFECYCLE_PERMISSIONS.STOP_PAYMENT_REQUEST,
    AP_PAYMENT_LIFECYCLE_PERMISSIONS.ESCHEAT_VIEW,
    AP_PAYMENT_LIFECYCLE_PERMISSIONS.ESCHEAT_DUE_DILIGENCE,
    AP_PAYMENT_LIFECYCLE_PERMISSIONS.ESCHEAT_TRANSFER,
    AP_PAYMENT_LIFECYCLE_PERMISSIONS.REISSUE,
  ]),
};

const FAKE_PAYMENT = { id: 'payment-1', status: 'POSTED', clearedAt: null };
const FAKE_STOP_REQUEST = { id: 'stop-1', paymentId: 'payment-1', status: 'REQUESTED', bankAck: 'PAYMENT_RAIL_NOT_CONFIGURED' };
const FAKE_TRANSFER = { id: 'transfer-1', paymentId: 'payment-1', status: 'POSTED' };

function fakePaymentLifecycleService(overrides: Partial<Record<string, any>> = {}) {
  return {
    markCleared: vi.fn().mockResolvedValue({ ...FAKE_PAYMENT, clearedAt: new Date(), clearedBy: 'admin-1' }),
    reissue: vi.fn().mockResolvedValue({ id: 'payment-2', reissueOfPaymentId: 'payment-1' }),
    requestStopPayment: vi.fn().mockResolvedValue(FAKE_STOP_REQUEST),
    resolveStopPayment: vi.fn().mockResolvedValue({ ...FAKE_STOP_REQUEST, status: 'ACKNOWLEDGED' }),
    listStopPaymentRequests: vi.fn().mockResolvedValue([FAKE_STOP_REQUEST]),
    escheatQueue: vi.fn().mockResolvedValue([{ paymentId: 'payment-1', jurisdictionConfigured: false, isStale: false }]),
    recordDueDiligence: vi.fn().mockResolvedValue({ id: 'dd-1', paymentId: 'payment-1' }),
    listDueDiligence: vi.fn().mockResolvedValue([]),
    postEscheatTransfer: vi.fn().mockResolvedValue(FAKE_TRANSFER),
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

  const app = Fastify();
  await app.register(aparRoutes, { prefix: '/api/v1/apar' });
  await app.ready();
  return app;
}

describe('Payment lifecycle route authorization and error contract (CE-09 S045)', () => {
  let app: FastifyInstance;
  const origJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeAll(async () => {
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;
    container.registerInstance('PaymentLifecycleService', fakePaymentLifecycleService());
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    process.env['AMACC_JWT_SECRET'] = origJwtSecret;
  });

  it('denies mark-cleared-test-only to a role with no grant', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/manual-payments/payment-1/mark-cleared-test-only',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' }, payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows mark-cleared-test-only to ADMIN', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/manual-payments/payment-1/mark-cleared-test-only',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' }, payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().clearedBy).toBe('admin-1');
  });

  it('returns 409 VOID_REFUSED_PAYMENT_RECONCILED when the service reports the D-CE09-01 refusal', async () => {
    container.registerInstance('PaymentLifecycleService', fakePaymentLifecycleService({
      markCleared: vi.fn().mockRejectedValue(new VoidRefusedPaymentReconciledError('payment-1')),
    }));
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/manual-payments/payment-1/mark-cleared-test-only',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' }, payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('VOID_REFUSED_PAYMENT_RECONCILED');
  });

  it('allows POST reissue to ACCOUNTANT and returns 201', async () => {
    container.registerInstance('PaymentLifecycleService', fakePaymentLifecycleService());
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/manual-payments/payment-1/reissue',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ bankAccountId: '11111111-1111-1111-1111-111111111111' }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().reissueOfPaymentId).toBe('payment-1');
  });

  it('requires a bankAccountId to reissue', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/manual-payments/payment-1/reissue',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' }, payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(400);
  });

  it('allows POST stop-payment-requests to ACCOUNTANT with a truthful PAYMENT_RAIL_NOT_CONFIGURED bank-ack', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/manual-payments/payment-1/stop-payment-requests',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ reason: 'Wrong payee' }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().bankAck).toBe('PAYMENT_RAIL_NOT_CONFIGURED');
  });

  it('denies resolve stop-payment to ACCOUNTANT (requires distinct resolve permission)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/stop-payment-requests/stop-1/resolve',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ status: 'ACKNOWLEDGED', bankAck: 'MANUAL' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows resolve stop-payment to ADMIN', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/stop-payment-requests/stop-1/resolve',
      headers: { ...authed('ADMIN'), 'content-type': 'application/json' },
      payload: JSON.stringify({ status: 'ACKNOWLEDGED', bankAck: 'MANUAL' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ACKNOWLEDGED');
  });

  it('returns an informational-only escheat queue that never signals a computed staleness without config (D-CE09-03)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/apar/escheat/queue', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].jurisdictionConfigured).toBe(false);
    expect(res.json()[0].isStale).toBe(false);
  });

  it('records a due-diligence attempt', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/manual-payments/payment-1/due-diligence',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ method: 'LETTER', outcome: 'No response' }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('returns 422 ESCHEAT_CONFIG_NOT_FOUND when the jurisdiction has no timing configuration (D-CE09-03 gate)', async () => {
    container.registerInstance('PaymentLifecycleService', fakePaymentLifecycleService({
      postEscheatTransfer: vi.fn().mockRejectedValue(new EscheatConfigNotFoundError('CA')),
    }));
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/manual-payments/payment-1/escheat-transfer',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ jurisdiction: 'CA' }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('ESCHEAT_CONFIG_NOT_FOUND');
  });

  it('posts an escheat transfer when the jurisdiction is configured', async () => {
    container.registerInstance('PaymentLifecycleService', fakePaymentLifecycleService());
    app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/apar/manual-payments/payment-1/escheat-transfer',
      headers: { ...authed('ACCOUNTANT'), 'content-type': 'application/json' },
      payload: JSON.stringify({ jurisdiction: 'CA' }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('POSTED');
  });
});
