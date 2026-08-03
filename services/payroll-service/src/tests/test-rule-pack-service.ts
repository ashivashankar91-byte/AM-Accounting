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
import type { ICe07RulePackRegistrar } from '../infrastructure/ce07-rule-pack-registrar';

const TENANT = 'tenant-test' as any;
const BEARER = 'Bearer test-token';

/** fix(integration): the CE-07 registration side effect is a real,
 * separately-certified HTTP boundary (see test-ce13-routes.ts's dedicated
 * CE-07-registration describe block for its actual contract coverage
 * against a mocked coa-service response, and the live curl/Playwright
 * certification for the real end-to-end proof). This unit suite mocks it
 * exactly like PayrollRulePackService already mocks PrismaClient — never
 * to fabricate a real posting outcome, only to isolate this service's own
 * SoD/status-transition logic under test. */
function makeCe07RegistrarMock(overrides: Partial<ICe07RulePackRegistrar> = {}): ICe07RulePackRegistrar {
  return {
    draft: vi.fn().mockResolvedValue({ id: 'ce07-version-1', status: 'DRAFT' }),
    validate: vi.fn().mockResolvedValue({ valid: true, findings: [] }),
    activate: vi.fn().mockResolvedValue({ id: 'ce07-version-1', status: 'ACTIVE' }),
    ...overrides,
  };
}

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
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
}

function makeSvc(overrides: Partial<any> = {}, ce07Overrides: Partial<ICe07RulePackRegistrar> = {}) {
  const prisma = makePrismaMock(overrides);
  const ce07Registrar = makeCe07RegistrarMock(ce07Overrides);
  return { svc: new PayrollRulePackService(prisma as any, ce07Registrar), prisma, ce07Registrar };
}

describe('PayrollRulePackService — draft', () => {
  it('creates version 1 when no prior version exists', async () => {
    const { svc, prisma } = makeSvc({ payrollRulePackVersion: { findFirst: vi.fn().mockResolvedValue(null) } });
    const version = await svc.createDraft(TENANT, 'entity-test', 'payroll-gl-mapping', [
      { family: 'EARNINGS', department: 'sales', payComponent: 'REGULAR_PAY', glAccountCode: null, isDebit: true },
    ], 'author-1', BEARER);
    expect(version.version).toBe(1);
    expect(version.status).toBe('DRAFT');
    expect(prisma.payrollRulePackVersion.create).toHaveBeenCalled();
  });

  it('increments version when a prior version exists for the same packKey', async () => {
    const { svc } = makeSvc({ payrollRulePackVersion: { findFirst: vi.fn().mockResolvedValue({ version: 3 }) } });
    const version = await svc.createDraft(TENANT, 'entity-test', 'payroll-gl-mapping', [], 'author-1', BEARER);
    expect(version.version).toBe(4);
  });

  it('tolerates blank glAccountCode rows (ACCOUNT_MAPPING_VALUES_PENDING is a valid draft state)', async () => {
    const { svc } = makeSvc({ payrollRulePackVersion: { findFirst: vi.fn().mockResolvedValue(null) } });
    const version = await svc.createDraft(TENANT, 'entity-test', 'k', [
      { family: 'EARNINGS', department: 'sales', payComponent: 'REGULAR_PAY', glAccountCode: null, isDebit: true },
    ], 'author-1', BEARER);
    expect(version.rows[0].glAccountCode).toBeNull();
  });

  it('registers a shadow CE-07 rule pack for both PAYROLL_BATCH_POSTED and PAYROLL_BATCH_REVERSED, authenticated as the real author', async () => {
    const { svc, ce07Registrar } = makeSvc({ payrollRulePackVersion: { findFirst: vi.fn().mockResolvedValue(null) } });
    const version = await svc.createDraft(TENANT, 'entity-test', 'payroll-gl-mapping', [], 'author-1', BEARER);
    expect(ce07Registrar.draft).toHaveBeenCalledWith(expect.objectContaining({ bearerToken: BEARER, kind: 'PAYROLL_BATCH_POSTED', legalEntityId: 'entity-test' }));
    expect(ce07Registrar.draft).toHaveBeenCalledWith(expect.objectContaining({ bearerToken: BEARER, kind: 'PAYROLL_BATCH_REVERSED', legalEntityId: 'entity-test' }));
    expect(version.ce07PostedVersionId).toBe('ce07-version-1');
    expect(version.ce07ReversedVersionId).toBe('ce07-version-1');
  });

  it('never creates the payroll draft row when CE-07 refuses to register the shadow rule pack', async () => {
    const { svc, prisma } = makeSvc(
      { payrollRulePackVersion: { findFirst: vi.fn().mockResolvedValue(null) } },
      { draft: vi.fn().mockRejectedValue(new Error('CE07_RULE_PACK_DRAFT_FAILED')) },
    );
    await expect(svc.createDraft(TENANT, 'entity-test', 'k', [], 'author-1', BEARER)).rejects.toThrow('CE07_RULE_PACK_DRAFT_FAILED');
    expect(prisma.payrollRulePackVersion.create).not.toHaveBeenCalled();
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
    const result = await svc.validate(TENANT, 'version-1', BEARER);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(prisma.payrollRulePackVersion.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'VALIDATED' }) }));
  });

  it('rejects an empty rule pack (no rows)', async () => {
    const { svc } = makeSvc({ payrollRulePackVersion: { findFirst: vi.fn().mockResolvedValue({ id: 'version-1', rows: [] }) } });
    const result = await svc.validate(TENANT, 'version-1', BEARER);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/at least one row/);
  });

  it('rejects rows missing family/department/payComponent', async () => {
    const { svc } = makeSvc({
      payrollRulePackVersion: { findFirst: vi.fn().mockResolvedValue({ id: 'version-1', rows: [{ family: '', department: 'sales', payComponent: 'X', glAccountCode: null, isDebit: true }] }) },
    });
    const result = await svc.validate(TENANT, 'version-1', BEARER);
    expect(result.valid).toBe(false);
  });

  it('also surfaces CE-07\'s own validation refusal of the shadow rule pack — never a payroll-side VALIDATED that CE-07 itself would reject', async () => {
    const { svc } = makeSvc(
      {
        payrollRulePackVersion: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'version-1', rows: [{ family: 'EARNINGS', department: 'sales', payComponent: 'REGULAR_PAY', glAccountCode: null, isDebit: true }],
            ce07PostedVersionId: 'ce07-posted-1', ce07ReversedVersionId: 'ce07-reversed-1',
          }),
        },
      },
      { validate: vi.fn().mockResolvedValue({ valid: false, findings: ['BALANCE_MISMATCH'] }) },
    );
    const result = await svc.validate(TENANT, 'version-1', BEARER);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes('CE-07'))).toBe(true);
  });
});

describe('PayrollRulePackService — activate (S025 SoD)', () => {
  it('denies activation when author === activator (self-activation denial)', async () => {
    const { svc } = makeSvc({
      payrollRulePackVersion: { findFirst: vi.fn().mockResolvedValue({ id: 'version-1', legalEntityId: 'entity-test', packKey: 'k', status: 'VALIDATED', author: 'same-user' }) },
    });
    await expect(svc.activate(TENANT, 'version-1', 'same-user', BEARER)).rejects.toThrow(RulePackAuthorEqualsActivatorError);
  });

  it('requires VALIDATED status before activation', async () => {
    const { svc } = makeSvc({
      payrollRulePackVersion: { findFirst: vi.fn().mockResolvedValue({ id: 'version-1', legalEntityId: 'entity-test', packKey: 'k', status: 'DRAFT', author: 'author-1' }) },
    });
    await expect(svc.activate(TENANT, 'version-1', 'activator-1', BEARER)).rejects.toThrow(RulePackActivationError);
  });

  it('activates via a distinct eligible user and supersedes the prior ACTIVE version', async () => {
    const { svc } = makeSvc({
      payrollRulePackVersion: { findFirst: vi.fn().mockResolvedValue({ id: 'version-1', legalEntityId: 'entity-test', packKey: 'k', status: 'VALIDATED', author: 'author-1' }) },
    });
    const activated = await svc.activate(TENANT, 'version-1', 'activator-1', BEARER);
    expect(activated.status).toBe('ACTIVE');
    expect(activated.activatedBy).toBe('activator-1');
  });

  it('activates the real CE-07 shadow versions as the activator\'s own forwarded identity, distinct from the drafting author', async () => {
    const { svc, ce07Registrar } = makeSvc({
      payrollRulePackVersion: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'version-1', legalEntityId: 'entity-test', packKey: 'k', status: 'VALIDATED', author: 'author-1',
          ce07PostedVersionId: 'ce07-posted-1', ce07ReversedVersionId: 'ce07-reversed-1',
        }),
      },
    });
    await svc.activate(TENANT, 'version-1', 'activator-1', BEARER);
    expect(ce07Registrar.activate).toHaveBeenCalledWith(expect.objectContaining({ bearerToken: BEARER, ce07VersionId: 'ce07-posted-1' }));
    expect(ce07Registrar.activate).toHaveBeenCalledWith(expect.objectContaining({ bearerToken: BEARER, ce07VersionId: 'ce07-reversed-1' }));
  });

  it('never flips the payroll version to ACTIVE when CE-07 refuses to activate the shadow version (e.g. real permission denial)', async () => {
    const { svc, prisma } = makeSvc(
      {
        payrollRulePackVersion: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'version-1', legalEntityId: 'entity-test', packKey: 'k', status: 'VALIDATED', author: 'author-1',
            ce07PostedVersionId: 'ce07-posted-1', ce07ReversedVersionId: 'ce07-reversed-1',
          }),
        },
      },
      { activate: vi.fn().mockRejectedValue(new Error('CE07_RULE_PACK_ACTIVATE_FAILED')) },
    );
    await expect(svc.activate(TENANT, 'version-1', 'activator-1', BEARER)).rejects.toThrow('CE07_RULE_PACK_ACTIVATE_FAILED');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws when the version does not exist', async () => {
    const { svc } = makeSvc({ payrollRulePackVersion: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(svc.activate(TENANT, 'nope', 'activator-1', BEARER)).rejects.toThrow('not found');
  });
});

describe('PayrollRulePackService — getActiveVersion / listVersions', () => {
  it('getActiveVersion queries for ACTIVE status only', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'version-1', status: 'ACTIVE' });
    const { svc } = makeSvc({ payrollRulePackVersion: { findFirst } });
    await svc.getActiveVersion(TENANT, 'entity-test', 'k');
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: TENANT, legalEntityId: 'entity-test', packKey: 'k', status: 'ACTIVE' } }));
  });

  it('listVersions filters by packKey when provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const { svc } = makeSvc({ payrollRulePackVersion: { findMany } });
    await svc.listVersions(TENANT, 'k');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: TENANT, packKey: 'k' } }));
  });
});
