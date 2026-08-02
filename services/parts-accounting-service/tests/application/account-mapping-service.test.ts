import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { FakePrismaClient } from '../support/fake-prisma';
import { PartsAccountMappingService } from '../../src/application/account-mapping-service';
import { AccountMappingPendingError } from '../../src/domain/errors';
import { CERTIFICATION_TEST_TENANT_ID } from '../../src/domain/event-families';

describe('PartsAccountMappingService', () => {
  it('creates a blank ACCOUNT_MAPPING_VALUES_PENDING row on first reference, never a real account number', async () => {
    const prisma = new FakePrismaClient();
    const svc = new PartsAccountMappingService(prisma as any);
    const row = await svc.lookup('tenant-1', 'le-1', 'PARTS_RECEIPT', 'INVENTORY');
    expect(row.status).toBe('ACCOUNT_MAPPING_VALUES_PENDING');
    expect(row.accountNumber).toBeNull();
  });

  it('resolveAll throws AccountMappingPendingError deterministically when any role is unresolved — never a silent proceed', async () => {
    const prisma = new FakePrismaClient();
    const svc = new PartsAccountMappingService(prisma as any);
    await expect(svc.resolveAll('tenant-1', 'le-1', 'PARTS_RECEIPT', ['INVENTORY', 'AP_ACCRUAL'])).rejects.toBeInstanceOf(AccountMappingPendingError);
  });

  it('resolves once an authorized tenant-configured account number is set', async () => {
    const prisma = new FakePrismaClient();
    const svc = new PartsAccountMappingService(prisma as any);
    await svc.setAccountNumber('tenant-1', 'le-1', 'PARTS_RECEIPT', 'INVENTORY', '1310', 'controller-1');
    await svc.setAccountNumber('tenant-1', 'le-1', 'PARTS_RECEIPT', 'AP_ACCRUAL', '2110', 'controller-1');
    const resolved = await svc.resolveAll('tenant-1', 'le-1', 'PARTS_RECEIPT', ['INVENTORY', 'AP_ACCRUAL']);
    expect(resolved).toEqual({ INVENTORY: '1310', AP_ACCRUAL: '2110' });
  });

  it('the labeled certification tenant carries an opaque, non-numeric fixture value — never a real production account number', async () => {
    const prisma = new FakePrismaClient();
    const svc = new PartsAccountMappingService(prisma as any);
    const resolved = await svc.resolveAll(CERTIFICATION_TEST_TENANT_ID, 'le-1', 'PARTS_RECEIPT', ['INVENTORY', 'AP_ACCRUAL']);
    expect(resolved.INVENTORY).toBe('TEST-FIXTURE-MAPPING-RESOLVED');
    expect(Number.isNaN(Number(resolved.INVENTORY))).toBe(true); // opaque, not a numeric GL account
  });
});
