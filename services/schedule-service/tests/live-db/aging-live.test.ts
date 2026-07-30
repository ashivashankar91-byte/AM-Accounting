/**
 * S027 — Schedule Aging Engine LIVE DATABASE certification suite.
 *
 * Same conventions as tests/live-db/open-item-live.test.ts. Proves the
 * aging report reconciles to REAL S026 open-item balances created through
 * the real OpenItemService.processPostingEvent path (not fixtures written
 * directly to the aging tables), across open, partially-applied, and closed
 * items, and that a real tenant-scoped bucket-config override changes
 * classification.
 *
 * Covers:
 *   1. A closed item (fully applied) is excluded from the aging report.
 *   2. An open item and a partially-applied item both appear, aged on their
 *      real remainingBalance, and the report's grandTotal reconciles
 *      exactly to a fresh, independent DB aggregate over the same items.
 *   3. A tenant-specific bucket-config override (set via
 *      AgingService.setBucketConfig against the real DB) changes which
 *      bucket an item classifies into.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { PrismaClient } from '.prisma/schedule-client';
import { OpenItemService } from '../../src/application/open-item-service';
import { AgingService } from '../../src/application/aging-service';
import { PrismaScheduleOpenItemRepository } from '../../src/infrastructure/schedule-open-item-repository';
import { PrismaScheduleAgingConfigRepository } from '../../src/infrastructure/schedule-aging-config-repository';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'] ?? 'postgresql://amacc:amacc_dev@localhost:5433/amacc';
const SKIP = process.env['SKIP_LIVE_DB'] === 'true';

describe.skipIf(SKIP)('S027 Live database — schedule aging engine', () => {
  let prisma: PrismaClient;
  let openItemSvc: OpenItemService;
  let agingSvc: AgingService;

  const TENANT = `s027-live-${randomUUID()}`;
  const SCHEDULE_NUMBER = '79';

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();
    const openItemRepo = new PrismaScheduleOpenItemRepository(prisma);
    openItemSvc = new OpenItemService(prisma as any, openItemRepo);
    agingSvc = new AgingService(openItemRepo, new PrismaScheduleAgingConfigRepository(prisma));

    await prisma.schedule.create({
      data: {
        tenantId: TENANT,
        scheduleNumber: SCHEDULE_NUMBER,
        title: 'S027 Aging Live Test',
        scheduleType: 5,
        glAccountNumbers: ['9997'],
        eomPurgeType: 5,
      },
    });
  });

  afterAll(async () => {
    await prisma.scheduleGlTieOut.deleteMany({ where: { tenantId: TENANT } });
    await prisma.scheduleApplication.deleteMany({ where: { tenantId: TENANT } });
    await prisma.scheduleOpenItem.deleteMany({ where: { tenantId: TENANT } });
    await prisma.scheduleDetail.deleteMany({ where: { tenantId: TENANT } });
    await prisma.auditOutboxEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.scheduleAgingBucketConfig.deleteMany({ where: { tenantId: TENANT } });
    await prisma.schedule.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$disconnect();
  });

  function postingEvent(overrides: Partial<any> = {}) {
    return {
      tenantId: TENANT,
      journalEntryId: `je-${randomUUID()}`,
      glAccountNumber: '9997',
      scheduleNumber: SCHEDULE_NUMBER,
      controlNumber: 'CUSTAGING1',
      amount: '100.00',
      referenceNumber: `INV-${randomUUID().slice(0, 8)}`,
      journalSource: 'AJ',
      transactionDate: '2026-06-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('excludes a fully-closed item and reconciles the report total to a fresh independent aggregate', async () => {
    // Item 1: opened, then fully closed — must be excluded from aging.
    const closedInvoice = postingEvent({ amount: '80.00' });
    await openItemSvc.processPostingEvent(TENANT, closedInvoice, `corr-${randomUUID()}`);
    await openItemSvc.processPostingEvent(
      TENANT,
      postingEvent({ amount: '80.00', applyNumber: closedInvoice.referenceNumber, applyCd: '#' }),
      `corr-${randomUUID()}`,
    );

    // Item 2: opened, partially applied — remains ageable at its remaining balance.
    const partialInvoice = postingEvent({ amount: '100.00' });
    await openItemSvc.processPostingEvent(TENANT, partialInvoice, `corr-${randomUUID()}`);
    await openItemSvc.processPostingEvent(
      TENANT,
      postingEvent({ amount: '40.00', applyNumber: partialInvoice.referenceNumber, applyCd: '#' }),
      `corr-${randomUUID()}`,
    );

    // Item 3: fully open, untouched.
    const openInvoice = postingEvent({ amount: '55.55' });
    await openItemSvc.processPostingEvent(TENANT, openInvoice, `corr-${randomUUID()}`);

    const report = await agingSvc.getAgingReport(TENANT, { scheduleNumber: SCHEDULE_NUMBER });

    const itemNumbers = report.rows.map((r) => r.itemNumber);
    expect(itemNumbers).not.toContain(closedInvoice.referenceNumber);
    expect(itemNumbers).toContain(partialInvoice.referenceNumber);
    expect(itemNumbers).toContain(openInvoice.referenceNumber);

    const partialRow = report.rows.find((r) => r.itemNumber === partialInvoice.referenceNumber);
    expect(partialRow!.remainingBalance).toBe('60.00');

    // Independent, fresh DB aggregate — not the same in-memory sum the
    // service just computed.
    const freshAgg = await prisma.scheduleOpenItem.aggregate({
      where: { tenantId: TENANT, scheduleNumber: SCHEDULE_NUMBER, status: { not: 'CLOSED' } },
      _sum: { remainingBalance: true },
    });
    const expectedTotal = freshAgg._sum.remainingBalance!.toFixed(2);
    expect(report.grandTotal).toBe(expectedTotal);
    expect(report.reconciliation).toEqual({ agingTotal: expectedTotal, openItemTotal: expectedTotal, matches: true });
  });

  it('applies a real tenant-specific bucket-config override to classification', async () => {
    const invoice = postingEvent({ amount: '10.00', controlNumber: 'CUSTAGING2', transactionDate: '2026-05-01T00:00:00.000Z' });
    await openItemSvc.processPostingEvent(TENANT, invoice, `corr-${randomUUID()}`);

    const asOf = new Date('2026-07-31'); // ~91 days after 2026-05-01

    const defaultReport = await agingSvc.getAgingReport(TENANT, {
      scheduleNumber: SCHEDULE_NUMBER, controlNumber: 'CUSTAGING2', asOfDate: asOf,
    });
    expect(defaultReport.rows[0].bucket).toBe('90+');

    // Override: a single wide "0-120" catch-all bucket for this tenant.
    await agingSvc.setBucketConfig(TENANT, [{ label: '0-120', upperBoundDays: null }], 'live-test');

    const overriddenReport = await agingSvc.getAgingReport(TENANT, {
      scheduleNumber: SCHEDULE_NUMBER, controlNumber: 'CUSTAGING2', asOfDate: asOf,
    });
    expect(overriddenReport.rows[0].bucket).toBe('0-120');

    const persisted = await prisma.scheduleAgingBucketConfig.findUnique({ where: { tenantId: TENANT } });
    expect(persisted).not.toBeNull();
    expect(persisted!.updatedBy).toBe('live-test');
  });
});
