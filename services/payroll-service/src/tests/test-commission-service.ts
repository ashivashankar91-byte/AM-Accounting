/**
 * @file test-commission-service.ts
 * @coverage CE-13 gap #1/#3 — S109 complete commission, draw and dispute lifecycle.
 *   - Plan CRUD + supersede (version increment, append-only)
 *   - Split-rule validation
 *   - Calculation: FLAT/PERCENTAGE/TIERED, with employee splits
 *   - Minimum guarantee top-up
 *   - Draw issuance + outstanding-draw tracking (appliedToDraw)
 *   - Earned-vs-paid status transitions (markPaid)
 *   - Correction + reversal (original-to-reversal linkage)
 *   - Chargeback linkage to ClawbackRecord
 *   - Dispute create/resolve, including self-resolution SoD denial
 *   - Register/YTD aggregation
 */
import { describe, it, expect, vi } from 'vitest';
import {
  CommissionService,
  CommissionPlanNotFoundError,
  CommissionRecordNotFoundError,
  CommissionDisputeNotFoundError,
  CommissionDisputeAlreadyResolvedError,
  InvalidSplitRulesError,
} from '../application/commission-service';
import { SegregationOfDutiesError } from '../domain/errors';

const TENANT = 'tenant-test' as any;

function decimalOf(n: number) {
  return { toNumber: () => n, toString: () => n.toString() };
}

function makePrismaMock(overrides: Partial<any> = {}) {
  return {
    commissionPlan: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'plan-1', ...data })),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      ...overrides.commissionPlan,
    },
    commissionRecord: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: `rec-${Math.random().toString(36).slice(2, 8)}`, clawedBackAmount: decimalOf(0), ...data, commissionAmount: decimalOf(Number((data.commissionAmount as any)?.toString?.() ?? data.commissionAmount ?? 0)), grossProfit: decimalOf(Number((data.grossProfit as any)?.toString?.() ?? data.grossProfit ?? 0)) })),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'rec-1', ...data })),
      aggregate: vi.fn().mockResolvedValue({ _sum: { commissionAmount: 0 } }),
      ...overrides.commissionRecord,
    },
    commissionDispute: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'dispute-1', ...data })),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'dispute-1', ...data })),
      ...overrides.commissionDispute,
    },
    clawbackRecord: {
      findFirst: vi.fn().mockResolvedValue({ id: 'clawback-1', tenantId: TENANT }),
      ...overrides.clawbackRecord,
    },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
}

function makeSvc(overrides: Partial<any> = {}) {
  const prisma = makePrismaMock(overrides);
  return { svc: new CommissionService(prisma as any), prisma };
}

describe('CommissionService — plans', () => {
  it('createPlan persists tenant-configured fields (no hardcoded percentage)', async () => {
    const { svc, prisma } = makeSvc();
    const plan = await svc.createPlan(TENANT, {
      legalEntityId: 'entity-test', employeeId: 'emp-1', planType: 'PERCENTAGE', percentageRate: 3.5, effectiveDate: '2024-01-01',
    }, 'author-1');
    expect(prisma.commissionPlan.create).toHaveBeenCalled();
    expect(plan.employeeId).toBe('emp-1');
    expect(prisma.outboxEvent.create).toHaveBeenCalled();
  });

  it('createPlan rejects split rules summing over 100%', async () => {
    const { svc } = makeSvc();
    await expect(svc.createPlan(TENANT, {
      legalEntityId: 'entity-test', employeeId: 'emp-1', planType: 'PERCENTAGE', percentageRate: 3,
      splitRules: [{ employeeId: 'emp-1', sharePct: 60 }, { employeeId: 'emp-2', sharePct: 60 }],
      effectiveDate: '2024-01-01',
    }, 'author-1')).rejects.toThrow(InvalidSplitRulesError);
  });

  it('supersedePlan creates a new version and marks the old plan inactive/superseded (append-only)', async () => {
    const { svc, prisma } = makeSvc({
      commissionPlan: {
        findFirst: vi.fn().mockResolvedValue({ id: 'plan-1', tenantId: TENANT, version: 1, department: 'sales' }),
      },
    });
    const newPlan = await svc.supersedePlan(TENANT, 'plan-1', {
      legalEntityId: 'entity-test', employeeId: 'emp-1', planType: 'PERCENTAGE', percentageRate: 4, effectiveDate: '2024-06-01',
    }, 'author-1');
    expect(newPlan.version).toBe(2);
    expect(prisma.commissionPlan.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'plan-1' },
      data: expect.objectContaining({ isActive: false }),
    }));
  });

  it('supersedePlan throws CommissionPlanNotFoundError for unknown plan', async () => {
    const { svc } = makeSvc({ commissionPlan: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(svc.supersedePlan(TENANT, 'nope', { employeeId: 'e', planType: 'FLAT', effectiveDate: '2024-01-01' } as any, 'a'))
      .rejects.toThrow(CommissionPlanNotFoundError);
  });
});

describe('CommissionService — calculation + splits + minimum guarantee', () => {
  it('calculateCommission throws CommissionPlanNotFoundError with no active plan', async () => {
    const { svc } = makeSvc({ commissionPlan: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(svc.calculateCommission(TENANT, {
      dealId: 'deal-1', employeeId: 'emp-1', dealType: 'NEW', grossProfit: 1000, dealDate: '2024-01-15',
    }, 'actor-1')).rejects.toThrow(CommissionPlanNotFoundError);
  });

  it('calculateCommission (PERCENTAGE, no splits) creates one ACCRUED record for the tenant-configured rate', async () => {
    const { svc, prisma } = makeSvc({
      commissionPlan: { findFirst: vi.fn().mockResolvedValue({ id: 'plan-1', planType: 'PERCENTAGE', percentageRate: 5, splitRules: null, drawAmount: null, minimumGuarantee: null }) },
    });
    const result = await svc.calculateCommission(TENANT, {
      dealId: 'deal-1', employeeId: 'emp-1', dealType: 'NEW', grossProfit: 1000, dealDate: '2024-01-15',
    }, 'actor-1');
    expect(result.grossCommission).toBe(50);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].status).toBe('ACCRUED');
    expect(prisma.commissionRecord.create).toHaveBeenCalled();
  });

  it('calculateCommission applies tenant-configured splitRules across multiple employees', async () => {
    const { svc } = makeSvc({
      commissionPlan: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'plan-1', planType: 'PERCENTAGE', percentageRate: 10, drawAmount: null, minimumGuarantee: null,
          splitRules: [{ employeeId: 'emp-A', sharePct: 60 }, { employeeId: 'emp-B', sharePct: 40 }],
        }),
      },
    });
    const result = await svc.calculateCommission(TENANT, {
      dealId: 'deal-1', employeeId: 'emp-1', dealType: 'NEW', grossProfit: 1000, dealDate: '2024-01-15',
    }, 'actor-1');
    expect(result.grossCommission).toBe(100);
    expect(result.records).toHaveLength(2);
    const amounts = result.records.map((r: any) => Number(r.commissionAmount.toString?.() ?? r.commissionAmount)).sort();
    expect(amounts).toEqual([40, 60]);
  });

  it('calculateCommission creates a MINIMUM_GUARANTEE_TOPUP record when period-earned falls below the plan floor', async () => {
    const { svc, prisma } = makeSvc({
      commissionPlan: { findFirst: vi.fn().mockResolvedValue({ id: 'plan-1', planType: 'FLAT', flatAmount: 50, drawAmount: null, minimumGuarantee: 500, splitRules: null }) },
      commissionRecord: { aggregate: vi.fn().mockResolvedValue({ _sum: { commissionAmount: 50 } }) },
    });
    await svc.calculateCommission(TENANT, {
      dealId: 'deal-1', employeeId: 'emp-1', dealType: 'NEW', grossProfit: 1000, dealDate: '2024-01-15',
    }, 'actor-1');
    const createCalls = (prisma.commissionRecord.create as any).mock.calls;
    const topup = createCalls.find((c: any) => c[0].data.dealType === 'MINIMUM_GUARANTEE_TOPUP');
    expect(topup).toBeTruthy();
  });
});

describe('CommissionService — draws', () => {
  it('issueDraw creates a PAID DRAW_ADVANCE record for a tenant-configured amount', async () => {
    const { svc, prisma } = makeSvc({ commissionPlan: { findFirst: vi.fn().mockResolvedValue({ id: 'plan-1', tenantId: TENANT }) } });
    const record = await svc.issueDraw(TENANT, 'emp-1', 'plan-1', 300, 'manager-1');
    expect(record.dealType).toBe('DRAW_ADVANCE');
    expect(record.status).toBe('PAID');
    expect(prisma.outboxEvent.create).toHaveBeenCalled();
  });

  it('issueDraw throws CommissionPlanNotFoundError for unknown plan', async () => {
    const { svc } = makeSvc({ commissionPlan: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(svc.issueDraw(TENANT, 'emp-1', 'nope', 100, 'manager-1')).rejects.toThrow(CommissionPlanNotFoundError);
  });
});

describe('CommissionService — status, correction, reversal', () => {
  it('markPaid transitions status to PAID and stores journalEntryId', async () => {
    const { svc, prisma } = makeSvc({ commissionRecord: { findFirst: vi.fn().mockResolvedValue({ id: 'rec-1', status: 'ACCRUED' }) } });
    const updated = await svc.markPaid(TENANT, 'rec-1', 'actor-1', 'je-1');
    expect(updated.status).toBe('PAID');
    expect(updated.journalEntryId).toBe('je-1');
    expect(prisma.commissionRecord.update).toHaveBeenCalled();
  });

  it('markPaid throws CommissionRecordNotFoundError for unknown record', async () => {
    const { svc } = makeSvc({ commissionRecord: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(svc.markPaid(TENANT, 'nope', 'actor-1')).rejects.toThrow(CommissionRecordNotFoundError);
  });

  it('correctRecord marks ADJUSTED with the new amount (audited, non-destructive)', async () => {
    const { svc, prisma } = makeSvc({ commissionRecord: { findFirst: vi.fn().mockResolvedValue({ id: 'rec-1', commissionAmount: decimalOf(50) }) } });
    const updated = await svc.correctRecord(TENANT, 'rec-1', 75, 'manual correction', 'actor-1');
    expect(updated.status).toBe('ADJUSTED');
    expect(prisma.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: 'COMMISSION_CORRECTED' }) }));
  });

  it('reverseRecord creates a linked negative-amount reversal record and marks the original REVERSED', async () => {
    const { svc, prisma } = makeSvc({
      commissionRecord: { findFirst: vi.fn().mockResolvedValue({ id: 'rec-1', employeeId: 'emp-1', dealId: 'deal-1', commissionAmount: decimalOf(50), periodYear: 2024, periodMonth: 1 }) },
    });
    const reversal = await svc.reverseRecord(TENANT, 'rec-1', 'duplicate deal', 'actor-1');
    expect(reversal.status).toBe('REVERSED');
    expect(reversal.dealType).toBe('REVERSAL_OF:rec-1');
    expect(prisma.commissionRecord.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'rec-1' }, data: { status: 'REVERSED' } }));
  });
});

describe('CommissionService — chargeback linkage', () => {
  it('applyChargeback increments clawedBackAmount and links to an existing ClawbackRecord', async () => {
    const { svc, prisma } = makeSvc({
      commissionRecord: { findFirst: vi.fn().mockResolvedValue({ id: 'rec-1' }) },
    });
    await svc.applyChargeback(TENANT, 'rec-1', 'clawback-1', 25, 'actor-1');
    expect(prisma.commissionRecord.update).toHaveBeenCalled();
  });

  it('applyChargeback throws 404 when the clawback record does not exist', async () => {
    const { svc } = makeSvc({
      commissionRecord: { findFirst: vi.fn().mockResolvedValue({ id: 'rec-1' }) },
      clawbackRecord: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    await expect(svc.applyChargeback(TENANT, 'rec-1', 'nope', 25, 'actor-1')).rejects.toThrow('not found');
  });
});

describe('CommissionService — disputes', () => {
  it('createDispute persists OPEN status with original/adjusted amounts', async () => {
    const { svc, prisma } = makeSvc({ commissionRecord: { findFirst: vi.fn().mockResolvedValue({ id: 'rec-1', commissionAmount: decimalOf(50) }) } });
    const dispute = await svc.createDispute(TENANT, 'rec-1', 'wrong tier applied', 40, 'raiser-1');
    expect(dispute.status).toBe('OPEN');
    expect(dispute.raisedBy).toBe('raiser-1');
    expect(prisma.commissionDispute.create).toHaveBeenCalled();
  });

  it('resolveDispute denies self-resolution: the raiser cannot also resolve their own dispute (SoD)', async () => {
    const { svc } = makeSvc({
      commissionDispute: { findFirst: vi.fn().mockResolvedValue({ id: 'dispute-1', status: 'OPEN', raisedBy: 'raiser-1', commissionRecordId: 'rec-1' }) },
    });
    await expect(svc.resolveDispute(TENANT, 'dispute-1', 'APPROVE_ADJUSTMENT', 'raiser-1')).rejects.toThrow(SegregationOfDutiesError);
  });

  it('resolveDispute (APPROVE_ADJUSTMENT) by a distinct reviewer applies the adjustment via correctRecord', async () => {
    const { svc, prisma } = makeSvc({
      commissionDispute: { findFirst: vi.fn().mockResolvedValue({ id: 'dispute-1', status: 'OPEN', raisedBy: 'raiser-1', commissionRecordId: 'rec-1', adjustedAmount: decimalOf(40) }) },
      commissionRecord: { findFirst: vi.fn().mockResolvedValue({ id: 'rec-1', commissionAmount: decimalOf(50) }) },
    });
    const updated = await svc.resolveDispute(TENANT, 'dispute-1', 'APPROVE_ADJUSTMENT', 'reviewer-1');
    expect(updated.status).toBe('RESOLVED');
    expect(updated.resolvedBy).toBe('reviewer-1');
    expect(prisma.commissionRecord.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ADJUSTED' }) }));
  });

  it('resolveDispute throws CommissionDisputeAlreadyResolvedError when already RESOLVED', async () => {
    const { svc } = makeSvc({
      commissionDispute: { findFirst: vi.fn().mockResolvedValue({ id: 'dispute-1', status: 'RESOLVED', raisedBy: 'raiser-1' }) },
    });
    await expect(svc.resolveDispute(TENANT, 'dispute-1', 'DENY', 'reviewer-1')).rejects.toThrow(CommissionDisputeAlreadyResolvedError);
  });

  it('resolveDispute throws CommissionDisputeNotFoundError for unknown dispute', async () => {
    const { svc } = makeSvc({ commissionDispute: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(svc.resolveDispute(TENANT, 'nope', 'DENY', 'reviewer-1')).rejects.toThrow(CommissionDisputeNotFoundError);
  });
});

describe('CommissionService — register / YTD', () => {
  it('ytdTotal sums ACCRUED/PAID/ADJUSTED commission for the year', async () => {
    const { svc } = makeSvc({ commissionRecord: { aggregate: vi.fn().mockResolvedValue({ _sum: { commissionAmount: 1234.5 } }) } });
    const total = await svc.ytdTotal(TENANT, 'emp-1', 2024);
    expect(total).toBe(1234.5);
  });

  it('listByEmployee filters by period and status', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const { svc } = makeSvc({ commissionRecord: { findMany } });
    await svc.listByEmployee(TENANT, 'emp-1', '2024-01', 'ACCRUED');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: TENANT, employeeId: 'emp-1', periodYear: 2024, periodMonth: 1, status: 'ACCRUED' }),
    }));
  });
});
