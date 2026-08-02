import 'reflect-metadata';
import { describe, it, expect } from 'vitest';

import { LaborRateService } from '../../src/application/labor-rate-service';
import { FakePrismaClient } from '../support/fake-prisma';
import { RateGapError } from '../../src/domain/errors';

function makeService() {
  const prisma = new FakePrismaClient();
  const service = new LaborRateService(prisma as any);
  return { prisma, service };
}

describe('LaborRateService — S063 gap-closure approved policy', () => {
  it('setRate() creates a new effective-dated row and is audited', async () => {
    const { prisma, service } = makeService();
    const row = await service.setRate({ tenantId: 't1', legalEntityId: 'le1', scope: 'TECHNICIAN', subjectKey: 'TECH-1', burdenedRate: '45.50', effectiveFrom: '2026-01-01', actor: 'controller' });

    expect(row.burdenedRate).toBe('45.50');
    const audit = await (prisma as any).auditOutboxEvent.findFirst({ where: { tenantId: 't1', docType: 'LABOR_RATE_CONFIG', docId: row.id } });
    expect(audit).toBeTruthy();
    expect(audit.action).toBe('SET');
  });

  it('setRate() upserts on the natural key (tenant, legalEntity, scope, subjectKey, effectiveFrom) — same date replaces the rate, not a duplicate row', async () => {
    const { prisma, service } = makeService();
    await service.setRate({ tenantId: 't1', legalEntityId: 'le1', scope: 'TECHNICIAN', subjectKey: 'TECH-1', burdenedRate: '45.50', effectiveFrom: '2026-01-01', actor: 'controller' });
    await service.setRate({ tenantId: 't1', legalEntityId: 'le1', scope: 'TECHNICIAN', subjectKey: 'TECH-1', burdenedRate: '50.00', effectiveFrom: '2026-01-01', actor: 'controller' });

    const all = await service.listForEntity('t1', 'le1');
    expect(all).toHaveLength(1);
    expect(all[0].burdenedRate).toBe('50.00');
  });

  it('resolveRate() prefers a technician-specific rate over a department-default rate, even when the department rate is more recently effective', async () => {
    const { service } = makeService();
    await service.setRate({ tenantId: 't1', legalEntityId: 'le1', scope: 'TECHNICIAN', subjectKey: 'TECH-1', burdenedRate: '40.00', effectiveFrom: '2025-01-01', actor: 'controller' });
    await service.setRate({ tenantId: 't1', legalEntityId: 'le1', scope: 'DEPARTMENT', subjectKey: 'SVC', burdenedRate: '35.00', effectiveFrom: '2026-06-01', actor: 'controller' });

    const resolved = await service.resolveRate('t1', 'le1', 'TECH-1', 'SVC', '2026-08-01');

    expect(resolved.rateSource).toBe('TECHNICIAN');
    expect(resolved.rateAmount).toBe(40.00);
  });

  it('resolveRate() falls back to the department-default rate when no technician-specific row exists', async () => {
    const { service } = makeService();
    await service.setRate({ tenantId: 't1', legalEntityId: 'le1', scope: 'DEPARTMENT', subjectKey: 'SVC', burdenedRate: '35.00', effectiveFrom: '2026-01-01', actor: 'controller' });

    const resolved = await service.resolveRate('t1', 'le1', 'TECH-999', 'SVC', '2026-08-01');

    expect(resolved.rateSource).toBe('DEPARTMENT');
    expect(resolved.rateAmount).toBe(35.00);
  });

  it('resolveRate() picks the LATEST effective-dated row that is still <= the business date — not the first one created, not a future-dated row', async () => {
    const { service } = makeService();
    await service.setRate({ tenantId: 't1', legalEntityId: 'le1', scope: 'TECHNICIAN', subjectKey: 'TECH-1', burdenedRate: '40.00', effectiveFrom: '2025-01-01', actor: 'controller' });
    await service.setRate({ tenantId: 't1', legalEntityId: 'le1', scope: 'TECHNICIAN', subjectKey: 'TECH-1', burdenedRate: '48.00', effectiveFrom: '2026-06-01', actor: 'controller' });
    await service.setRate({ tenantId: 't1', legalEntityId: 'le1', scope: 'TECHNICIAN', subjectKey: 'TECH-1', burdenedRate: '99.00', effectiveFrom: '2027-01-01', actor: 'controller' }); // future — must not be picked

    const resolved = await service.resolveRate('t1', 'le1', 'TECH-1', 'SVC', '2026-08-01');

    expect(resolved.rateAmount).toBe(48.00);
    expect(resolved.rateEffectiveFrom).toBe('2026-06-01');
  });

  it('resolveRate() ignores a technician-specific row that is not yet effective as of the business date, correctly falling back to department', async () => {
    const { service } = makeService();
    await service.setRate({ tenantId: 't1', legalEntityId: 'le1', scope: 'TECHNICIAN', subjectKey: 'TECH-1', burdenedRate: '99.00', effectiveFrom: '2027-01-01', actor: 'controller' }); // not yet effective
    await service.setRate({ tenantId: 't1', legalEntityId: 'le1', scope: 'DEPARTMENT', subjectKey: 'SVC', burdenedRate: '35.00', effectiveFrom: '2026-01-01', actor: 'controller' });

    const resolved = await service.resolveRate('t1', 'le1', 'TECH-1', 'SVC', '2026-08-01');

    expect(resolved.rateSource).toBe('DEPARTMENT');
    expect(resolved.rateAmount).toBe(35.00);
  });

  it('resolveRate() throws RateGapError when neither a technician nor a department rate resolves — never a dealership-wide fallback, never an estimated rate', async () => {
    const { service } = makeService();
    await expect(service.resolveRate('t1', 'le1', 'TECH-1', 'SVC', '2026-08-01')).rejects.toThrow(RateGapError);
  });

  it('resolveRate() is scoped per legal entity — a rate resolved for one entity never leaks into another', async () => {
    const { service } = makeService();
    await service.setRate({ tenantId: 't1', legalEntityId: 'le1', scope: 'TECHNICIAN', subjectKey: 'TECH-1', burdenedRate: '40.00', effectiveFrom: '2026-01-01', actor: 'controller' });

    await expect(service.resolveRate('t1', 'le2', 'TECH-1', 'SVC', '2026-08-01')).rejects.toThrow(RateGapError);
  });

  it('listForEntity() returns all scopes/subjects for the entity', async () => {
    const { service } = makeService();
    await service.setRate({ tenantId: 't1', legalEntityId: 'le1', scope: 'TECHNICIAN', subjectKey: 'TECH-1', burdenedRate: '40.00', effectiveFrom: '2026-01-01', actor: 'controller' });
    await service.setRate({ tenantId: 't1', legalEntityId: 'le1', scope: 'DEPARTMENT', subjectKey: 'SVC', burdenedRate: '35.00', effectiveFrom: '2026-01-01', actor: 'controller' });

    const all = await service.listForEntity('t1', 'le1');
    expect(all).toHaveLength(2);
  });
});
