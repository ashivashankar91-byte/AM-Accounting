import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LegalEntityService,
  LegalEntityNotFoundError,
  LegalEntityConflictError,
  LegalEntityValidationError,
} from '../src/application/legal-entity-service';

// ── Test helpers ──────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-test-le';
const ENTITY_ID = 'le-uuid-001';

const BASE_ENTITY = {
  id:                 ENTITY_ID,
  tenantId:           TENANT_ID,
  entityCode:         'KUNES-IL',
  legalName:          'Kunes Country Auto Group IL',
  displayName:        'Kunes IL',
  statutoryId:        '12-3456789',
  functionalCurrency: 'USD',
  country:            'US',
  fiscalYearEndMonth: 12,
  address:            '100 Main St',
  city:               'Chicago',
  state:              'IL',
  postalCode:         '60601',
  status:             'ACTIVE',
  effectiveDate:      new Date('2024-01-01'),
  version:            1,
  hasPostedJournals:  false,
  deactivatedAt:      null,
  deactivatedBy:      null,
  deactivationReason: null,
  createdAt:          new Date(),
  updatedAt:          new Date(),
};

function makePrisma(overrides: Partial<{
  findFirst: ReturnType<typeof vi.fn>;
  findMany:  ReturnType<typeof vi.fn>;
  count:     ReturnType<typeof vi.fn>;
  create:    ReturnType<typeof vi.fn>;
  update:    ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  outboxCreate: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    legalEntity: {
      findFirst:  overrides.findFirst  ?? vi.fn().mockResolvedValue(BASE_ENTITY),
      findMany:   overrides.findMany   ?? vi.fn().mockResolvedValue([BASE_ENTITY]),
      count:      overrides.count      ?? vi.fn().mockResolvedValue(1),
      create:     overrides.create     ?? vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...data, id: ENTITY_ID })),
      update:     overrides.update     ?? vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...BASE_ENTITY, ...data })),
      updateMany: overrides.updateMany ?? vi.fn().mockResolvedValue({ count: 1 }),
    },
    tenantOutboxEvent: {
      create: overrides.outboxCreate ?? vi.fn().mockResolvedValue({}),
    },
  };
}

function makeEventPublisher() {
  return { publish: vi.fn().mockResolvedValue(undefined) };
}

function makeService(prismaOverrides = {}) {
  const prisma    = makePrisma(prismaOverrides);
  const publisher = makeEventPublisher();
  const svc       = new LegalEntityService(prisma as any, publisher as any);
  return { svc, prisma, publisher };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LegalEntityService.list', () => {
  it('returns paginated entities for a tenant', async () => {
    const { svc } = makeService();
    const result = await svc.list({ tenantId: TENANT_ID, page: 1, pageSize: 50 });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('passes search filter to Prisma', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count    = vi.fn().mockResolvedValue(0);
    const { svc }  = makeService({ findMany, count });
    await svc.list({ tenantId: TENANT_ID, search: 'KUNES', status: 'ACTIVE' });
    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.status).toBe('ACTIVE');
    expect(whereArg.OR).toBeDefined();
  });
});

describe('LegalEntityService.getById', () => {
  it('returns entity when found', async () => {
    const { svc } = makeService();
    const entity  = await svc.getById(TENANT_ID, ENTITY_ID);
    expect(entity.entityCode).toBe('KUNES-IL');
  });

  it('throws LegalEntityNotFoundError when not found', async () => {
    const { svc } = makeService({ findFirst: vi.fn().mockResolvedValue(null) });
    await expect(svc.getById(TENANT_ID, 'missing-id')).rejects.toThrow(LegalEntityNotFoundError);
  });
});

describe('LegalEntityService.create', () => {
  const createDTO = {
    tenantId:           TENANT_ID,
    entityCode:         'NEW-01',
    legalName:          'New Corp',
    functionalCurrency: 'USD',
    country:            'US',
    fiscalYearEndMonth: 12,
    effectiveDate:      new Date('2025-01-01'),
  };

  it('creates entity when code is unique', async () => {
    // findFirst returns null (no existing entity with that code)
    const { svc, prisma } = makeService({
      findFirst: vi.fn().mockResolvedValue(null),
    });
    const { entity } = await svc.create(createDTO);
    expect(prisma.legalEntity.create).toHaveBeenCalledOnce();
    expect(entity.entityCode).toBe('NEW-01');
  });

  it('throws DUPLICATE_ENTITY_CODE when code already exists', async () => {
    // findFirst returns an existing entity
    const { svc } = makeService({
      findFirst: vi.fn().mockResolvedValue(BASE_ENTITY),
    });
    await expect(svc.create({ ...createDTO, entityCode: 'KUNES-IL' })).rejects.toThrow(
      LegalEntityConflictError,
    );
  });

  it('warns but does not block on duplicate statutory ID', async () => {
    const callCount = { n: 0 };
    const findFirst = vi.fn().mockImplementation(() => {
      callCount.n++;
      // First call: check entityCode uniqueness → null (no dup)
      if (callCount.n === 1) return Promise.resolve(null);
      // Second call: check statutoryId dup → found
      return Promise.resolve({ ...BASE_ENTITY, id: 'other-id' });
    });
    const { svc } = makeService({ findFirst });
    const result = await svc.create({ ...createDTO, statutoryId: '99-9999999' });
    expect(result.warnDuplicateStatutoryId).toBe(true);
  });

  it('writes to outbox after creation', async () => {
    const { svc, prisma } = makeService({
      findFirst: vi.fn().mockResolvedValue(null),
    });
    await svc.create(createDTO);
    expect(prisma.tenantOutboxEvent.create).toHaveBeenCalledOnce();
  });
});

describe('LegalEntityService.update', () => {
  it('updates entity with correct version', async () => {
    const { svc, prisma } = makeService();
    await svc.update(TENANT_ID, ENTITY_ID, {
      version:       1,
      effectiveDate: new Date('2025-06-01'),
      legalName:     'Updated Corp',
    });
    const data = prisma.legalEntity.update.mock.calls[0][0].data;
    expect(data.legalName).toBe('Updated Corp');
    expect(data.version).toBe(2); // incremented
  });

  it('throws VERSION_CONFLICT when version does not match', async () => {
    const { svc } = makeService();
    await expect(
      svc.update(TENANT_ID, ENTITY_ID, {
        version:       99, // wrong
        effectiveDate: new Date(),
      }),
    ).rejects.toThrow(LegalEntityConflictError);
  });

  it('throws ENTITY_INACTIVE when entity is inactive', async () => {
    const { svc } = makeService({
      findFirst: vi.fn().mockResolvedValue({ ...BASE_ENTITY, status: 'INACTIVE' }),
    });
    await expect(
      svc.update(TENANT_ID, ENTITY_ID, { version: 1, effectiveDate: new Date() }),
    ).rejects.toThrow(LegalEntityValidationError);
  });

  it('does not allow entityCode or functionalCurrency in update payload', async () => {
    // The service does not include entityCode/functionalCurrency in UpdateDTO
    // Verify that the update data object never contains entityCode
    const { svc, prisma } = makeService();
    await svc.update(TENANT_ID, ENTITY_ID, {
      version:       1,
      effectiveDate: new Date(),
      legalName:     'X',
    });
    const data = prisma.legalEntity.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('entityCode');
    expect(data).not.toHaveProperty('functionalCurrency');
  });
});

describe('LegalEntityService.deactivate', () => {
  it('sets status to INACTIVE and records deactivation metadata', async () => {
    const { svc, prisma } = makeService();
    await svc.deactivate(TENANT_ID, ENTITY_ID, {
      version:       1,
      reason:        'Business restructure',
      deactivatedBy: 'admin-user',
    });
    const data = prisma.legalEntity.update.mock.calls[0][0].data;
    expect(data.status).toBe('INACTIVE');
    expect(data.deactivationReason).toBe('Business restructure');
    expect(data.deactivatedBy).toBe('admin-user');
    expect(data.deactivatedAt).toBeInstanceOf(Date);
  });

  it('throws ALREADY_INACTIVE when entity is already inactive', async () => {
    const { svc } = makeService({
      findFirst: vi.fn().mockResolvedValue({ ...BASE_ENTITY, status: 'INACTIVE' }),
    });
    await expect(
      svc.deactivate(TENANT_ID, ENTITY_ID, { version: 1, reason: 'x', deactivatedBy: 'u' }),
    ).rejects.toThrow(LegalEntityValidationError);
  });

  it('throws VERSION_CONFLICT on stale version', async () => {
    const { svc } = makeService();
    await expect(
      svc.deactivate(TENANT_ID, ENTITY_ID, { version: 5, reason: 'x', deactivatedBy: 'u' }),
    ).rejects.toThrow(LegalEntityConflictError);
  });
});

describe('LegalEntityService.markHasPostedJournals', () => {
  it('calls updateMany with hasPostedJournals: true', async () => {
    const { svc, prisma } = makeService();
    await svc.markHasPostedJournals(TENANT_ID, ENTITY_ID);
    expect(prisma.legalEntity.updateMany).toHaveBeenCalledWith({
      where: { id: ENTITY_ID, tenantId: TENANT_ID },
      data:  { hasPostedJournals: true },
    });
  });
});
