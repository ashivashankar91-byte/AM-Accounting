/**
 * S052 — LIVE DATABASE + REAL HTTP ROUTE ownership-enforcement certification.
 *
 * Gate 1 (S052 certification closure) requires drawer-ownership behavior to
 * be proven "against real persisted drawers and real authenticated users",
 * not just mocked services (tests/drawer-ownership-authz.test.ts fakes
 * DrawerService/ReceiptService entirely) and not just application-layer
 * calls with no HTTP/JWT layer (tests/live-db/cash-flow-live.test.ts calls
 * the services directly). This file wires the REAL Fastify routes, the REAL
 * DrawerService/ReceiptService/BlindCloseService (backed by a real Prisma
 * client against a real Postgres instance), real HS256 JWTs verified by the
 * real authMiddleware, and the real tenantContextHook/RLS middleware — the
 * only fake is AuthzClient (there is no live auth-service in this test
 * environment), matching coa-service's authz-guard-integration.test.ts
 * precedent of faking only the network boundary to another service.
 *
 * Skipped entirely unless LIVE_DATABASE_URL is set.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import * as crypto from 'crypto';
import { container } from 'tsyringe';
import { PrismaClient } from '.prisma/cash-client';
import {
  IEventPublisher, AuthzClient, AuthzCheckRequest, AuthzCheckResult,
  createTenantRlsMiddleware, tenantContextHook,
} from '@amacc/shared-kernel';
import { DrawerService } from '../../src/application/cash-drawer-service';
import { ReceiptSequenceService } from '../../src/application/receipt-sequence-service';
import { ReceiptService } from '../../src/application/cash-receipt-service';
import { ToleranceService } from '../../src/application/tolerance-service';
import { BlindCloseService } from '../../src/application/blind-close-service';
import { ReconciliationService } from '../../src/application/reconciliation-service';
import { cashDrawerRoutes, CASH_PERMISSIONS } from '../../src/http/cash-drawer-routes';
import { cashReceiptRoutes, CASH_RECEIPT_PERMISSIONS } from '../../src/http/cash-receipt-routes';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];
const JWT_SECRET = 'cash-live-ownership-authz-test-secret';
const noopEvents: IEventPublisher = { publish: async () => {}, subscribe: () => {} };

function b64u(s: string): string {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function tokenFor(sub: string, tenantId: string): string {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ sub, tenantId, iat: now, exp: now + 3600 }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

const CASHIER_GRANTS = new Set([
  CASH_PERMISSIONS.DRAWER_OPEN, CASH_PERMISSIONS.DRAWER_VIEW_OWN, CASH_PERMISSIONS.DRAWER_BLIND_CLOSE,
  CASH_RECEIPT_PERMISSIONS.CREATE, CASH_RECEIPT_PERMISSIONS.VIEW, CASH_RECEIPT_PERMISSIONS.REPRINT, CASH_RECEIPT_PERMISSIONS.VOID,
]);
const ADMIN_GRANTS = new Set([...CASHIER_GRANTS, CASH_PERMISSIONS.DRAWER_VIEW_ALL, CASH_PERMISSIONS.DRAWER_RECONCILE, CASH_PERMISSIONS.VARIANCE_APPROVE]);

class FakeAuthzClient implements AuthzClient {
  async check(req: AuthzCheckRequest): Promise<AuthzCheckResult> {
    const grants = (req.userId === 'live-admin-1' || req.userId === 'live-controller-1') ? ADMIN_GRANTS : CASHIER_GRANTS;
    return { allow: grants.has(req.permissionKey) };
  }
}

describe.skipIf(!LIVE_DB_URL)('Live database + real HTTP routes — S052 drawer-ownership certification', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;
  const TENANT = `live-ownership-tenant-${randomUUID()}`;
  const ENTITY = randomUUID();
  const STORE = randomUUID();
  const STORE_CODE = 'LOWN';

  function authed(sub: string) {
    return { 'x-tenant-id': TENANT, authorization: `Bearer ${tokenFor(sub, TENANT)}` };
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();
    (prisma as any).$use(createTenantRlsMiddleware(prisma));

    container.reset();
    container.registerInstance('PrismaClient', prisma as any);
    container.registerInstance('IEventPublisher', noopEvents as any);
    container.registerInstance<AuthzClient>('AuthzClient', new FakeAuthzClient());
    container.register('DrawerService', { useClass: DrawerService });
    container.register('ReceiptSequenceService', { useClass: ReceiptSequenceService });
    container.registerInstance('CashReceiptPostingPort', { submit: async () => {} } as any);
    container.register('ReceiptService', { useClass: ReceiptService });
    container.register('ToleranceService', { useClass: ToleranceService });
    container.register('BlindCloseService', { useClass: BlindCloseService });
    container.register('ReconciliationService', { useClass: ReconciliationService });

    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;
    app = Fastify();
    app.addHook('preHandler', tenantContextHook);
    await app.register(cashDrawerRoutes, { prefix: '/api/v1/cash' });
    await app.register(cashReceiptRoutes, { prefix: '/api/v1/cash' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    delete process.env['AMACC_JWT_SECRET'];
    await prisma.cashVarianceApproval.deleteMany({ where: { tenantId: TENANT } });
    await prisma.cashDrawerVariance.deleteMany({ where: { tenantId: TENANT } });
    await prisma.cashBlindCountLine.deleteMany({ where: { tenantId: TENANT } });
    await prisma.cashBlindCount.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$executeRawUnsafe('ALTER TABLE cash_drawer_movement DISABLE TRIGGER trg_cash_drawer_movement_append_only');
    await prisma.cashDrawerMovement.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$executeRawUnsafe('ALTER TABLE cash_drawer_movement ENABLE TRIGGER trg_cash_drawer_movement_append_only');
    await prisma.cashReceiptTender.deleteMany({ where: { tenantId: TENANT } });
    await prisma.cashReceipt.deleteMany({ where: { tenantId: TENANT } });
    await prisma.cashDrawer.deleteMany({ where: { tenantId: TENANT } });
    await prisma.cashReceiptSequence.deleteMany({ where: { tenantId: TENANT } });
    await prisma.auditOutboxEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.cashOutboxEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$disconnect();
  });

  it('Cashier A opens a REAL, persisted drawer via the real HTTP route', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/cash/drawers', headers: authed('live-cashier-a'),
      payload: { storeId: STORE, storeCode: STORE_CODE, terminalCode: 'LOWN-T1', entityId: ENTITY, businessDate: '2026-07-29', openingFloat: 100 },
    });
    expect(res.statusCode).toBe(201);
    const persisted = await prisma.cashDrawer.findFirst({ where: { tenantId: TENANT, cashierId: 'live-cashier-a' } });
    expect(persisted).toBeTruthy();
    expect(persisted!.status).toBe('OPEN');
  });

  it('Cashier B CANNOT create a receipt against Cashier A\'s real drawer (403, no row written)', async () => {
    const drawer = await prisma.cashDrawer.findFirstOrThrow({ where: { tenantId: TENANT, cashierId: 'live-cashier-a' } });
    const res = await app.inject({
      method: 'POST', url: `/api/v1/cash/drawers/${drawer.id}/receipts`, headers: authed('live-cashier-b'),
      payload: {
        entityId: ENTITY, sourceDocType: 'RO', sourceDocId: 'RO-LIVE-1', totalAmount: 25,
        tenders: [{ tenderType: 'CASH', amount: 25 }], idempotencyKey: `live-idem-b-attempt-${randomUUID()}`,
      },
    });
    expect(res.statusCode).toBe(403);
    const receiptCount = await prisma.cashReceipt.count({ where: { tenantId: TENANT, drawerId: drawer.id } });
    expect(receiptCount).toBe(0);
  });

  it('Cashier A CAN create a receipt against their OWN real drawer — persisted', async () => {
    const drawer = await prisma.cashDrawer.findFirstOrThrow({ where: { tenantId: TENANT, cashierId: 'live-cashier-a' } });
    const res = await app.inject({
      method: 'POST', url: `/api/v1/cash/drawers/${drawer.id}/receipts`, headers: authed('live-cashier-a'),
      payload: {
        entityId: ENTITY, sourceDocType: 'RO', sourceDocId: 'RO-LIVE-1', totalAmount: 25,
        tenders: [{ tenderType: 'CASH', amount: 25 }], idempotencyKey: 'live-idem-a-1',
      },
    });
    expect(res.statusCode).toBe(201);
    const persisted = await prisma.cashReceipt.findFirst({ where: { tenantId: TENANT, drawerId: drawer.id } });
    expect(persisted).toBeTruthy();
    expect(Number(persisted!.totalAmount)).toBe(25);
  });

  it('Cashier B CANNOT void a receipt belonging to Cashier A\'s real drawer (403, receipt stays ISSUED)', async () => {
    const receipt = await prisma.cashReceipt.findFirstOrThrow({ where: { tenantId: TENANT, cashierId: 'live-cashier-a' } });
    const res = await app.inject({
      method: 'POST', url: `/api/v1/cash/receipts/${receipt.id}/void`, headers: authed('live-cashier-b'),
      payload: { reason: 'not my drawer' },
    });
    expect(res.statusCode).toBe(403);
    const reloaded = await prisma.cashReceipt.findUniqueOrThrow({ where: { id: receipt.id } });
    expect(reloaded.status).toBe('ISSUED');
  });

  it('Cashier B CANNOT submit blind close for Cashier A\'s real drawer (403, no blind count written)', async () => {
    const drawer = await prisma.cashDrawer.findFirstOrThrow({ where: { tenantId: TENANT, cashierId: 'live-cashier-a' } });
    const res = await app.inject({
      method: 'POST', url: `/api/v1/cash/drawers/${drawer.id}/blind-close`, headers: authed('live-cashier-b'),
      payload: { countedCash: 125, checkCount: 0, checkTotal: 0, retainedFloat: 100 },
    });
    expect(res.statusCode).toBe(403);
    const blindCount = await prisma.cashBlindCount.findUnique({ where: { drawerId: drawer.id } });
    expect(blindCount).toBeNull();
  });

  it('ADMIN (real cash.drawer.view_all override) CAN submit blind close for Cashier A\'s drawer, and the response discloses NO expected/variance figures', async () => {
    const drawer = await prisma.cashDrawer.findFirstOrThrow({ where: { tenantId: TENANT, cashierId: 'live-cashier-a' } });
    const res = await app.inject({
      method: 'POST', url: `/api/v1/cash/drawers/${drawer.id}/blind-close`, headers: authed('live-admin-1'),
      payload: { countedCash: 125, checkCount: 0, checkTotal: 0, retainedFloat: 100 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    // BR: blind-close confirmation must never leak expected cash or variance —
    // the cashier (or, here, the privileged actor performing the submission)
    // must not see what the system expected before/at submission time.
    expect(body).not.toHaveProperty('expectedCash');
    expect(body).not.toHaveProperty('cashVariance');
    expect(body).not.toHaveProperty('variance');
    expect(body).not.toHaveProperty('classification');

    const persisted = await prisma.cashBlindCount.findUniqueOrThrow({ where: { drawerId: drawer.id } });
    expect(Number(persisted.countedCash)).toBe(125);
    // The variance itself IS computed and persisted server-side — just never
    // returned in this endpoint's response body.
    const variance = await prisma.cashDrawerVariance.findUniqueOrThrow({ where: { drawerId: drawer.id } });
    expect(variance.classification).toBe('EXACT');
    expect(Number(variance.cashVariance)).toBe(0);
  });

  it('CONTROLLER (real cash.drawer.view_all override) CAN also blind-close another cashier\'s drawer — proves the override is not ADMIN-only', async () => {
    const openRes = await app.inject({
      method: 'POST', url: '/api/v1/cash/drawers', headers: authed('live-cashier-c'),
      payload: { storeId: STORE, storeCode: STORE_CODE, terminalCode: 'LOWN-T-CTRL', entityId: ENTITY, businessDate: '2026-07-29', openingFloat: 50 },
    });
    expect(openRes.statusCode).toBe(201);
    const drawer = await prisma.cashDrawer.findFirstOrThrow({ where: { tenantId: TENANT, cashierId: 'live-cashier-c' } });

    const blocked = await app.inject({
      method: 'POST', url: `/api/v1/cash/drawers/${drawer.id}/blind-close`, headers: authed('live-cashier-b'),
      payload: { countedCash: 50, checkCount: 0, checkTotal: 0, retainedFloat: 50 },
    });
    expect(blocked.statusCode).toBe(403);

    const res = await app.inject({
      method: 'POST', url: `/api/v1/cash/drawers/${drawer.id}/blind-close`, headers: authed('live-controller-1'),
      payload: { countedCash: 50, checkCount: 0, checkTotal: 0, retainedFloat: 50 },
    });
    expect(res.statusCode).toBe(201);
    const persisted = await prisma.cashBlindCount.findUniqueOrThrow({ where: { drawerId: drawer.id } });
    expect(persisted.submittedBy).toBe('live-controller-1');
  });

  it('audit_outbox has real persisted records for open, receipt-issue and blind-close on this drawer/receipt', async () => {
    const drawer = await prisma.cashDrawer.findFirstOrThrow({ where: { tenantId: TENANT, cashierId: 'live-cashier-a' } });
    const receipt = await prisma.cashReceipt.findFirstOrThrow({ where: { tenantId: TENANT, drawerId: drawer.id } });

    const openEvent = await prisma.auditOutboxEvent.findFirst({ where: { tenantId: TENANT, docType: 'CASH_DRAWER', docId: drawer.id, action: 'CASH_DRAWER_OPENED' } });
    expect(openEvent).toBeTruthy();

    const receiptEvent = await prisma.auditOutboxEvent.findFirst({ where: { tenantId: TENANT, docType: 'CASH_RECEIPT', docId: receipt.id, action: 'CASH_RECEIPT_ISSUED' } });
    expect(receiptEvent).toBeTruthy();

    const blindCloseEvent = await prisma.auditOutboxEvent.findFirst({ where: { tenantId: TENANT, action: 'CASH_BLIND_COUNT_SUBMITTED', docId: drawer.id } });
    expect(blindCloseEvent).toBeTruthy();
  });
});
