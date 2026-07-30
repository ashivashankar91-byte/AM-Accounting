import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { container } from 'tsyringe';
import { ReceiptSequenceService, SequenceValidationError } from '../src/application/receipt-sequence-service';
import { makeFakePrisma } from './support/fake-prisma';

function setup() {
  container.reset();
  const prisma = makeFakePrisma();
  container.registerInstance('PrismaClient', prisma as any);
  container.register('ReceiptSequenceService', { useClass: ReceiptSequenceService });
  return { svc: container.resolve<ReceiptSequenceService>('ReceiptSequenceService'), prisma };
}

describe('ReceiptSequenceService.allocate', () => {
  it('mints sequential numbers starting at 1', async () => {
    const { svc } = setup();
    const a = await svc.allocate({ tenantId: 't1', storeId: 's1', storeCode: 'S01', businessDate: '2026-07-29' });
    const b = await svc.allocate({ tenantId: 't1', storeId: 's1', storeCode: 'S01', businessDate: '2026-07-29' });
    expect(a.seq).toBe(1);
    expect(a.receiptNumber).toBe('CR-S01-20260729-0001');
    expect(b.seq).toBe(2);
  });

  it('resets per business date and scopes independently per store', async () => {
    const { svc } = setup();
    await svc.allocate({ tenantId: 't1', storeId: 's1', storeCode: 'S01', businessDate: '2026-07-29' });
    const nextDay = await svc.allocate({ tenantId: 't1', storeId: 's1', storeCode: 'S01', businessDate: '2026-07-30' });
    const otherStore = await svc.allocate({ tenantId: 't1', storeId: 's2', storeCode: 'S02', businessDate: '2026-07-29' });
    expect(nextDay.seq).toBe(1);
    expect(otherStore.seq).toBe(1);
  });

  it('BR: concurrent allocations return distinct sequential numbers (race hammer)', async () => {
    const { svc } = setup();
    const results = await Promise.all(
      Array.from({ length: 50 }, () => svc.allocate({ tenantId: 't1', storeId: 's1', storeCode: 'S01', businessDate: '2026-07-29' })),
    );
    const seqs = results.map((r) => r.seq).sort((x, y) => x - y);
    expect(new Set(seqs).size).toBe(50);
    expect(seqs[0]).toBe(1);
    expect(seqs[49]).toBe(50);
  });

  it('rejects a malformed store code', async () => {
    const { svc } = setup();
    await expect(svc.allocate({ tenantId: 't1', storeId: 's1', storeCode: '', businessDate: '2026-07-29' })).rejects.toBeInstanceOf(SequenceValidationError);
  });
});
