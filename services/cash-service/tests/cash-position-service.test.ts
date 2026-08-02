import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { container } from 'tsyringe';
import { makeFakePrisma } from './support/fake-prisma';
import { CashPositionService } from '../src/application/cash-position-service';

const TENANT = 'tenant-s057';
const ENTITY = 'entity-s057';

describe('CashPositionService (S057)', () => {
  let prisma: any;
  let cashPosition: CashPositionService;
  const originalFetch = global.fetch;

  beforeEach(() => {
    container.reset();
    prisma = makeFakePrisma();
    container.registerInstance('PrismaClient', prisma);
    container.register('CashPositionService', { useClass: CashPositionService });
    cashPosition = container.resolve('CashPositionService');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('composes drawer sessions + undeposited receipts + deposits-in-transit purely from own tables (traceable sources)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network unreachable in unit test')) as any;

    await prisma.cashDrawer.create({ data: { id: 'd1', tenantId: TENANT, entityId: ENTITY, storeId: 's1', storeCode: 'S1', terminalCode: 'T1', cashierId: 'c1', businessDate: new Date('2026-08-01'), status: 'OPEN', openingFloat: '100.00', openedBy: 'c1' } });
    await prisma.cashReceipt.create({ data: { id: 'r1', tenantId: TENANT, entityId: ENTITY, drawerId: 'd1', sourceDocType: 'SERVICE_RO', sourceDocId: 'RO-1', totalAmount: '75.00', status: 'ISSUED', receiptNumber: 'RCPT-1', issuedBy: 'c1' } });
    await prisma.cashDeposit.create({ data: { id: 'dep1', tenantId: TENANT, entityId: ENTITY, storeId: 's1', bankAccountCode: 'OPERATING-001', businessDate: new Date('2026-08-01'), status: 'POSTED', totalAmount: '200.00', idempotencyKey: 'dep-1', preparedBy: 'c1' } });

    const result = await cashPosition.getDailyCashPosition({ tenantId: TENANT, entityId: ENTITY, businessDate: '2026-08-01' });

    expect(result.drawerSessions.source).toBe('cash_drawer');
    expect(result.drawerSessions.items).toHaveLength(1);
    expect(result.undepositedReceipts.source).toContain('cash_receipt');
    expect(result.undepositedReceipts.count).toBe(1);
    expect(result.undepositedReceipts.total).toBe(75);
    expect(result.depositsInTransit.source).toContain('cash_deposit');
    expect(result.depositsInTransit.count).toBe(1);
    expect(result.depositsInTransit.total).toBe(200);
  });

  it('reports MANUAL_ENTRY_REQUIRED for bank balances when recon-service is unreachable — never fabricates a balance', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;
    await prisma.cashDeposit.create({ data: { id: 'dep2', tenantId: TENANT, entityId: ENTITY, storeId: 's1', bankAccountCode: 'OPERATING-002', businessDate: new Date('2026-08-01'), status: 'POSTED', totalAmount: '50.00', idempotencyKey: 'dep-2', preparedBy: 'c1' } });

    const result = await cashPosition.getDailyCashPosition({ tenantId: TENANT, entityId: ENTITY, businessDate: '2026-08-01' });
    expect(result.bankBalances.items).toHaveLength(1);
    expect(result.bankBalances.items[0].state).toBe('MANUAL_ENTRY_REQUIRED');
  });

  it('reports PENDING_SERVICE_INTEGRATION for outstanding checks when apar-service is unreachable — never fakes AP data', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;
    const result = await cashPosition.getDailyCashPosition({ tenantId: TENANT, entityId: ENTITY, businessDate: '2026-08-01' });
    expect(result.outstandingChecks.state).toBe('PENDING_SERVICE_INTEGRATION');
    expect(result.outstandingChecks.items).toHaveLength(0);
  });

  it('reads a real bank balance from recon-service when reachable', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ accountName: 'OPERATING-003', bankBalance: 1234.56, reconDate: '2026-08-01' }],
    }) as any;
    await prisma.cashDeposit.create({ data: { id: 'dep3', tenantId: TENANT, entityId: ENTITY, storeId: 's1', bankAccountCode: 'OPERATING-003', businessDate: new Date('2026-08-01'), status: 'POSTED', totalAmount: '10.00', idempotencyKey: 'dep-3', preparedBy: 'c1' } });

    const result = await cashPosition.getDailyCashPosition({ tenantId: TENANT, entityId: ENTITY, businessDate: '2026-08-01' });
    expect(result.bankBalances.items[0]).toMatchObject({ state: 'OK', bankAccountCode: 'OPERATING-003', balance: '1234.56' });
  });

  it('large-cash-transaction flags obey the threshold config table exactly — empty config = no flags, never guessed', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('unreachable')) as any;
    await prisma.cashReceipt.create({ data: { id: 'r2', tenantId: TENANT, entityId: ENTITY, drawerId: 'd-none', sourceDocType: 'SERVICE_RO', sourceDocId: 'RO-2', totalAmount: '15000.00', status: 'ISSUED', receiptNumber: 'RCPT-2', issuedBy: 'c1' } });

    const noConfig = await cashPosition.getDailyCashPosition({ tenantId: TENANT, entityId: ENTITY, businessDate: '2026-08-01' });
    expect(noConfig.largeCashTransactionFlags.flags).toHaveLength(0); // no config => no flags, never guessed

    await prisma.largeCashThresholdConfig.create({ data: { id: 'th1', tenantId: TENANT, jurisdiction: 'US-FEDERAL', thresholdAmount: '10000.00', currency: 'USD', updatedBy: 'controller-1' } });
    const withConfig = await cashPosition.getDailyCashPosition({ tenantId: TENANT, entityId: ENTITY, businessDate: '2026-08-01', jurisdiction: 'US-FEDERAL' });
    expect(withConfig.largeCashTransactionFlags.flags).toHaveLength(1);
    expect(withConfig.largeCashTransactionFlags.flags[0].sourceId).toBe('r2');
  });

  it('export writes a retained, audited snapshot verbatim (no recomputation) and is listable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('unreachable')) as any;
    const exported = await cashPosition.exportDailyCashPosition({ tenantId: TENANT, entityId: ENTITY, businessDate: '2026-08-01' }, 'controller-1');
    expect(exported.requestedBy).toBe('controller-1');
    expect((exported.snapshot as any).businessDate).toBe('2026-08-01');

    const list = await cashPosition.listExports(TENANT, {});
    expect(list.items.some((i: any) => i.id === exported.id)).toBe(true);
  });
});
