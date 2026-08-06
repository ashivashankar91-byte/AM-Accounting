import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { FakePrismaClient } from '../support/fake-prisma';
import { JurisdictionRegistrationService } from '../../src/application/jurisdiction-registration-service';
import { OverlappingEffectiveDateError, CrossEntityAccessDeniedError, OptimisticConcurrencyError } from '../../src/domain/errors';

function makeService() {
  const prisma = new FakePrismaClient();
  return { prisma, service: new JurisdictionRegistrationService(prisma as any) };
}

describe('JurisdictionRegistrationService', () => {
  it('creates a registration', async () => {
    const { service } = makeService();
    const created = await service.create('tenant-1', {
      legalEntityId: 'entity-1', jurisdictionRef: 'STATE-XX', effectiveFrom: '2025-01-01', effectiveTo: null,
    }, 'tester');
    expect(created.jurisdictionRef).toBe('STATE-XX');
    expect(created.version).toBe(1);
  });

  it('rejects an overlapping effective range at create (AC2)', async () => {
    const { service } = makeService();
    await service.create('tenant-1', { legalEntityId: 'entity-1', jurisdictionRef: 'STATE-XX', effectiveFrom: '2025-01-01', effectiveTo: '2025-06-30' }, 'tester');
    await expect(service.create('tenant-1', { legalEntityId: 'entity-1', jurisdictionRef: 'STATE-XX', effectiveFrom: '2025-05-01', effectiveTo: null }, 'tester'))
      .rejects.toThrow(OverlappingEffectiveDateError);
  });

  it('allows non-overlapping consecutive versions for the same jurisdiction', async () => {
    const { service } = makeService();
    await service.create('tenant-1', { legalEntityId: 'entity-1', jurisdictionRef: 'STATE-XX', effectiveFrom: '2025-01-01', effectiveTo: '2025-06-30' }, 'tester');
    const second = await service.create('tenant-1', { legalEntityId: 'entity-1', jurisdictionRef: 'STATE-XX', effectiveFrom: '2025-07-01', effectiveTo: null }, 'tester');
    expect(second.jurisdictionRef).toBe('STATE-XX');
  });

  it('update excludes itself from overlap detection but still detects overlap with other siblings', async () => {
    const { service } = makeService();
    const a = await service.create('tenant-1', { legalEntityId: 'entity-1', jurisdictionRef: 'STATE-XX', effectiveFrom: '2025-01-01', effectiveTo: '2025-06-30' }, 'tester');
    const b = await service.create('tenant-1', { legalEntityId: 'entity-1', jurisdictionRef: 'STATE-XX', effectiveFrom: '2025-07-01', effectiveTo: null }, 'tester');

    // No-op update to `a` (same dates) must not conflict with itself.
    const updated = await service.update('tenant-1', 'entity-1', a.id, { effectiveFrom: '2025-01-01', effectiveTo: '2025-06-30' }, a.version, 'tester');
    expect(updated.version).toBe(2);

    // Extending `a` into `b`'s range must be rejected.
    await expect(service.update('tenant-1', 'entity-1', a.id, { effectiveTo: '2025-08-01' }, updated.version, 'tester'))
      .rejects.toThrow(OverlappingEffectiveDateError);
  });

  it('rejects update with a stale version (optimistic concurrency)', async () => {
    const { service } = makeService();
    const a = await service.create('tenant-1', { legalEntityId: 'entity-1', jurisdictionRef: 'STATE-XX', effectiveFrom: '2025-01-01', effectiveTo: null }, 'tester');
    await expect(service.update('tenant-1', 'entity-1', a.id, { jurisdictionLevel: 'STATE' }, 99, 'tester')).rejects.toThrow(OptimisticConcurrencyError);
  });

  it('denies cross-entity access at the application layer (legal-entity scoping)', async () => {
    const { service } = makeService();
    const a = await service.create('tenant-1', { legalEntityId: 'entity-1', jurisdictionRef: 'STATE-XX', effectiveFrom: '2025-01-01', effectiveTo: null }, 'tester');
    await expect(service.getById('tenant-1', 'entity-DIFFERENT', a.id)).rejects.toThrow(CrossEntityAccessDeniedError);
  });

  it('history-proof: assertNoOverlap prevents corrupting historical (backdated) versions too', async () => {
    const { service } = makeService();
    await service.create('tenant-1', { legalEntityId: 'entity-1', jurisdictionRef: 'STATE-XX', effectiveFrom: '2020-01-01', effectiveTo: '2020-12-31' }, 'tester');
    await expect(service.create('tenant-1', { legalEntityId: 'entity-1', jurisdictionRef: 'STATE-XX', effectiveFrom: '2020-06-01', effectiveTo: '2020-08-01' }, 'tester'))
      .rejects.toThrow(OverlappingEffectiveDateError);
  });

  it('deactivates (never deletes) a registration, requiring a reason and current version', async () => {
    const { service, prisma } = makeService();
    const a = await service.create('tenant-1', { legalEntityId: 'entity-1', jurisdictionRef: 'STATE-XX', effectiveFrom: '2025-01-01', effectiveTo: null }, 'tester');
    const versionBeforeDeactivate = a.version;
    const deactivated = await service.deactivate('tenant-1', 'entity-1', a.id, versionBeforeDeactivate, 'no longer registered', 'tester');
    expect(deactivated.active).toBe(false);
    expect(deactivated.version).toBe(versionBeforeDeactivate + 1);
    // Row still exists — never a hard delete.
    const stillThere = await prisma.jurisdictionRegistration.findFirst({ where: { id: a.id, tenantId: 'tenant-1' } });
    expect(stillThere).not.toBeNull();
  });

  it('rejects deactivate without a reason', async () => {
    const { service } = makeService();
    const a = await service.create('tenant-1', { legalEntityId: 'entity-1', jurisdictionRef: 'STATE-XX', effectiveFrom: '2025-01-01', effectiveTo: null }, 'tester');
    await expect(service.deactivate('tenant-1', 'entity-1', a.id, a.version, '', 'tester')).rejects.toThrow();
  });

  it('rejects deactivate with a stale version', async () => {
    const { service } = makeService();
    const a = await service.create('tenant-1', { legalEntityId: 'entity-1', jurisdictionRef: 'STATE-XX', effectiveFrom: '2025-01-01', effectiveTo: null }, 'tester');
    await expect(service.deactivate('tenant-1', 'entity-1', a.id, 99, 'reason', 'tester')).rejects.toThrow(OptimisticConcurrencyError);
  });
});
