/**
 * S052 — route-level "own drawer only" authorization tests.
 *
 * Gap found during S052 certification: ReceiptService.createReceipt/
 * voidReceipt and BlindCloseService.submit validated drawer STATE (OPEN,
 * eligible-for-void, etc.) but never compared the authenticated actor against
 * drawer.cashierId — any user holding the tenant-wide cash.receipt.create /
 * cash.receipt.void / cash.drawer.blind_close permission could act on ANY
 * cashier's drawer by supplying its id, not just their own. Fixed by adding
 * an ownership check at the route layer (assertOwnDrawerOrPrivileged in
 * cash-drawer-routes.ts / cash-receipt-routes.ts), mirroring the existing
 * GET /drawers/:drawerId own-vs-view_all pattern. This file proves the fix
 * end-to-end through the real Fastify routes and DI wiring (fake Prisma /
 * fake AuthzClient — no live DB needed), per BR #10 in the S052 contract:
 * "Unauthorized users cannot open, transact against or close another
 * cashier's drawer."
 */
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import type { AuthzClient, AuthzCheckRequest, AuthzCheckResult } from '@amacc/shared-kernel';

import { cashDrawerRoutes, CASH_PERMISSIONS } from '../src/http/cash-drawer-routes';
import { cashReceiptRoutes, CASH_RECEIPT_PERMISSIONS } from '../src/http/cash-receipt-routes';

const JWT_SECRET = 'cash-ownership-authz-test-secret';
const TENANT = 'tenant-a';
const OWNER_DRAWER_ID = 'drawer-owned-by-cashier-a';
const OTHER_CASHIER_ID = 'cashier-b';

function b64u(s: string): string {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function tokenFor(sub: string): string {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ sub, tenantId: TENANT, iat: now, exp: now + 3600 }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function authed(sub: string) {
  return { 'x-tenant-id': TENANT, authorization: `Bearer ${tokenFor(sub)}` };
}

// CASHIER holds every day-to-day cash.* action key but NOT view_all;
// ADMIN holds every key including view_all (emergency override) — mirrors
// the S052 authz-catalog migration's role design exactly.
const CASHIER_GRANTS = new Set([
  CASH_PERMISSIONS.DRAWER_OPEN, CASH_PERMISSIONS.DRAWER_VIEW_OWN, CASH_PERMISSIONS.DRAWER_BLIND_CLOSE,
  CASH_RECEIPT_PERMISSIONS.CREATE, CASH_RECEIPT_PERMISSIONS.VIEW, CASH_RECEIPT_PERMISSIONS.REPRINT, CASH_RECEIPT_PERMISSIONS.VOID,
]);
const ADMIN_GRANTS = new Set([
  ...CASHIER_GRANTS, CASH_PERMISSIONS.DRAWER_VIEW_ALL, CASH_PERMISSIONS.DRAWER_RECONCILE, CASH_PERMISSIONS.VARIANCE_APPROVE,
]);

class FakeAuthzClient implements AuthzClient {
  async check(req: AuthzCheckRequest): Promise<AuthzCheckResult> {
    const grants = req.userId === 'admin-1' ? ADMIN_GRANTS : CASHIER_GRANTS;
    return { allow: grants.has(req.permissionKey) };
  }
}

// Fakes just enough of DrawerService/ReceiptService/BlindCloseService for the
// route layer's ownership check to be exercised — the underlying business
// logic (state machine, idempotency, variance math) is already covered by
// each service's own application-layer test file.
class FakeDrawerService {
  async getById(_tenantId: string, drawerId: string) {
    if (drawerId !== OWNER_DRAWER_ID) throw Object.assign(new Error('not found'), { statusCode: 404 });
    return { id: OWNER_DRAWER_ID, tenantId: TENANT, cashierId: 'cashier-a', status: 'OPEN' };
  }
}
class FakeReceiptService {
  async createReceipt(dto: any) {
    return { id: 'receipt-1', drawerId: dto.drawerId, idempotent: false };
  }
  async getReceiptById(_tenantId: string, receiptId: string) {
    return { id: receiptId, drawerId: OWNER_DRAWER_ID, status: 'ISSUED' };
  }
  async voidReceipt(dto: any) {
    return { id: dto.receiptId, status: 'VOIDED' };
  }
}
class FakeBlindCloseService {
  async submit(dto: any) {
    return { drawerId: dto.drawerId, status: 'BLIND_COUNT_SUBMITTED', submittedAt: new Date(), idempotent: false };
  }
}

describe('S052 — drawer ownership enforcement (own drawer only, not just permission)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;
    container.reset();
    container.registerInstance<AuthzClient>('AuthzClient', new FakeAuthzClient());
    container.registerInstance('DrawerService', new FakeDrawerService());
    container.registerInstance('ReceiptService', new FakeReceiptService());
    container.registerInstance('BlindCloseService', new FakeBlindCloseService());
    container.registerInstance('ReconciliationService', {
      getReconciliation: async () => ({}),
      approveVariance: async () => ({ idempotent: false }),
      reconcile: async () => ({ idempotent: false }),
    });

    app = Fastify();
    await app.register(cashDrawerRoutes, { prefix: '/api/v1/cash' });
    await app.register(cashReceiptRoutes, { prefix: '/api/v1/cash' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    delete process.env['AMACC_JWT_SECRET'];
  });

  it('a cashier CAN issue a receipt against their OWN drawer', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/v1/cash/drawers/${OWNER_DRAWER_ID}/receipts`, headers: authed('cashier-a'),
      payload: {
        entityId: 'e1', sourceDocType: 'RO', sourceDocId: 'RO-1', totalAmount: 10,
        tenders: [{ tenderType: 'CASH', amount: 10 }], idempotencyKey: 'idem-1',
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it('a DIFFERENT cashier CANNOT issue a receipt against another cashier\'s drawer (403, not silently allowed)', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/v1/cash/drawers/${OWNER_DRAWER_ID}/receipts`, headers: authed(OTHER_CASHIER_ID),
      payload: {
        entityId: 'e1', sourceDocType: 'RO', sourceDocId: 'RO-1', totalAmount: 10,
        tenders: [{ tenderType: 'CASH', amount: 10 }], idempotencyKey: 'idem-2',
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN');
  });

  it('a DIFFERENT cashier CANNOT void a receipt belonging to another cashier\'s drawer', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/v1/cash/receipts/receipt-1/void`, headers: authed(OTHER_CASHIER_ID),
      payload: { reason: 'mistake' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('a DIFFERENT cashier CANNOT submit a blind close for another cashier\'s drawer', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/v1/cash/drawers/${OWNER_DRAWER_ID}/blind-close`, headers: authed(OTHER_CASHIER_ID),
      payload: { countedCash: 10, checkCount: 0, checkTotal: 0, retainedFloat: 0 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('ADMIN (holds cash.drawer.view_all) CAN act on another cashier\'s drawer — emergency override', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/v1/cash/drawers/${OWNER_DRAWER_ID}/blind-close`, headers: authed('admin-1'),
      payload: { countedCash: 10, checkCount: 0, checkTotal: 0, retainedFloat: 0 },
    });
    expect(res.statusCode).toBe(201);
  });

  it('the owning cashier CAN void their own receipt', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/v1/cash/receipts/receipt-1/void`, headers: authed('cashier-a'),
      payload: { reason: 'mistake' },
    });
    expect(res.statusCode).toBe(200);
  });
});
