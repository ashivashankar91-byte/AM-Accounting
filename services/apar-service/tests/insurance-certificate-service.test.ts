/**
 * AMACC-CH04 S038 — InsuranceCertificateService domain tests.
 *
 * Mocked-Prisma unit tests, mirroring the pattern in
 * services/apar-service/tests/vendor-service.test.ts (S036A).
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import {
  InsuranceCertificateService,
  InsuranceCertificateNotFoundError,
  VendorNotFoundForCertificateError,
  InsuranceCertificateConflictError,
  InsuranceCertificateValidationError,
  computeExpirationStatus,
} from '../src/application/insurance-certificate-service';

const TENANT_ID = 'tenant-test-ic';
const TENANT_B = 'tenant-test-ic-b';
const VENDOR_ID = 'vendor-uuid-001';
const CERT_ID = 'cert-uuid-001';

const BASE_VENDOR = { id: VENDOR_ID, tenantId: TENANT_ID, status: 'ACTIVE' };

const BASE_CERT = {
  id: CERT_ID,
  tenantId: TENANT_ID,
  vendorId: VENDOR_ID,
  certificateNumber: 'POL-100',
  insuranceProvider: 'Acme Insurance Co',
  insuranceType: 'GENERAL_LIABILITY',
  effectiveDate: new Date('2026-01-01'),
  expirationDate: new Date('2027-01-01'),
  coverageAmount: '1000000',
  coverageDescription: null,
  documentId: null,
  documentFileName: null,
  documentMimeType: null,
  status: 'ACTIVE',
  isCurrent: true,
  supersededByCertificateId: null,
  previousCertificateId: null,
  revokedAt: null,
  revokedReason: null,
  revokedBy: null,
  notes: null,
  version: 1,
  createdAt: new Date(),
  createdBy: 'user-1',
  updatedAt: new Date(),
  updatedBy: 'user-1',
};

function makePrisma(overrides: Partial<{
  vendorFindFirst: ReturnType<typeof vi.fn>;
  certFindFirst: ReturnType<typeof vi.fn>;
  certFindMany: ReturnType<typeof vi.fn>;
  certCount: ReturnType<typeof vi.fn>;
  certCreate: ReturnType<typeof vi.fn>;
  certUpdate: ReturnType<typeof vi.fn>;
}> = {}) {
  const client: any = {
    vendor: {
      findFirst: overrides.vendorFindFirst ?? vi.fn().mockResolvedValue(BASE_VENDOR),
    },
    vendorInsuranceCertificate: {
      findFirst: overrides.certFindFirst ?? vi.fn().mockResolvedValue(null),
      findMany: overrides.certFindMany ?? vi.fn().mockResolvedValue([BASE_CERT]),
      count: overrides.certCount ?? vi.fn().mockResolvedValue(1),
      create: overrides.certCreate ?? vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ ...BASE_CERT, ...data, id: CERT_ID })),
      update: overrides.certUpdate ?? vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ ...BASE_CERT, ...data })),
    },
    auditOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
    // S038 live-stack certification fix: setTenantContextOnConnection() now
    // runs first inside every interactive $transaction callback (see
    // insurance-certificate-service.ts), so the mock tx must stub this call.
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
  };
  client.$transaction = async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg));
  return client;
}

function makeEventPublisher() {
  return { publish: vi.fn().mockResolvedValue(undefined) };
}

function makeService(overrides = {}) {
  const prisma = makePrisma(overrides);
  const svc = new InsuranceCertificateService(prisma as any, makeEventPublisher() as any);
  return { svc, prisma };
}

const validCreateDTO = {
  tenantId: TENANT_ID,
  vendorId: VENDOR_ID,
  certificateNumber: 'POL-100',
  insuranceProvider: 'Acme Insurance Co',
  insuranceType: 'GENERAL_LIABILITY',
  effectiveDate: new Date('2026-01-01'),
  expirationDate: new Date('2027-01-01'),
};

describe('computeExpirationStatus', () => {
  const now = new Date('2026-06-01');

  it('returns EXPIRED when expirationDate is in the past', () => {
    expect(computeExpirationStatus(new Date('2026-01-01'), now)).toBe('EXPIRED');
  });

  it('returns CURRENT when no withinDays is supplied, even if close to expiring', () => {
    expect(computeExpirationStatus(new Date('2026-06-05'), now)).toBe('CURRENT');
  });

  it('returns EXPIRING_SOON only when withinDays is supplied and expiration falls within it', () => {
    expect(computeExpirationStatus(new Date('2026-06-05'), now, 10)).toBe('EXPIRING_SOON');
    expect(computeExpirationStatus(new Date('2026-08-01'), now, 10)).toBe('CURRENT');
  });

  it('never invents a default warning period — omitting withinDays never yields EXPIRING_SOON', () => {
    expect(computeExpirationStatus(new Date('2026-06-02'), now)).toBe('CURRENT');
  });
});

describe('InsuranceCertificateService.create', () => {
  it('creates a valid certificate defaulting to ACTIVE/current/version 1', async () => {
    const certCreate = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_CERT, ...data, id: CERT_ID }));
    const { svc } = makeService({ certCreate });
    const result = await svc.create(validCreateDTO, 'user-1');
    expect(result.status).toBe('ACTIVE');
    expect(certCreate.mock.calls[0][0].data.isCurrent).toBe(true);
    expect(certCreate.mock.calls[0][0].data.version).toBe(1);
    expect(result.expirationStatus).toBeDefined();
  });

  it('rejects an unsupported insurance type', async () => {
    const { svc } = makeService();
    await expect(
      svc.create({ ...validCreateDTO, insuranceType: 'NOT_A_TYPE' } as any, 'user-1'),
    ).rejects.toBeInstanceOf(InsuranceCertificateValidationError);
  });

  it('rejects expirationDate before or equal to effectiveDate', async () => {
    const { svc } = makeService();
    await expect(
      svc.create({ ...validCreateDTO, effectiveDate: new Date('2027-01-01'), expirationDate: new Date('2026-01-01') }, 'user-1'),
    ).rejects.toMatchObject({ code: 'INVALID_DATE_RANGE' });
    await expect(
      svc.create({ ...validCreateDTO, effectiveDate: new Date('2027-01-01'), expirationDate: new Date('2027-01-01') }, 'user-1'),
    ).rejects.toMatchObject({ code: 'INVALID_DATE_RANGE' });
  });

  it('rejects attaching a certificate to a vendor that does not belong to the tenant', async () => {
    const { svc } = makeService({ vendorFindFirst: vi.fn().mockResolvedValue(null) });
    await expect(svc.create(validCreateDTO, 'user-1')).rejects.toBeInstanceOf(VendorNotFoundForCertificateError);
  });

  it('rejects a duplicate active certificate for the same vendor + insurance type', async () => {
    const { svc } = makeService({ certFindFirst: vi.fn().mockResolvedValue(BASE_CERT) });
    await expect(svc.create(validCreateDTO, 'user-1')).rejects.toMatchObject({ code: 'DUPLICATE_ACTIVE_CERTIFICATE' });
  });

  it('requires certificateNumber and insuranceProvider', async () => {
    const { svc } = makeService();
    await expect(svc.create({ ...validCreateDTO, certificateNumber: '  ' }, 'user-1')).rejects.toBeInstanceOf(InsuranceCertificateValidationError);
    await expect(svc.create({ ...validCreateDTO, insuranceProvider: '' }, 'user-1')).rejects.toBeInstanceOf(InsuranceCertificateValidationError);
  });
});

describe('InsuranceCertificateService.update', () => {
  it('rejects when version does not match (optimistic concurrency)', async () => {
    const { svc } = makeService({ certFindFirst: vi.fn().mockResolvedValue(BASE_CERT) });
    await expect(
      svc.update(TENANT_ID, CERT_ID, { version: 999, notes: 'x' }, 'user-1'),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('rejects editing a certificate that is no longer current/active (superseded)', async () => {
    const superseded = { ...BASE_CERT, isCurrent: false, status: 'SUPERSEDED' };
    const { svc } = makeService({ certFindFirst: vi.fn().mockResolvedValue(superseded) });
    await expect(
      svc.update(TENANT_ID, CERT_ID, { version: 1, notes: 'x' }, 'user-1'),
    ).rejects.toMatchObject({ code: 'CERTIFICATE_NOT_EDITABLE' });
  });

  it('404s when the certificate does not exist for this tenant', async () => {
    const { svc } = makeService({ certFindFirst: vi.fn().mockResolvedValue(null) });
    await expect(svc.update(TENANT_ID, CERT_ID, { version: 1 }, 'user-1')).rejects.toBeInstanceOf(InsuranceCertificateNotFoundError);
  });

  it('never lets a tenant load another tenant\'s certificate by id', async () => {
    // Prisma's findFirst is called with { id, tenantId } — simulate the
    // cross-tenant case by having the mock only resolve when tenantId matches.
    const certFindFirst = vi.fn().mockImplementation(({ where }: any) => Promise.resolve(where.tenantId === TENANT_ID ? BASE_CERT : null));
    const { svc } = makeService({ certFindFirst });
    await expect(svc.getById(TENANT_B, CERT_ID)).rejects.toBeInstanceOf(InsuranceCertificateNotFoundError);
  });

  it('updates allowed non-defining fields and increments version', async () => {
    const certUpdate = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_CERT, ...data }));
    const { svc } = makeService({ certFindFirst: vi.fn().mockResolvedValue(BASE_CERT), certUpdate });
    const result = await svc.update(TENANT_ID, CERT_ID, { version: 1, notes: 'Updated note' }, 'user-1');
    expect(certUpdate.mock.calls[0][0].data.version).toBe(2);
    expect(certUpdate.mock.calls[0][0].data.notes).toBe('Updated note');
    expect(result).toBeDefined();
  });
});

describe('InsuranceCertificateService.renew', () => {
  const renewDTO = {
    version: 1,
    certificateNumber: 'POL-200',
    insuranceProvider: 'Acme Insurance Co',
    effectiveDate: new Date('2027-01-01'),
    expirationDate: new Date('2028-01-01'),
  };

  it('atomically supersedes the old certificate and creates a new current one', async () => {
    const certFindFirst = vi.fn().mockResolvedValue(BASE_CERT);
    const certCreate = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_CERT, ...data, id: 'cert-uuid-002' }));
    const certUpdate = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_CERT, ...data }));
    const { svc } = makeService({ certFindFirst, certCreate, certUpdate });

    const result = await svc.renew(TENANT_ID, CERT_ID, renewDTO, 'user-1');

    expect(certCreate.mock.calls[0][0].data.previousCertificateId).toBe(CERT_ID);
    expect(certCreate.mock.calls[0][0].data.isCurrent).toBe(true);
    expect(certUpdate.mock.calls[0][0].data.isCurrent).toBe(false);
    expect(certUpdate.mock.calls[0][0].data.status).toBe('SUPERSEDED');
    // S038 live-stack certification fix: the old certificate is demoted
    // BEFORE the new one is created (Postgres enforces the partial unique
    // index `(tenant_id, vendor_id, insurance_type) WHERE is_current` non-
    // deferrably, so creating the new current row first would violate it).
    // supersededByCertificateId is therefore backfilled in a second update
    // call, once the new certificate's id is known.
    expect(certUpdate.mock.calls[1][0].data.supersededByCertificateId).toBe('cert-uuid-002');
    expect(result.id).toBe('cert-uuid-002');
  });

  it('never silently overwrites — rejects renewing a stale version', async () => {
    const { svc } = makeService({ certFindFirst: vi.fn().mockResolvedValue(BASE_CERT) });
    await expect(
      svc.renew(TENANT_ID, CERT_ID, { ...renewDTO, version: 999 }, 'user-1'),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('rejects renewing an already-superseded certificate', async () => {
    const superseded = { ...BASE_CERT, isCurrent: false, status: 'SUPERSEDED' };
    const { svc } = makeService({ certFindFirst: vi.fn().mockResolvedValue(superseded) });
    await expect(
      svc.renew(TENANT_ID, CERT_ID, renewDTO, 'user-1'),
    ).rejects.toMatchObject({ code: 'CERTIFICATE_NOT_RENEWABLE' });
  });

  it('rejects an invalid date range on renewal', async () => {
    const { svc } = makeService({ certFindFirst: vi.fn().mockResolvedValue(BASE_CERT) });
    await expect(
      svc.renew(TENANT_ID, CERT_ID, { ...renewDTO, effectiveDate: new Date('2028-01-01'), expirationDate: new Date('2027-01-01') }, 'user-1'),
    ).rejects.toMatchObject({ code: 'INVALID_DATE_RANGE' });
  });
});

describe('InsuranceCertificateService.revoke', () => {
  it('revokes the current certificate and preserves it (no delete)', async () => {
    const certUpdate = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_CERT, ...data }));
    const { svc, prisma } = makeService({ certFindFirst: vi.fn().mockResolvedValue(BASE_CERT), certUpdate });
    const result = await svc.revoke(TENANT_ID, CERT_ID, { version: 1, reason: 'Policy cancelled' }, 'user-1');
    expect(certUpdate.mock.calls[0][0].data.status).toBe('REVOKED');
    expect(certUpdate.mock.calls[0][0].data.isCurrent).toBe(false);
    expect(certUpdate.mock.calls[0][0].data.revokedReason).toBe('Policy cancelled');
    expect(result.status).toBe('REVOKED');
    expect(prisma.vendorInsuranceCertificate.update).toHaveBeenCalled(); // never .delete
    expect((prisma.vendorInsuranceCertificate as any).delete).toBeUndefined();
  });

  it('requires a reason', async () => {
    const { svc } = makeService({ certFindFirst: vi.fn().mockResolvedValue(BASE_CERT) });
    await expect(svc.revoke(TENANT_ID, CERT_ID, { version: 1, reason: '' }, 'user-1')).rejects.toBeInstanceOf(InsuranceCertificateValidationError);
  });

  it('rejects a stale-version revoke', async () => {
    const { svc } = makeService({ certFindFirst: vi.fn().mockResolvedValue(BASE_CERT) });
    await expect(
      svc.revoke(TENANT_ID, CERT_ID, { version: 999, reason: 'x' }, 'user-1'),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });
});

describe('InsuranceCertificateService.list', () => {
  it('requires withinDays when expirationFilter=expiring (no invented default warning period)', async () => {
    const { svc } = makeService();
    await expect(
      svc.list({ tenantId: TENANT_ID, expirationFilter: 'expiring' }),
    ).rejects.toMatchObject({ code: 'WITHIN_DAYS_REQUIRED' });
  });

  it('defaults to scope=current (only is_current rows)', async () => {
    const certFindMany = vi.fn().mockResolvedValue([BASE_CERT]);
    const { svc } = makeService({ certFindMany });
    await svc.list({ tenantId: TENANT_ID });
    expect(certFindMany.mock.calls[0][0].where.isCurrent).toBe(true);
  });

  it('includes historical (superseded/revoked) records when scope=all', async () => {
    const certFindMany = vi.fn().mockResolvedValue([BASE_CERT]);
    const { svc } = makeService({ certFindMany });
    await svc.list({ tenantId: TENANT_ID, scope: 'all' });
    expect(certFindMany.mock.calls[0][0].where.isCurrent).toBeUndefined();
  });

  it('never queries across tenants — where always includes the caller\'s tenantId', async () => {
    const certFindMany = vi.fn().mockResolvedValue([]);
    const { svc } = makeService({ certFindMany });
    await svc.list({ tenantId: TENANT_ID });
    expect(certFindMany.mock.calls[0][0].where.tenantId).toBe(TENANT_ID);
  });
});

describe('InsuranceCertificateService.getVendorInsuranceSummary', () => {
  it('exposes only raw facts — no verification/compliance field (S036B boundary)', async () => {
    const { svc } = makeService();
    const result = await svc.getVendorInsuranceSummary(TENANT_ID, VENDOR_ID);
    expect(result.vendorId).toBe(VENDOR_ID);
    for (const cert of result.certificates) {
      expect(cert).not.toHaveProperty('verified');
      expect(cert).not.toHaveProperty('complianceStatus');
      expect(cert).not.toHaveProperty('verificationStatus');
    }
  });

  it('rejects when the vendor does not belong to the tenant', async () => {
    const { svc } = makeService({ vendorFindFirst: vi.fn().mockResolvedValue(null) });
    await expect(svc.getVendorInsuranceSummary(TENANT_ID, VENDOR_ID)).rejects.toBeInstanceOf(VendorNotFoundForCertificateError);
  });
});
