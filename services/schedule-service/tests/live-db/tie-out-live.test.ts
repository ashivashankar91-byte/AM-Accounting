/**
 * S026 — nightly GL-to-schedule tie-out LIVE certification suite.
 *
 * Runs against the real Postgres (shared docker-compose `amacc` dev
 * database) AND, when reachable, the real running gl-service container
 * (GL_SERVICE_URL, default http://localhost:3010) — proving the actual HTTP
 * contract (path + response shape), not a mocked assumption of it. This is
 * how the /api/v1/gl/trial-balance path-prefix bug and the {accounts:[...]}
 * response-shape bug (both fixed in infrastructure/gl-balance-client.ts)
 * were actually found — curling the running container directly showed the
 * bare /trial-balance path 404s and the payload is not a bare array.
 *
 * Covers:
 *   1. Real HTTP call to gl-service's live /api/v1/gl/trial-balance —
 *      schedule-service correctly parses the real response shape.
 *   2. A schedule with a nonzero remaining balance against a GL account with
 *      no matching activity in gl-service is recorded as a persisted
 *      DISCREPANCY (not silently matched, not silently corrected).
 *   3. GL_UNAVAILABLE is recorded (not MATCHED, not thrown/lost) when
 *      gl-service cannot be reached.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { PrismaClient } from '.prisma/schedule-client';
import { TieOutService } from '../../src/application/tie-out-service';
import { PrismaScheduleRepository } from '../../src/infrastructure/schedule-repository';
import { PrismaScheduleOpenItemRepository } from '../../src/infrastructure/schedule-open-item-repository';
import { PrismaScheduleTieOutRepository } from '../../src/infrastructure/schedule-tie-out-repository';
import { HttpGlBalanceClient } from '../../src/infrastructure/gl-balance-client';
import { OpenItemService } from '../../src/application/open-item-service';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'] ?? 'postgresql://amacc:amacc_dev@localhost:5433/amacc';
const GL_SERVICE_URL = process.env['GL_SERVICE_URL'] ?? 'http://localhost:3010';
const SKIP = process.env['SKIP_LIVE_DB'] === 'true';

async function glServiceReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${GL_SERVICE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

describe.skipIf(SKIP)('S026 Live — nightly GL-to-schedule tie-out', () => {
  let prisma: PrismaClient;
  let tieOutSvc: TieOutService;
  let openItemSvc: OpenItemService;
  let glUp = false;

  const TENANT = `s026-tieout-live-${randomUUID()}`;
  const SCHEDULE_NUMBER = '78';
  const GL_ACCOUNT = '9998';

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();
    glUp = await glServiceReachable();

    const openItemRepo = new PrismaScheduleOpenItemRepository(prisma);
    openItemSvc = new OpenItemService(prisma as any, openItemRepo);
    tieOutSvc = new TieOutService(
      new PrismaScheduleRepository(prisma),
      openItemRepo,
      new PrismaScheduleTieOutRepository(prisma),
      new HttpGlBalanceClient(GL_SERVICE_URL),
      prisma as any,
    );

    await prisma.schedule.create({
      data: {
        tenantId: TENANT,
        scheduleNumber: SCHEDULE_NUMBER,
        title: 'S026 Tie-Out Live Test',
        scheduleType: 5,
        glAccountNumbers: [GL_ACCOUNT],
        eomPurgeType: 5,
      },
    });

    await openItemSvc.processPostingEvent(
      TENANT,
      {
        tenantId: TENANT,
        journalEntryId: `je-${randomUUID()}`,
        glAccountNumber: GL_ACCOUNT,
        scheduleNumber: SCHEDULE_NUMBER,
        controlNumber: 'CUSTTIEOUT',
        amount: '333.33',
        referenceNumber: `INV-${randomUUID().slice(0, 8)}`,
        journalSource: 'AJ',
        transactionDate: new Date().toISOString(),
      },
      `corr-${randomUUID()}`,
    );
  });

  afterAll(async () => {
    await prisma.scheduleGlTieOut.deleteMany({ where: { tenantId: TENANT } });
    await prisma.scheduleApplication.deleteMany({ where: { tenantId: TENANT } });
    await prisma.scheduleOpenItem.deleteMany({ where: { tenantId: TENANT } });
    await prisma.scheduleDetail.deleteMany({ where: { tenantId: TENANT } });
    await prisma.auditOutboxEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.schedule.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$disconnect();
  });

  it('records a persisted DISCREPANCY against the real gl-service response when balances disagree', async () => {
    if (!glUp) {
      console.warn(`[tie-out-live.test.ts] gl-service not reachable at ${GL_SERVICE_URL} — skipping real-HTTP assertion.`);
      return;
    }
    const { runId, rows } = await tieOutSvc.runTieOut(TENANT, new Date(), 'live-test');
    expect(runId).toBeTruthy();
    const row = rows.find((r: any) => r.glAccountNumber === GL_ACCOUNT);
    expect(row).toBeDefined();
    // This tenant has never posted through gl-service, so its real
    // trial-balance has no activity for GL_ACCOUNT (ending balance 0) while
    // schedule-service carries a 333.33 remaining balance — a genuine,
    // real-HTTP-verified discrepancy.
    expect(row!.status).toBe('DISCREPANCY');
    expect(row!.scheduleBalance.toFixed(2)).toBe('333.33');

    const persisted = await prisma.scheduleGlTieOut.findMany({ where: { tenantId: TENANT, runId } });
    expect(persisted.length).toBeGreaterThan(0);
    expect(persisted[0].status).toBe('DISCREPANCY');

    // Audit evidence: a DISCREPANCY outcome wrote a real audit_outbox row
    // against the live database (this test's afterAll deletes it, so this
    // is the only place that evidence is ever queried).
    const auditRows = await prisma.auditOutboxEvent.findMany({
      where: { tenantId: TENANT, docType: 'SCHEDULE_GL_TIE_OUT', action: 'DISCREPANCY_DETECTED', correlationId: runId },
    });
    expect(auditRows.length).toBeGreaterThan(0);
  });

  it('records GL_UNAVAILABLE (not MATCHED) when gl-service cannot be reached', async () => {
    const unreachableClient = new HttpGlBalanceClient('http://localhost:1');
    const unreachableSvc = new TieOutService(
      new PrismaScheduleRepository(prisma),
      new PrismaScheduleOpenItemRepository(prisma),
      new PrismaScheduleTieOutRepository(prisma),
      unreachableClient,
      prisma as any,
    );
    const { rows } = await unreachableSvc.runTieOut(TENANT, new Date(), 'live-test-unreachable');
    const row = rows.find((r: any) => r.glAccountNumber === GL_ACCOUNT);
    expect(row!.status).toBe('GL_UNAVAILABLE');
    expect(row!.glBalance).toBeNull();
  });
});
