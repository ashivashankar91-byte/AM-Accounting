/**
 * AMACC-CH04 S036B — VendorComplianceService domain tests.
 *
 * Mocked-Prisma unit tests, mirroring the pattern in vendor-service.test.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import {
  VendorComplianceService,
  ComplianceCheckNotFoundError,
  ComplianceCheckValidationError,
  ComplianceCheckConflictError,
  VendorNotFoundForComplianceError,
} from '../src/application/vendor-compliance-service';
import { ManualComplianceAdapter } from '../src/application/compliance-adapter';

const TENANT_ID = 'tenant-test-compliance';
const VENDOR_ID = 'vendor-uuid-001';
const CHECK_ID = 'check-uuid-001';

const BASE_VENDOR = { id: VENDOR_ID, tenantId: TENANT_ID, vendorName: 'Acme Supply Co', status: 'ACTIVE' };

const BASE_CHECK = {
  id: CHECK_ID,
  tenantId: TENANT_ID,
  vendorId: VENDOR_ID,
  checkType: 'INSURANCE_CERTIFICATE',
  status: 'PENDING_REVIEW',
  jurisdiction: null,
  country: null,
  externalReference: null,
  notes: null,
  providerName: null,
  resultMessage: null,
  expirationDate: null,
  lastCheckedAt: null,
  reviewedAt: null,
  reviewedBy: null,
  reviewNote: null,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makePrisma(overrides: Partial<{
  vendorFindFirst: ReturnType<typeof vi.fn>;
  checkFindFirst: ReturnType<typeof vi.fn>;
  checkFindMany: ReturnType<typeof vi.fn>;
  checkCreate: ReturnType<typeof vi.fn>;
  checkUpdate: ReturnType<typeof vi.fn>;
}> = {}) {
  const client: any = {
    vendor: {
      findFirst: overrides.vendorFindFirst ?? vi.fn().mockResolvedValue(BASE_VENDOR),
    },
    vendorComplianceCheck: {
      findFirst: overrides.checkFindFirst ?? vi.fn().mockResolvedValue(BASE_CHECK),
      findMany: overrides.checkFindMany ?? vi.fn().mockResolvedValue([BASE_CHECK]),
      create: overrides.checkCreate ?? vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ ...BASE_CHECK, ...data, id: CHECK_ID })),
      update: overrides.checkUpdate ?? vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ ...BASE_CHECK, ...data })),
    },
    auditOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  client.$transaction = async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg));
  return client;
}

function makeEventPublisher() {
  return { publish: vi.fn().mockResolvedValue(undefined) };
}

function makeService(overrides = {}, adapter: any = new ManualComplianceAdapter()) {
  const prisma = makePrisma(overrides);
  const svc = new VendorComplianceService(prisma as any, makeEventPublisher() as any, adapter);
  return { svc, prisma };
}

describe('VendorComplianceService.create', () => {
  it('creates a check defaulting to PENDING_REVIEW with version 1', async () => {
    const { svc } = makeService();
    const result = await svc.create(TENANT_ID, { vendorId: VENDOR_ID, checkType: 'INSURANCE_CERTIFICATE' }, 'user-1');
    expect(result.status).toBe('PENDING_REVIEW');
    expect(result.version).toBe(1);
  });

  it('rejects an unsupported check type', async () => {
    const { svc } = makeService();
    await expect(
      svc.create(TENANT_ID, { vendorId: VENDOR_ID, checkType: 'NOT_A_TYPE' } as any, 'user-1'),
    ).rejects.toBeInstanceOf(ComplianceCheckValidationError);
  });

  it('rejects when the vendor does not exist in this tenant', async () => {
    const { svc } = makeService({ vendorFindFirst: vi.fn().mockResolvedValue(null) });
    await expect(
      svc.create(TENANT_ID, { vendorId: 'missing-vendor', checkType: 'INSURANCE_CERTIFICATE' }, 'user-1'),
    ).rejects.toBeInstanceOf(VendorNotFoundForComplianceError);
  });

  it('writes an audit event under docType Vendor / docId vendorId (reuses the vendor audit trail)', async () => {
    const { svc, prisma } = makeService();
    await svc.create(TENANT_ID, { vendorId: VENDOR_ID, checkType: 'INSURANCE_CERTIFICATE' }, 'user-1');
    expect(prisma.auditOutboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ docType: 'Vendor', docId: VENDOR_ID, action: 'COMPLIANCE_CHECK_CREATED' }),
    }));
  });
});

describe('VendorComplianceService.getById / list', () => {
  it('throws ComplianceCheckNotFoundError for a missing check', async () => {
    const { svc } = makeService({ checkFindFirst: vi.fn().mockResolvedValue(null) });
    await expect(svc.getById(TENANT_ID, VENDOR_ID, 'missing')).rejects.toBeInstanceOf(ComplianceCheckNotFoundError);
  });

  it('lists checks scoped to tenant + vendor', async () => {
    const checkFindMany = vi.fn().mockResolvedValue([BASE_CHECK]);
    const { svc } = makeService({ checkFindMany });
    const result = await svc.list({ tenantId: TENANT_ID, vendorId: VENDOR_ID });
    expect(result).toEqual([BASE_CHECK]);
    expect(checkFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: TENANT_ID, vendorId: VENDOR_ID } }));
  });
});

describe('VendorComplianceService.update', () => {
  it('rejects a stale version with ComplianceCheckConflictError', async () => {
    const { svc } = makeService();
    await expect(
      svc.update(TENANT_ID, VENDOR_ID, CHECK_ID, { version: 99 }, 'user-1'),
    ).rejects.toBeInstanceOf(ComplianceCheckConflictError);
  });

  it('rejects editing a check that has already been reviewed', async () => {
    const { svc } = makeService({ checkFindFirst: vi.fn().mockResolvedValue({ ...BASE_CHECK, status: 'VERIFIED' }) });
    await expect(
      svc.update(TENANT_ID, VENDOR_ID, CHECK_ID, { version: 1 }, 'user-1'),
    ).rejects.toBeInstanceOf(ComplianceCheckValidationError);
  });

  it('allows editing jurisdiction/country/expiration on an unreviewed check', async () => {
    const { svc } = makeService();
    const result = await svc.update(TENANT_ID, VENDOR_ID, CHECK_ID, { version: 1, jurisdiction: 'IL' }, 'user-1');
    expect(result.jurisdiction).toBe('IL');
    expect(result.version).toBe(2);
  });
});

describe('VendorComplianceService.runVerification', () => {
  it('never fabricates VERIFIED — the ManualComplianceAdapter always reports NOT_CONFIGURED', async () => {
    const { svc } = makeService();
    const result = await svc.runVerification(TENANT_ID, VENDOR_ID, CHECK_ID, 'user-1');
    expect(result.status).toBe('NOT_CONFIGURED');
    expect(result.providerName).toBe('MANUAL');
    expect(result.status).not.toBe('VERIFIED');
  });

  it('surfaces VERIFICATION_UNAVAILABLE truthfully when a real adapter cannot reach its provider', async () => {
    const flakyAdapter = {
      name: 'FLAKY_PROVIDER',
      verify: vi.fn().mockResolvedValue({ status: 'VERIFICATION_UNAVAILABLE', providerName: 'FLAKY_PROVIDER', message: 'Provider timeout' }),
    };
    const { svc } = makeService({}, flakyAdapter);
    const result = await svc.runVerification(TENANT_ID, VENDOR_ID, CHECK_ID, 'user-1');
    expect(result.status).toBe('VERIFICATION_UNAVAILABLE');
  });

  it('rejects running verification on an already-reviewed check', async () => {
    const { svc } = makeService({ checkFindFirst: vi.fn().mockResolvedValue({ ...BASE_CHECK, status: 'REJECTED' }) });
    await expect(
      svc.runVerification(TENANT_ID, VENDOR_ID, CHECK_ID, 'user-1'),
    ).rejects.toBeInstanceOf(ComplianceCheckValidationError);
  });
});

describe('VendorComplianceService.review', () => {
  it('requires a reason to reject', async () => {
    const { svc } = makeService();
    await expect(
      svc.review(TENANT_ID, VENDOR_ID, CHECK_ID, { version: 1, decision: 'REJECTED' }, 'user-1'),
    ).rejects.toBeInstanceOf(ComplianceCheckValidationError);
  });

  it('sets VERIFIED with reviewedBy/reviewedAt recorded', async () => {
    const { svc } = makeService();
    const result = await svc.review(TENANT_ID, VENDOR_ID, CHECK_ID, { version: 1, decision: 'VERIFIED', reason: 'COI on file' }, 'controller-1');
    expect(result.status).toBe('VERIFIED');
    expect(result.reviewedBy).toBe('controller-1');
  });

  it('rejects reviewing an already-reviewed check', async () => {
    const { svc } = makeService({ checkFindFirst: vi.fn().mockResolvedValue({ ...BASE_CHECK, status: 'VERIFIED' }) });
    await expect(
      svc.review(TENANT_ID, VENDOR_ID, CHECK_ID, { version: 1, decision: 'VERIFIED' }, 'user-1'),
    ).rejects.toBeInstanceOf(ComplianceCheckValidationError);
  });

  it('rejects a stale version', async () => {
    const { svc } = makeService();
    await expect(
      svc.review(TENANT_ID, VENDOR_ID, CHECK_ID, { version: 99, decision: 'VERIFIED' }, 'user-1'),
    ).rejects.toBeInstanceOf(ComplianceCheckConflictError);
  });

  it('writes an audit event under docType Vendor for the review action', async () => {
    const { svc, prisma } = makeService();
    await svc.review(TENANT_ID, VENDOR_ID, CHECK_ID, { version: 1, decision: 'REJECTED', reason: 'Expired certificate' }, 'controller-1');
    expect(prisma.auditOutboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ docType: 'Vendor', docId: VENDOR_ID, action: 'COMPLIANCE_CHECK_REVIEWED' }),
    }));
  });
});
