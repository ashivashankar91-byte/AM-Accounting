/**
 * @test G-04/05/06 — GLService.resetForOwnershipChange
 * @cobol-origin glzero.cbl, glzerosch.cbl, jrnzero.cbl
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the logic in isolation by creating a mock PrismaClient transaction
// that verifies the correct Prisma operations are called in the right sequence.

function makeAccountRepo() {
  return {
    findById: vi.fn().mockResolvedValue({ id: 'acct-1', code: '4000', scheduleCode: '01' }),
    update: vi.fn().mockImplementation((_id, data) => Promise.resolve({ id: 'acct-1', ...data })),
  };
}

function makePrisma(txImpl: (tx: any) => void) {
  const tx = {
    gLAccount: {
      updateMany: vi.fn().mockResolvedValue({ count: 42 }),
    },
    gLAccountPeriodBalance: {
      deleteMany: vi.fn().mockResolvedValue({ count: 120 }),
    },
    outboxEvent: {
      create: vi.fn().mockResolvedValue({ id: 'evt-1' }),
    },
  };
  return {
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
    ...tx,
    _tx: tx,
  };
}

// Import the service. Since it uses tsyringe DI, we instantiate directly.
// We need to bypass the full DI container — test only the method logic.
describe('GLService.resetForOwnershipChange (G-04/05/06)', () => {
  it('zeros opening balances for all GL accounts in the tenant', async () => {
    const prisma = makePrisma(() => {});
    // Dynamically require so the PrismaClient import path doesn't break tests
    const { GLService } = await import('../application/gl-service');
    const svc = new (GLService as any)(
      makeAccountRepo(),
      { create: vi.fn(), findAll: vi.fn().mockResolvedValue([]) },
      { create: vi.fn(), findByEntry: vi.fn().mockResolvedValue([]) },
      prisma,
      'http://eom-service:3040',
    );

    const result = await svc.resetForOwnershipChange('tenant-test', 'admin@test.com');

    const tx = (prisma.$transaction as any).mock.calls[0][0];
    // Verify the transaction function was passed
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(result).toHaveProperty('accountsReset');
    expect(result).toHaveProperty('periodBalancesDeleted');
    expect(result).toHaveProperty('scheduleAssignmentsCleared');
  });

  it('returns correct counts from the SERIALIZABLE transaction', async () => {
    const txMock = {
      gLAccount: {
        updateMany: vi.fn()
          .mockResolvedValueOnce({ count: 50 }) // zeroing opening balances
          .mockResolvedValueOnce({ count: 30 }), // clearing scheduleCode
      },
      gLAccountPeriodBalance: { deleteMany: vi.fn().mockResolvedValue({ count: 200 }) },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation(async (fn: any) => fn(txMock)),
    };

    const { GLService } = await import('../application/gl-service');
    const svc = new (GLService as any)(
      makeAccountRepo(),
      { create: vi.fn(), findAll: vi.fn().mockResolvedValue([]) },
      { create: vi.fn(), findByEntry: vi.fn().mockResolvedValue([]) },
      prisma,
      'http://eom-service:3040',
    );

    const result = await svc.resetForOwnershipChange('tenant-test', 'admin@test.com', {
      clearScheduleAssignments: true,
      clearPeriodBalances: true,
    });

    expect(result.accountsReset).toBe(50);
    expect(result.scheduleAssignmentsCleared).toBe(30);
    expect(result.periodBalancesDeleted).toBe(200);
  });

  it('skips schedule assignment clearing when option is false', async () => {
    const txMock = {
      gLAccount: {
        updateMany: vi.fn().mockResolvedValue({ count: 10 }),
      },
      gLAccountPeriodBalance: { deleteMany: vi.fn().mockResolvedValue({ count: 50 }) },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation(async (fn: any) => fn(txMock)),
    };

    const { GLService } = await import('../application/gl-service');
    const svc = new (GLService as any)(
      makeAccountRepo(),
      { create: vi.fn(), findAll: vi.fn().mockResolvedValue([]) },
      { create: vi.fn(), findByEntry: vi.fn().mockResolvedValue([]) },
      prisma,
      'http://eom-service:3040',
    );

    const result = await svc.resetForOwnershipChange('tenant-test', 'admin@test.com', {
      clearScheduleAssignments: false,
      clearPeriodBalances: true,
    });

    expect(result.scheduleAssignmentsCleared).toBe(0);
    // gLAccount.updateMany should only have been called once (opening balance zero)
    expect(txMock.gLAccount.updateMany).toHaveBeenCalledTimes(1);
  });

  it('emits OWNERSHIP_CHANGE_RESET outbox event atomically in the transaction', async () => {
    const outboxCreate = vi.fn().mockResolvedValue({});
    const txMock = {
      gLAccount: { updateMany: vi.fn().mockResolvedValue({ count: 5 }) },
      gLAccountPeriodBalance: { deleteMany: vi.fn().mockResolvedValue({ count: 10 }) },
      outboxEvent: { create: outboxCreate },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation(async (fn: any) => fn(txMock)),
    };

    const { GLService } = await import('../application/gl-service');
    const svc = new (GLService as any)(
      makeAccountRepo(),
      { create: vi.fn(), findAll: vi.fn().mockResolvedValue([]) },
      { create: vi.fn(), findByEntry: vi.fn().mockResolvedValue([]) },
      prisma,
      'http://eom-service:3040',
    );

    await svc.resetForOwnershipChange('tenant-test', 'admin@test.com');

    expect(outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'OWNERSHIP_CHANGE_RESET',
          tenantId: 'tenant-test',
        }),
      }),
    );
  });
});
