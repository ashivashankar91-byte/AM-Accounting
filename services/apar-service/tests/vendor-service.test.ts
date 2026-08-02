/**
 * AMACC-CH04 S036A — VendorService domain tests.
 *
 * Mocked-Prisma unit tests, mirroring the pattern in
 * services/tenant-service/tests/store.test.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import {
  VendorService,
  VendorNotFoundError,
  VendorConflictError,
  VendorValidationError,
  VendorHasReferencesError,
  DuplicateVendorAcknowledgementRequiredError,
  maskTaxId,
  toSafeVendor,
  redactForAudit,
} from '../src/application/vendor-service';

const TENANT_ID = 'tenant-test-vendor';
const TENANT_B = 'tenant-test-vendor-b';
const VENDOR_ID = 'vendor-uuid-001';

const BASE_VENDOR = {
  id: VENDOR_ID,
  tenantId: TENANT_ID,
  vendorNumber: '000001',
  normalizedVendorNumber: '000001',
  vendorName: 'Acme Supply Co',
  normalizedVendorName: 'acme supply co',
  vendorType: 'SUPPLIER',
  dba: null,
  contactName: null,
  phone: null,
  normalizedPhone: null,
  fax: null,
  email: null,
  normalizedEmail: null,
  address1: null,
  address2: null,
  city: null,
  state: null,
  zip: '60601',
  taxId: '123456789',
  is1099Misc: false,
  is1099Nec: false,
  income1099Type: null,
  w9OnFile: false,
  w9ReceivedDate: null,
  paymentTerms: 'Net30',
  defaultGlAccount: null,
  paymentMethod: 'Check',
  discountPercent: '0',
  discountDays: 0,
  bankName: null,
  bankRoutingNumber: null,
  bankAccountNumber: null,
  bankAccountType: null,
  separateCheck: false,
  holdPayments: false,
  defaultExpenseAccount: null,
  notes: null,
  status: 'ACTIVE',
  isActive: true,
  version: 1,
  inactiveReason: null,
  inactivatedAt: null,
  inactivatedBy: null,
  reactivatedAt: null,
  reactivatedBy: null,
  deletedAt: null,
  deletedBy: null,
  deleteReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makePrisma(overrides: Partial<{
  vendorFindFirst: ReturnType<typeof vi.fn>;
  vendorFindMany: ReturnType<typeof vi.fn>;
  vendorCount: ReturnType<typeof vi.fn>;
  vendorCreate: ReturnType<typeof vi.fn>;
  vendorUpdate: ReturnType<typeof vi.fn>;
  counterUpsert: ReturnType<typeof vi.fn>;
  counterFindUnique: ReturnType<typeof vi.fn>;
  poCount: ReturnType<typeof vi.fn>;
  apEntryCount: ReturnType<typeof vi.fn>;
}> = {}) {
  const client: any = {
    vendor: {
      findFirst: overrides.vendorFindFirst ?? vi.fn().mockResolvedValue(BASE_VENDOR),
      findMany: overrides.vendorFindMany ?? vi.fn().mockResolvedValue([BASE_VENDOR]),
      count: overrides.vendorCount ?? vi.fn().mockResolvedValue(1),
      create: overrides.vendorCreate ?? vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ ...BASE_VENDOR, ...data, id: VENDOR_ID })),
      update: overrides.vendorUpdate ?? vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ ...BASE_VENDOR, ...data })),
    },
    apVendorNumberCounter: {
      upsert: overrides.counterUpsert ?? vi.fn().mockResolvedValue({ tenantId: TENANT_ID, nextNumber: 2 }),
      findUnique: overrides.counterFindUnique ?? vi.fn().mockResolvedValue({ tenantId: TENANT_ID, nextNumber: 2 }),
    },
    apVendorDuplicateAcknowledgement: {
      create: vi.fn().mockResolvedValue({}),
    },
    purchaseOrder: {
      count: overrides.poCount ?? vi.fn().mockResolvedValue(0),
    },
    aPEntry: {
      count: overrides.apEntryCount ?? vi.fn().mockResolvedValue(0),
    },
    auditOutboxEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
    outboxEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
    // CE-07 — setTenantContextOnConnection() (called as the first statement
    // inside every interactive $transaction callback, see rls-middleware.ts)
    // issues a raw SET on the transaction's own connection; the mock tx here
    // IS this same client object (see $transaction below), so it needs the
    // method too, even though nothing asserts on its calls.    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
  };
  client.$transaction = async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg));
  return client;
}

function makeEventPublisher() {
  return { publish: vi.fn().mockResolvedValue(undefined) };
}

function makeService(overrides = {}) {
  const prisma = makePrisma(overrides);
  const svc = new VendorService(prisma as any, makeEventPublisher() as any);
  return { svc, prisma };
}

// ── 1. Valid vendor defaults to ACTIVE ──────────────────────────────────────
describe('VendorService.create', () => {
  it('defaults a valid new vendor to ACTIVE with version 1', async () => {
    const vendorCreate = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_VENDOR, ...data, id: VENDOR_ID }));
    const { svc } = makeService({ vendorFindFirst: vi.fn().mockResolvedValue(null), vendorFindMany: vi.fn().mockResolvedValue([]), vendorCreate });
    const result = await svc.create({ tenantId: TENANT_ID, vendorName: 'New Vendor' }, 'user-1');
    expect(result.status).toBe('ACTIVE');
    expect(vendorCreate.mock.calls[0][0].data.status).toBe('ACTIVE');
    expect(vendorCreate.mock.calls[0][0].data.version).toBe(1);
  });

  // 2. Required fields enforced — vendorName is required by the Zod schema at
  // the route layer; service-layer, an empty vendorName still normalizes to ''.
  it('rejects an unsupported vendor type', async () => {
    const { svc } = makeService({ vendorFindFirst: vi.fn().mockResolvedValue(null), vendorFindMany: vi.fn().mockResolvedValue([]) });
    await expect(
      svc.create({ tenantId: TENANT_ID, vendorName: 'X', vendorType: 'NOT_A_TYPE' } as any, 'user-1'),
    ).rejects.toBeInstanceOf(VendorValidationError);
  });

  // 3. Vendor-code normalization is deterministic
  it('normalizes vendor number to uppercase/trimmed form', async () => {
    const vendorCreate = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_VENDOR, ...data, id: VENDOR_ID }));
    const { svc } = makeService({ vendorFindFirst: vi.fn().mockResolvedValue(null), vendorFindMany: vi.fn().mockResolvedValue([]), vendorCreate });
    await svc.create({ tenantId: TENANT_ID, vendorName: 'X', vendorNumber: ' ab12 ' }, 'user-1');
    expect(vendorCreate.mock.calls[0][0].data.normalizedVendorNumber).toBe('AB12');
  });

  // 15. Same normalized vendor code is blocked in one tenant
  it('blocks create when normalized vendor code already exists in tenant', async () => {
    const { svc } = makeService({ vendorFindFirst: vi.fn().mockResolvedValue(BASE_VENDOR) });
    await expect(
      svc.create({ tenantId: TENANT_ID, vendorName: 'Dup', vendorNumber: '000001' }, 'user-1'),
    ).rejects.toMatchObject({ code: 'VENDOR_CODE_ALREADY_EXISTS' });
  });

  // 17. Same normalized name and postal code returns a candidate
  it('returns a duplicate-acknowledgement-required error for a name+zip match', async () => {
    const { svc } = makeService({
      vendorFindFirst: vi.fn().mockResolvedValue(null),
      vendorFindMany: vi.fn().mockResolvedValue([BASE_VENDOR]),
    });
    await expect(
      svc.create({ tenantId: TENANT_ID, vendorName: 'Acme Supply Co', zip: '60601' }, 'user-1'),
    ).rejects.toBeInstanceOf(DuplicateVendorAcknowledgementRequiredError);
  });

  // 22/23/24. Create Anyway requires an override with reason; persists acknowledgement + actor
  it('creates the vendor and persists an acknowledgement when override is supplied', async () => {
    const ackCreate = vi.fn().mockResolvedValue({});
    const { svc, prisma } = makeService({
      vendorFindFirst: vi.fn().mockResolvedValue(null),
      vendorFindMany: vi.fn().mockResolvedValue([BASE_VENDOR]),
    });
    prisma.apVendorDuplicateAcknowledgement.create = ackCreate;
    const result = await svc.create(
      { tenantId: TENANT_ID, vendorName: 'Acme Supply Co', zip: '60601', override: { reason: 'Confirmed different entity' } },
      'user-1',
      'corr-123',
    );
    expect(result).toBeDefined();
    expect(ackCreate).toHaveBeenCalledTimes(1);
    const ackData = ackCreate.mock.calls[0][0].data;
    expect(ackData.reason).toBe('Confirmed different entity');
    expect(ackData.actor).toBe('user-1');
    expect(ackData.correlationId).toBe('corr-123');
  });
});

// ── 12/13. Tax identifier masking ───────────────────────────────────────────
describe('maskTaxId / toSafeVendor', () => {
  it('masks a tax id to last-4 only', () => {
    expect(maskTaxId('123456789')).toBe('*****6789');
  });
  it('returns null for no tax id', () => {
    expect(maskTaxId(null)).toBeNull();
  });
  it('never includes the raw taxId or banking fields in the safe projection', () => {
    const safe = toSafeVendor(BASE_VENDOR) as any;
    expect(safe.taxId).toBeUndefined();
    expect(safe.taxIdMasked).toBe('*****6789');
    expect(safe.bankAccountNumber).toBeUndefined();
    expect(safe.bankRoutingNumber).toBeUndefined();
    expect(safe.normalizedVendorNumber).toBeUndefined();
  });
});

// Regression test: audit_outbox before/after snapshots must never carry the
// full tax ID or banking values (found and fixed during S036A certification —
// _audit() calls originally passed the raw Prisma row straight through).
describe('redactForAudit', () => {
  it('masks taxId and strips banking account/routing numbers from audit snapshots', () => {
    const redacted = redactForAudit(BASE_VENDOR) as any;
    expect(redacted.taxId).toBeUndefined();
    expect(redacted.taxIdMasked).toBe('*****6789');
    expect(redacted.bankAccountNumber).toBeUndefined();
    expect(redacted.bankRoutingNumber).toBeUndefined();
    // Unlike toSafeVendor, non-sensitive banking metadata and normalized
    // comparison columns ARE retained — audit needs the full business diff.
    expect(redacted.bankName).toBe(BASE_VENDOR.bankName);
    expect(redacted.normalizedVendorNumber).toBe(BASE_VENDOR.normalizedVendorNumber);
  });

  it('returns null/undefined unchanged', () => {
    expect(redactForAudit(null)).toBeNull();
  });
});

// ── 5/6/7/8. Lifecycle transitions ──────────────────────────────────────────
describe('VendorService.inactivate', () => {
  it('requires a reason', async () => {
    const { svc } = makeService();
    await expect(svc.inactivate(TENANT_ID, VENDOR_ID, { version: 1, reason: '' }, 'user-1'))
      .rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  });

  it('only transitions ACTIVE -> INACTIVE', async () => {
    const inactiveVendor = { ...BASE_VENDOR, status: 'INACTIVE' };
    const { svc } = makeService({ vendorFindFirst: vi.fn().mockResolvedValue(inactiveVendor) });
    await expect(svc.inactivate(TENANT_ID, VENDOR_ID, { version: 1, reason: 'closing' }, 'user-1'))
      .rejects.toMatchObject({ code: 'ALREADY_INACTIVE' });
  });

  it('inactivates an active vendor with a reason', async () => {
    const vendorUpdate = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_VENDOR, ...data }));
    const { svc } = makeService({ vendorUpdate });
    const result = await svc.inactivate(TENANT_ID, VENDOR_ID, { version: 1, reason: 'Vendor closed' }, 'user-1');
    expect(result.status).toBe('INACTIVE');
    expect(vendorUpdate.mock.calls[0][0].data.inactiveReason).toBe('Vendor closed');
  });

  // 14. Stale-version update is rejected
  it('rejects a stale version', async () => {
    const { svc } = makeService();
    await expect(svc.inactivate(TENANT_ID, VENDOR_ID, { version: 99, reason: 'x' }, 'user-1'))
      .rejects.toBeInstanceOf(VendorConflictError);
  });
});

describe('VendorService.reactivate', () => {
  it('only transitions INACTIVE -> ACTIVE', async () => {
    const { svc } = makeService(); // BASE_VENDOR is ACTIVE
    await expect(svc.reactivate(TENANT_ID, VENDOR_ID, { version: 1 }, 'user-1'))
      .rejects.toMatchObject({ code: 'ALREADY_ACTIVE' });
  });

  it('reactivates an inactive vendor', async () => {
    const inactiveVendor = { ...BASE_VENDOR, status: 'INACTIVE' };
    const vendorUpdate = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...inactiveVendor, ...data }));
    const { svc } = makeService({ vendorFindFirst: vi.fn().mockResolvedValue(inactiveVendor), vendorUpdate });
    const result = await svc.reactivate(TENANT_ID, VENDOR_ID, { version: 1 }, 'user-1');
    expect(result.status).toBe('ACTIVE');
  });
});

// ── 9/10/11. Invoice-creation eligibility ───────────────────────────────────
describe('VendorService.eligibility', () => {
  it('ACTIVE vendor is eligible', async () => {
    const { svc } = makeService();
    const result = await svc.eligibility(TENANT_ID, VENDOR_ID);
    expect(result.eligible).toBe(true);
  });

  it('INACTIVE vendor is not eligible', async () => {
    const { svc } = makeService({ vendorFindFirst: vi.fn().mockResolvedValue({ ...BASE_VENDOR, status: 'INACTIVE' }) });
    const result = await svc.eligibility(TENANT_ID, VENDOR_ID);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/inactive/i);
  });

  it('DELETED vendor is not found (not eligible)', async () => {
    const { svc } = makeService({ vendorFindFirst: vi.fn().mockResolvedValue(null) });
    await expect(svc.eligibility(TENANT_ID, VENDOR_ID)).rejects.toBeInstanceOf(VendorNotFoundError);
  });
});

// ── Guarded logical delete ──────────────────────────────────────────────────
describe('VendorService.delete', () => {
  it('deletes an unreferenced vendor logically', async () => {
    const inactiveVendor = { ...BASE_VENDOR, status: 'INACTIVE' };
    const vendorUpdate = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...inactiveVendor, ...data }));
    const { svc } = makeService({ vendorFindFirst: vi.fn().mockResolvedValue(inactiveVendor), vendorUpdate, poCount: vi.fn().mockResolvedValue(0), apEntryCount: vi.fn().mockResolvedValue(0) });
    const result = await svc.delete(TENANT_ID, VENDOR_ID, { version: 1 }, 'user-1');
    expect(result.status).toBe('DELETED');
  });

  it('rejects delete for a referenced vendor', async () => {
    const { svc } = makeService({ poCount: vi.fn().mockResolvedValue(2) });
    await expect(svc.delete(TENANT_ID, VENDOR_ID, { version: 1 }, 'user-1'))
      .rejects.toBeInstanceOf(VendorHasReferencesError);
  });
});

// ── Cross-tenant isolation at the service layer ─────────────────────────────
describe('VendorService cross-tenant isolation', () => {
  function isolatingPrisma() {
    const client: any = {
      vendor: {
        findFirst: async ({ where }: any) => (where.tenantId === TENANT_ID ? BASE_VENDOR : null),
        findMany: async ({ where }: any) => (where.tenantId === TENANT_ID ? [BASE_VENDOR] : []),
        count: async ({ where }: any) => (where.tenantId === TENANT_ID ? 1 : 0),
      },
      auditOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
      // CE-09 cert fix: see makePrisma() above for rationale.
      $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    };
    client.$transaction = async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg));
    return client;
  }

  it('tenant B cannot read tenant A vendor by id', async () => {
    const prisma = isolatingPrisma();
    const svc = new VendorService(prisma as any, { publish: vi.fn() } as any);
    await expect(svc.getById(TENANT_B, VENDOR_ID)).rejects.toBeInstanceOf(VendorNotFoundError);
    const result = await svc.getById(TENANT_ID, VENDOR_ID);
    expect(result.id).toBe(VENDOR_ID);
  });

  it('tenant B list never returns tenant A vendors', async () => {
    const prisma = isolatingPrisma();
    const svc = new VendorService(prisma as any, { publish: vi.fn() } as any);
    const result = await svc.list({ tenantId: TENANT_B });
    expect(result.items).toHaveLength(0);
  });
});
