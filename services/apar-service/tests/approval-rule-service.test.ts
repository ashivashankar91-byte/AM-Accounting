/**
 * AMACC-CH04 S041 — ApprovalRuleService domain tests (tenant-configurable
 * matrix tier resolution). Mocked-Prisma unit tests.
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import {
  ApprovalRuleService,
  ApprovalRuleValidationError,
  ApprovalRuleConflictError,
  ApprovalRuleNotFoundError,
  ANY_APPROVER_ROLE,
} from '../src/application/approval-rule-service';

const TENANT_ID = 'tenant-approval';

function makePrisma(overrides: Partial<{
  ruleFindMany: ReturnType<typeof vi.fn>;
  ruleFindFirst: ReturnType<typeof vi.fn>;
  ruleCreate: ReturnType<typeof vi.fn>;
  ruleUpdate: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    apInvoiceApprovalRule: {
      findMany: overrides.ruleFindMany ?? vi.fn().mockResolvedValue([]),
      findFirst: overrides.ruleFindFirst ?? vi.fn().mockResolvedValue(null),
      create: overrides.ruleCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'rule-1', ...data })),
      update: overrides.ruleUpdate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'rule-1', ...data })),
    },
  };
}

describe('ApprovalRuleService.resolveTiers', () => {
  it('returns a single ANY_APPROVER tier when the tenant has configured no rules (conservative default)', async () => {
    const svc = new ApprovalRuleService(makePrisma() as any);
    const tiers = await svc.resolveTiers(TENANT_ID, 5000);
    expect(tiers).toEqual([{ sequence: 1, requiredRole: ANY_APPROVER_ROLE, thresholdAmount: 0 }]);
  });

  it('returns the ANY_APPROVER default when the amount is below every configured threshold', async () => {
    const prisma = makePrisma({
      ruleFindMany: vi.fn().mockResolvedValue([{ sequence: 1, requiredRole: 'CONTROLLER', thresholdAmount: '10000.00', isActive: true }]),
    });
    const svc = new ApprovalRuleService(prisma as any);
    const tiers = await svc.resolveTiers(TENANT_ID, 500);
    expect(tiers).toEqual([{ sequence: 1, requiredRole: ANY_APPROVER_ROLE, thresholdAmount: 0 }]);
  });

  it('returns applicable tiers in sequence order when the amount meets configured thresholds', async () => {
    const prisma = makePrisma({
      ruleFindMany: vi.fn().mockResolvedValue([
        { sequence: 1, requiredRole: 'ACCOUNTANT', thresholdAmount: '0.00', isActive: true },
        { sequence: 2, requiredRole: 'CONTROLLER', thresholdAmount: '5000.00', isActive: true },
      ]),
    });
    const svc = new ApprovalRuleService(prisma as any);
    const tiers = await svc.resolveTiers(TENANT_ID, 7500);
    expect(tiers).toEqual([
      { sequence: 1, requiredRole: 'ACCOUNTANT', thresholdAmount: 0 },
      { sequence: 2, requiredRole: 'CONTROLLER', thresholdAmount: 5000 },
    ]);
  });

  it('excludes tiers whose threshold exceeds the invoice amount', async () => {
    const prisma = makePrisma({
      ruleFindMany: vi.fn().mockResolvedValue([
        { sequence: 1, requiredRole: 'ACCOUNTANT', thresholdAmount: '0.00', isActive: true },
        { sequence: 2, requiredRole: 'CONTROLLER', thresholdAmount: '5000.00', isActive: true },
      ]),
    });
    const svc = new ApprovalRuleService(prisma as any);
    const tiers = await svc.resolveTiers(TENANT_ID, 100);
    expect(tiers).toEqual([{ sequence: 1, requiredRole: 'ACCOUNTANT', thresholdAmount: 0 }]);
  });
});

describe('ApprovalRuleService.create', () => {
  it('rejects an unrecognized role', async () => {
    const svc = new ApprovalRuleService(makePrisma() as any);
    await expect(svc.create({ tenantId: TENANT_ID, thresholdAmount: 100, requiredRole: 'INVENTED_ROLE', sequence: 1 }))
      .rejects.toBeInstanceOf(ApprovalRuleValidationError);
  });

  it('rejects a negative threshold', async () => {
    const svc = new ApprovalRuleService(makePrisma() as any);
    await expect(svc.create({ tenantId: TENANT_ID, thresholdAmount: -1, requiredRole: 'ADMIN', sequence: 1 }))
      .rejects.toBeInstanceOf(ApprovalRuleValidationError);
  });

  it('rejects a duplicate sequence for the same tenant', async () => {
    const prisma = makePrisma({ ruleFindFirst: vi.fn().mockResolvedValue({ id: 'existing' }) });
    const svc = new ApprovalRuleService(prisma as any);
    await expect(svc.create({ tenantId: TENANT_ID, thresholdAmount: 100, requiredRole: 'ADMIN', sequence: 1 }))
      .rejects.toBeInstanceOf(ApprovalRuleConflictError);
  });

  it('creates a valid rule', async () => {
    const svc = new ApprovalRuleService(makePrisma() as any);
    const rule = await svc.create({ tenantId: TENANT_ID, thresholdAmount: 1000, requiredRole: 'CONTROLLER', sequence: 2 });
    expect(rule.requiredRole).toBe('CONTROLLER');
  });
});

describe('ApprovalRuleService.update', () => {
  it('throws when the rule does not exist', async () => {
    const svc = new ApprovalRuleService(makePrisma() as any);
    await expect(svc.update(TENANT_ID, 'missing', { isActive: false })).rejects.toBeInstanceOf(ApprovalRuleNotFoundError);
  });

  it('rejects an unrecognized role on update', async () => {
    const prisma = makePrisma({ ruleFindFirst: vi.fn().mockResolvedValue({ id: 'rule-1', tenantId: TENANT_ID }) });
    const svc = new ApprovalRuleService(prisma as any);
    await expect(svc.update(TENANT_ID, 'rule-1', { requiredRole: 'BOGUS' })).rejects.toBeInstanceOf(ApprovalRuleValidationError);
  });
});
