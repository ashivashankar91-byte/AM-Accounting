import 'reflect-metadata';
import { describe, it, expect } from 'vitest';

import { WipModeService } from '../../src/application/wip-mode-service';
import { FakePrismaClient } from '../support/fake-prisma';
import { FixedOpsValidationError } from '../../src/domain/errors';

function makeService() {
  const prisma = new FakePrismaClient();
  const service = new WipModeService(prisma as any);
  return { prisma, service };
}

describe('WipModeService — S061 [SAFE_CONFIGURATION] effective-dated election', () => {
  it('elect() creates a new election row and is audited', async () => {
    const { prisma, service } = makeService();
    const row = await service.elect({ tenantId: 't1', legalEntityId: 'le1', mode: 'WIP_MODE', effectiveFrom: '2026-01-01', approvedBy: 'controller' });

    expect(row.mode).toBe('WIP_MODE');
    const audit = await (prisma as any).auditOutboxEvent.findFirst({ where: { tenantId: 't1', docType: 'WIP_MODE_ELECTION', docId: row.id } });
    expect(audit).toBeTruthy();
    expect(audit.action).toBe('ELECTED');
  });

  it('elect() rejects a mode value outside WIP_MODE/DIRECT_MODE', async () => {
    const { service } = makeService();
    await expect(service.elect({ tenantId: 't1', legalEntityId: 'le1', mode: 'BOGUS' as any, effectiveFrom: '2026-01-01', approvedBy: 'controller' }))
      .rejects.toThrow(FixedOpsValidationError);
  });

  it('activeMode() defaults to DIRECT_MODE when no election has ever been made', async () => {
    const { service } = makeService();
    const mode = await service.activeMode('t1', 'le1', null, new Date('2026-08-01'));
    expect(mode).toBe('DIRECT_MODE');
  });

  it('activeMode() is prospective-only — picks the election with the LATEST effectiveFrom that is still <= the given date, never a future election', async () => {
    const { service } = makeService();
    await service.elect({ tenantId: 't1', legalEntityId: 'le1', mode: 'WIP_MODE', effectiveFrom: '2026-01-01', approvedBy: 'controller' });
    await service.elect({ tenantId: 't1', legalEntityId: 'le1', mode: 'DIRECT_MODE', effectiveFrom: '2026-06-01', approvedBy: 'controller' });
    await service.elect({ tenantId: 't1', legalEntityId: 'le1', mode: 'WIP_MODE', effectiveFrom: '2027-01-01', approvedBy: 'controller' }); // future

    const mode = await service.activeMode('t1', 'le1', null, new Date('2026-08-01'));
    expect(mode).toBe('DIRECT_MODE'); // the 2026-06-01 election, not the future 2027 one
  });

  it('activeMode() prefers a store-specific election over an entity-wide (storeId=null) one for that store', async () => {
    const { service } = makeService();
    await service.elect({ tenantId: 't1', legalEntityId: 'le1', mode: 'DIRECT_MODE', effectiveFrom: '2026-01-01', approvedBy: 'controller' }); // entity-wide
    await service.elect({ tenantId: 't1', legalEntityId: 'le1', storeId: 's1', mode: 'WIP_MODE', effectiveFrom: '2026-02-01', approvedBy: 'controller' }); // store-specific

    const storeMode = await service.activeMode('t1', 'le1', 's1', new Date('2026-08-01'));
    expect(storeMode).toBe('WIP_MODE');

    const otherStoreMode = await service.activeMode('t1', 'le1', 's2', new Date('2026-08-01'));
    expect(otherStoreMode).toBe('DIRECT_MODE'); // falls back to the entity-wide election
  });

  it('history() returns every election for the entity, newest first', async () => {
    const { service } = makeService();
    await service.elect({ tenantId: 't1', legalEntityId: 'le1', mode: 'DIRECT_MODE', effectiveFrom: '2026-01-01', approvedBy: 'controller' });
    await service.elect({ tenantId: 't1', legalEntityId: 'le1', mode: 'WIP_MODE', effectiveFrom: '2026-06-01', approvedBy: 'controller' });

    const rows = await service.history('t1', 'le1');
    expect(rows).toHaveLength(2);
    expect(rows[0].mode).toBe('WIP_MODE'); // most recent effectiveFrom first
  });
});
