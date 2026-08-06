/**
 * S046 — CustomerService domain tests.
 *
 * Mocked-Prisma unit tests, mirroring the pattern established in
 * tests/vendor-service.test.ts (AMACC-CH04 S036A).
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import {
  CustomerService,
  CustomerNotFoundError,
  CustomerConflictError,
  CustomerValidationError,
  DuplicateCustomerAcknowledgementRequiredError,
  toSafeCustomer,
} from '../src/application/customer-service';

const TENANT_ID = 'tenant-test-customer';
const TENANT_B = 'tenant-test-customer-b';
const CUSTOMER_ID = 'customer-uuid-001';

const BASE_CUSTOMER = {
  id: CUSTOMER_ID,
  tenantId: TENANT_ID,
  customerNumber: '000001',
  normalizedCustomerNumber: '000001',
  customerName: 'Jane Doe',
  normalizedCustomerName: 'jane doe',
  customerType: 'Individual',
  salespersonCode: null,
  arAccountOverride: null,
  companyNumber: null,
  taxId: null,
  taxExemptStatus: false,
  taxExemptCertNumber: null,
  taxExemptExpiration: null,
  creditLimit: '0',
  creditTerms: 'Net30',
  creditProfileEffectiveDate: new Date(),
  creditHold: false,
  creditHoldReason: null,
  creditHoldSetAt: null,
  creditHoldSetBy: null,
  creditHoldClearedAt: null,
  creditHoldClearedBy: null,
  preferredContactMethod: 'Phone',
  doNotSolicit: false,
  doNotMail: false,
  address1: null,
  address2: null,
  city: null,
  state: null,
  zip: '60601',
  country: 'US',
  phone: null,
  normalizedPhone: null,
  phone2: null,
  fax: null,
  email: null,
  normalizedEmail: null,
  secondaryStreet: null,
  secondaryCity: null,
  secondaryState: null,
  secondaryZip: null,
  secondaryCountry: null,
  addressLabel: null,
  flagAR: true,
  flagVehicle: false,
  flagParts: false,
  flagService: false,
  flagFI: false,
  employeeFlag: false,
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
  customerFindFirst: ReturnType<typeof vi.fn>;
  customerFindMany: ReturnType<typeof vi.fn>;
  customerCount: ReturnType<typeof vi.fn>;
  customerCreate: ReturnType<typeof vi.fn>;
  customerUpdate: ReturnType<typeof vi.fn>;
  counterUpsert: ReturnType<typeof vi.fn>;
  counterFindUnique: ReturnType<typeof vi.fn>;
}> = {}) {
  const client: any = {
    customer: {
      findFirst: overrides.customerFindFirst ?? vi.fn().mockResolvedValue(BASE_CUSTOMER),
      findMany: overrides.customerFindMany ?? vi.fn().mockResolvedValue([BASE_CUSTOMER]),
      count: overrides.customerCount ?? vi.fn().mockResolvedValue(1),
      create: overrides.customerCreate ?? vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ ...BASE_CUSTOMER, ...data, id: CUSTOMER_ID })),
      update: overrides.customerUpdate ?? vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ ...BASE_CUSTOMER, ...data })),
    },
    arCustomerNumberCounter: {
      upsert: overrides.counterUpsert ?? vi.fn().mockResolvedValue({ tenantId: TENANT_ID, nextNumber: 2 }),
      findUnique: overrides.counterFindUnique ?? vi.fn().mockResolvedValue({ tenantId: TENANT_ID, nextNumber: 2 }),
    },
    arCustomerDuplicateAcknowledgement: {
      create: vi.fn().mockResolvedValue({}),
    },
    auditOutboxEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
    outboxEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
    // CE-09 cert fix: setTenantContextOnConnection() now runs first inside
    // every interactive $transaction callback in customer-service.ts (RLS
    // hardening), so the mock tx must stub this call.
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
  const svc = new CustomerService(prisma as any, makeEventPublisher() as any);
  return { svc, prisma };
}

// ── Create ───────────────────────────────────────────────────────────────────
describe('CustomerService.create', () => {
  it('defaults a valid new customer to ACTIVE with version 1', async () => {
    const customerCreate = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_CUSTOMER, ...data, id: CUSTOMER_ID }));
    const { svc } = makeService({ customerFindFirst: vi.fn().mockResolvedValue(null), customerFindMany: vi.fn().mockResolvedValue([]), customerCreate });
    const result = await svc.create({ tenantId: TENANT_ID, customerName: 'New Customer' }, 'user-1');
    expect(result.status).toBe('ACTIVE');
    expect(customerCreate.mock.calls[0][0].data.status).toBe('ACTIVE');
    expect(customerCreate.mock.calls[0][0].data.version).toBe(1);
  });

  it('defaults customerType to Individual when not supplied', async () => {
    const customerCreate = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_CUSTOMER, ...data, id: CUSTOMER_ID }));
    const { svc } = makeService({ customerFindFirst: vi.fn().mockResolvedValue(null), customerFindMany: vi.fn().mockResolvedValue([]), customerCreate });
    await svc.create({ tenantId: TENANT_ID, customerName: 'New Customer' }, 'user-1');
    expect(customerCreate.mock.calls[0][0].data.customerType).toBe('Individual');
  });

  it('accepts an explicit Business customerType', async () => {
    const customerCreate = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_CUSTOMER, ...data, id: CUSTOMER_ID }));
    const { svc } = makeService({ customerFindFirst: vi.fn().mockResolvedValue(null), customerFindMany: vi.fn().mockResolvedValue([]), customerCreate });
    await svc.create({ tenantId: TENANT_ID, customerName: 'Acme LLC', customerType: 'Business' }, 'user-1');
    expect(customerCreate.mock.calls[0][0].data.customerType).toBe('Business');
  });

  it('rejects an unsupported customer type', async () => {
    const { svc } = makeService({ customerFindFirst: vi.fn().mockResolvedValue(null), customerFindMany: vi.fn().mockResolvedValue([]) });
    await expect(
      svc.create({ tenantId: TENANT_ID, customerName: 'X', customerType: 'NOT_A_TYPE' } as any, 'user-1'),
    ).rejects.toBeInstanceOf(CustomerValidationError);
  });

  it('rejects unsupported credit terms', async () => {
    const { svc } = makeService({ customerFindFirst: vi.fn().mockResolvedValue(null), customerFindMany: vi.fn().mockResolvedValue([]) });
    await expect(
      svc.create({ tenantId: TENANT_ID, customerName: 'X', creditTerms: 'Net999' } as any, 'user-1'),
    ).rejects.toBeInstanceOf(CustomerValidationError);
  });

  it('normalizes customer number to uppercase/trimmed form', async () => {
    const customerCreate = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_CUSTOMER, ...data, id: CUSTOMER_ID }));
    const { svc } = makeService({ customerFindFirst: vi.fn().mockResolvedValue(null), customerFindMany: vi.fn().mockResolvedValue([]), customerCreate });
    await svc.create({ tenantId: TENANT_ID, customerName: 'X', customerNumber: ' ab12 ' }, 'user-1');
    expect(customerCreate.mock.calls[0][0].data.normalizedCustomerNumber).toBe('AB12');
  });

  // Customer-number uniqueness — hard block on exact normalized match in tenant
  it('blocks create when normalized customer number already exists in tenant', async () => {
    const { svc } = makeService({ customerFindFirst: vi.fn().mockResolvedValue(BASE_CUSTOMER) });
    await expect(
      svc.create({ tenantId: TENANT_ID, customerName: 'Dup', customerNumber: '000001' }, 'user-1'),
    ).rejects.toMatchObject({ code: 'CUSTOMER_NUMBER_ALREADY_EXISTS' });
  });

  it('auto-generates a sequential customer number using the per-tenant counter', async () => {
    const customerCreate = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_CUSTOMER, ...data, id: CUSTOMER_ID }));
    const counterUpsert = vi.fn().mockResolvedValue({ tenantId: TENANT_ID, nextNumber: 43 });
    const counterFindUnique = vi.fn().mockResolvedValue({ tenantId: TENANT_ID, nextNumber: 43 });
    const { svc } = makeService({
      customerFindFirst: vi.fn().mockResolvedValue(null),
      customerFindMany: vi.fn().mockResolvedValue([]),
      customerCreate, counterUpsert, counterFindUnique,
    });
    await svc.create({ tenantId: TENANT_ID, customerName: 'Auto Numbered' }, 'user-1');
    expect(customerCreate.mock.calls[0][0].data.customerNumber).toBe('000042');
  });

  // Duplicate-customer protection (candidate/soft match)
  it('returns a duplicate-acknowledgement-required error for a name+zip match', async () => {
    const { svc } = makeService({
      customerFindFirst: vi.fn().mockResolvedValue(null),
      customerFindMany: vi.fn().mockResolvedValue([BASE_CUSTOMER]),
    });
    await expect(
      svc.create({ tenantId: TENANT_ID, customerName: 'Jane Doe', zip: '60601' }, 'user-1'),
    ).rejects.toBeInstanceOf(DuplicateCustomerAcknowledgementRequiredError);
  });

  it('returns a duplicate-acknowledgement-required error for an email match', async () => {
    const { svc } = makeService({
      customerFindFirst: vi.fn().mockResolvedValue(null),
      customerFindMany: vi.fn().mockResolvedValue([{ ...BASE_CUSTOMER, normalizedEmail: 'jane@example.com' }]),
    });
    await expect(
      svc.create({ tenantId: TENANT_ID, customerName: 'Someone Else', email: 'Jane@Example.com' }, 'user-1'),
    ).rejects.toBeInstanceOf(DuplicateCustomerAcknowledgementRequiredError);
  });

  it('creates the customer and persists an acknowledgement when override is supplied', async () => {
    const ackCreate = vi.fn().mockResolvedValue({});
    const { svc, prisma } = makeService({
      customerFindFirst: vi.fn().mockResolvedValue(null),
      customerFindMany: vi.fn().mockResolvedValue([BASE_CUSTOMER]),
    });
    prisma.arCustomerDuplicateAcknowledgement.create = ackCreate;
    const result = await svc.create(
      { tenantId: TENANT_ID, customerName: 'Jane Doe', zip: '60601', override: { reason: 'Confirmed different person' } },
      'user-1',
      'corr-123',
    );
    expect(result).toBeDefined();
    expect(ackCreate).toHaveBeenCalledTimes(1);
    const ackData = ackCreate.mock.calls[0][0].data;
    expect(ackData.reason).toBe('Confirmed different person');
    expect(ackData.actor).toBe('user-1');
    expect(ackData.correlationId).toBe('corr-123');
  });
});

// ── toSafeCustomer projection ────────────────────────────────────────────────
describe('toSafeCustomer', () => {
  it('never includes internal normalized comparison columns in the API projection', () => {
    const safe = toSafeCustomer(BASE_CUSTOMER) as any;
    expect(safe.normalizedCustomerNumber).toBeUndefined();
    expect(safe.normalizedCustomerName).toBeUndefined();
    expect(safe.normalizedEmail).toBeUndefined();
    expect(safe.normalizedPhone).toBeUndefined();
    expect(safe.customerName).toBe(BASE_CUSTOMER.customerName);
  });

  it('returns null/undefined unchanged', () => {
    expect(toSafeCustomer(null)).toBeNull();
  });
});

// ── Lifecycle transitions ────────────────────────────────────────────────────
describe('CustomerService.inactivate', () => {
  it('requires a reason', async () => {
    const { svc } = makeService();
    await expect(svc.inactivate(TENANT_ID, CUSTOMER_ID, { version: 1, reason: '' }, 'user-1'))
      .rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  });

  it('only transitions ACTIVE -> INACTIVE', async () => {
    const inactiveCustomer = { ...BASE_CUSTOMER, status: 'INACTIVE' };
    const { svc } = makeService({ customerFindFirst: vi.fn().mockResolvedValue(inactiveCustomer) });
    await expect(svc.inactivate(TENANT_ID, CUSTOMER_ID, { version: 1, reason: 'closing' }, 'user-1'))
      .rejects.toMatchObject({ code: 'ALREADY_INACTIVE' });
  });

  it('inactivates an active customer with a reason', async () => {
    const customerUpdate = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_CUSTOMER, ...data }));
    const { svc } = makeService({ customerUpdate });
    const result = await svc.inactivate(TENANT_ID, CUSTOMER_ID, { version: 1, reason: 'Customer closed account' }, 'user-1');
    expect(result.status).toBe('INACTIVE');
    expect(customerUpdate.mock.calls[0][0].data.inactiveReason).toBe('Customer closed account');
  });

  it('rejects a stale version (optimistic concurrency)', async () => {
    const { svc } = makeService();
    await expect(svc.inactivate(TENANT_ID, CUSTOMER_ID, { version: 99, reason: 'x' }, 'user-1'))
      .rejects.toBeInstanceOf(CustomerConflictError);
  });
});

describe('CustomerService.reactivate', () => {
  it('only transitions INACTIVE -> ACTIVE', async () => {
    const { svc } = makeService(); // BASE_CUSTOMER is ACTIVE
    await expect(svc.reactivate(TENANT_ID, CUSTOMER_ID, { version: 1 }, 'user-1'))
      .rejects.toMatchObject({ code: 'ALREADY_ACTIVE' });
  });

  it('reactivates an inactive customer', async () => {
    const inactiveCustomer = { ...BASE_CUSTOMER, status: 'INACTIVE' };
    const customerUpdate = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...inactiveCustomer, ...data }));
    const { svc } = makeService({ customerFindFirst: vi.fn().mockResolvedValue(inactiveCustomer), customerUpdate });
    const result = await svc.reactivate(TENANT_ID, CUSTOMER_ID, { version: 1 }, 'user-1');
    expect(result.status).toBe('ACTIVE');
  });
});

// ── Update (edit) with optimistic concurrency ───────────────────────────────
describe('CustomerService.update', () => {
  it('rejects a stale version', async () => {
    const { svc } = makeService();
    await expect(svc.update(TENANT_ID, CUSTOMER_ID, { version: 99, customerName: 'New Name' }, 'user-1'))
      .rejects.toBeInstanceOf(CustomerConflictError);
  });

  it('refuses to edit an inactive customer', async () => {
    const { svc } = makeService({ customerFindFirst: vi.fn().mockResolvedValue({ ...BASE_CUSTOMER, status: 'INACTIVE' }) });
    await expect(svc.update(TENANT_ID, CUSTOMER_ID, { version: 1, customerName: 'New Name' }, 'user-1'))
      .rejects.toMatchObject({ code: 'CUSTOMER_INACTIVE' });
  });

  it('applies a valid edit and increments version', async () => {
    const customerUpdate = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_CUSTOMER, ...data }));
    const { svc } = makeService({ customerUpdate });
    const result = await svc.update(TENANT_ID, CUSTOMER_ID, { version: 1, customerName: 'Jane A. Doe' }, 'user-1');
    expect(result.customerName).toBe('Jane A. Doe');
    expect(customerUpdate.mock.calls[0][0].data.version).toBe(2);
  });
});

// ── New-charge eligibility (status + credit hold) ───────────────────────────
describe('CustomerService.eligibility', () => {
  it('ACTIVE customer with no credit hold is eligible', async () => {
    const { svc } = makeService();
    const result = await svc.eligibility(TENANT_ID, CUSTOMER_ID);
    expect(result.eligible).toBe(true);
  });

  it('INACTIVE customer is not eligible', async () => {
    const { svc } = makeService({ customerFindFirst: vi.fn().mockResolvedValue({ ...BASE_CUSTOMER, status: 'INACTIVE' }) });
    const result = await svc.eligibility(TENANT_ID, CUSTOMER_ID);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/inactive/i);
  });

  it('ACTIVE customer on credit hold is not eligible', async () => {
    const { svc } = makeService({ customerFindFirst: vi.fn().mockResolvedValue({ ...BASE_CUSTOMER, creditHold: true, creditHoldReason: 'Past due balance' }) });
    const result = await svc.eligibility(TENANT_ID, CUSTOMER_ID);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('Past due balance');
  });

  it('DELETED customer is not found (not eligible)', async () => {
    const { svc } = makeService({ customerFindFirst: vi.fn().mockResolvedValue(null) });
    await expect(svc.eligibility(TENANT_ID, CUSTOMER_ID)).rejects.toBeInstanceOf(CustomerNotFoundError);
  });
});

// ── Credit profile: hold / release ──────────────────────────────────────────
describe('CustomerService.setCreditHold', () => {
  it('requires a reason', async () => {
    const { svc } = makeService();
    await expect(svc.setCreditHold(TENANT_ID, CUSTOMER_ID, { version: 1, reason: '' }, 'controller-1'))
      .rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  });

  it('rejects placing a hold on a customer already on hold', async () => {
    const { svc } = makeService({ customerFindFirst: vi.fn().mockResolvedValue({ ...BASE_CUSTOMER, creditHold: true }) });
    await expect(svc.setCreditHold(TENANT_ID, CUSTOMER_ID, { version: 1, reason: 'x' }, 'controller-1'))
      .rejects.toMatchObject({ code: 'ALREADY_ON_HOLD' });
  });

  it('rejects a stale version', async () => {
    const { svc } = makeService();
    await expect(svc.setCreditHold(TENANT_ID, CUSTOMER_ID, { version: 99, reason: 'Past due' }, 'controller-1'))
      .rejects.toBeInstanceOf(CustomerConflictError);
  });

  it('places a credit hold with a reason and actor', async () => {
    const customerUpdate = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_CUSTOMER, ...data }));
    const { svc } = makeService({ customerUpdate });
    const result = await svc.setCreditHold(TENANT_ID, CUSTOMER_ID, { version: 1, reason: 'Past due balance' }, 'controller-1');
    expect(result.creditHold).toBe(true);
    expect(customerUpdate.mock.calls[0][0].data.creditHoldReason).toBe('Past due balance');
    expect(customerUpdate.mock.calls[0][0].data.creditHoldSetBy).toBe('controller-1');
  });
});

describe('CustomerService.releaseCreditHold', () => {
  it('rejects releasing a hold that is not set', async () => {
    const { svc } = makeService();
    await expect(svc.releaseCreditHold(TENANT_ID, CUSTOMER_ID, { version: 1 }, 'controller-1'))
      .rejects.toMatchObject({ code: 'NOT_ON_HOLD' });
  });

  it('rejects a stale version', async () => {
    const { svc } = makeService({ customerFindFirst: vi.fn().mockResolvedValue({ ...BASE_CUSTOMER, creditHold: true }) });
    await expect(svc.releaseCreditHold(TENANT_ID, CUSTOMER_ID, { version: 99 }, 'controller-1'))
      .rejects.toBeInstanceOf(CustomerConflictError);
  });

  it('releases a credit hold', async () => {
    const onHold = { ...BASE_CUSTOMER, creditHold: true, creditHoldReason: 'Past due balance' };
    const customerUpdate = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...onHold, ...data }));
    const { svc } = makeService({ customerFindFirst: vi.fn().mockResolvedValue(onHold), customerUpdate });
    const result = await svc.releaseCreditHold(TENANT_ID, CUSTOMER_ID, { version: 1 }, 'controller-1');
    expect(result.creditHold).toBe(false);
    expect(customerUpdate.mock.calls[0][0].data.creditHoldClearedBy).toBe('controller-1');
  });
});

// ── Cross-tenant isolation at the service layer ─────────────────────────────
describe('CustomerService cross-tenant isolation', () => {
  function isolatingPrisma() {
    const client: any = {
      customer: {
        findFirst: async ({ where }: any) => (where.tenantId === TENANT_ID ? BASE_CUSTOMER : null),
        findMany: async ({ where }: any) => (where.tenantId === TENANT_ID ? [BASE_CUSTOMER] : []),
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

  it('tenant B cannot read tenant A customer by id', async () => {
    const prisma = isolatingPrisma();
    const svc = new CustomerService(prisma as any, { publish: vi.fn() } as any);
    await expect(svc.getById(TENANT_B, CUSTOMER_ID)).rejects.toBeInstanceOf(CustomerNotFoundError);
    const result = await svc.getById(TENANT_ID, CUSTOMER_ID);
    expect(result.id).toBe(CUSTOMER_ID);
  });

  it('tenant B list never returns tenant A customers', async () => {
    const prisma = isolatingPrisma();
    const svc = new CustomerService(prisma as any, { publish: vi.fn() } as any);
    const result = await svc.list({ tenantId: TENANT_B });
    expect(result.items).toHaveLength(0);
  });
});
