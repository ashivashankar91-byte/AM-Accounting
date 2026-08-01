import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { FakePrismaClient } from '../support/fake-prisma';
import { TaxAccountMappingService } from '../../src/application/tax-account-mapping-service';
import { AccountMappingPendingError } from '../../src/domain/errors';
import { ACCOUNT_MAPPING_VALUES_PENDING, TEST_FIXTURE_MAPPING_RESOLVED } from '../../src/domain/tax-attachment';

function makeService() {
  const prisma = new FakePrismaClient();
  return { prisma, service: new TaxAccountMappingService(prisma as any) };
}

describe('TaxAccountMappingService (S023 boundary)', () => {
  it('lookup auto-creates a blank row starting PENDING for a real tenant (new rows always start blank)', async () => {
    const { prisma, service } = makeService();
    const row = await service.lookup('real-dealer-tenant', 'entity-1', 'COUNTER_SALE');
    expect(row.mappingStatus).toBe(ACCOUNT_MAPPING_VALUES_PENDING);
    expect(await prisma.taxAccountMappingRef.count({})).toBe(1);
  });

  it('assertResolved throws a deterministic typed rejection while mapping is PENDING — never a silent proceed', async () => {
    const { service } = makeService();
    await expect(service.assertResolved('real-dealer-tenant', 'entity-1', 'COUNTER_SALE')).rejects.toThrow(AccountMappingPendingError);
  });

  it('subsequent lookups return the same row, not a fresh blank one', async () => {
    const { prisma, service } = makeService();
    await service.lookup('real-dealer-tenant', 'entity-1', 'COUNTER_SALE');
    await service.lookup('real-dealer-tenant', 'entity-1', 'COUNTER_SALE');
    expect(await prisma.taxAccountMappingRef.count({})).toBe(1);
  });

  it('the labeled TEST-TENANT fixture may carry a resolved, still-opaque mapping status', async () => {
    const { prisma, service } = makeService();
    await prisma.taxAccountMappingRef.create({
      data: { tenantId: 'TEST-TENANT-CE10-CERTIFICATION-ONLY', legalEntityId: 'entity-1', eventType: 'COUNTER_SALE', feeCode: null, mappingStatus: TEST_FIXTURE_MAPPING_RESOLVED },
    });
    const resolved = await service.assertResolved('TEST-TENANT-CE10-CERTIFICATION-ONLY', 'entity-1', 'COUNTER_SALE');
    expect(resolved).toBe(TEST_FIXTURE_MAPPING_RESOLVED);
    // Opaque — must not look like a real GL account number.
    expect(resolved).not.toMatch(/^\d+$/);
  });

  it('distinguishes mapping rows by feeCode within the same (tenantId, legalEntityId, eventType)', async () => {
    const { prisma, service } = makeService();
    await service.lookup('real-dealer-tenant', 'entity-1', 'FEE_EVENT', 'TIRE_FEE');
    await service.lookup('real-dealer-tenant', 'entity-1', 'FEE_EVENT', 'BATTERY_FEE');
    expect(await prisma.taxAccountMappingRef.count({})).toBe(2);
  });
});
