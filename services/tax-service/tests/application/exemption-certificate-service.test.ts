import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { FakePrismaClient } from '../support/fake-prisma';
import { ExemptionCertificateService } from '../../src/application/exemption-certificate-service';

function makeService() {
  const prisma = new FakePrismaClient();
  return { prisma, service: new ExemptionCertificateService(prisma as any) };
}

describe('ExemptionCertificateService', () => {
  it('creates a certificate', async () => {
    const { service } = makeService();
    const cert = await service.create('tenant-1', {
      legalEntityId: 'entity-1', partyRef: 'PARTY-1', jurisdictionScope: 'STATE-XX',
      exemptionTypeCode: 'RESALE', effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31',
    }, 'tester');
    expect(cert.partyRef).toBe('PARTY-1');
  });

  it('resolveEffectiveCertificate returns null when absent — request proceeds without exemption ref, truthfully', async () => {
    const { service } = makeService();
    const resolved = await service.resolveEffectiveCertificate('tenant-1', 'entity-1', 'PARTY-NONE', 'STATE-XX', '2025-06-01');
    expect(resolved).toBeNull();
  });

  it('resolveEffectiveCertificate returns null for an expired certificate at businessDate', async () => {
    const { service } = makeService();
    await service.create('tenant-1', {
      legalEntityId: 'entity-1', partyRef: 'PARTY-1', jurisdictionScope: 'STATE-XX',
      exemptionTypeCode: 'RESALE', effectiveFrom: '2024-01-01', effectiveTo: '2024-12-31',
    }, 'tester');
    const resolved = await service.resolveEffectiveCertificate('tenant-1', 'entity-1', 'PARTY-1', 'STATE-XX', '2025-06-01');
    expect(resolved).toBeNull();
  });

  it('resolveEffectiveCertificate returns the certificate active at businessDate', async () => {
    const { service } = makeService();
    await service.create('tenant-1', {
      legalEntityId: 'entity-1', partyRef: 'PARTY-1', jurisdictionScope: 'STATE-XX',
      exemptionTypeCode: 'RESALE', effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31',
    }, 'tester');
    const resolved = await service.resolveEffectiveCertificate('tenant-1', 'entity-1', 'PARTY-1', 'STATE-XX', '2025-06-01');
    expect(resolved?.exemptionTypeCode).toBe('RESALE');
  });

  it('a REVOKED certificate is excluded from resolution even if within its date range', async () => {
    const { prisma, service } = makeService();
    const cert = await service.create('tenant-1', {
      legalEntityId: 'entity-1', partyRef: 'PARTY-1', jurisdictionScope: 'STATE-XX',
      exemptionTypeCode: 'RESALE', effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31',
    }, 'tester');
    await service.update('tenant-1', 'entity-1', cert.id, { status: 'REVOKED' } as any, cert.version, 'tester');
    const resolved = await service.resolveEffectiveCertificate('tenant-1', 'entity-1', 'PARTY-1', 'STATE-XX', '2025-06-01');
    expect(resolved).toBeNull();
  });

  it('expiring() finds certificates whose effectiveTo falls within N days, excluding revoked', async () => {
    const { prisma, service } = makeService();
    const soon = new Date();
    soon.setDate(soon.getDate() + 10);
    await prisma.exemptionCertificate.create({
      data: {
        tenantId: 'tenant-1', legalEntityId: 'entity-1', partyRef: 'PARTY-1', jurisdictionScope: 'STATE-XX',
        exemptionTypeCode: 'RESALE', effectiveFrom: new Date('2025-01-01'), effectiveTo: soon, createdBy: 'tester',
      },
    });
    const results = await service.expiring('tenant-1', 'entity-1', 30);
    expect(results).toHaveLength(1);
  });

  it('expiring() truthfully returns empty when nothing is expiring', async () => {
    const { service } = makeService();
    expect(await service.expiring('tenant-1', 'entity-1', 30)).toEqual([]);
  });
});
