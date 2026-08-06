import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { FakePrismaClient } from '../support/fake-prisma';
import { DepositService } from '../../src/application/deposit-service';
import { PartsAccountMappingService } from '../../src/application/account-mapping-service';
import { FakePostingEventProducer } from '../../src/infrastructure/posting-client';

const TENANT = 'tenant-1'; const LE = 'le-1'; const STORE = 'store-1';

async function setUp() {
  const prisma = new FakePrismaClient();
  const mappings = new PartsAccountMappingService(prisma as any);
  for (const [family, roles] of Object.entries({
    SPECIAL_ORDER_DEPOSIT: ['CASH_OR_AR', 'CUSTOMER_DEPOSIT_LIABILITY'],
    SPECIAL_ORDER_DEPOSIT_APPLY: ['CUSTOMER_DEPOSIT_LIABILITY', 'SALE_REVENUE'],
    SPECIAL_ORDER_DEPOSIT_REFUND: ['CUSTOMER_DEPOSIT_LIABILITY', 'CASH_OR_AR'],
  })) {
    for (const role of roles) await mappings.setAccountNumber(TENANT, LE, family, role, '2200', 'controller-1');
  }
  const posting = new FakePostingEventProducer((env) => ({ executionId: 'x', eventId: env.eventId, status: 'POSTED', idempotent: false, journalEntryId: 'je-1', journalNumber: 'JN-1' }));
  const svc = new DepositService(prisma as any, posting, mappings);
  return { prisma, svc, posting };
}

describe('DepositService (S070)', () => {
  it('deposit at order creates an OPEN item', async () => {
    const { svc } = await setUp();
    const { deposit } = await svc.createDeposit({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, orderNumber: 'SO-1', customerRef: 'cust-1', depositAmount: 100, receiptId: 'rc-1', correlationId: 'c1', businessDate: '2026-08-01', actor: 'clerk-1' });
    expect(deposit.status).toBe('OPEN');
  });

  it('a second apply attempt on an already-applied deposit is refused deterministically — no double relief', async () => {
    const { svc, posting } = await setUp();
    await svc.createDeposit({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, orderNumber: 'SO-2', customerRef: 'cust-2', depositAmount: 50, receiptId: 'rc-2', correlationId: 'c1', businessDate: '2026-08-01', actor: 'clerk-1' });
    const first = await svc.apply({ tenantId: TENANT, legalEntityId: LE, orderNumber: 'SO-2', saleAmount: 500, correlationId: 'c2', businessDate: '2026-08-01', actor: 'clerk-1' });
    expect(first.idempotent).toBe(false);
    const second = await svc.apply({ tenantId: TENANT, legalEntityId: LE, orderNumber: 'SO-2', saleAmount: 500, correlationId: 'c3', businessDate: '2026-08-01', actor: 'clerk-1' });
    expect(second.idempotent).toBe(true); // exactly-once relief
    expect(posting.submitted.filter((e) => e.eventType === 'parts.deposit.applied.v1').length).toBe(1);
  });

  it('refund is refused once a deposit has already been applied', async () => {
    const { svc } = await setUp();
    await svc.createDeposit({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, orderNumber: 'SO-3', customerRef: 'cust-3', depositAmount: 75, receiptId: 'rc-3', correlationId: 'c1', businessDate: '2026-08-01', actor: 'clerk-1' });
    await svc.apply({ tenantId: TENANT, legalEntityId: LE, orderNumber: 'SO-3', saleAmount: 400, correlationId: 'c2', businessDate: '2026-08-01', actor: 'clerk-1' });
    await expect(svc.refund({ tenantId: TENANT, legalEntityId: LE, orderNumber: 'SO-3', correlationId: 'c3', businessDate: '2026-08-01', actor: 'clerk-1', reason: 'customer request' }))
      .rejects.toThrow(/already applied/);
  });

  it('abandoned queue is truthfully empty (not estimated) when no EscheatJurisdictionConfig exists', async () => {
    const { svc } = await setUp();
    const result = await svc.abandonedQueue(TENANT, LE, '2026-08-01');
    expect(result.items).toEqual([]);
    expect(result.note).toMatch(/No EscheatJurisdictionConfig/);
  });

  it('escheat is refused when no jurisdiction config exists — never invents a dormancy rule', async () => {
    const { svc } = await setUp();
    await svc.createDeposit({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, orderNumber: 'SO-4', customerRef: 'cust-4', depositAmount: 20, receiptId: 'rc-4', correlationId: 'c1', businessDate: '2020-01-01', actor: 'clerk-1' });
    await expect(svc.escheat({ tenantId: TENANT, legalEntityId: LE, orderNumber: 'SO-4', jurisdiction: 'CA', correlationId: 'c2', businessDate: '2026-08-01', actor: 'clerk-1' }))
      .rejects.toThrow(/ESCHEAT_JURISDICTION_CONFIG_MISSING|No EscheatJurisdictionConfig/);
  });
});
