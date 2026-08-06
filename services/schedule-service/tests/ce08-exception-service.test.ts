import 'reflect-metadata';
/**
 * ExceptionService unit tests — S027 completion (rule engine that was
 * documented in the Fable package but not implemented in the certified
 * S026/S027 code).
 */
import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '.prisma/schedule-client';
import { ExceptionService } from '../src/application/exception-service';
import { ExceptionNotFoundError, ExceptionAlreadyDispositionedError } from '../src/domain/errors';

function dec(n: number | string) {
  return new Prisma.Decimal(n);
}

const TENANT = 'tenant-acme';

function makePrisma(overrides: Partial<any> = {}) {
  const tx = {
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    scheduleOpenItem: {
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { remainingBalance: dec(0) } }),
    },
    scheduleException: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((a: any) => Promise.resolve({ id: 'exc-1', ...a.data })),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockImplementation((a: any) => Promise.resolve({ id: a.where.id, ...a.data })),
    },
    scheduleExceptionRuleConfig: { findFirst: vi.fn().mockResolvedValue(null) },
    auditOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
    ...overrides,
  };
  return { $transaction: (fn: any) => fn(tx), scheduleException: tx.scheduleException, scheduleExceptionRuleConfig: tx.scheduleExceptionRuleConfig, tx };
}

describe('ExceptionService.runEvaluation', () => {
  it('flags a STALE item past the configured threshold', async () => {
    const staleItem = { id: 'item-1', scheduleNumber: '01', controlNumber: 'CTRL001', itemNumber: 'INV-1', journalEntryId: 'je-1', transactionDate: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000), dueDate: null, remainingBalance: dec('50.00') };
    const prisma = makePrisma({ scheduleOpenItem: { findMany: vi.fn().mockResolvedValue([staleItem]), aggregate: vi.fn().mockResolvedValue({ _sum: { remainingBalance: dec(0) } }) } });
    const svc = new ExceptionService(prisma as any);
    const result = await svc.runEvaluation(TENANT, undefined, 'user-1');
    expect(result.opened).toBeGreaterThanOrEqual(1);
    expect(prisma.tx.scheduleException.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ruleType: 'STALE' }) }),
    );
  });

  it('flags MISSING_REFERENCE when itemNumber fell back to the journalEntryId', async () => {
    const item = { id: 'item-1', scheduleNumber: '01', controlNumber: 'CTRL001', itemNumber: 'je-1', journalEntryId: 'je-1', transactionDate: new Date(), dueDate: null, remainingBalance: dec('50.00') };
    const prisma = makePrisma({ scheduleOpenItem: { findMany: vi.fn().mockResolvedValue([item]), aggregate: vi.fn().mockResolvedValue({ _sum: { remainingBalance: dec(0) } }) } });
    const svc = new ExceptionService(prisma as any);
    await svc.runEvaluation(TENANT, undefined, 'user-1');
    expect(prisma.tx.scheduleException.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ruleType: 'MISSING_REFERENCE' }) }),
    );
  });

  it('does not duplicate an already-open exception for the same item/rule', async () => {
    const item = { id: 'item-1', scheduleNumber: '01', controlNumber: 'CTRL001', itemNumber: 'je-1', journalEntryId: 'je-1', transactionDate: new Date(), dueDate: null, remainingBalance: dec('50.00') };
    const prisma = makePrisma({
      scheduleOpenItem: { findMany: vi.fn().mockResolvedValue([item]), aggregate: vi.fn().mockResolvedValue({ _sum: { remainingBalance: dec(0) } }) },
      scheduleException: { findFirst: vi.fn().mockResolvedValue({ id: 'existing' }), create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    });
    const svc = new ExceptionService(prisma as any);
    const result = await svc.runEvaluation(TENANT, undefined, 'user-1');
    expect(result.opened).toBe(0);
    expect(prisma.tx.scheduleException.create).not.toHaveBeenCalled();
  });
});

describe('ExceptionService.dispositionException', () => {
  it('marks an open exception as DISPOSITIONED with a note and actor', async () => {
    const prisma = makePrisma({
      scheduleException: {
        findFirst: vi.fn().mockResolvedValue({ id: 'exc-1', status: 'OPEN' }),
        create: vi.fn(), findMany: vi.fn(),
        update: vi.fn().mockImplementation((a: any) => Promise.resolve({ id: a.where.id, ...a.data })),
      },
    });
    const svc = new ExceptionService(prisma as any);
    const result = await svc.dispositionException(TENANT, 'exc-1', 'reviewed, no action needed', 'user-1');
    expect(result.status).toBe('DISPOSITIONED');
    expect(result.dispositionedBy).toBe('user-1');
  });

  it('rejects dispositioning an unknown exception', async () => {
    const prisma = makePrisma({ scheduleException: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), findMany: vi.fn(), update: vi.fn() } });
    const svc = new ExceptionService(prisma as any);
    await expect(svc.dispositionException(TENANT, 'missing', 'note', 'user-1')).rejects.toBeInstanceOf(ExceptionNotFoundError);
  });

  it('rejects re-dispositioning an already-dispositioned exception', async () => {
    const prisma = makePrisma({ scheduleException: { findFirst: vi.fn().mockResolvedValue({ id: 'exc-1', status: 'DISPOSITIONED' }), create: vi.fn(), findMany: vi.fn(), update: vi.fn() } });
    const svc = new ExceptionService(prisma as any);
    await expect(svc.dispositionException(TENANT, 'exc-1', 'note', 'user-1')).rejects.toBeInstanceOf(ExceptionAlreadyDispositionedError);
  });
});
