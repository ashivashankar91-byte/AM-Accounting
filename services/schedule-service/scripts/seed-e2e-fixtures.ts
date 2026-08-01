/**
 * S026/S027 Playwright fixture seeder — committed, repeatable replacement
 * for the discarded ad-hoc Docker Postgres instance the S026/S027 specs
 * previously depended on. Creates the fixture Schedule rows and their
 * ScheduleOpenItem/ScheduleDetail rows through the REAL
 * OpenItemService.processPostingEvent() / applyManual() write paths (the
 * same JOURNAL_ENTRY_POSTED-driven path gl-service uses in production), not
 * raw SQL — so the fixture data is provably reachable through the
 * application's own business logic, exactly like the S026/S027 specs'
 * header comments describe ("exercising the real JOURNAL_ENTRY_POSTED ->
 * OpenItemService.processPostingEvent path").
 *
 * Idempotent: safe to run repeatedly against the same database (checks for
 * existing rows before creating). Deterministic: fixed schedule numbers,
 * control numbers, item numbers, and amounts match the S026/S027 spec
 * defaults (see tests/e2e/s026-schedule-open-items.spec.ts and
 * tests/e2e/s027-schedule-aging.spec.ts env-var defaults).
 *
 * This script does NOT create the tenant or its users — run
 * services/auth-service/scripts/bootstrap-role-user.ts first (see
 * scripts/seed-s026-s027-e2e-fixtures.sh for the full orchestration).
 *
 * Usage:
 *   DATABASE_URL=<schedule-service DB url> AMACC_TENANT_ID=<uuid> \
 *     npx tsx scripts/seed-e2e-fixtures.ts
 */
import 'reflect-metadata';
import { PrismaClient } from '.prisma/schedule-client';
import { RlsTenantContext, createTenantRlsMiddleware } from '@amacc/shared-kernel';
import { OpenItemService } from '../src/application/open-item-service';
import { PrismaScheduleOpenItemRepository } from '../src/infrastructure/schedule-open-item-repository';
import type { IGlPostingClient } from '../src/infrastructure/gl-posting-client';

// processPostingEvent()/applyManual() never call the GL posting client
// themselves (that client is only used by the write-off ceremony's GL-debit
// path) — a stub is sufficient and keeps this seeder independent of a
// running gl-service.
class NoopGlPostingClient implements IGlPostingClient {
  async post(): Promise<{ journalEntryId: string }> {
    return { journalEntryId: 'seed-noop' };
  }
}

async function main() {
  const tenantId = process.env['AMACC_TENANT_ID'];
  if (!tenantId) throw new Error('AMACC_TENANT_ID is required');

  const scheduleNumberS026 = process.env['S026_SCHEDULE_NUMBER'] ?? '77';
  const itemNumberS026 = process.env['S026_ITEM_NUMBER'] ?? 'S026FIX01';
  const originalAmountS026 = process.env['S026_ORIGINAL_AMOUNT'] ?? '200.00';
  const controlNumberS026 = process.env['S026_CONTROL_NUMBER'] ?? 'FIXCUST01';

  const scheduleNumberS027 = process.env['S027_SCHEDULE_NUMBER'] ?? '78';
  const controlNumberS027 = process.env['S027_CONTROL_NUMBER'] ?? 'AGINGFIX01';
  const closedItemNumber = process.env['S027_CLOSED_ITEM_NUMBER'] ?? 'S027FIXCLS';
  const partialItemNumber = process.env['S027_PARTIAL_ITEM_NUMBER'] ?? 'S027FIXPRT';
  const partialOriginal = '100.00';
  const partialApplied = '40.00'; // remaining 60.00, matches S027_PARTIAL_REMAINING default
  const closedOriginal = '50.00';

  const prisma = new PrismaClient();
  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  RlsTenantContext.set(tenantId);

  const openItemRepo = new PrismaScheduleOpenItemRepository(prisma as any);
  const svc = new OpenItemService(prisma as any, openItemRepo, new NoopGlPostingClient());

  async function ensureSchedule(scheduleNumber: string, title: string) {
    const existing = await prisma.schedule.findUnique({
      where: { tenantId_scheduleNumber: { tenantId, scheduleNumber } },
    });
    if (existing) return existing;
    return prisma.schedule.create({
      data: {
        tenantId,
        scheduleNumber,
        title,
        reportSequence: 'C',
        scheduleType: 1,
        glAccountNumbers: ['1100'],
        eomPurgeType: 1,
        controlNameDisplay: ' ',
      },
    });
  }

  async function ensureOpenItem(
    scheduleNumber: string,
    controlNumber: string,
    itemNumber: string,
    amount: string,
    sourceCorrelationId: string,
  ) {
    // Idempotent-and-repeatable, not merely idempotent-once: a prior test
    // run may have mutated this same fixture item (applied/reversed/split/
    // written off it), so a plain "skip if it already exists" check would
    // silently leave the fixture in a non-pristine state on the second and
    // subsequent runs. Reset by deleting the item (and its applications/
    // audit rows/detail line) and recreating it fresh through the same real
    // JOURNAL_ENTRY_POSTED path every time, so this spec can genuinely be
    // re-run against the same database without manual cleanup.
    const existing = await prisma.scheduleOpenItem.findFirst({
      where: { tenantId, scheduleNumber, itemNumber },
    });
    if (existing) {
      await prisma.scheduleApplication.deleteMany({ where: { tenantId, openItemId: existing.id } });
      await prisma.auditOutboxEvent.deleteMany({ where: { tenantId, docType: 'SCHEDULE_OPEN_ITEM', docId: existing.id } }).catch(() => {});
      await prisma.scheduleOpenItem.delete({ where: { id: existing.id } });
      if (existing.scheduleDetailId) {
        await prisma.scheduleDetail.delete({ where: { id: existing.scheduleDetailId } }).catch(() => {});
      }
    }
    const outcome = await svc.processPostingEvent(
      tenantId,
      {
        tenantId,
        journalEntryId: `seed-${sourceCorrelationId}`,
        glAccountNumber: '1100',
        scheduleNumber,
        controlNumber,
        amount,
        referenceNumber: itemNumber,
        journalSource: 'GL',
        transactionDate: new Date().toISOString(),
        description: `E2E fixture: ${itemNumber}`,
      },
      sourceCorrelationId,
    );
    console.log('seeded open item', itemNumber, '->', outcome);
    return prisma.scheduleOpenItem.findFirst({ where: { tenantId, scheduleNumber, itemNumber } });
  }

  // ── S026 fixture: one OPEN item on schedule 77 ──────────────────────────
  await ensureSchedule(scheduleNumberS026, 'S026 E2E Fixture Schedule');
  await ensureOpenItem(scheduleNumberS026, controlNumberS026, itemNumberS026, originalAmountS026, `seed-s026-${itemNumberS026}`);

  // ── S027 fixture: one PARTIALLY_APPLIED item + one CLOSED item on ─────────
  // schedule 78, both under the same control# so the aging report's
  // reconciliation badge and control# filter have real, distinct data to
  // exercise (see s027 spec steps 4/5/9).
  await ensureSchedule(scheduleNumberS027, 'S027 E2E Fixture Schedule');

  const partial = await ensureOpenItem(
    scheduleNumberS027, controlNumberS027, partialItemNumber, partialOriginal, `seed-s027-${partialItemNumber}`,
  );
  if (partial && partial.status === 'OPEN') {
    // Apply a partial amount through the real manual-apply path so the item
    // reaches PARTIALLY_APPLIED with the expected remaining balance.
    await svc.applyManual(tenantId, partial.id, {
      amount: partialApplied,
      idempotencyKey: `seed-s027-apply-${partialItemNumber}`,
      appliedBy: 'seed-fixture',
    });
    console.log('applied partial amount to', partialItemNumber);
  }

  const closed = await ensureOpenItem(
    scheduleNumberS027, controlNumberS027, closedItemNumber, closedOriginal, `seed-s027-${closedItemNumber}`,
  );
  if (closed && closed.status === 'OPEN') {
    await svc.applyManual(tenantId, closed.id, {
      amount: closedOriginal,
      idempotencyKey: `seed-s027-apply-${closedItemNumber}`,
      appliedBy: 'seed-fixture',
    });
    console.log('closed item', closedItemNumber, 'via full apply');
  }

  console.log(JSON.stringify({
    tenantId,
    s026: { scheduleNumber: scheduleNumberS026, controlNumber: controlNumberS026, itemNumber: itemNumberS026 },
    s027: { scheduleNumber: scheduleNumberS027, controlNumber: controlNumberS027, closedItemNumber, partialItemNumber },
  }, null, 2));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
