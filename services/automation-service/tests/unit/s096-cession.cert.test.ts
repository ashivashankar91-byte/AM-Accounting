/**
 * CERTIFICATION TEST — S096 Reinsurance/DOWC Cession
 *
 * Certifies:
 *  1. Cession statement is entered verbatim — figures are never estimated
 *  2. Evidence reference is mandatory — missing ref produces a typed failure
 *  3. Tenant scope — tenantId in every Prisma write
 *  4. Position roll-up correctly sums premium + reserve - claim per treaty
 *  5. Posting linkage — approve() links statement to an automation item
 *  6. SoD — automation identity cannot approve a cession posting
 */

import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CessionService } from '../../src/application/cession-service';
import { AutomationError } from '../../src/domain/errors';

const TENANT = 'tenant-xyz';
const LE = 'le-2';

function makeCapabilities() {
  return { requireConfigured: vi.fn().mockResolvedValue({ currentAuthority: 'EXECUTE_WITH_APPROVAL' }) };
}

function makeItems() {
  const item = { id: 'item-1', tenantId: TENANT };
  return {
    create: vi.fn().mockResolvedValue({ item }),
    approve: vi.fn().mockResolvedValue({ id: 'item-1' }),
  };
}

function makePrisma() {
  return {
    cessionStatement: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'stmt-1', ...data })),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'stmt-1', state: 'APPROVED', ...data })),
    },
  };
}

function makeEvents() {
  return { publish: vi.fn().mockResolvedValue(undefined) };
}

const STATEMENT_INPUT = {
  tenantId: TENANT, legalEntityId: LE,
  statementDate: '2026-06-30',
  programAdminRef: 'ADMIN-001', treatyCode: 'TREATY-A',
  premiumCession: '12000', reserveCession: '3000', claimCession: '1500',
  statementEvidenceRef: 'evidence:stmt:2026-06', actor: 'user-ops',
};

describe('S096 — Reinsurance/DOWC Cession', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let events: ReturnType<typeof makeEvents>;
  let items: ReturnType<typeof makeItems>;
  let service: CessionService;

  beforeEach(() => {
    prisma = makePrisma();
    events = makeEvents();
    items = makeItems();
    service = new CessionService(prisma as any, events as any, makeCapabilities() as any, items as any);
  });

  it('creates a cession statement with tenantId in the create data', async () => {
    const stmt = await service.enter(STATEMENT_INPUT);
    const createCall = prisma.cessionStatement.create.mock.calls[0][0];
    expect(createCall.data.tenantId).toBe(TENANT);
    expect(stmt.premiumCession).toBe('12000');
    expect(stmt.reserveCession).toBe('3000');
    expect(stmt.claimCession).toBe('1500');
  });

  it('rejects entry without an evidence reference — statement cannot float without a source', async () => {
    await expect(
      service.enter({ ...STATEMENT_INPUT, statementEvidenceRef: '' }),
    ).rejects.toMatchObject({ code: 'STATEMENT_EVIDENCE_REQUIRED' });
  });

  it('approve() creates an automation item linked to the statement', async () => {
    prisma.cessionStatement.findFirst.mockResolvedValue({
      id: 'stmt-1', tenantId: TENANT, legalEntityId: LE,
      treatyCode: 'TREATY-A', programAdminRef: 'ADMIN-001',
      statementDate: new Date('2026-06-30'),
      premiumCession: { toString: () => '12000' },
      reserveCession: { toString: () => '3000' },
      claimCession: { toString: () => '1500' },
      statementEvidenceRef: 'evidence:stmt:2026-06',
      state: 'ENTERED',
    });
    await service.approve({
      tenantId: TENANT, id: 'stmt-1', approver: 'user-controller',
      cededPremiumAccountCode: '5100', cededReserveAccountCode: '5101', offsetAccountCode: '2050',
    });
    expect(items.create).toHaveBeenCalledOnce();
    expect(items.approve).toHaveBeenCalledOnce();
    const updateCall = prisma.cessionStatement.update.mock.calls[0][0];
    expect(updateCall.data.postingItemId).toBe('item-1');
  });

  it('rejects approval by an automation identity — SoD structural guard', async () => {
    prisma.cessionStatement.findFirst.mockResolvedValue({
      id: 'stmt-1', tenantId: TENANT, legalEntityId: LE,
      treatyCode: 'TREATY-A', programAdminRef: 'ADMIN-001',
      statementDate: new Date('2026-06-30'),
      premiumCession: { toString: () => '12000' },
      reserveCession: { toString: () => '3000' },
      claimCession: { toString: () => '1500' },
      statementEvidenceRef: 'evidence:stmt:2026-06',
      state: 'ENTERED',
    });
    await expect(
      service.approve({
        tenantId: TENANT, id: 'stmt-1', approver: 'automation:ce17',
        cededPremiumAccountCode: '5100', cededReserveAccountCode: '5101', offsetAccountCode: '2050',
      }),
    ).rejects.toMatchObject({ code: 'SOD_VIOLATION' });
  });

  it('position() roll-up nets premium + reserve - claim per treaty', async () => {
    prisma.cessionStatement.findMany.mockResolvedValue([
      {
        treatyCode: 'TREATY-A', statementEvidenceRef: 'e1',
        premiumCession: '12000', reserveCession: '3000', claimCession: '1500',
        statementDate: new Date('2026-06-30'),
      },
      {
        treatyCode: 'TREATY-A', statementEvidenceRef: 'e2',
        premiumCession: '8000', reserveCession: '2000', claimCession: '500',
        statementDate: new Date('2026-07-31'),
      },
    ]);
    const pos = await service.position(TENANT, LE, 'TREATY-A');
    expect(pos.configured).toBe(true);
    const treaty = pos.treaties[0];
    // net = (12000+8000) + (3000+2000) - (1500+500) = 20000+5000-2000 = 23000
    expect(Number(treaty.netPosition)).toBe(23000);
    expect(treaty.evidenceRefs).toHaveLength(2);
  });
});
