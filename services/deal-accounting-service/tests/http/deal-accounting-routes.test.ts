/**
 * Gap-closure — real Fastify `.inject()` HTTP tests for every new/changed
 * endpoint from this pass: CIT funding-receipts list, CIT sold-not-funded,
 * wholesale dispositions list, deal lineage, review-queue join, and the new
 * Due-Bill/We-Owe ceremony (record/list/get/fulfill). Modeled on services/
 * apar-service/tests/vendor-routes.test.ts's pattern: a real Fastify
 * instance registers this service's real routes.ts, with every application
 * service + PrismaClient + AuthzClient swapped for an in-memory fake via
 * tsyringe's container (routes.ts resolves concrete classes as DI tokens,
 * so `container.registerInstance(SomeService, fake)` overrides them cleanly
 * — no real DB, no real coa-service call, in this suite).
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { dealAccountingRoutes } from '../../src/http/routes';
import { DealFinalizeService } from '../../src/application/deal-finalize-service';
import { BillerReviewService } from '../../src/application/biller-review-service';
import { UnwindService } from '../../src/application/unwind-service';
import { RecontractService } from '../../src/application/recontract-service';
import { CitFundingService } from '../../src/application/cit-funding-service';
import { PayoffService } from '../../src/application/payoff-service';
import { WholesaleService } from '../../src/application/wholesale-service';
import { DueBillService } from '../../src/application/due-bill-service';
import { DealNotFoundError, OpenItemNotFoundError, AlreadyRelievedError } from '../../src/application/errors';
import { DEAL_ACCOUNTING_PERMISSIONS } from '../../src/http/security';
import { createFakeAuthzClient } from '../support/fake-authz-client';

const JWT_SECRET = 'deal-accounting-gapclose-test-secret';
const TENANT = 'tenant-a';

function b64u(s: string): string {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function tokenFor(role: string, tenantId = TENANT): string {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ sub: role, tenantId, role, iat: now, exp: now + 3600 }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}
function authed(role: string, tenantId = TENANT) {
  return { 'x-tenant-id': tenantId, authorization: `Bearer ${tokenFor(role, tenantId)}`, 'content-type': 'application/json' };
}

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set(Object.values(DEAL_ACCOUNTING_PERMISSIONS)),
  ACCOUNTANT: new Set([
    DEAL_ACCOUNTING_PERMISSIONS.CIT_VIEW,
    DEAL_ACCOUNTING_PERMISSIONS.WHOLESALE_VIEW,
    DEAL_ACCOUNTING_PERMISSIONS.DEAL_VIEW,
    DEAL_ACCOUNTING_PERMISSIONS.REVIEW_VIEW,
    DEAL_ACCOUNTING_PERMISSIONS.DUE_BILL_VIEW,
    DEAL_ACCOUNTING_PERMISSIONS.DUE_BILL_RECORD,
  ]),
  NO_GRANTS: new Set<string>(),
};

function registerAuthz() {
  container.registerInstance('AuthzClient', createFakeAuthzClient(
    [
      { userId: 'ADMIN', tenantId: TENANT, role: 'ADMIN' },
      { userId: 'ACCOUNTANT', tenantId: TENANT, role: 'ACCOUNTANT' },
      { userId: 'NOBODY', tenantId: TENANT, role: 'NO_GRANTS' },
    ],
    ROLE_GRANTS,
  ));
}

const FAKE_DEAL = {
  id: 'deal-1', tenantId: TENANT, dealNumber: 'D-1001', dealType: 'RETAIL', status: 'POSTED',
  currentRecapVersion: 1, vin: '1FTFW1E5XNFA00001', stockNumber: 'STK-1001',
  legalEntityId: 'entity-1', storeId: 'store-1',
};

function fakePrisma(overrides: Record<string, any> = {}) {
  return {
    deal: { findUnique: vi.fn().mockResolvedValue(FAKE_DEAL), findMany: vi.fn().mockResolvedValue([FAKE_DEAL]) },
    dealRecap: { findMany: vi.fn().mockResolvedValue([]) },
    dealPostingRecord: { findMany: vi.fn().mockResolvedValue([]) },
    dealReviewCase: { findMany: vi.fn().mockResolvedValue([]) },
    dealOpenItem: { findMany: vi.fn().mockResolvedValue([]) },
    dealRecontract: { findMany: vi.fn().mockResolvedValue([]) },
    dealUnwind: { findMany: vi.fn().mockResolvedValue([]) },
    wholesaleDisposition: { findFirst: vi.fn().mockResolvedValue(null) },
    arbitrationCase: { findMany: vi.fn().mockResolvedValue([]) },
    payoffIssuance: { findUnique: vi.fn().mockResolvedValue(null) },
    ...overrides,
  };
}

function registerServiceStubs(over: Partial<Record<string, any>> = {}) {
  container.registerInstance('PrismaClient', over.prisma ?? fakePrisma());
  container.registerInstance(DealFinalizeService, over.finalize ?? { finalize: vi.fn() });
  container.registerInstance(BillerReviewService, over.review ?? { getQueue: vi.fn().mockResolvedValue([]), preview: vi.fn(), hold: vi.fn(), returnToDesking: vi.fn(), release: vi.fn() });
  container.registerInstance(UnwindService, over.unwind ?? { unwind: vi.fn() });
  container.registerInstance(RecontractService, over.recontract ?? { recontract: vi.fn() });
  container.registerInstance(CitFundingService, over.cit ?? {
    recordFundingReceipt: vi.fn(), dispositionShortfall: vi.fn(), listAging: vi.fn().mockResolvedValue([]),
    listFundingReceipts: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 }),
    listSoldNotFunded: vi.fn().mockResolvedValue([]),
  });
  container.registerInstance(PayoffService, over.payoff ?? { issuePayoff: vi.fn(), dispositionVariance: vi.fn() });
  container.registerInstance(WholesaleService, over.wholesale ?? {
    dispose: vi.fn(), priceAdjustment: vi.fn(), unitReturn: vi.fn(),
    listDispositions: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 }),
  });
  container.registerInstance(DueBillService, over.dueBill ?? {
    recordDueBill: vi.fn(), fulfill: vi.fn(), getById: vi.fn(), list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 }),
  });
  registerAuthz();
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(dealAccountingRoutes, { prefix: '/api/v1/deal-accounting' });
  await app.ready();
  return app;
}

describe('Gap-closure HTTP routes (CE-12 deal-accounting-service)', () => {
  const origSecret = process.env['AMACC_JWT_SECRET'];

  beforeAll(() => {
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;
  });
  afterAll(() => {
    process.env['AMACC_JWT_SECRET'] = origSecret;
  });

  // ── GET /cit/funding-receipts ────────────────────────────────────────────
  describe('GET /cit/funding-receipts', () => {
    it('401 with no auth header', async () => {
      registerServiceStubs();
      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/v1/deal-accounting/cit/funding-receipts', headers: { 'x-tenant-id': TENANT } });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it('403 without CIT_VIEW permission', async () => {
      registerServiceStubs();
      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/v1/deal-accounting/cit/funding-receipts', headers: authed('NOBODY') });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'FORBIDDEN' });
      await app.close();
    });

    it('200 empty list when none exist', async () => {
      registerServiceStubs();
      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/v1/deal-accounting/cit/funding-receipts', headers: authed('ACCOUNTANT') });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ items: [], total: 0 });
      await app.close();
    });

    it('200 with real persisted-shaped data and forwards dealNumber/status/pagination filters', async () => {
      const listFundingReceipts = vi.fn().mockResolvedValue({
        items: [{ id: 'r1', dealNumber: 'D-1001', status: 'MATCHED', amount: '25000.00' }], total: 1, page: 1, pageSize: 50,
      });
      registerServiceStubs({ cit: { recordFundingReceipt: vi.fn(), dispositionShortfall: vi.fn(), listAging: vi.fn(), listFundingReceipts, listSoldNotFunded: vi.fn() } });
      const app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/deal-accounting/cit/funding-receipts?dealNumber=D-1001&status=MATCHED&page=2&pageSize=10',
        headers: authed('ACCOUNTANT'),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ total: 1 });
      expect(listFundingReceipts).toHaveBeenCalledWith(TENANT, { dealNumber: 'D-1001', status: 'MATCHED', page: 2, pageSize: 10 });
      await app.close();
    });
  });

  // ── GET /cit/sold-not-funded ──────────────────────────────────────────────
  describe('GET /cit/sold-not-funded', () => {
    it('403 without CIT_VIEW', async () => {
      registerServiceStubs();
      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/v1/deal-accounting/cit/sold-not-funded', headers: authed('NOBODY') });
      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it('200 empty when nothing is sold-not-funded', async () => {
      registerServiceStubs();
      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/v1/deal-accounting/cit/sold-not-funded', headers: authed('ACCOUNTANT') });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ items: [] });
      await app.close();
    });

    it('200 with real SNF-shaped rows, honoring thresholdDays', async () => {
      const listSoldNotFunded = vi.fn().mockResolvedValue([{ itemNumber: 'D-1001', ageDays: 9, deal: { dealNumber: 'D-1001', status: 'POSTED' } }]);
      registerServiceStubs({ cit: { recordFundingReceipt: vi.fn(), dispositionShortfall: vi.fn(), listAging: vi.fn(), listFundingReceipts: vi.fn(), listSoldNotFunded } });
      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/v1/deal-accounting/cit/sold-not-funded?thresholdDays=7', headers: authed('ACCOUNTANT') });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toHaveLength(1);
      expect(listSoldNotFunded).toHaveBeenCalledWith(TENANT, 7);
      await app.close();
    });
  });

  // ── GET /wholesale/dispositions ──────────────────────────────────────────
  describe('GET /wholesale/dispositions', () => {
    it('403 without WHOLESALE_VIEW', async () => {
      registerServiceStubs();
      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/v1/deal-accounting/wholesale/dispositions', headers: authed('NOBODY') });
      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it('200 empty', async () => {
      registerServiceStubs();
      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/v1/deal-accounting/wholesale/dispositions', headers: authed('ACCOUNTANT') });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ items: [], total: 0 });
      await app.close();
    });

    it('200 with real data, forwards status/unitRef filters', async () => {
      const listDispositions = vi.fn().mockResolvedValue({ items: [{ id: 'w1', unitRef: 'VIN-1', status: 'POSTED' }], total: 1, page: 1, pageSize: 50 });
      registerServiceStubs({ wholesale: { dispose: vi.fn(), priceAdjustment: vi.fn(), unitReturn: vi.fn(), listDispositions } });
      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/v1/deal-accounting/wholesale/dispositions?status=POSTED&unitRef=VIN-1', headers: authed('ACCOUNTANT') });
      expect(res.statusCode).toBe(200);
      expect(listDispositions).toHaveBeenCalledWith(TENANT, { status: 'POSTED', unitRef: 'VIN-1', page: undefined, pageSize: undefined });
      await app.close();
    });
  });

  // ── GET /deals/:dealNumber/lineage ───────────────────────────────────────
  describe('GET /deals/:dealNumber/lineage', () => {
    it('403 without DEAL_VIEW', async () => {
      registerServiceStubs();
      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/v1/deal-accounting/deals/D-1001/lineage', headers: authed('NOBODY') });
      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it('404 for an unknown deal', async () => {
      registerServiceStubs({ prisma: fakePrisma({ deal: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn() } }) });
      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/v1/deal-accounting/deals/NOPE/lineage', headers: authed('ACCOUNTANT') });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'DEAL_NOT_FOUND' });
      await app.close();
    });

    it('200 returns the full chain (original posting + recontract deltas + unwind reversals)', async () => {
      const postingRecords = [{ id: 'p1', recapVersion: 1, segmentType: 'CORE', eventType: 'deal.finalized.v1', eventId: 'e1', coaStatus: 'POSTED', journalEntryId: 'j1', journalNumber: 'J-1', reversalJournalEntryId: null, reversalJournalNumber: null, reversedAt: null, createdAt: new Date() }];
      const recontracts = [{ id: 'rc1', fromRecapVersion: 1, toRecapVersion: 2, mode: 'DELTA', deltaPostingRecordId: 'p2', reversalPostingRecordId: null, repostPostingRecordId: null, createdAt: new Date() }];
      const unwinds = [{ id: 'u1', recapVersion: 2, status: 'COMPLETED', reason: 'test', refusalCode: null, reversalPostingRecordIds: ['p1'], executedAt: new Date() }];
      registerServiceStubs({
        prisma: fakePrisma({
          deal: { findUnique: vi.fn().mockResolvedValue(FAKE_DEAL), findMany: vi.fn() },
          dealPostingRecord: { findMany: vi.fn().mockResolvedValue(postingRecords) },
          dealRecontract: { findMany: vi.fn().mockResolvedValue(recontracts) },
          dealUnwind: { findMany: vi.fn().mockResolvedValue(unwinds) },
        }),
      });
      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/v1/deal-accounting/deals/D-1001/lineage', headers: authed('ACCOUNTANT') });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.deal.dealNumber).toBe('D-1001');
      expect(body.chain).toHaveLength(1);
      expect(body.recontracts).toHaveLength(1);
      expect(body.unwinds).toHaveLength(1);
      await app.close();
    });
  });

  // ── GET /review/queue — join fix ─────────────────────────────────────────
  describe('GET /review/queue', () => {
    it('403 without REVIEW_VIEW', async () => {
      registerServiceStubs();
      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/v1/deal-accounting/review/queue', headers: authed('NOBODY') });
      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it('200 items carry dealNumber/dealType directly (no client-side join needed)', async () => {
      const getQueue = vi.fn().mockResolvedValue([{ id: 'case-1', dealId: 'deal-1', recapVersion: 1, status: 'PENDING_REVIEW', dealNumber: 'D-1001', dealType: 'RETAIL' }]);
      registerServiceStubs({ review: { getQueue, preview: vi.fn(), hold: vi.fn(), returnToDesking: vi.fn(), release: vi.fn() } });
      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/v1/deal-accounting/review/queue', headers: authed('ACCOUNTANT') });
      expect(res.statusCode).toBe(200);
      expect(res.json().items[0]).toMatchObject({ dealNumber: 'D-1001', dealType: 'RETAIL' });
      await app.close();
    });
  });

  // ── Due-Bill / We-Owe ceremony ────────────────────────────────────────────
  describe('POST /due-bills', () => {
    it('403 without DUE_BILL_RECORD', async () => {
      registerServiceStubs();
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST', url: '/api/v1/deal-accounting/due-bills', headers: authed('NOBODY'),
        payload: JSON.stringify({ dealNumber: 'D-1001', itemDescription: 'Second key', amount: '150.00', reason: 'promised at delivery', idempotencyKey: 'k1' }),
      });
      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it('400 VALIDATION_ERROR when required fields are missing', async () => {
      registerServiceStubs();
      const app = await buildApp();
      const res = await app.inject({ method: 'POST', url: '/api/v1/deal-accounting/due-bills', headers: authed('ADMIN'), payload: JSON.stringify({}) });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
      await app.close();
    });

    it('404 DEAL_NOT_FOUND when the service refuses an orphan due-bill', async () => {
      const recordDueBill = vi.fn().mockRejectedValue(new DealNotFoundError('NO-SUCH-DEAL'));
      registerServiceStubs({ dueBill: { recordDueBill, fulfill: vi.fn(), getById: vi.fn(), list: vi.fn() } });
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST', url: '/api/v1/deal-accounting/due-bills', headers: authed('ADMIN'),
        payload: JSON.stringify({ dealNumber: 'NO-SUCH-DEAL', itemDescription: 'Floor mats', amount: '75.00', reason: 'backordered', idempotencyKey: 'k2' }),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'DEAL_NOT_FOUND' });
      await app.close();
    });

    it('201 real persisted response on success, with a real audit-bearing service call', async () => {
      const created = { id: 'db-1', dealId: 'deal-1', itemDescription: 'Second key', amount: '150.00', status: 'OPEN', coaStatus: 'POSTED', journalNumber: 'J-99' };
      const recordDueBill = vi.fn().mockResolvedValue(created);
      registerServiceStubs({ dueBill: { recordDueBill, fulfill: vi.fn(), getById: vi.fn(), list: vi.fn() } });
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST', url: '/api/v1/deal-accounting/due-bills', headers: authed('ADMIN'),
        payload: JSON.stringify({ dealNumber: 'D-1001', itemDescription: 'Second key', amount: '150.00', reason: 'promised at delivery', idempotencyKey: 'k3' }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ id: 'db-1', status: 'OPEN', journalNumber: 'J-99' });
      expect(recordDueBill).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT, dealNumber: 'D-1001', idempotencyKey: 'k3' }));
      await app.close();
    });
  });

  describe('GET /due-bills', () => {
    it('403 without DUE_BILL_VIEW', async () => {
      registerServiceStubs();
      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/v1/deal-accounting/due-bills', headers: authed('NOBODY') });
      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it('200 empty list', async () => {
      registerServiceStubs();
      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/v1/deal-accounting/due-bills', headers: authed('ACCOUNTANT') });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ items: [], total: 0 });
      await app.close();
    });
  });

  describe('GET /due-bills/:id', () => {
    it('404 when not found', async () => {
      const getById = vi.fn().mockRejectedValue(new OpenItemNotFoundError('DUE_BILL', 'db-x'));
      registerServiceStubs({ dueBill: { recordDueBill: vi.fn(), fulfill: vi.fn(), getById, list: vi.fn() } });
      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/v1/deal-accounting/due-bills/db-x', headers: authed('ACCOUNTANT') });
      expect(res.statusCode).toBe(404);
      await app.close();
    });
  });

  describe('POST /due-bills/:id/fulfill', () => {
    it('409 ALREADY_RELIEVED on a second fulfill', async () => {
      const fulfill = vi.fn().mockRejectedValue(new AlreadyRelievedError('Due-bill "db-1" is already fulfilled.'));
      registerServiceStubs({ dueBill: { recordDueBill: vi.fn(), fulfill, getById: vi.fn(), list: vi.fn() } });
      const app = await buildApp();
      const res = await app.inject({ method: 'POST', url: '/api/v1/deal-accounting/due-bills/db-1/fulfill', headers: authed('ADMIN'), payload: '{}' });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'ALREADY_RELIEVED' });
      await app.close();
    });
  });
});
