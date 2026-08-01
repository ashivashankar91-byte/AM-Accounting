import 'reflect-metadata';
/**
 * StatementService unit tests — S030 (statements & dunning). Generation is
 * read-only over open items + a best-effort apar-service customer lookup
 * (degrades gracefully to the raw controlNumber when the lookup fails).
 */
import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '.prisma/schedule-client';
import { StatementService, DEFAULT_DUNNING_LEVELS } from '../src/application/statement-service';

function dec(n: number | string) {
  return new Prisma.Decimal(n);
}

const TENANT = 'tenant-acme';

function makeService(openItems: any[], customer: any = null, dunningConfig: any = null) {
  const prismaTx = {
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    scheduleStatementRun: { create: vi.fn().mockImplementation((a: any) => Promise.resolve({ id: 'stmt-1', ...a.data })) },
    scheduleDunningRun: { create: vi.fn().mockImplementation((a: any) => Promise.resolve({ id: 'dun-1', ...a.data })) },
  };
  const prisma: any = {
    $transaction: (fn: any) => fn(prismaTx),
    scheduleDunningConfig: { findFirst: vi.fn().mockResolvedValue(dunningConfig ? { levels: dunningConfig } : null) },
  };
  const openItemRepo: any = { findBySchedule: vi.fn().mockResolvedValue(openItems) };
  const customerClient: any = { findByCustomerNumber: vi.fn().mockResolvedValue(customer) };
  return { svc: new StatementService(prisma, openItemRepo, customerClient), prismaTx, customerClient };
}

describe('StatementService.generateStatement', () => {
  it('builds a print/PDF-ready snapshot (D-CE08-06) with customer identity when the lookup succeeds', async () => {
    const items = [{ itemNumber: 'INV-1', transactionDate: new Date('2025-01-01'), dueDate: null, description: 'Invoice', originalAmount: dec('100.00'), remainingBalance: dec('40.00'), status: 'PARTIALLY_APPLIED' }];
    const customer = { id: 'cust-1', customerNumber: 'CTRL001', customerName: 'Acme Auto' };
    const { svc, prismaTx } = makeService(items, customer);
    const result = await svc.generateStatement(TENANT, '01', 'CTRL001', new Date('2025-06-01'), 'user-1');
    expect(result.id).toBe('stmt-1');
    expect(prismaTx.scheduleStatementRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ totalAmount: expect.any(Prisma.Decimal), itemCount: 1 }) }),
    );
  });

  it('degrades gracefully to the raw controlNumber when the customer lookup fails', async () => {
    const items: any[] = [];
    const { svc, prismaTx } = makeService(items, null);
    await svc.generateStatement(TENANT, '01', 'CTRL999', new Date(), 'user-1');
    const content = prismaTx.scheduleStatementRun.create.mock.calls[0][0].data.content;
    expect(content.recipient.customerNumber).toBe('CTRL999');
    expect(content.recipient.name).toBeNull();
  });
});

describe('StatementService.generateDunning', () => {
  it('selects the highest applicable dunning level for the oldest item age', async () => {
    const items = [{ transactionDate: new Date(Date.now() - 95 * 24 * 60 * 60 * 1000), dueDate: null }];
    const { svc, prismaTx } = makeService(items, null, DEFAULT_DUNNING_LEVELS);
    const result = await svc.generateDunning(TENANT, '01', 'CTRL001', 'user-1');
    expect(prismaTx.scheduleDunningRun.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ level: 3 }) }));
    expect(result.id).toBe('dun-1');
  });

  it('refuses to generate a notice when no level threshold is met yet', async () => {
    const items = [{ transactionDate: new Date(), dueDate: null }];
    const { svc } = makeService(items, null, DEFAULT_DUNNING_LEVELS);
    await expect(svc.generateDunning(TENANT, '01', 'CTRL001', 'user-1')).rejects.toThrow('NO_DUNNING_LEVEL_APPLICABLE');
  });
});
