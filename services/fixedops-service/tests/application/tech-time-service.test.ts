import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/lib/serializable-retry', () => ({
  withSerializableRetry: async (prisma: any, fn: (tx: any) => Promise<any>) => fn(prisma),
}));

import { TechTimeService } from '../../src/application/tech-time-service';
import { AccountMappingService } from '../../src/application/account-mapping-service';
import { LaborRateService } from '../../src/application/labor-rate-service';
import { FakePrismaClient } from '../support/fake-prisma';
import { FakePostingEventProducer } from '../support/fake-posting-client';
import { ROLES_BY_FAMILY, EVENT_FAMILY } from '../../src/domain/account-mapping-roles';
import { AccountMappingPendingError, RateGapError, NotFoundError } from '../../src/domain/errors';

async function resolveAllMappings(prisma: FakePrismaClient, tenantId: string, legalEntityId: string, families: string[]) {
  for (const family of families) {
    for (const role of (ROLES_BY_FAMILY as any)[family] ?? []) {
      await (prisma as any).fixedOpsAccountMapping.create({
        data: { tenantId, legalEntityId, eventFamily: family, role, status: 'RESOLVED', accountNumber: null },
      });
    }
  }
}

function makeService() {
  const prisma = new FakePrismaClient();
  const postingClient = new FakePostingEventProducer();
  const mapping = new AccountMappingService(prisma as any);
  const rate = new LaborRateService(prisma as any);
  const service = new TechTimeService(prisma as any, postingClient, mapping, rate);
  return { prisma, postingClient, mapping, rate, service };
}

const baseAbsorb = {
  tenantId: 't1', legalEntityId: 'le1', techId: 'TECH-1', deptCode: 'SVC', payrollPeriodId: 'PP-2026-08',
  clockedHours: '80', flaggedAppliedHours: '70', businessDate: '2026-08-01',
  sourceEventId: 'evt-1', correlationId: 'c1', actor: 'tester',
};

describe('TechTimeService.absorb() — S063 approved unapplied-time absorption policy', () => {
  it('resolves the technician-specific burdened rate and converts unapplied hours to a dollar amount, capturing rate/source/effective-date on the row', async () => {
    const { prisma, postingClient, rate, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.UNAPPLIED_TIME_ABSORPTION]);
    await rate.setRate({ tenantId: 't1', legalEntityId: 'le1', scope: 'TECHNICIAN', subjectKey: 'TECH-1', burdenedRate: '25.00', effectiveFrom: '2026-01-01', actor: 'controller' });

    const row = await service.absorb(baseAbsorb);

    expect(row.idempotent).toBe(false);
    expect(row.unappliedHours).toBe(10); // 80 clocked - 70 applied
    expect(row.unappliedAmount).toBe(250); // 10 hours * $25.00
    expect(row.rateSource).toBe('TECHNICIAN');
    expect(row.rateAmount).toBe(25);
    expect(row.rateEffectiveFrom).toBeTruthy();
    expect(postingClient.submitted).toHaveLength(1);
    expect(postingClient.submitted[0].payload.unappliedAmount).toBe('250.00');
  });

  it('falls back to the department-default rate when no technician-specific rate is configured', async () => {
    const { prisma, rate, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.UNAPPLIED_TIME_ABSORPTION]);
    await rate.setRate({ tenantId: 't1', legalEntityId: 'le1', scope: 'DEPARTMENT', subjectKey: 'SVC', burdenedRate: '22.00', effectiveFrom: '2026-01-01', actor: 'controller' });

    const row = await service.absorb(baseAbsorb);

    expect(row.rateSource).toBe('DEPARTMENT');
    expect(row.unappliedAmount).toBe(220); // 10 hours * $22.00
  });

  it('RATE_GAP: rejects with RateGapError when neither a technician nor a department rate resolves — zero DB writes, zero posting-engine call', async () => {
    const { prisma, postingClient, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.UNAPPLIED_TIME_ABSORPTION]);

    await expect(service.absorb(baseAbsorb)).rejects.toThrow(RateGapError);

    expect(postingClient.submitted).toHaveLength(0);
    const rows = await (prisma as any).techTimeAbsorption.findMany({ where: { tenantId: 't1', techId: 'TECH-1' } });
    expect(rows).toHaveLength(0); // never a partial/estimated absorption row
  });

  it('RATE_GAP is checked BEFORE the account-mapping check — a rate gap surfaces even when the mapping is also unresolved, and still writes nothing', async () => {
    const { prisma, postingClient, service } = makeService();
    // No mapping resolved AND no rate configured.
    await expect(service.absorb(baseAbsorb)).rejects.toThrow(RateGapError);
    expect(postingClient.submitted).toHaveLength(0);
    const rows = await (prisma as any).techTimeAbsorption.findMany({ where: { tenantId: 't1' } });
    expect(rows).toHaveLength(0);
  });

  it('rejects with AccountMappingPendingError when a rate resolves but the account mapping does not — still zero mutation', async () => {
    const { prisma, postingClient, rate, service } = makeService();
    await rate.setRate({ tenantId: 't1', legalEntityId: 'le1', scope: 'TECHNICIAN', subjectKey: 'TECH-1', burdenedRate: '25.00', effectiveFrom: '2026-01-01', actor: 'controller' });

    await expect(service.absorb(baseAbsorb)).rejects.toThrow(AccountMappingPendingError);
    expect(postingClient.submitted).toHaveLength(0);
    const rows = await (prisma as any).techTimeAbsorption.findMany({ where: { tenantId: 't1' } });
    expect(rows).toHaveLength(0);
  });

  it('is idempotent on (tenantId, techId, payrollPeriodId) — replay returns the original row, no second journal, no second rate lookup', async () => {
    const { prisma, postingClient, rate, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.UNAPPLIED_TIME_ABSORPTION]);
    await rate.setRate({ tenantId: 't1', legalEntityId: 'le1', scope: 'TECHNICIAN', subjectKey: 'TECH-1', burdenedRate: '25.00', effectiveFrom: '2026-01-01', actor: 'controller' });

    const first = await service.absorb(baseAbsorb);
    const second = await service.absorb(baseAbsorb);

    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.id).toBe(first.id);
    expect(postingClient.submitted).toHaveLength(1);
  });

  it('computes shortfallAmount from guaranteedHours vs flaggedAppliedHours at the same resolved rate', async () => {
    const { prisma, rate, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.UNAPPLIED_TIME_ABSORPTION]);
    await rate.setRate({ tenantId: 't1', legalEntityId: 'le1', scope: 'TECHNICIAN', subjectKey: 'TECH-1', burdenedRate: '30.00', effectiveFrom: '2026-01-01', actor: 'controller' });
    await service.setGuaranteeConfig({ tenantId: 't1', legalEntityId: 'le1', techId: 'TECH-1', guaranteedHoursPerPeriod: '75', effectiveFrom: '2026-01-01', actor: 'controller' });

    const row = await service.absorb(baseAbsorb); // flaggedAppliedHours = 70, guaranteed = 75 -> shortfall 5

    expect(row.shortfallHours).toBe(5);
    expect(row.shortfallAmount).toBe(150); // 5 hours * $30.00
  });

  it('ignores a guarantee-config row scoped to a DIFFERENT legal entity — never leaks cross-entity', async () => {
    const { prisma, rate, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.UNAPPLIED_TIME_ABSORPTION]);
    await rate.setRate({ tenantId: 't1', legalEntityId: 'le1', scope: 'TECHNICIAN', subjectKey: 'TECH-1', burdenedRate: '30.00', effectiveFrom: '2026-01-01', actor: 'controller' });
    await service.setGuaranteeConfig({ tenantId: 't1', legalEntityId: 'le2', techId: 'TECH-1', guaranteedHoursPerPeriod: '75', effectiveFrom: '2026-01-01', actor: 'controller' });

    const row = await service.absorb(baseAbsorb); // legalEntityId le1 — the le2 guarantee row must not apply

    expect(row.guaranteedHours).toBe(0);
    expect(row.shortfallHours).toBe(0);
  });

  it('ignores a guarantee-config row not yet effective as of the business date', async () => {
    const { prisma, rate, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.UNAPPLIED_TIME_ABSORPTION]);
    await rate.setRate({ tenantId: 't1', legalEntityId: 'le1', scope: 'TECHNICIAN', subjectKey: 'TECH-1', burdenedRate: '30.00', effectiveFrom: '2026-01-01', actor: 'controller' });
    await service.setGuaranteeConfig({ tenantId: 't1', legalEntityId: 'le1', techId: 'TECH-1', guaranteedHoursPerPeriod: '75', effectiveFrom: '2027-01-01', actor: 'controller' }); // future

    const row = await service.absorb(baseAbsorb); // businessDate 2026-08-01, before the guarantee's effective date

    expect(row.guaranteedHours).toBe(0);
    expect(row.shortfallHours).toBe(0);
  });
});

describe('TechTimeService.setGuaranteeConfig()/listGuaranteeConfig() — governed ceremony', () => {
  it('setGuaranteeConfig() upserts on the natural key — same effective date replaces the value rather than duplicating', async () => {
    const { service } = makeService();
    await service.setGuaranteeConfig({ tenantId: 't1', legalEntityId: 'le1', techId: 'TECH-1', guaranteedHoursPerPeriod: '70', effectiveFrom: '2026-01-01', actor: 'controller' });
    await service.setGuaranteeConfig({ tenantId: 't1', legalEntityId: 'le1', techId: 'TECH-1', guaranteedHoursPerPeriod: '80', effectiveFrom: '2026-01-01', actor: 'controller' });

    const all = await service.listGuaranteeConfig('t1', 'le1');
    expect(all).toHaveLength(1);
    expect(all[0].guaranteedHoursPerPeriod).toBe('80');
  });

  it('setGuaranteeConfig() is audited', async () => {
    const { prisma, service } = makeService();
    const row = await service.setGuaranteeConfig({ tenantId: 't1', legalEntityId: 'le1', techId: 'TECH-1', guaranteedHoursPerPeriod: '70', effectiveFrom: '2026-01-01', actor: 'controller' });
    const audit = await (prisma as any).auditOutboxEvent.findFirst({ where: { tenantId: 't1', docType: 'TECH_GUARANTEE_CONFIG', docId: row.id } });
    expect(audit).toBeTruthy();
  });

  it('listGuaranteeConfig() scopes to the requested legal entity only', async () => {
    const { service } = makeService();
    await service.setGuaranteeConfig({ tenantId: 't1', legalEntityId: 'le1', techId: 'TECH-1', guaranteedHoursPerPeriod: '70', effectiveFrom: '2026-01-01', actor: 'controller' });
    await service.setGuaranteeConfig({ tenantId: 't1', legalEntityId: 'le2', techId: 'TECH-1', guaranteedHoursPerPeriod: '80', effectiveFrom: '2026-01-01', actor: 'controller' });

    const rows = await service.listGuaranteeConfig('t1', 'le1');
    expect(rows).toHaveLength(1);
    expect(rows[0].legalEntityId).toBe('le1');
  });
});

describe('TechTimeService.reverse() — correction/reversal reuses the captured rate', () => {
  it('reverses a posted absorption using the ORIGINAL captured rate/amount, not a re-resolved current rate', async () => {
    const { prisma, postingClient, rate, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.UNAPPLIED_TIME_ABSORPTION]);
    await rate.setRate({ tenantId: 't1', legalEntityId: 'le1', scope: 'TECHNICIAN', subjectKey: 'TECH-1', burdenedRate: '25.00', effectiveFrom: '2026-01-01', actor: 'controller' });
    const original = await service.absorb(baseAbsorb);

    // Rate changes AFTER the original absorption — the reversal must still use $25.00, not the new $99.00.
    await rate.setRate({ tenantId: 't1', legalEntityId: 'le1', scope: 'TECHNICIAN', subjectKey: 'TECH-1', burdenedRate: '99.00', effectiveFrom: '2026-08-15', actor: 'controller' });

    const reversal = await service.reverse({ tenantId: 't1', legalEntityId: 'le1', techId: 'TECH-1', payrollPeriodId: 'PP-2026-08', actor: 'tester', correlationId: 'c2', sourceEventId: 'evt-reverse-1' });

    expect(reversal.idempotent).toBe(false);
    expect(reversal.status).toBe('COMPLETED');
    expect(reversal.originalJournalEntryId).toBe(original.journalEntryId);
    expect(postingClient.submitted).toHaveLength(2); // one absorb, one reverse
    expect(postingClient.submitted[1].payload.rateAmount).toBe('25'); // captured, not re-resolved
    expect(postingClient.submitted[1].payload.unappliedAmount).toBe('250');
  });

  it('is idempotent on (tenantId, techId, payrollPeriodId) — replay returns the original reversal, no second journal', async () => {
    const { prisma, postingClient, rate, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.UNAPPLIED_TIME_ABSORPTION]);
    await rate.setRate({ tenantId: 't1', legalEntityId: 'le1', scope: 'TECHNICIAN', subjectKey: 'TECH-1', burdenedRate: '25.00', effectiveFrom: '2026-01-01', actor: 'controller' });
    await service.absorb(baseAbsorb);
    const req = { tenantId: 't1', legalEntityId: 'le1', techId: 'TECH-1', payrollPeriodId: 'PP-2026-08', actor: 'tester', correlationId: 'c2', sourceEventId: 'evt-reverse-1' };

    const first = await service.reverse(req);
    const second = await service.reverse(req);

    expect(second.idempotent).toBe(true);
    expect(second.id).toBe(first.id);
    expect(postingClient.submitted).toHaveLength(2); // one absorb, exactly one reverse
  });

  it('reversing a payroll period with no absorption at all throws NotFoundError', async () => {
    const { service } = makeService();
    await expect(service.reverse({ tenantId: 't1', legalEntityId: 'le1', techId: 'TECH-1', payrollPeriodId: 'PP-NONE', actor: 'tester', correlationId: 'c1', sourceEventId: 'evt-1' }))
      .rejects.toThrow(NotFoundError);
  });
});
