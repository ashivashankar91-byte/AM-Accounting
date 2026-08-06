import 'reflect-metadata';
import { describe, it, expect } from 'vitest';

import { AccountMappingService } from '../../src/application/account-mapping-service';
import { FakePrismaClient } from '../support/fake-prisma';
import { AccountMappingPendingError } from '../../src/domain/errors';
import { ACCOUNT_MAPPING_VALUES_PENDING, EVENT_FAMILY, TEST_FIXTURE_TENANT_ID } from '../../src/domain/account-mapping-roles';

function makeService() {
  const prisma = new FakePrismaClient();
  const service = new AccountMappingService(prisma as any);
  return { prisma, service };
}

describe('AccountMappingService — S023 governed matrix', () => {
  it('lookup() creates a new row as ACCOUNT_MAPPING_VALUES_PENDING the first time it is queried', async () => {
    const { service } = makeService();
    const row = await service.lookup('t1', 'le1', EVENT_FAMILY.SUBLET_ACCRUAL, 'COS_SUBLET');
    expect(row.status).toBe(ACCOUNT_MAPPING_VALUES_PENDING);
  });

  it('lookup() does not create a duplicate row on repeated calls for the same (tenant, entity, family, role)', async () => {
    const { prisma, service } = makeService();
    await service.lookup('t1', 'le1', EVENT_FAMILY.SUBLET_ACCRUAL, 'COS_SUBLET');
    await service.lookup('t1', 'le1', EVENT_FAMILY.SUBLET_ACCRUAL, 'COS_SUBLET');
    const rows = await (prisma as any).fixedOpsAccountMapping.findMany({ where: { tenantId: 't1', eventFamily: EVENT_FAMILY.SUBLET_ACCRUAL, role: 'COS_SUBLET' } });
    expect(rows).toHaveLength(1);
  });

  it('assertResolved() throws AccountMappingPendingError while the role is still pending', async () => {
    const { service } = makeService();
    await expect(service.assertResolved('t1', 'le1', EVENT_FAMILY.SUBLET_ACCRUAL, 'COS_SUBLET')).rejects.toThrow(AccountMappingPendingError);
  });

  it('assertResolved() succeeds once setAccountNumber() has resolved the role', async () => {
    const { service } = makeService();
    await service.setAccountNumber('t1', 'le1', EVENT_FAMILY.SUBLET_ACCRUAL, 'COS_SUBLET', '50200', 'controller');
    const status = await service.assertResolved('t1', 'le1', EVENT_FAMILY.SUBLET_ACCRUAL, 'COS_SUBLET');
    expect(status).toBe('RESOLVED');
  });

  it('assertFamilyResolved() rejects on the FIRST unresolved role even when others in the family are already resolved — never a partial post', async () => {
    const { service } = makeService();
    await service.setAccountNumber('t1', 'le1', EVENT_FAMILY.SUBLET_ACCRUAL, 'COS_SUBLET', '50200', 'controller');
    // SUBLET_ACCRUAL role tags are ['COS_SUBLET', 'SUBLET_ACCRUAL'] per ROLES_BY_FAMILY — SUBLET_ACCRUAL role left pending.
    await expect(service.assertFamilyResolved('t1', 'le1', EVENT_FAMILY.SUBLET_ACCRUAL)).rejects.toThrow(AccountMappingPendingError);
  });

  it('assertFamilyResolved() succeeds once every role for the family is resolved', async () => {
    const { service } = makeService();
    await service.setAccountNumber('t1', 'le1', EVENT_FAMILY.SUBLET_ACCRUAL, 'COS_SUBLET', '50200', 'controller');
    await service.setAccountNumber('t1', 'le1', EVENT_FAMILY.SUBLET_ACCRUAL, 'SUBLET_ACCRUAL', '22000', 'controller');
    await expect(service.assertFamilyResolved('t1', 'le1', EVENT_FAMILY.SUBLET_ACCRUAL)).resolves.toBeUndefined();
  });

  it('setAccountNumber() upserts — resolving the same role twice updates the account number rather than creating a duplicate row', async () => {
    const { prisma, service } = makeService();
    await service.setAccountNumber('t1', 'le1', EVENT_FAMILY.SUBLET_ACCRUAL, 'COS_SUBLET', '50200', 'controller');
    await service.setAccountNumber('t1', 'le1', EVENT_FAMILY.SUBLET_ACCRUAL, 'COS_SUBLET', '50999', 'controller');

    const rows = await (prisma as any).fixedOpsAccountMapping.findMany({ where: { tenantId: 't1', eventFamily: EVENT_FAMILY.SUBLET_ACCRUAL, role: 'COS_SUBLET' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].accountNumber).toBe('50999');
    expect(rows[0].status).toBe('RESOLVED');
  });

  it('refuses to edit the labeled certification-fixture tenant mapping (S023 standing rule)', async () => {
    const { service } = makeService();
    await expect(service.setAccountNumber(TEST_FIXTURE_TENANT_ID, 'le1', EVENT_FAMILY.SUBLET_ACCRUAL, 'COS_SUBLET', '50200', 'controller')).rejects.toThrow();
  });

  it('listForEntity() returns only rows for the requested legal entity', async () => {
    const { service } = makeService();
    await service.setAccountNumber('t1', 'le1', EVENT_FAMILY.SUBLET_ACCRUAL, 'COS_SUBLET', '50200', 'controller');
    await service.setAccountNumber('t1', 'le2', EVENT_FAMILY.SUBLET_ACCRUAL, 'COS_SUBLET', '50201', 'controller');

    const rows = await service.listForEntity('t1', 'le1');
    expect(rows).toHaveLength(1);
    expect(rows[0].legalEntityId).toBe('le1');
  });
});
