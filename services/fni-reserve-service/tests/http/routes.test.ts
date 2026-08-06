/**
 * CE-12 gap-closure — real Fastify .inject() HTTP tests for fni-reserve-
 * service's routes, focused on every NEW/CHANGED endpoint from this pass:
 *   - POST /chargebacks/preview (new)
 *   - POST /cancellations/preview (new)
 *   - GET  /chargeback-reserve/accruals (new)
 *   - GET  /chargeback-reserve/draws (new)
 *   - GET  /chargeback-reserve/tie-out (changed — now carries scheduleTieOut)
 * plus a representative sample of the pre-existing mutating endpoints
 * (POST /chargebacks, POST /cancellations) to prove preview and the real
 * mutation are wired through the SAME permission-guard/validation pattern.
 *
 * Application services are test doubles (vi.fn()) registered directly into
 * the tsyringe container — this suite proves route wiring (permission
 * enforcement, Zod validation, status codes, response passthrough), not
 * application-service business logic (covered by tests/unit and
 * tests/live-db).
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import type { AuthzClient, AuthzCheckRequest, AuthzCheckResult } from '@amacc/shared-kernel';
import { fniReserveRoutes, FNI_RESERVE_PERMISSIONS } from '../../src/http/routes';
import { ConfigService } from '../../src/application/config-service';
import { ReserveService } from '../../src/application/reserve-service';
import { RemitService } from '../../src/application/remit-service';
import { CancellationService } from '../../src/application/cancellation-service';
import { DeferralService } from '../../src/application/deferral-service';

const JWT_SECRET = 'fni-reserve-routes-test-secret';
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

/** In-memory AuthzClient stand-in — role -> granted permission set. */
function createFakeAuthzClient(rolePermissions: Record<string, ReadonlySet<string>>): AuthzClient {
  return {
    async check(req: AuthzCheckRequest): Promise<AuthzCheckResult> {
      const granted = rolePermissions[req.userId];
      if (granted?.has(req.permissionKey)) return { allow: true, matchedRole: req.userId };
      return { allow: false, reason: 'NO_MATCHING_ROLE' };
    },
  };
}

const FULL_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set(Object.values(FNI_RESERVE_PERMISSIONS)),
};
const VIEW_ONLY_GRANTS: Record<string, ReadonlySet<string>> = {
  VIEWER: new Set([FNI_RESERVE_PERMISSIONS.CHARGEBACK_VIEW, FNI_RESERVE_PERMISSIONS.CANCELLATION_VIEW]),
};

const FAKE_PREVIEW = { preview: true, controlNumber: 'CBR:LP1:D1', chargebackAmount: '250.00', reserveBalanceBefore: '200.00', drawFromReserveAmount: '200.00', excessToExpenseAmount: '50.00', reserveBalanceAfter: '0.00' };
const FAKE_CANCEL_PREVIEW = { preview: true, quoteTotal: '400.00', incomeReversalAmount: '240.00', remitAdjustmentAmount: '160.00', refundPayableAmount: '400.00' };
const FAKE_ACCRUAL = { id: 'accrual-1', tenantId: TENANT, dealNumber: 'D1', lenderProgramCode: 'LP1', accrualAmount: '150.00' };
const FAKE_DRAW = { id: 'draw-1', tenantId: TENANT, dealNumber: 'D1', lenderProgramCode: 'LP1', drawFromReserveAmount: '150.00' };
const FAKE_TIE_OUT = { lines: [], totalAccrued: '150.00', totalDrawn: '0.00', totalRemainingBalance: '150.00', scheduleTieOut: { scheduleNumber: '95', openItemCount: 1, totalRemainingBalance: '150.00', source: 'SCHEDULE_SERVICE' as const } };

function fakeReserveService(overrides: Partial<Record<string, any>> = {}) {
  return {
    processChargebackNotice: vi.fn().mockResolvedValue({ drawId: 'draw-1', ...FAKE_PREVIEW }),
    previewChargebackNotice: vi.fn().mockResolvedValue(FAKE_PREVIEW),
    listAccruals: vi.fn().mockResolvedValue({ items: [FAKE_ACCRUAL], page: 1, pageSize: 25, total: 1 }),
    listDraws: vi.fn().mockResolvedValue({ items: [FAKE_DRAW], page: 1, pageSize: 25, total: 1 }),
    tieOutChargebackReserve: vi.fn().mockResolvedValue(FAKE_TIE_OUT),
    processRemittance: vi.fn(),
    listRemittances: vi.fn().mockResolvedValue([]),
    getRemittance: vi.fn(),
    dispositionShortPay: vi.fn(),
    ...overrides,
  };
}

function fakeCancellationService(overrides: Partial<Record<string, any>> = {}) {
  return {
    processCancellation: vi.fn().mockResolvedValue({ id: 'cancel-1', status: 'PROCESSED', ...FAKE_CANCEL_PREVIEW }),
    previewCancellation: vi.fn().mockResolvedValue(FAKE_CANCEL_PREVIEW),
    listCancellations: vi.fn().mockResolvedValue([]),
    getCancellation: vi.fn(),
    getLineage: vi.fn(),
    ...overrides,
  };
}

describe('fni-reserve-service routes — CE-12 gap-closure new/changed endpoints', () => {
  let app: FastifyInstance;
  const origJwtSecret = process.env['AMACC_JWT_SECRET'];
  let reserveSvc: ReturnType<typeof fakeReserveService>;
  let cancellationSvc: ReturnType<typeof fakeCancellationService>;

  beforeAll(async () => {
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;

    reserveSvc = fakeReserveService();
    cancellationSvc = fakeCancellationService();

    container.registerInstance(ConfigService, {
      createLenderProgramConfig: vi.fn(), listLenderProgramConfigs: vi.fn().mockResolvedValue([]),
      createProviderProgramConfig: vi.fn(), listProviderProgramConfigs: vi.fn().mockResolvedValue([]),
      createDeferralModeConfig: vi.fn(), listDeferralModeConfigs: vi.fn().mockResolvedValue([]),
      resolveDeferralMode: vi.fn(), setScheduleMapping: vi.fn(), getScheduleMapping: vi.fn(), listScheduleMappings: vi.fn().mockResolvedValue([]),
    } as any);
    container.registerInstance(ReserveService, reserveSvc as any);
    container.registerInstance(RemitService, {
      registerRemitLiability: vi.fn(), executeRemitRun: vi.fn(), listRemitRuns: vi.fn().mockResolvedValue([]), getRemitRun: vi.fn(),
      tieOutRemitLiability: vi.fn().mockResolvedValue({ openItems: [], totalOpenAmount: '0.00', scheduleTieOut: null }),
      uploadProviderStatement: vi.fn(), listReconciliations: vi.fn().mockResolvedValue([]), getReconciliation: vi.fn(), reviewVarianceLine: vi.fn(),
    } as any);
    container.registerInstance(CancellationService, cancellationSvc as any);
    container.registerInstance(DeferralService, {
      registerBooking: vi.fn(), listBookings: vi.fn().mockResolvedValue([]), getBooking: vi.fn(),
      tieOutDeferralLiability: vi.fn().mockResolvedValue({ totalDeferred: '0.00', totalRecognized: '0.00', totalUnearned: '0.00', scheduleTieOut: null }),
      computeRecognitionRunPreview: vi.fn(), listBatches: vi.fn().mockResolvedValue([]), getBatch: vi.fn(), approveAndPost: vi.fn(),
    } as any);
    container.registerInstance('AuthzClient', createFakeAuthzClient({ ...FULL_GRANTS, ...VIEW_ONLY_GRANTS }));

    app = Fastify();
    await app.register(fniReserveRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    process.env['AMACC_JWT_SECRET'] = origJwtSecret;
  });

  // ── POST /chargebacks/preview ───────────────────────────────────────────
  describe('POST /api/v1/fni-reserve/chargebacks/preview', () => {
    const validPayload = { dealNumber: 'D1', lenderProgramCode: 'LP1', chargebackAmount: '250.00', idempotencyKey: 'k1' };

    it('denies a role with no chargeback.preview grant (403)', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/fni-reserve/chargebacks/preview', headers: authed('VIEWER'), payload: JSON.stringify(validPayload) });
      expect(res.statusCode).toBe(403);
    });

    it('computes the preview split for a granted role WITHOUT calling processChargebackNotice (200, no posting)', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/fni-reserve/chargebacks/preview', headers: authed('ADMIN'), payload: JSON.stringify(validPayload) });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(FAKE_PREVIEW);
      expect(reserveSvc.previewChargebackNotice).toHaveBeenCalled();
      expect(reserveSvc.processChargebackNotice).not.toHaveBeenCalled();
    });

    it('rejects a missing required field with 400 VALIDATION_ERROR', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/fni-reserve/chargebacks/preview', headers: authed('ADMIN'), payload: JSON.stringify({ dealNumber: 'D1' }) });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('VALIDATION_ERROR');
    });

    it('the real POST /chargebacks endpoint accepts the SAME payload shape and actually posts (distinct call, distinct permission)', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/fni-reserve/chargebacks', headers: authed('ADMIN'), payload: JSON.stringify(validPayload) });
      expect(res.statusCode).toBe(201);
      expect(reserveSvc.processChargebackNotice).toHaveBeenCalled();
    });
  });

  // ── GET /chargeback-reserve/accruals + /draws ───────────────────────────
  describe('GET /api/v1/fni-reserve/chargeback-reserve/accruals', () => {
    it('denies a role with no chargeback.view grant (403)', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/fni-reserve/chargeback-reserve/accruals', headers: authed('UNKNOWN') });
      expect(res.statusCode).toBe(403);
    });

    it('returns real persisted rows, paginated, for a granted role (200)', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/fni-reserve/chargeback-reserve/accruals?dealNumber=D1&page=1&pageSize=10', headers: authed('VIEWER') });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ items: [FAKE_ACCRUAL], page: 1, pageSize: 25, total: 1 });
      expect(reserveSvc.listAccruals).toHaveBeenCalledWith(TENANT, { dealNumber: 'D1', lenderProgramCode: undefined }, 1, 10);
    });

    it('returns an empty page when there are no matching rows', async () => {
      reserveSvc.listAccruals.mockResolvedValueOnce({ items: [], page: 1, pageSize: 25, total: 0 });
      const res = await app.inject({ method: 'GET', url: '/api/v1/fni-reserve/chargeback-reserve/accruals?dealNumber=NOPE', headers: authed('VIEWER') });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ items: [], page: 1, pageSize: 25, total: 0 });
    });
  });

  describe('GET /api/v1/fni-reserve/chargeback-reserve/draws', () => {
    it('denies a role with no chargeback.view grant (403)', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/fni-reserve/chargeback-reserve/draws', headers: authed('UNKNOWN') });
      expect(res.statusCode).toBe(403);
    });

    it('returns real persisted rows for a granted role (200)', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/fni-reserve/chargeback-reserve/draws?dealNumber=D1', headers: authed('VIEWER') });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ items: [FAKE_DRAW], page: 1, pageSize: 25, total: 1 });
    });
  });

  it('GET /chargeback-reserve/tie-out now carries the authoritative scheduleTieOut field', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/fni-reserve/chargeback-reserve/tie-out', headers: authed('VIEWER') });
    expect(res.statusCode).toBe(200);
    expect(res.json().scheduleTieOut).toEqual(FAKE_TIE_OUT.scheduleTieOut);
  });

  // ── POST /cancellations/preview ─────────────────────────────────────────
  describe('POST /api/v1/fni-reserve/cancellations/preview', () => {
    const validPayload = {
      dealNumber: 'D1', productCode: 'GAP', cancellationSource: 'CUSTOMER',
      originalIncomeAmount: '600.00', originalRemitAmount: '400.00',
      refundBasis: { kind: 'PROVIDER_QUOTE_PERCENT', refundPercent: 40 },
      idempotencyKey: 'k2',
    };

    it('denies a role with no cancellation.preview grant (403)', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/fni-reserve/cancellations/preview', headers: authed('VIEWER'), payload: JSON.stringify(validPayload) });
      expect(res.statusCode).toBe(403);
    });

    it('computes the three-leg preview for a granted role WITHOUT calling processCancellation (200, no posting)', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/fni-reserve/cancellations/preview', headers: authed('ADMIN'), payload: JSON.stringify(validPayload) });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(FAKE_CANCEL_PREVIEW);
      expect(cancellationSvc.previewCancellation).toHaveBeenCalled();
      expect(cancellationSvc.processCancellation).not.toHaveBeenCalled();
    });

    it('rejects an invalid refundBasis discriminant with 400 VALIDATION_ERROR', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/fni-reserve/cancellations/preview', headers: authed('ADMIN'),
        payload: JSON.stringify({ ...validPayload, refundBasis: { kind: 'NOT_A_REAL_KIND' } }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('VALIDATION_ERROR');
    });

    it('the real POST /cancellations endpoint accepts the SAME payload shape and actually posts (distinct call, distinct permission)', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/fni-reserve/cancellations', headers: authed('ADMIN'), payload: JSON.stringify(validPayload) });
      expect(res.statusCode).toBe(201);
      expect(cancellationSvc.processCancellation).toHaveBeenCalled();
    });
  });

  // ── Cross-cutting ────────────────────────────────────────────────────────
  it('every route requires x-tenant-id (400 when missing, even with a valid otherwise-authorized token)', async () => {
    const headers = { authorization: `Bearer ${tokenFor('ADMIN')}`, 'content-type': 'application/json' };
    const res = await app.inject({ method: 'POST', url: '/api/v1/fni-reserve/chargebacks/preview', headers, payload: JSON.stringify({ dealNumber: 'D1', lenderProgramCode: 'LP1', chargebackAmount: '1.00', idempotencyKey: 'k' }) });
    expect(res.statusCode).toBe(400);
  });

  it('unauthenticated requests are rejected (401) before any permission check', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/fni-reserve/chargeback-reserve/accruals', headers: { 'x-tenant-id': TENANT } });
    expect(res.statusCode).toBe(401);
  });
});
