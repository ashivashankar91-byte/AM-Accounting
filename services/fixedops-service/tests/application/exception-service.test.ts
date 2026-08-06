import 'reflect-metadata';
import { describe, it, expect } from 'vitest';

import { ExceptionService } from '../../src/application/exception-service';
import { FakePrismaClient } from '../support/fake-prisma';

function makeService() {
  const prisma = new FakePrismaClient();
  const service = new ExceptionService(prisma as any);
  return { prisma, service };
}

describe('ExceptionService — S021-aligned Fixed Ops exception/recovery queue', () => {
  it('raise() creates an OPEN exception row', async () => {
    const { service } = makeService();
    const row = await service.raise({ tenantId: 't1', legalEntityId: 'le1', sourceEventId: 'evt-1', correlationId: 'c1', eventFamily: 'SUBLET_ACCRUAL', reasonCode: 'ACCOUNT_MAPPING_PENDING' });
    expect(row.status).toBe('OPEN');
    expect(row.reasonCode).toBe('ACCOUNT_MAPPING_PENDING');
  });

  it('raise() defaults optional fields (storeId, roNumber, detail) to null rather than undefined', async () => {
    const { service } = makeService();
    const row = await service.raise({ tenantId: 't1', legalEntityId: 'le1', sourceEventId: 'evt-1', correlationId: 'c1', eventFamily: 'SUBLET_ACCRUAL', reasonCode: 'X' });
    expect(row.storeId).toBeNull();
    expect(row.roNumber).toBeNull();
    expect(row.detail).toBeNull();
  });

  it('raise() can write inside a caller-supplied transaction handle instead of the top-level prisma client', async () => {
    const { prisma, service } = makeService();
    let usedTx: any = null;
    const fakeTx = { fixedOpsPostingException: { create: (args: any) => { usedTx = fakeTx; return (prisma as any).fixedOpsPostingException.create(args); } } };
    await service.raise({ tenantId: 't1', legalEntityId: 'le1', sourceEventId: 'evt-1', correlationId: 'c1', eventFamily: 'SUBLET_ACCRUAL', reasonCode: 'X' }, fakeTx);
    expect(usedTx).toBe(fakeTx);
  });

  it('list() filters by status and reasonCode independently', async () => {
    const { service } = makeService();
    await service.raise({ tenantId: 't1', legalEntityId: 'le1', sourceEventId: 'evt-1', correlationId: 'c1', eventFamily: 'SUBLET_ACCRUAL', reasonCode: 'MAPPING' });
    await service.raise({ tenantId: 't1', legalEntityId: 'le1', sourceEventId: 'evt-2', correlationId: 'c2', eventFamily: 'DEFERRED_CONTRACT_SALE', reasonCode: 'TAX' });

    const byReason = await service.list('t1', { reasonCode: 'MAPPING' });
    expect(byReason).toHaveLength(1);
    expect(byReason[0].eventFamily).toBe('SUBLET_ACCRUAL');

    const all = await service.list('t1');
    expect(all).toHaveLength(2);
  });

  it('list() never returns another tenant\'s exceptions', async () => {
    const { service } = makeService();
    await service.raise({ tenantId: 't1', legalEntityId: 'le1', sourceEventId: 'evt-1', correlationId: 'c1', eventFamily: 'SUBLET_ACCRUAL', reasonCode: 'X' });
    await service.raise({ tenantId: 't2', legalEntityId: 'le1', sourceEventId: 'evt-2', correlationId: 'c2', eventFamily: 'SUBLET_ACCRUAL', reasonCode: 'X' });

    const rows = await service.list('t1');
    expect(rows).toHaveLength(1);
  });

  it('resolve() marks the exception RESOLVED and stamps resolvedBy/resolvedAt', async () => {
    const { service } = makeService();
    const row = await service.raise({ tenantId: 't1', legalEntityId: 'le1', sourceEventId: 'evt-1', correlationId: 'c1', eventFamily: 'SUBLET_ACCRUAL', reasonCode: 'X' });

    const resolved = await service.resolve('t1', row.id, 'controller');

    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolvedBy).toBe('controller');
    expect(resolved.resolvedAt).toBeTruthy();
  });
});
