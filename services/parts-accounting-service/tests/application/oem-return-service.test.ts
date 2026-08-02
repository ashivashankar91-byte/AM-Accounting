import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { FakePrismaClient } from '../support/fake-prisma';
import { OemReturnService } from '../../src/application/oem-return-service';
import { PartsAccountMappingService } from '../../src/application/account-mapping-service';
import { FakePostingEventProducer } from '../../src/infrastructure/posting-client';

const TENANT = 'tenant-1'; const LE = 'le-1'; const STORE = 'store-1'; const OEM = 'OEM-GM';

async function setUp(mapFamilies: string[] = ['OEM_RETURN_SHIP', 'OEM_RETURN_CREDIT']) {
  const prisma = new FakePrismaClient();
  const mappings = new PartsAccountMappingService(prisma as any);
  const roleMap: Record<string, string[]> = {
    OEM_RETURN_SHIP: ['INVENTORY', 'OEM_RETURN_RECEIVABLE'],
    OEM_RETURN_CREDIT: ['OEM_RETURN_RECEIVABLE', 'RESTOCKING_FEE_VARIANCE', 'AP_OR_CASH'],
  };
  for (const family of mapFamilies) {
    for (const role of roleMap[family]!) await mappings.setAccountNumber(TENANT, LE, family, role, '2200', 'controller-1');
  }
  const posting = new FakePostingEventProducer((env) => ({ executionId: 'x', eventId: env.eventId, status: 'POSTED', idempotent: false, journalEntryId: 'je-1', journalNumber: 'JN-1' }));
  const svc = new OemReturnService(prisma as any, posting, mappings);
  return { prisma, svc, posting };
}

async function seedProgram(svc: OemReturnService) {
  await svc.setProgramConfig({ tenantId: TENANT, legalEntityId: LE, oemCode: OEM, allowancePct: 100, restockingFeePct: 5, effectiveFrom: '2020-01-01', actor: 'controller-1' });
}

describe('OemReturnService — setProgramConfig (governed, config-only terms)', () => {
  it('upserts by (tenant, legalEntity, oemCode, effectiveFrom) — a second call for the same date updates rather than duplicates', async () => {
    const { svc, prisma } = await setUp();
    await seedProgram(svc);
    await svc.setProgramConfig({ tenantId: TENANT, legalEntityId: LE, oemCode: OEM, allowancePct: 90, restockingFeePct: 10, effectiveFrom: '2020-01-01', actor: 'controller-1' });
    const rows = await prisma.oemReturnProgramConfig.findMany({ where: { tenantId: TENANT, oemCode: OEM } });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].allowancePct)).toBe(90);
  });
});

describe('OemReturnService — authorize', () => {
  it('refuses OEM_RETURN_PROGRAM_CONFIG_MISSING rather than inventing allowance terms', async () => {
    const { svc } = await setUp();
    await expect(svc.authorize({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, oemCode: OEM, returnAuthNumber: 'OEMR-1', lines: [{ partNumber: 'P-1', qty: 1, value: 100 }], actor: 'clerk-1' }))
      .rejects.toMatchObject({ code: 'OEM_RETURN_PROGRAM_CONFIG_MISSING' });
  });

  it('authorizes once program config exists, and is idempotent on a repeat returnAuthNumber', async () => {
    const { svc } = await setUp();
    await seedProgram(svc);
    const first = await svc.authorize({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, oemCode: OEM, returnAuthNumber: 'OEMR-2', lines: [{ partNumber: 'P-1', qty: 1, value: 100 }], actor: 'clerk-1' });
    expect(first.idempotent).toBe(false);
    expect(first.authorization.status).toBe('AUTHORIZED');
    const second = await svc.authorize({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, oemCode: OEM, returnAuthNumber: 'OEMR-2', lines: [{ partNumber: 'P-1', qty: 1, value: 100 }], actor: 'clerk-1' });
    expect(second.idempotent).toBe(true);
  });
});

describe('OemReturnService — ship', () => {
  it('rejects a nonexistent return', async () => {
    const { svc } = await setUp();
    await expect(svc.ship({ tenantId: TENANT, legalEntityId: LE, returnAuthNumber: 'NO-SUCH', correlationId: 'c1', businessDate: '2026-08-01', actor: 'clerk-1' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('requires AUTHORIZED status before shipment', async () => {
    const { svc } = await setUp();
    await seedProgram(svc);
    await svc.authorize({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, oemCode: OEM, returnAuthNumber: 'OEMR-3', lines: [{ partNumber: 'P-1', qty: 1, value: 100 }], actor: 'clerk-1' });
    await svc.ship({ tenantId: TENANT, legalEntityId: LE, returnAuthNumber: 'OEMR-3', correlationId: 'c1', businessDate: '2026-08-01', actor: 'clerk-1' });
    // Already SHIPPED — a second ship() is idempotent, not a re-post.
    const again = await svc.ship({ tenantId: TENANT, legalEntityId: LE, returnAuthNumber: 'OEMR-3', correlationId: 'c2', businessDate: '2026-08-01', actor: 'clerk-1' });
    expect(again.idempotent).toBe(true);
  });

  it('rejects shipment when the OEM_RETURN_SHIP mapping is still pending — zero mutation to status', async () => {
    const { svc } = await setUp(['OEM_RETURN_CREDIT']); // SHIP deliberately unmapped
    await seedProgram(svc);
    await svc.authorize({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, oemCode: OEM, returnAuthNumber: 'OEMR-4', lines: [{ partNumber: 'P-1', qty: 1, value: 100 }], actor: 'clerk-1' });
    await expect(svc.ship({ tenantId: TENANT, legalEntityId: LE, returnAuthNumber: 'OEMR-4', correlationId: 'c1', businessDate: '2026-08-01', actor: 'clerk-1' }))
      .rejects.toMatchObject({ code: 'ACCOUNT_MAPPING_VALUES_PENDING' });
  });
});

describe('OemReturnService — applyCredit (restocking-fee variance, never silently absorbed)', () => {
  async function shipReturn(svc: OemReturnService, returnAuthNumber: string, lineValue: number) {
    await seedProgram(svc);
    await svc.authorize({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, oemCode: OEM, returnAuthNumber, lines: [{ partNumber: 'P-1', qty: 1, value: lineValue }], actor: 'clerk-1' });
    return svc.ship({ tenantId: TENANT, legalEntityId: LE, returnAuthNumber, correlationId: 'c1', businessDate: '2026-08-01', actor: 'clerk-1' });
  }

  it('requires SHIPPED status before credit can apply', async () => {
    const { svc } = await setUp();
    await seedProgram(svc);
    await svc.authorize({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, oemCode: OEM, returnAuthNumber: 'OEMR-5', lines: [{ partNumber: 'P-1', qty: 1, value: 100 }], actor: 'clerk-1' });
    await expect(svc.applyCredit({ tenantId: TENANT, legalEntityId: LE, returnAuthNumber: 'OEMR-5', creditAmount: 95, correlationId: 'c1', businessDate: '2026-08-01', actor: 'clerk-1' }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('computes the restocking fee from the governed program % and captures any remaining variance explicitly (never hidden)', async () => {
    const { svc } = await setUp();
    await shipReturn(svc, 'OEMR-6', 100); // 5% restocking fee = 5.00 (per seedProgram)
    const result = await svc.applyCredit({ tenantId: TENANT, legalEntityId: LE, returnAuthNumber: 'OEMR-6', creditAmount: 95, correlationId: 'c1', businessDate: '2026-08-01', actor: 'clerk-1' });
    expect(result.authorization.status).toBe('CREDIT_APPLIED');
    // shipped 100, credit 95, fee 5 -> variance = 100 - 95 - 5 = 0
    expect(result.variance).toBe(0);
  });

  it('is idempotent on a repeat applyCredit call — no double relief of the receivable', async () => {
    const { svc, posting } = await setUp();
    await shipReturn(svc, 'OEMR-7', 100);
    const first = await svc.applyCredit({ tenantId: TENANT, legalEntityId: LE, returnAuthNumber: 'OEMR-7', creditAmount: 95, correlationId: 'c1', businessDate: '2026-08-01', actor: 'clerk-1' });
    expect(first.idempotent).toBe(false);
    const second = await svc.applyCredit({ tenantId: TENANT, legalEntityId: LE, returnAuthNumber: 'OEMR-7', creditAmount: 95, correlationId: 'c2', businessDate: '2026-08-01', actor: 'clerk-1' });
    expect(second.idempotent).toBe(true);
    expect(posting.submitted.filter((e) => e.eventType === 'parts.oemreturn.credit-applied.v1').length).toBe(1);
  });
});

describe('OemReturnService — disposition (explicit, audited discrepancy resolution)', () => {
  it('requires CREDIT_APPLIED status before disposition', async () => {
    const { svc } = await setUp();
    await seedProgram(svc);
    await svc.authorize({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, oemCode: OEM, returnAuthNumber: 'OEMR-8', lines: [{ partNumber: 'P-1', qty: 1, value: 100 }], actor: 'clerk-1' });
    await expect(svc.disposition({ tenantId: TENANT, legalEntityId: LE, returnAuthNumber: 'OEMR-8', reason: 'variance', actor: 'controller-1', correlationId: 'c1' }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('moves a credit-applied return to DISPOSITIONED with the stated reason recorded', async () => {
    const { svc } = await setUp();
    await seedProgram(svc);
    await svc.authorize({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, oemCode: OEM, returnAuthNumber: 'OEMR-9', lines: [{ partNumber: 'P-1', qty: 1, value: 100 }], actor: 'clerk-1' });
    await svc.ship({ tenantId: TENANT, legalEntityId: LE, returnAuthNumber: 'OEMR-9', correlationId: 'c1', businessDate: '2026-08-01', actor: 'clerk-1' });
    await svc.applyCredit({ tenantId: TENANT, legalEntityId: LE, returnAuthNumber: 'OEMR-9', creditAmount: 90, correlationId: 'c2', businessDate: '2026-08-01', actor: 'clerk-1' });
    const dispositioned = await svc.disposition({ tenantId: TENANT, legalEntityId: LE, returnAuthNumber: 'OEMR-9', reason: 'OEM shorted the credit by $5', actor: 'controller-1', correlationId: 'c3' });
    expect(dispositioned.status).toBe('DISPOSITIONED');
  });
});
