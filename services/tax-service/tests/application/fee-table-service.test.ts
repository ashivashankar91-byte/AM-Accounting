import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { FakePrismaClient } from '../support/fake-prisma';
import { FeeTableService } from '../../src/application/fee-table-service';
import { OverlappingEffectiveDateError, ReferencedRowCannotBeDeactivatedError, TaxServiceValidationError } from '../../src/domain/errors';

function makeService() {
  const prisma = new FakePrismaClient();
  return { prisma, service: new FeeTableService(prisma as any) };
}

const tags = [{ itemClassCode: 'TIRE', documentTypeCode: null }];

describe('FeeTableService', () => {
  it('creates a fee table with applicability tags', async () => {
    const { service } = makeService();
    const created = await service.create('tenant-1', {
      legalEntityId: 'entity-1', jurisdictionRef: 'STATE-XX', feeCode: 'TIRE_FEE', name: 'Tire Fee',
      basis: 'FIXED_PER_UNIT', amount: '5.00', effectiveFrom: '2025-01-01', effectiveTo: null, applicabilityTags: tags,
    }, 'tester');
    expect(created.applicabilityTags).toHaveLength(1);
  });

  it('rejects create when both amount and ratePercent basis validation fails', async () => {
    const { service } = makeService();
    await expect(service.create('tenant-1', {
      legalEntityId: 'entity-1', jurisdictionRef: 'STATE-XX', feeCode: 'TIRE_FEE', name: 'Tire Fee',
      basis: 'FIXED_PER_UNIT', amount: null, effectiveFrom: '2025-01-01', applicabilityTags: tags,
    }, 'tester')).rejects.toThrow(TaxServiceValidationError);
  });

  it('rejects an overlapping effective range for the same feeCode+jurisdiction (AC2)', async () => {
    const { service } = makeService();
    await service.create('tenant-1', { legalEntityId: 'entity-1', jurisdictionRef: 'STATE-XX', feeCode: 'TIRE_FEE', name: 'Tire Fee', basis: 'FIXED_PER_UNIT', amount: '5.00', effectiveFrom: '2025-01-01', effectiveTo: '2025-06-30', applicabilityTags: tags }, 'tester');
    await expect(service.create('tenant-1', { legalEntityId: 'entity-1', jurisdictionRef: 'STATE-XX', feeCode: 'TIRE_FEE', name: 'Tire Fee', basis: 'FIXED_PER_UNIT', amount: '6.00', effectiveFrom: '2025-05-01', effectiveTo: null, applicabilityTags: tags }, 'tester'))
      .rejects.toThrow(OverlappingEffectiveDateError);
  });

  it('resolves the correct fee version across a boundary businessDate', async () => {
    const { service } = makeService();
    await service.create('tenant-1', { legalEntityId: 'entity-1', jurisdictionRef: 'STATE-XX', feeCode: 'TIRE_FEE', name: 'Tire Fee', basis: 'FIXED_PER_UNIT', amount: '4.00', effectiveFrom: '2024-01-01', effectiveTo: '2024-12-31', applicabilityTags: tags }, 'tester');
    await service.create('tenant-1', { legalEntityId: 'entity-1', jurisdictionRef: 'STATE-XX', feeCode: 'TIRE_FEE', name: 'Tire Fee', basis: 'FIXED_PER_UNIT', amount: '5.00', effectiveFrom: '2025-01-01', effectiveTo: null, applicabilityTags: tags }, 'tester');

    const before = await service.resolve('tenant-1', 'entity-1', '2024-06-01', 'TIRE', 'COUNTER_SALE');
    expect(before[0]?.amount).toBe('4.00');
    const after = await service.resolve('tenant-1', 'entity-1', '2025-06-01', 'TIRE', 'COUNTER_SALE');
    expect(after[0]?.amount).toBe('5.00');
  });

  it('empty fee table truthfully resolves to nothing — no error, no estimate (S125 AC3)', async () => {
    const { service } = makeService();
    expect(await service.resolve('tenant-1', 'entity-1', '2025-06-01', 'TIRE', 'COUNTER_SALE')).toEqual([]);
  });

  it('records a real usage reference only for non-preview (documentContext) resolution', async () => {
    const { prisma, service } = makeService();
    await service.create('tenant-1', { legalEntityId: 'entity-1', jurisdictionRef: 'STATE-XX', feeCode: 'TIRE_FEE', name: 'Tire Fee', basis: 'FIXED_PER_UNIT', amount: '5.00', effectiveFrom: '2025-01-01', effectiveTo: null, applicabilityTags: tags }, 'tester');

    // Preview (no documentContext) records nothing.
    await service.resolve('tenant-1', 'entity-1', '2025-06-01', 'TIRE', 'COUNTER_SALE');
    expect(await prisma.feeTableUsageReference.count({})).toBe(0);

    // Real transaction context records a usage reference.
    await service.resolve('tenant-1', 'entity-1', '2025-06-01', 'TIRE', 'COUNTER_SALE', { documentType: 'COUNTER_SALE', documentId: 'doc-1' });
    expect(await prisma.feeTableUsageReference.count({})).toBe(1);
  });

  it('deactivate is blocked with a 409-mapped error once referenced, reporting the real reference count', async () => {
    const { service } = makeService();
    const created = await service.create('tenant-1', { legalEntityId: 'entity-1', jurisdictionRef: 'STATE-XX', feeCode: 'TIRE_FEE', name: 'Tire Fee', basis: 'FIXED_PER_UNIT', amount: '5.00', effectiveFrom: '2025-01-01', effectiveTo: null, applicabilityTags: tags }, 'tester');
    await service.resolve('tenant-1', 'entity-1', '2025-06-01', 'TIRE', 'COUNTER_SALE', { documentType: 'COUNTER_SALE', documentId: 'doc-1' });
    await service.resolve('tenant-1', 'entity-1', '2025-06-01', 'TIRE', 'COUNTER_SALE', { documentType: 'COUNTER_SALE', documentId: 'doc-2' });

    try {
      await service.deactivate('tenant-1', created.id, 'tester');
      expect.fail('expected deactivate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ReferencedRowCannotBeDeactivatedError);
      expect((err as ReferencedRowCannotBeDeactivatedError).referenceCount).toBe(2);
    }
  });

  it('deactivate succeeds (never hard-delete) when there are zero references', async () => {
    const { service } = makeService();
    const created = await service.create('tenant-1', { legalEntityId: 'entity-1', jurisdictionRef: 'STATE-XX', feeCode: 'TIRE_FEE', name: 'Tire Fee', basis: 'FIXED_PER_UNIT', amount: '5.00', effectiveFrom: '2025-01-01', effectiveTo: null, applicabilityTags: tags }, 'tester');
    const deactivated = await service.deactivate('tenant-1', created.id, 'tester');
    expect(deactivated.active).toBe(false);
    // Row still exists (soft-deactivate, not hard delete).
    const fetched = await service.getById('tenant-1', created.id);
    expect(fetched).toBeTruthy();
  });
});
