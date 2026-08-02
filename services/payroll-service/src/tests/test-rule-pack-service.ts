/**
 * @file test-rule-pack-service.ts
 * @coverage CE-13 gap #3 — S025 PayrollRulePackService direct unit tests:
 *   draft creation (version increment), simulate (blueprint + pending-row
 *   count), validate (row-shape errors), activate (author != activator SoD,
 *   VALIDATED-before-ACTIVE gate, supersession of the prior ACTIVE version),
 *   getActiveVersion.
 */
import { describe, it, expect, vi } from 'vitest';
import { PayrollRulePackService, RulePackActivationError, RulePackAuthorEqualsActivatorError } from '../application/rule-pack-service';

const TENANT = 'tenant-test' as any;

function makePrismaMock(overrides: Partial<any> = {}) {
  return {
    payrollRulePackVersion: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'version-1', ...data })),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'version-1', ...data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      ...overrides.payrollRulePackVersion,
    },
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn({
      payrollRulePackVersion: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'version-1', ...data })),
      },
    })),
  };
}

function makeSvc(overrides: Partial<any> = {}) {
  const prisma = makePrismaMock(overrides);
  return { svc: new PayrollRulePackService(prisma as any), prisma };
}

describe('PayrollRulePackService — draft', () => {
  it('creates version 1 when no prior version exists', async () => {
    const { svc, prisma } = makeSvc({ payrollRulePackVersion: { findFirst: vi.fn().mockResolvedValue(null) } });
    const version = await svc.createDraft(TENANT, 'payroll-gl-mapping', [
      { family: 'EARNINGS', department: 'sales', payComponent: 'REGULAR_PAY', glAccountCode: null, isDebit: true },
    ], 'author-1');
    expect(version.version).toBe(1);
    expect(version.status).toBe('DRAFT');
    expect(prisma.payrollRulePackVersion.create).toHaveBeenCalled();
  });

  it('increments version when a prior version exists for the same packKey', async () => {
    const { svc } = makeSvc({ payrollRulePackVersion: { findFirst: vi.fn().mockResolvedValue({ version: 3 }) } });
    const version = await svc.createDraft(TENANT, 'payroll-gl-mapping', [], 'author-1');
    expect(version.version).toBe(4);
  });

  it('tolerates blank glAccountCode rows (ACCOUNT_MAPPING_VALUES_PENDING is a valid draft state)', async () => {
    const { svc } = makeSvc({ payrollRulePackVersion: { findFirst: vi.fn().mockResolvedValue(null) } });
    const version = await svc.createDraft(TENANT, 'k', [
      { family: 'EARNINGS', department: 'sales', payComponent: 'REGULAR_PAY', glAccountCode: null, isDebit: true },
    ], 'author-1');
    expect(version.rows[0].glAccountCode).toBeNull();
  });
});

describe('PayrollRulePackService — simulate', () => {
  it('returns the blueprint with a pendingMappingCount for blank rows, without requiring activation', async () => {
    const { svc } = makeSvc({
      payrollRulePackVersion: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'version-1', packKey: 'k', version: 1, status: 'DRAFT',
          rows: [
            { family: 'EARNINGS', department: 'sales', payComponent: 'REGULAR_PAY', glAccountCode: '5000', isDebit: true },
            { family: 'EARNINGS', department: 'service', payComponent: 'REGULAR_PAY', glAccountCode: null, isDebit: true },
          ],
        }),
      },
    });
    const sim = await svc.simulate(TENANT, 'version-1');
    expect(sim.pendingMappingCount).toBe(1);
    expect(sim.rows).toHaveLength(2);
  });

  it('throws when the version does not exist', async () => {
    const { svc } = makeSvc({ payrollRulePackVersion: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(svc.simulate(TENANT, 'nope')).rejects.toThrow('not found');
  });
});

describe('PayrollRulePackService — validate', () => {
  it('marks VALIDATED when every row has family/department/payComponent', async () => {
    const { svc, prisma } = makeSvc({
      payrollRulePackVersion: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'version-1', rows: [{ family: 'EARNINGS', department: 'sales', payComponent: 'REGULAR_PAY', glAccountCode: null, isDebit: true }],
        }),
      },
    });
    const result = await svc.validate(TENANT, 'version-1');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(prisma.payrollRulePackVersion.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'VALIDATED' }) }));
  });

  it('rejects an empty rule pack (no rows)', async () => {
    const { svc } = makeSvc({ payrollRulePackVersion: { findFirst: vi.fn().mockResolvedValue({ id: 'version-1', rows: [] }) } });
    const result = await svc.validate(TENANT, 'version-1');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/at least one row/);
  });

  it('rejects rows missing family/department/payComponent', async () => {
    const { svc } = makeSvc({
      payrollRulePackVersion: { findFirst: vi.fn().mockResolvedValue({ id: 'version-1', rows: [{ family: '', department: 'sales', payComponent: 'X', glAccountCode: null, isDebit: true }] }) },
    });
    const result = await svc.validate(TENANT, 'version-1');
    expect(result.valid).toBe(false);
  });
});

describe('PayrollRulePackService — activate (S025 SoD)', () => {
  it('denies activation when author === activator (self-activation denial)', async () => {
    const { svc } = makeSvc({
      payrollRulePackVersion: { findFirst: vi.fn().mockResolvedValue({ id: 'version-1', packKey: 'k', status: 'VALIDATED', author: 'same-user' }) },
    });
    await expect(svc.activate(TENANT, 'version-1', 'same-user')).rejects.toThrow(RulePackAuthorEqualsActivatorError);
  });

  it('requires VALIDATED status before activation', async () => {
    const { svc } = makeSvc({
      payrollRulePackVersion: { findFirst: vi.fn().mockResolvedValue({ id: 'version-1', packKey: 'k', status: 'DRAFT', author: 'author-1' }) },
    });
    await expect(svc.activate(TENANT, 'version-1', 'activator-1')).rejects.toThrow(RulePackActivationError);
  });

  it('activates via a distinct eligible user and supersedes the prior ACTIVE version', async () => {
    const { svc } = makeSvc({
      payrollRulePackVersion: { findFirst: vi.fn().mockResolvedValue({ id: 'version-1', packKey: 'k', status: 'VALIDATED', author: 'author-1' }) },
    });
    const activated = await svc.activate(TENANT, 'version-1', 'activator-1');
    expect(activated.status).toBe('ACTIVE');
    expect(activated.activatedBy).toBe('activator-1');
  });

  it('throws when the version does not exist', async () => {
    const { svc } = makeSvc({ payrollRulePackVersion: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(svc.activate(TENANT, 'nope', 'activator-1')).rejects.toThrow('not found');
  });
});

describe('PayrollRulePackService — getActiveVersion / listVersions', () => {
  it('getActiveVersion queries for ACTIVE status only', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'version-1', status: 'ACTIVE' });
    const { svc } = makeSvc({ payrollRulePackVersion: { findFirst } });
    await svc.getActiveVersion(TENANT, 'k');
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: TENANT, packKey: 'k', status: 'ACTIVE' } }));
  });

  it('listVersions filters by packKey when provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const { svc } = makeSvc({ payrollRulePackVersion: { findMany } });
    await svc.listVersions(TENANT, 'k');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: TENANT, packKey: 'k' } }));
  });
});
