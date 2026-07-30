import 'reflect-metadata';
/**
 * @test-suite OpenItemService — S026 Schedule Open-Item Core
 *
 * @proves
 *   - processPostingEvent skips when scheduleNumber is null
 *   - processPostingEvent is idempotent on replay (sourceCorrelationId dedup)
 *   - processPostingEvent skips silently when schedule no longer exists
 *   - processPostingEvent creates a new open item when applyNumber is absent
 *   - processPostingEvent applies against an existing open item and partially
 *     reduces its remaining balance
 *   - processPostingEvent fully closes an open item when the application
 *     exactly matches the remaining balance
 *   - processPostingEvent treats an unresolvable apply-to reference as
 *     UNRESOLVED_APPLICATION (no fabricated application row) — zero matches
 *   - processPostingEvent treats an over-applying posted line as
 *     UNRESOLVED_APPLICATION rather than corrupting the balance
 *   - applyManual rejects over-application
 *   - applyManual rejects application to a CLOSED item
 *   - applyManual is idempotent for a repeated idempotencyKey + same amount
 *   - applyManual rejects a reused idempotencyKey with a different amount
 *   - reverseApplication creates a negating application and restores balance
 *   - reverseApplication rejects reversing an already-reversed application
 *   - reverseApplication rejects an unknown applicationId
 */

import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '.prisma/schedule-client';
import { OpenItemService } from '../src/application/open-item-service';
import {
  OpenItemNotFoundError,
  OpenItemClosedError,
  OverApplicationError,
  ApplicationNotFoundError,
  ApplicationAlreadyReversedError,
  DuplicateApplicationError,
} from '../src/domain/errors';

function dec(n: number | string) {
  return new Prisma.Decimal(n);
}

function makeTx(overrides: Partial<any> = {}) {
  return {
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    scheduleDetail: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((args: any) => Promise.resolve({ id: 'detail-1', ...args.data })),
    },
    schedule: {
      findUnique: vi.fn().mockResolvedValue({ tenantId: 'tenant-acme', scheduleNumber: '01' }),
    },
    scheduleOpenItem: {
      create: vi.fn().mockImplementation((args: any) => Promise.resolve({ id: 'item-1', ...args.data })),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockImplementation((args: any) => Promise.resolve({ id: args.where.id, ...args.data })),
    },
    scheduleApplication: {
      create: vi.fn().mockImplementation((args: any) => Promise.resolve({ id: 'app-1', ...args.data })),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockImplementation((args: any) => Promise.resolve({ id: args.where.id, ...args.data })),
    },
    auditOutboxEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
}

function makeService(tx: any, openItemRepo: any = {}) {
  const prisma: any = { $transaction: (fn: any) => fn(tx) };
  return new OpenItemService(prisma, openItemRepo as any);
}

const TENANT = 'tenant-acme';
const baseEvent = {
  tenantId: TENANT,
  journalEntryId: 'je-001',
  glAccountNumber: '1200',
  scheduleNumber: '01',
  controlNumber: 'CTRL001',
  amount: '150.00',
  referenceNumber: 'INV-100',
  journalSource: 'AJ',
  transactionDate: '2025-03-15T00:00:00.000Z',
};

describe('OpenItemService.processPostingEvent', () => {
  it('skips when scheduleNumber is null', async () => {
    const tx = makeTx();
    const svc = makeService(tx);
    const outcome = await svc.processPostingEvent(TENANT, { ...baseEvent, scheduleNumber: null }, 'corr-1');
    expect(outcome).toBe('SKIPPED_NOT_SCHEDULED');
    expect(tx.scheduleDetail.create).not.toHaveBeenCalled();
  });

  it('is idempotent on replay of the same sourceCorrelationId', async () => {
    const tx = makeTx({
      scheduleDetail: { findFirst: vi.fn().mockResolvedValue({ id: 'existing' }), create: vi.fn() },
    });
    const svc = makeService(tx);
    const outcome = await svc.processPostingEvent(TENANT, baseEvent, 'corr-1');
    expect(outcome).toBe('ALREADY_PROCESSED');
    expect(tx.scheduleDetail.create).not.toHaveBeenCalled();
  });

  it('skips silently when the schedule no longer exists', async () => {
    const tx = makeTx({ schedule: { findUnique: vi.fn().mockResolvedValue(null) } });
    const svc = makeService(tx);
    const outcome = await svc.processPostingEvent(TENANT, baseEvent, 'corr-1');
    expect(outcome).toBe('SKIPPED_SCHEDULE_NOT_FOUND');
    expect(tx.scheduleDetail.create).not.toHaveBeenCalled();
  });

  it('creates a new open item when applyNumber is absent', async () => {
    const tx = makeTx();
    const svc = makeService(tx);
    const outcome = await svc.processPostingEvent(TENANT, baseEvent, 'corr-1');
    expect(outcome).toBe('NEW_ITEM');
    expect(tx.scheduleOpenItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          itemNumber: 'INV-100',
          originalAmount: expect.any(Prisma.Decimal),
          remainingBalance: expect.any(Prisma.Decimal),
          status: 'OPEN',
          sourceCorrelationId: 'corr-1',
        }),
      }),
    );
    expect(tx.scheduleApplication.create).not.toHaveBeenCalled();
  });

  // Regression: the CREATED audit event's docId originally used a composite
  // "schedule:control:item" string instead of the real ScheduleOpenItem.id
  // that every other audit event for this doc_type uses (APPLIED/REVERSED/
  // MANUAL_APPLY), which broke querying an item's full audit history by its
  // one real id. Caught live against a real database in the S026/S027
  // closure-certification pass (open-item-live.test.ts).
  it('writes the CREATED audit event with the real created item id as docId', async () => {
    const tx = makeTx();
    const svc = makeService(tx);
    await svc.processPostingEvent(TENANT, baseEvent, 'corr-1');
    expect(tx.auditOutboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ docType: 'SCHEDULE_OPEN_ITEM', docId: 'item-1', action: 'CREATED' }),
      }),
    );
  });

  it('falls back to journalEntryId as itemNumber when referenceNumber is absent', async () => {
    const tx = makeTx();
    const svc = makeService(tx);
    await svc.processPostingEvent(TENANT, { ...baseEvent, referenceNumber: undefined }, 'corr-1');
    expect(tx.scheduleOpenItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ itemNumber: 'je-001' }) }),
    );
  });

  it('applies against an existing open item and partially reduces its balance', async () => {
    const target = {
      id: 'item-target',
      originalAmount: dec('150.00'),
      appliedAmount: dec('0.00'),
      remainingBalance: dec('150.00'),
    };
    const tx = makeTx({ scheduleOpenItem: { findMany: vi.fn().mockResolvedValue([target]), create: vi.fn(), findFirst: vi.fn(), update: vi.fn().mockImplementation((a: any) => Promise.resolve({ id: a.where.id, ...a.data })) } });
    const svc = makeService(tx);
    const outcome = await svc.processPostingEvent(
      TENANT,
      { ...baseEvent, amount: '50.00', applyNumber: 'INV-100', applyCd: '#' },
      'corr-2',
    );
    expect(outcome).toBe('APPLICATION');
    expect(tx.scheduleApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ openItemId: 'item-target', amount: expect.any(Prisma.Decimal) }) }),
    );
    expect(tx.scheduleOpenItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'item-target' },
        data: expect.objectContaining({ status: 'PARTIALLY_APPLIED', closedAt: null }),
      }),
    );
  });

  it('fully closes an open item when the application matches the remaining balance', async () => {
    const target = {
      id: 'item-target',
      originalAmount: dec('150.00'),
      appliedAmount: dec('0.00'),
      remainingBalance: dec('150.00'),
    };
    const tx = makeTx({ scheduleOpenItem: { findMany: vi.fn().mockResolvedValue([target]), create: vi.fn(), findFirst: vi.fn(), update: vi.fn().mockImplementation((a: any) => Promise.resolve({ id: a.where.id, ...a.data })) } });
    const svc = makeService(tx);
    const outcome = await svc.processPostingEvent(
      TENANT,
      { ...baseEvent, amount: '150.00', applyNumber: 'INV-100', applyCd: '#' },
      'corr-2',
    );
    expect(outcome).toBe('APPLICATION');
    expect(tx.scheduleOpenItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CLOSED', closedAt: expect.any(Date) }) }),
    );
  });

  it('does not fabricate an application when zero open items match the apply-to reference', async () => {
    const tx = makeTx({ scheduleOpenItem: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), findFirst: vi.fn(), update: vi.fn() } });
    const svc = makeService(tx);
    const outcome = await svc.processPostingEvent(
      TENANT,
      { ...baseEvent, applyNumber: 'NO-SUCH-ITEM', applyCd: '#' },
      'corr-3',
    );
    expect(outcome).toBe('UNRESOLVED_APPLICATION');
    expect(tx.scheduleApplication.create).not.toHaveBeenCalled();
    expect(tx.scheduleOpenItem.update).not.toHaveBeenCalled();
    // Legacy report fidelity: the raw posted line is still recorded.
    expect(tx.scheduleDetail.create).toHaveBeenCalled();
  });

  it('does not corrupt the balance when a posted application would over-apply', async () => {
    const target = { id: 'item-target', originalAmount: dec('100.00'), appliedAmount: dec('0.00'), remainingBalance: dec('100.00') };
    const tx = makeTx({ scheduleOpenItem: { findMany: vi.fn().mockResolvedValue([target]), create: vi.fn(), findFirst: vi.fn(), update: vi.fn() } });
    const svc = makeService(tx);
    const outcome = await svc.processPostingEvent(
      TENANT,
      { ...baseEvent, amount: '500.00', applyNumber: 'INV-100', applyCd: '#' },
      'corr-4',
    );
    expect(outcome).toBe('UNRESOLVED_APPLICATION');
    expect(tx.scheduleApplication.create).not.toHaveBeenCalled();
    expect(tx.scheduleOpenItem.update).not.toHaveBeenCalled();
  });
});

describe('OpenItemService.applyManual', () => {
  it('rejects over-application', async () => {
    const item = { id: 'item-1', tenantId: TENANT, originalAmount: dec('100.00'), remainingBalance: dec('40.00'), status: 'PARTIALLY_APPLIED' };
    const tx = makeTx({ scheduleOpenItem: { findFirst: vi.fn().mockResolvedValue(item), create: vi.fn(), findMany: vi.fn(), update: vi.fn() } });
    const svc = makeService(tx);
    await expect(
      svc.applyManual(TENANT, 'item-1', { amount: '50.00', idempotencyKey: 'k1' }),
    ).rejects.toBeInstanceOf(OverApplicationError);
  });

  it('rejects application to a CLOSED item', async () => {
    const item = { id: 'item-1', tenantId: TENANT, originalAmount: dec('100.00'), remainingBalance: dec('0.00'), status: 'CLOSED' };
    const tx = makeTx({ scheduleOpenItem: { findFirst: vi.fn().mockResolvedValue(item), create: vi.fn(), findMany: vi.fn(), update: vi.fn() } });
    const svc = makeService(tx);
    await expect(
      svc.applyManual(TENANT, 'item-1', { amount: '10.00', idempotencyKey: 'k2' }),
    ).rejects.toBeInstanceOf(OpenItemClosedError);
  });

  it('throws OpenItemNotFoundError for an unknown item', async () => {
    const tx = makeTx({ scheduleOpenItem: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), findMany: vi.fn(), update: vi.fn() } });
    const svc = makeService(tx);
    await expect(
      svc.applyManual(TENANT, 'missing', { amount: '10.00', idempotencyKey: 'k3' }),
    ).rejects.toBeInstanceOf(OpenItemNotFoundError);
  });

  it('is idempotent for a repeated idempotencyKey with the same amount', async () => {
    const item = { id: 'item-1', tenantId: TENANT, originalAmount: dec('100.00'), remainingBalance: dec('100.00'), status: 'OPEN' };
    const existingApp = { id: 'app-existing', openItemId: 'item-1', amount: dec('25.00') };
    const tx = makeTx({
      scheduleOpenItem: { findFirst: vi.fn().mockResolvedValue(item), create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
      scheduleApplication: { findFirst: vi.fn().mockResolvedValue(existingApp), create: vi.fn(), update: vi.fn() },
    });
    const svc = makeService(tx);
    const result = await svc.applyManual(TENANT, 'item-1', { amount: '25.00', idempotencyKey: 'dup-key' });
    expect(result).toBe(existingApp);
    expect(tx.scheduleApplication.create).not.toHaveBeenCalled();
    expect(tx.scheduleOpenItem.update).not.toHaveBeenCalled();
  });

  it('rejects a reused idempotencyKey submitted with a different amount', async () => {
    const item = { id: 'item-1', tenantId: TENANT, originalAmount: dec('100.00'), remainingBalance: dec('100.00'), status: 'OPEN' };
    const existingApp = { id: 'app-existing', openItemId: 'item-1', amount: dec('25.00') };
    const tx = makeTx({
      scheduleOpenItem: { findFirst: vi.fn().mockResolvedValue(item), create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
      scheduleApplication: { findFirst: vi.fn().mockResolvedValue(existingApp), create: vi.fn(), update: vi.fn() },
    });
    const svc = makeService(tx);
    await expect(
      svc.applyManual(TENANT, 'item-1', { amount: '30.00', idempotencyKey: 'dup-key' }),
    ).rejects.toBeInstanceOf(DuplicateApplicationError);
  });

  it('closes the item when a manual application matches the full remaining balance', async () => {
    const item = { id: 'item-1', tenantId: TENANT, originalAmount: dec('100.00'), remainingBalance: dec('100.00'), status: 'OPEN' };
    const tx = makeTx({
      scheduleOpenItem: {
        findFirst: vi.fn().mockResolvedValue(item), create: vi.fn(), findMany: vi.fn(),
        update: vi.fn().mockImplementation((a: any) => Promise.resolve({ id: a.where.id, ...a.data })),
      },
    });
    const svc = makeService(tx);
    await svc.applyManual(TENANT, 'item-1', { amount: '100.00', idempotencyKey: 'k4', appliedBy: 'user-1' });
    expect(tx.scheduleOpenItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CLOSED', closedAt: expect.any(Date) }) }),
    );
  });
});

describe('OpenItemService.reverseApplication', () => {
  it('creates a negating application and restores the remaining balance', async () => {
    const original = { id: 'app-1', tenantId: TENANT, openItemId: 'item-1', amount: dec('40.00'), reversedAt: null };
    const item = { id: 'item-1', tenantId: TENANT, originalAmount: dec('100.00'), remainingBalance: dec('60.00'), status: 'PARTIALLY_APPLIED' };
    const tx = makeTx({
      scheduleApplication: {
        findFirst: vi.fn().mockResolvedValue(original),
        create: vi.fn().mockImplementation((a: any) => Promise.resolve({ id: 'app-reversal', ...a.data })),
        update: vi.fn().mockImplementation((a: any) => Promise.resolve({ id: a.where.id, ...a.data })),
      },
      scheduleOpenItem: {
        findFirst: vi.fn().mockResolvedValue(item), create: vi.fn(), findMany: vi.fn(),
        update: vi.fn().mockImplementation((a: any) => Promise.resolve({ id: a.where.id, ...a.data })),
      },
    });
    const svc = makeService(tx);
    const reversal = await svc.reverseApplication(TENANT, 'app-1', 'user-1');
    expect(tx.scheduleApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reversalOfId: 'app-1', amount: expect.any(Prisma.Decimal) }) }),
    );
    expect(tx.scheduleApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'app-1' }, data: expect.objectContaining({ reversedAt: expect.any(Date) }) }),
    );
    expect(tx.scheduleOpenItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ remainingBalance: expect.any(Prisma.Decimal) }) }),
    );
    expect((reversal as any).id).toBe('app-reversal');
  });

  it('rejects reversing an already-reversed application', async () => {
    const original = { id: 'app-1', tenantId: TENANT, openItemId: 'item-1', amount: dec('40.00'), reversedAt: new Date() };
    const tx = makeTx({ scheduleApplication: { findFirst: vi.fn().mockResolvedValue(original), create: vi.fn(), update: vi.fn() } });
    const svc = makeService(tx);
    await expect(svc.reverseApplication(TENANT, 'app-1', 'user-1')).rejects.toBeInstanceOf(ApplicationAlreadyReversedError);
  });

  it('rejects an unknown applicationId', async () => {
    const tx = makeTx({ scheduleApplication: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() } });
    const svc = makeService(tx);
    await expect(svc.reverseApplication(TENANT, 'missing', 'user-1')).rejects.toBeInstanceOf(ApplicationNotFoundError);
  });
});
