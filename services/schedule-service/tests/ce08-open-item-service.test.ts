import 'reflect-metadata';
/**
 * Application-service unit tests — S028 (auto/on-account application) and
 * S029 (split / transfer / write-off ceremonies), plus the D-CE08-08
 * downstream-reversal guard. Same fully-mocked-Prisma-transaction pattern as
 * tests/open-item-service.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '.prisma/schedule-client';
import { OpenItemService } from '../src/application/open-item-service';
import {
  OpenItemNotFoundError,
  InvalidSplitError,
  CrossAccountTransferNotAllowedError,
  ItemAlreadyWrittenOffError,
  WriteOffThresholdExceededError,
  DownstreamApplicationsExistError,
  NoOpenItemsToRelieveError,
} from '../src/domain/errors';

function dec(n: number | string) {
  return new Prisma.Decimal(n);
}

const TENANT = 'tenant-acme';

function makeTx(overrides: Partial<any> = {}) {
  return {
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    scheduleDetail: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'detail-1' }) },
    schedule: { findUnique: vi.fn().mockResolvedValue({ tenantId: TENANT, scheduleNumber: '01' }) },
    scheduleOpenItem: {
      create: vi.fn().mockImplementation((a: any) => Promise.resolve({ id: `new-${Math.random()}`, ...a.data })),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockImplementation((a: any) => Promise.resolve({ id: a.where.id, ...a.data })),
      aggregate: vi.fn().mockResolvedValue({ _sum: { remainingBalance: dec(0) } }),
    },
    scheduleApplication: {
      create: vi.fn().mockImplementation((a: any) => Promise.resolve({ id: 'app-1', ...a.data })),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockImplementation((a: any) => Promise.resolve({ id: a.where.id, ...a.data })),
    },
    scheduleUnappliedReceipt: {
      create: vi.fn().mockResolvedValue({ id: 'receipt-1' }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    outboxEvent: { create: vi.fn().mockResolvedValue({ id: 'outbox-1' }) },
    scheduleCeremony: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((a: any) => Promise.resolve({ id: 'ceremony-1', ...a.data })),
    },
    scheduleWriteOffConfig: { findFirst: vi.fn().mockResolvedValue(null) },
    auditOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
    ...overrides,
  };
}

function makeService(tx: any, glPostingClient: any = { postWriteOff: vi.fn().mockResolvedValue('je-writeoff-1') }) {
  const prisma: any = { $transaction: (fn: any) => fn(tx) };
  return new OpenItemService(prisma, {} as any, glPostingClient as any);
}

describe('OpenItemService.applyAutoFifo (S028)', () => {
  it('sweeps FIFO across a schedule+control and records one application per touched item', async () => {
    const items = [
      { id: 'old', tenantId: TENANT, originalAmount: dec('30.00'), remainingBalance: dec('30.00'), transactionDate: new Date('2025-01-01'), createdAt: new Date('2025-01-01') },
      { id: 'new', tenantId: TENANT, originalAmount: dec('30.00'), remainingBalance: dec('30.00'), transactionDate: new Date('2025-02-01'), createdAt: new Date('2025-02-01') },
    ];
    const tx = makeTx({ scheduleOpenItem: { findMany: vi.fn().mockResolvedValue(items), update: vi.fn().mockResolvedValue({}), create: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) } });
    const svc = makeService(tx);
    const { outcome } = await svc.applyAutoFifo(TENANT, '01', 'CTRL001', '40.00', 'idem-1', 'user-1');
    expect(outcome).toBe('AUTO_APPLIED');
    expect(tx.scheduleApplication.create).toHaveBeenCalledTimes(2);
  });

  it('throws NoOpenItemsToRelieveError when there is nothing to relieve', async () => {
    const tx = makeTx({ scheduleOpenItem: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() } });
    const svc = makeService(tx);
    await expect(svc.applyAutoFifo(TENANT, '01', 'CTRL001', '40.00', 'idem-2', 'user-1')).rejects.toBeInstanceOf(NoOpenItemsToRelieveError);
  });
});

describe('OpenItemService.splitOpenItem (S029)', () => {
  it('creates a child item per part carrying parentItemId lineage and closes the original', async () => {
    const item = { id: 'item-1', tenantId: TENANT, scheduleNumber: '01', controlNumber: 'CTRL001', itemNumber: 'INV-1', originalAmount: dec('100.00'), remainingBalance: dec('100.00'), status: 'OPEN' };
    const tx = makeTx({ scheduleOpenItem: { findFirst: vi.fn().mockResolvedValue(item), create: vi.fn().mockImplementation((a: any) => Promise.resolve({ id: `child-${a.data.itemNumber}`, ...a.data })), update: vi.fn().mockResolvedValue({}), findMany: vi.fn() } });
    const svc = makeService(tx);
    const result = await svc.splitOpenItem(TENANT, 'item-1', ['40.00', '60.00'], 'idem-split-1', 'user-1', 'customer requested split');
    expect(result.childItemIds).toHaveLength(2);
    expect(tx.scheduleOpenItem.create).toHaveBeenCalledTimes(2);
    expect(tx.scheduleOpenItem.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ parentItemId: 'item-1' }) }));
    expect(tx.scheduleOpenItem.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'item-1' }, data: expect.objectContaining({ status: 'CLOSED' }) }));
  });

  it('rejects a split whose parts do not sum to the whole', async () => {
    const item = { id: 'item-1', tenantId: TENANT, remainingBalance: dec('100.00'), status: 'OPEN' };
    const tx = makeTx({ scheduleOpenItem: { findFirst: vi.fn().mockResolvedValue(item), create: vi.fn(), update: vi.fn(), findMany: vi.fn() } });
    const svc = makeService(tx);
    await expect(svc.splitOpenItem(TENANT, 'item-1', ['40.00', '40.00'], 'idem-split-2', 'user-1', 'r')).rejects.toBeInstanceOf(InvalidSplitError);
  });

  it('rejects splitting an unknown item', async () => {
    const tx = makeTx({ scheduleOpenItem: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn(), findMany: vi.fn() } });
    const svc = makeService(tx);
    await expect(svc.splitOpenItem(TENANT, 'missing', ['40.00', '60.00'], 'idem-split-3', 'user-1', 'r')).rejects.toBeInstanceOf(OpenItemNotFoundError);
  });

  it('is idempotent — a replayed idempotencyKey returns the original result without a second write', async () => {
    const existing = { ceremonyType: 'SPLIT', openItemId: 'item-1', result: { parentItemId: 'item-1', childItemIds: ['x', 'y'] } };
    const tx = makeTx({
      scheduleCeremony: { findFirst: vi.fn().mockResolvedValue(existing), create: vi.fn() },
      scheduleOpenItem: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    });
    const svc = makeService(tx);
    const result = await svc.splitOpenItem(TENANT, 'item-1', ['40.00', '60.00'], 'idem-split-1', 'user-1', 'r');
    expect(result).toEqual(existing.result);
    expect(tx.scheduleOpenItem.findFirst).not.toHaveBeenCalled();
  });
});

describe('OpenItemService.transferOpenItem (S029, D-CE08-04)', () => {
  it('moves a balance within the same schedule to a new control/item number', async () => {
    const item = { id: 'item-1', tenantId: TENANT, scheduleNumber: '01', controlNumber: 'CTRL001', itemNumber: 'INV-1', originalAmount: dec('50.00'), remainingBalance: dec('50.00'), status: 'OPEN' };
    const tx = makeTx({ scheduleOpenItem: { findFirst: vi.fn().mockResolvedValue(item), create: vi.fn().mockImplementation((a: any) => Promise.resolve({ id: 'item-2', ...a.data })), update: vi.fn().mockResolvedValue({}), findMany: vi.fn() } });
    const svc = makeService(tx);
    const result = await svc.transferOpenItem(TENANT, 'item-1', '01', 'CTRL002', 'INV-1-T', 'idem-transfer-1', 'user-1', 'wrong customer');
    expect(result.toItemId).toBe('item-2');
    expect(tx.scheduleOpenItem.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'item-1' }, data: expect.objectContaining({ status: 'CLOSED' }) }));
  });

  it('rejects a transfer that would cross control accounts (D-CE08-04 approved: within-account only)', async () => {
    const item = { id: 'item-1', tenantId: TENANT, scheduleNumber: '01', controlNumber: 'CTRL001', remainingBalance: dec('50.00'), status: 'OPEN' };
    const tx = makeTx({ scheduleOpenItem: { findFirst: vi.fn().mockResolvedValue(item), create: vi.fn(), update: vi.fn(), findMany: vi.fn() } });
    const svc = makeService(tx);
    await expect(
      svc.transferOpenItem(TENANT, 'item-1', '02', 'CTRL002', 'INV-1-T', 'idem-transfer-2', 'user-1', 'r'),
    ).rejects.toBeInstanceOf(CrossAccountTransferNotAllowedError);
  });
});

describe('OpenItemService.writeOffOpenItem (S029)', () => {
  it('posts through gl-service and marks the item WRITTEN_OFF with journal lineage', async () => {
    const item = { id: 'item-1', tenantId: TENANT, scheduleNumber: '01', controlNumber: 'CTRL001', glAccountNumber: '1200', originalAmount: dec('75.00'), remainingBalance: dec('75.00'), status: 'OPEN' };
    const tx = makeTx({ scheduleOpenItem: { findFirst: vi.fn().mockResolvedValue(item), update: vi.fn().mockResolvedValue({}), create: vi.fn(), findMany: vi.fn() } });
    const glPostingClient = { postWriteOff: vi.fn().mockResolvedValue('je-writeoff-99') };
    const svc = makeService(tx, glPostingClient);
    const result = await svc.writeOffOpenItem(TENANT, 'item-1', '6100', 'idem-wo-1', 'user-1', 'uncollectible per collections review');
    expect(glPostingClient.postWriteOff).toHaveBeenCalledWith(TENANT, expect.objectContaining({ offsetAccountCode: '6100', amount: '75.00' }));
    expect(result.journalEntryId).toBe('je-writeoff-99');
    expect(tx.scheduleOpenItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'item-1' }, data: expect.objectContaining({ status: 'WRITTEN_OFF', writeOffJournalEntryId: 'je-writeoff-99' }) }),
    );
  });

  it('rejects write-off of an already-written-off item', async () => {
    const item = { id: 'item-1', tenantId: TENANT, remainingBalance: dec('75.00'), status: 'WRITTEN_OFF' };
    const tx = makeTx({ scheduleOpenItem: { findFirst: vi.fn().mockResolvedValue(item), create: vi.fn(), update: vi.fn(), findMany: vi.fn() } });
    const svc = makeService(tx);
    await expect(svc.writeOffOpenItem(TENANT, 'item-1', '6100', 'idem-wo-2', 'user-1', 'r')).rejects.toBeInstanceOf(ItemAlreadyWrittenOffError);
  });

  it('refuses a write-off above the configured D-CE08-02 authority threshold', async () => {
    const item = { id: 'item-1', tenantId: TENANT, remainingBalance: dec('5000.00'), status: 'OPEN' };
    const tx = makeTx({
      scheduleOpenItem: { findFirst: vi.fn().mockResolvedValue(item), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
      scheduleWriteOffConfig: { findFirst: vi.fn().mockResolvedValue({ thresholdAmount: dec('1000.00') }) },
    });
    const svc = makeService(tx);
    await expect(svc.writeOffOpenItem(TENANT, 'item-1', '6100', 'idem-wo-3', 'user-1', 'r')).rejects.toBeInstanceOf(WriteOffThresholdExceededError);
  });
});

describe('OpenItemService.reverseApplication — D-CE08-08 downstream guard', () => {
  it('blocks reversal when a later, unreversed application exists on the same item', async () => {
    const original = { id: 'app-1', tenantId: TENANT, openItemId: 'item-1', amount: dec('40.00'), reversedAt: null, appliedAt: new Date('2025-01-01') };
    const later = { id: 'app-2', tenantId: TENANT, openItemId: 'item-1', amount: dec('10.00'), reversedAt: null, appliedAt: new Date('2025-02-01') };
    const tx = makeTx({
      scheduleApplication: { findFirst: vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(later), create: vi.fn(), update: vi.fn() },
      scheduleOpenItem: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    });
    const svc = makeService(tx);
    await expect(svc.reverseApplication(TENANT, 'app-1', 'user-1')).rejects.toBeInstanceOf(DownstreamApplicationsExistError);
  });
});
