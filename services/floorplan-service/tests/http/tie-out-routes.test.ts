/**
 * CE-12 gap-close — HTTP-level (Fastify .inject()) proof that GET
 * /api/v1/floorplan/tie-out now sources its authoritative "sum of open
 * liability items" figure from schedule-service's real open-item ledger
 * (via ScheduleServiceClient / SCHEDULE_SERVICE_CLIENT_TOKEN), not from
 * this service's own FloorplanLiabilityItem table — see
 * src/application/tie-out-service.ts's doc comment. Uses a fake fetch-free
 * InMemoryScheduleServiceClient double for speed/determinism; the REAL,
 * live-coa-service/schedule-service-over-HTTP proof lives in
 * tests/live-db/schedule-linkage-live.test.ts.
 *
 * Every other floorplanRoutes dependency is a plain stub — this file's job
 * is the tie-out endpoint and its authorization gate, not the rest of the
 * surface (already covered by the domain/live-db suites).
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { floorplanRoutes, FLOORPLAN_PERMISSIONS } from '../../src/http/routes';
import { LenderService } from '../../src/application/lender-service';
import { FeedService } from '../../src/application/feed-service';
import { MatchService } from '../../src/application/match-service';
import { BreakService } from '../../src/application/break-service';
import { TieOutService, SCHEDULE_SERVICE_CLIENT_TOKEN } from '../../src/application/tie-out-service';
import { SotService } from '../../src/application/sot-service';
import { InterestService } from '../../src/application/interest-service';
import { CurtailmentService } from '../../src/application/curtailment-service';
import { TenantConfigService } from '../../src/application/tenant-config-service';
import { InMemoryScheduleServiceClient, ScheduleOpenItem } from '../../src/infrastructure/schedule-service-client';
import { FLOORPLAN_SCHEDULE_NUMBER } from '../../src/domain/event-types';
import { createFakeAuthzClient } from '../support/fake-authz-client';

// ── JWT helper — mirrors services/tax-service/tests/http/routes.test.ts ────
const JWT_SECRET = 'floorplan-service-test-secret';

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

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  VIEWER: new Set([FLOORPLAN_PERMISSIONS.LIABILITY_VIEW]),
  NO_PERMS: new Set([]),
};

function makeFakePrisma() {
  const liabilityItems: any[] = [];
  const applications: any[] = [];
  return {
    _liabilityItems: liabilityItems,
    _applications: applications,
    floorplanLiabilityItem: {
      findMany: vi.fn(async ({ where }: any) =>
        liabilityItems.filter((i) => i.tenantId === where.tenantId && (!where.lenderCode || i.lenderCode === where.lenderCode)),
      ),
    },
    floorplanLiabilityApplication: {
      findMany: vi.fn(async ({ where }: any) =>
        applications.filter(
          (a) =>
            a.tenantId === where.tenantId &&
            (!where.item?.lenderCode || liabilityItems.find((i) => i.id === a.itemId)?.lenderCode === where.item.lenderCode),
        ),
      ),
    },
  };
}

describe('floorplan-service routes — GET /tie-out sources from schedule-service (CE-12 gap-close)', () => {
  let app: FastifyInstance;
  let scheduleClient: InMemoryScheduleServiceClient;
  let fakePrisma: ReturnType<typeof makeFakePrisma>;
  const originalJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeAll(async () => {
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;
    container.registerInstance(
      'AuthzClient',
      createFakeAuthzClient(
        [
          { userId: 'VIEWER', tenantId: 'tenant-a', role: 'VIEWER' },
          { userId: 'NO_PERMS', tenantId: 'tenant-a', role: 'NO_PERMS' },
        ],
        ROLE_GRANTS,
      ),
    );

    fakePrisma = makeFakePrisma();
    scheduleClient = new InMemoryScheduleServiceClient();
    container.registerInstance(SCHEDULE_SERVICE_CLIENT_TOKEN, scheduleClient);
    container.registerInstance('PrismaClient', fakePrisma as any);
    container.register(TieOutService, { useClass: TieOutService });

    // Every other floorplanRoutes dependency — plain stubs, this suite's
    // scope is the tie-out endpoint + its authz gate only.
    container.registerInstance(LenderService, { listLenders: vi.fn(async () => []), feedStatus: vi.fn(async () => ({})), upsertLenderProfile: vi.fn(async () => ({})) } as any);
    container.registerInstance(FeedService, {
      importFeedBatch: vi.fn(async () => ({})), importManualBatch: vi.fn(async () => ({})), listImportBatches: vi.fn(async () => []),
      listStagedRows: vi.fn(async () => []), getStagedRow: vi.fn(async () => ({})), supersedeRow: vi.fn(async () => ({})),
    } as any);
    container.registerInstance(MatchService, {
      matchRow: vi.fn(async () => ({})), listMatches: vi.fn(async () => []), listLiabilityItems: vi.fn(async () => []),
      getLiabilityItem: vi.fn(async () => ({})), scanForWeHaveLenderDoesntBreaks: vi.fn(async () => ({ created: 0 })),
    } as any);
    container.registerInstance(BreakService, { listBreaks: vi.fn(async () => []), getBreak: vi.fn(async () => ({})), dispositionBreak: vi.fn(async () => ({})) } as any);
    container.registerInstance(SotService, {
      recordDeliveryEvent: vi.fn(async () => ({})), dashboard: vi.fn(async () => ({})), listExceptions: vi.fn(async () => []),
      aging: vi.fn(async () => []), getException: vi.fn(async () => ({})), manualTransition: vi.fn(async () => ({})),
    } as any);
    container.registerInstance(InterestService, {
      enterStatement: vi.fn(async () => ({})), listStatements: vi.fn(async () => []), getStatement: vi.fn(async () => ({})),
      allocate: vi.fn(async () => []), postAccrual: vi.fn(async () => ({})), reverseAccrual: vi.fn(async () => ({})),
    } as any);
    container.registerInstance(CurtailmentService, {
      configureSchedule: vi.fn(async () => ({})), listSchedules: vi.fn(async () => []), payCurtailment: vi.fn(async () => ({})), listPayments: vi.fn(async () => []),
    } as any);
    container.registerInstance(TenantConfigService, { get: vi.fn(async () => ({})), update: vi.fn(async () => ({})) } as any);

    app = Fastify();
    await app.register(floorplanRoutes, { prefix: '/api/v1/floorplan' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    process.env['AMACC_JWT_SECRET'] = originalJwtSecret;
  });

  it('rejects an unauthenticated request with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/floorplan/tie-out', headers: { 'x-tenant-id': 'tenant-a' } });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for a role missing floorplan.liability.view', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/floorplan/tie-out', headers: authed('NO_PERMS') });
    expect(res.statusCode).toBe(403);
  });

  it('sources sumOfOpenLiabilityItems from schedule-service — NOT from the local FloorplanLiabilityItem sum', async () => {
    // Deliberately make the local ledger's sum (999.99) differ from
    // schedule-service's real open-item sum (500.00) — if the endpoint
    // still read the local ledger, this assertion would fail.
    fakePrisma._liabilityItems.push({ id: 'item-1', tenantId: 'tenant-a', lenderCode: 'ACME', vin: null, stockNumber: 'STK001', remainingBalance: '999.99' });
    fakePrisma._applications.push({ id: 'app-1', tenantId: 'tenant-a', itemId: 'item-1', amount: '500.00' });

    scheduleClient.setItems([
      {
        id: 'sched-item-1', scheduleNumber: FLOORPLAN_SCHEDULE_NUMBER, controlNumber: 'STK001', itemNumber: 'STK001',
        glAccountNumber: '19102', originalAmount: '500.00', appliedAmount: '0.00', remainingBalance: '500.00',
        status: 'OPEN', transactionDate: '2026-08-01T00:00:00.000Z', journalEntryId: 'je-1',
      } satisfies ScheduleOpenItem,
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/v1/floorplan/tie-out', headers: authed('VIEWER') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.scheduleNumber).toBe(FLOORPLAN_SCHEDULE_NUMBER);
    expect(body.sumOfOpenLiabilityItems).toBe('500.00'); // schedule-service's figure, not 999.99
    expect(body.sumOfPostedApplications).toBe('500.00');
    expect(body.tied).toBe(true);
    expect(body.variance).toBe('0.00');
    expect(body.items).toHaveLength(1);
    expect(body.items[0].stockNumber).toBe('STK001');
  });

  it('reports a non-zero variance when schedule-service and the own-ledger application sum disagree', async () => {
    fakePrisma._liabilityItems.length = 0;
    fakePrisma._applications.length = 0;
    fakePrisma._liabilityItems.push({ id: 'item-2', tenantId: 'tenant-a', lenderCode: 'ACME', vin: null, stockNumber: 'STK002', remainingBalance: '100.00' });
    fakePrisma._applications.push({ id: 'app-2', tenantId: 'tenant-a', itemId: 'item-2', amount: '100.00' });

    scheduleClient.setItems([
      {
        id: 'sched-item-2', scheduleNumber: FLOORPLAN_SCHEDULE_NUMBER, controlNumber: 'STK002', itemNumber: 'STK002',
        glAccountNumber: '19102', originalAmount: '150.00', appliedAmount: '0.00', remainingBalance: '150.00',
        status: 'OPEN', transactionDate: '2026-08-01T00:00:00.000Z', journalEntryId: 'je-2',
      } satisfies ScheduleOpenItem,
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/v1/floorplan/tie-out', headers: authed('VIEWER') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.sumOfOpenLiabilityItems).toBe('150.00');
    expect(body.sumOfPostedApplications).toBe('100.00');
    expect(body.tied).toBe(false);
    expect(body.variance).toBe('50.00');
  });

  it('excludes CLOSED schedule-service items from the open sum', async () => {
    fakePrisma._liabilityItems.length = 0;
    fakePrisma._applications.length = 0;

    scheduleClient.setItems([
      {
        id: 'sched-item-3', scheduleNumber: FLOORPLAN_SCHEDULE_NUMBER, controlNumber: 'STK003', itemNumber: 'STK003',
        glAccountNumber: '19102', originalAmount: '200.00', appliedAmount: '200.00', remainingBalance: '0.00',
        status: 'CLOSED', transactionDate: '2026-08-01T00:00:00.000Z', journalEntryId: 'je-3',
      } satisfies ScheduleOpenItem,
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/v1/floorplan/tie-out', headers: authed('VIEWER') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.sumOfOpenLiabilityItems).toBe('0.00');
    expect(body.itemCount).toBe(0);
    expect(body.items).toHaveLength(0);
  });

  it('lenderCode filter cross-references the own ledger to scope schedule-service items by controlNumber', async () => {
    fakePrisma._liabilityItems.length = 0;
    fakePrisma._applications.length = 0;
    fakePrisma._liabilityItems.push(
      { id: 'item-4', tenantId: 'tenant-a', lenderCode: 'ACME', vin: null, stockNumber: 'STK004', remainingBalance: '0' },
      { id: 'item-5', tenantId: 'tenant-a', lenderCode: 'OTHER-LENDER', vin: null, stockNumber: 'STK005', remainingBalance: '0' },
    );

    scheduleClient.setItems([
      { id: 'sched-item-4', scheduleNumber: FLOORPLAN_SCHEDULE_NUMBER, controlNumber: 'STK004', itemNumber: 'STK004', glAccountNumber: '19102', originalAmount: '300.00', appliedAmount: '0.00', remainingBalance: '300.00', status: 'OPEN', transactionDate: '2026-08-01T00:00:00.000Z', journalEntryId: 'je-4' },
      { id: 'sched-item-5', scheduleNumber: FLOORPLAN_SCHEDULE_NUMBER, controlNumber: 'STK005', itemNumber: 'STK005', glAccountNumber: '19102', originalAmount: '700.00', appliedAmount: '0.00', remainingBalance: '700.00', status: 'OPEN', transactionDate: '2026-08-01T00:00:00.000Z', journalEntryId: 'je-5' },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/v1/floorplan/tie-out?lenderCode=ACME', headers: authed('VIEWER') });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.lenderCode).toBe('ACME');
    expect(body.sumOfOpenLiabilityItems).toBe('300.00'); // only STK004's schedule item, not STK005's
    expect(body.items).toHaveLength(1);
    expect(body.items[0].stockNumber).toBe('STK004');
  });
});
