import 'reflect-metadata';
import { PrismaClient } from '.prisma/schedule-client';
import { RlsTenantContext, createTenantRlsMiddleware } from '@amacc/shared-kernel';
import { OpenItemService } from '../src/application/open-item-service';
import { PrismaScheduleOpenItemRepository } from '../src/infrastructure/schedule-open-item-repository';
import type { IGlPostingClient } from '../src/infrastructure/gl-posting-client';

class NoopGlPostingClient implements IGlPostingClient {
  async post(): Promise<{ journalEntryId: string }> { return { journalEntryId: 'seed-noop' }; }
}

async function main() {
  const tenantId = process.env['AMACC_TENANT_ID']!;
  const prisma = new PrismaClient();
  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  RlsTenantContext.set(tenantId);
  const openItemRepo = new PrismaScheduleOpenItemRepository(prisma as any);
  const svc = new OpenItemService(prisma as any, openItemRepo, new NoopGlPostingClient());

  async function ensureSchedule(scheduleNumber: string) {
    const existing = await prisma.schedule.findUnique({ where: { tenantId_scheduleNumber: { tenantId, scheduleNumber } } });
    if (existing) return existing;
    return prisma.schedule.create({ data: { tenantId, scheduleNumber, title: `CE08 fixture ${scheduleNumber}`, reportSequence: 'C', scheduleType: 1, glAccountNumbers: ['1100'], eomPurgeType: 1, controlNameDisplay: ' ' } });
  }

  async function ensureOpenItem(scheduleNumber: string, controlNumber: string, itemNumber: string, amount: string, corrId: string, pastDueDays = 0) {
    const existing = await prisma.scheduleOpenItem.findFirst({ where: { tenantId, scheduleNumber, itemNumber } });
    if (existing) {
      await prisma.scheduleApplication.deleteMany({ where: { tenantId, openItemId: existing.id } });
      await prisma.auditOutboxEvent.deleteMany({ where: { tenantId, docType: 'SCHEDULE_OPEN_ITEM', docId: existing.id } }).catch(() => {});
      await prisma.scheduleOpenItem.delete({ where: { id: existing.id } });
      if (existing.scheduleDetailId) await prisma.scheduleDetail.delete({ where: { id: existing.scheduleDetailId } }).catch(() => {});
    }
    const txDate = new Date();
    if (pastDueDays) txDate.setDate(txDate.getDate() - pastDueDays);
    await svc.processPostingEvent(tenantId, {
      tenantId, journalEntryId: `seed-${corrId}`, glAccountNumber: '1100', scheduleNumber, controlNumber, amount,
      referenceNumber: itemNumber, journalSource: 'GL', transactionDate: txDate.toISOString(), description: `CE08 fixture: ${itemNumber}`,
    }, corrId);
    console.log('seeded', itemNumber);
  }

  await ensureSchedule('90');
  await ensureSchedule('91');
  await ensureOpenItem('90', 'E2ECUST01', 'E2ESPLIT001', '500.00', 'seed-s028-split');
  await ensureOpenItem('90', 'E2ECUST02', 'E2EXFER001', '300.00', 'seed-s028-xfer');
  await ensureOpenItem('90', 'E2ECUST03', 'E2EWO001', '250.00', 'seed-s028-wo');
  await ensureOpenItem('90', 'E2ECUST04', 'E2EAUTO001', '150.00', 'seed-s028-auto');
  await ensureOpenItem('90', 'E2ECUST05', 'E2ESTALE01', '400.00', 'seed-s028-stale', 100);
  console.log('done');
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
