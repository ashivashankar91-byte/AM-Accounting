import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  StoreService,
  StoreNotFoundError,
  StoreConflictError,
  StoreValidationError,
} from '../src/application/store-service';

// ── Test helpers ──────────────────────────────────────────────────────────────

const TENANT_ID  = 'tenant-test-st';
const ENTITY_ID  = 'entity-uuid-001';
const STORE_ID   = 'store-uuid-001';

const BASE_STORE = {
  id:                 STORE_ID,
  tenantId:           TENANT_ID,
  entityId:           ENTITY_ID,
  storeCode:          '01',
  storeName:          'North Store',
  stateProvince:      'IL',
  addressLine1:       '100 N Main St',
  addressLine2:       null,
  city:               'Chicago',
  postalCode:         '60601',
  dmvId:              null,
  status:             'ACTIVE',
  version:            1,
  deactivatedAt:      null,
  deactivatedBy:      null,
  deactivationReason: null,
  createdAt:          new Date(),
  updatedAt:          new Date(),
};

const BASE_ENTITY = {
  id:       ENTITY_ID,
  tenantId: TENANT_ID,
  status:   'ACTIVE',
};

function makePrisma(overrides: Partial<{
  storeFindFirst:   ReturnType<typeof vi.fn>;
  storeFindMany:    ReturnType<typeof vi.fn>;
  storeCount:       ReturnType<typeof vi.fn>;
  storeCreate:      ReturnType<typeof vi.fn>;
  storeUpdate:      ReturnType<typeof vi.fn>;
  entityFindFirst:  ReturnType<typeof vi.fn>;
  outboxCreate:     ReturnType<typeof vi.fn>;
}> = {}) {
  const client: any = {
    store: {
      findFirst: overrides.storeFindFirst ?? vi.fn().mockResolvedValue(BASE_STORE),
      findMany:  overrides.storeFindMany  ?? vi.fn().mockResolvedValue([BASE_STORE]),
      count:     overrides.storeCount     ?? vi.fn().mockResolvedValue(1),
      create:    overrides.storeCreate    ?? vi.fn().mockImplementation(({ data }) =>
        Promise.resolve({ ...BASE_STORE, ...data, id: STORE_ID })),
      update:    overrides.storeUpdate    ?? vi.fn().mockImplementation(({ data }) =>
        Promise.resolve({ ...BASE_STORE, ...data })),
    },
    legalEntity: {
      findFirst: overrides.entityFindFirst ?? vi.fn().mockResolvedValue(BASE_ENTITY),
    },
    tenantOutboxEvent: {
      create: overrides.outboxCreate ?? vi.fn().mockResolvedValue({}),
    },
    auditOutboxEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
  client.$transaction = async (arg: any) =>
    typeof arg === 'function' ? arg(client) : Promise.all(arg);
  return client;
}

function makeEventPublisher() {
  return { publish: vi.fn().mockResolvedValue(undefined) };
}

function makeService(prismaOverrides = {}) {
  const prisma    = makePrisma(prismaOverrides);
  const publisher = makeEventPublisher();
  const svc       = new StoreService(prisma as any, publisher as any);
  return { svc, prisma, publisher };
}

// ── StoreService.list ─────────────────────────────────────────────────────────

describe('StoreService.list', () => {
  it('returns paginated stores for a tenant', async () => {
    const { svc } = makeService();
    const result = await svc.list({ tenantId: TENANT_ID, page: 1, pageSize: 50 });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.items[0].tenantId).toBe(TENANT_ID);
  });

  it('filters by status', async () => {
    const storeFindMany = vi.fn().mockResolvedValue([]);
    const storeCount    = vi.fn().mockResolvedValue(0);
    const { svc } = makeService({ storeFindMany, storeCount });
    await svc.list({ tenantId: TENANT_ID, status: 'INACTIVE', page: 1, pageSize: 50 });
    const whereArg = storeFindMany.mock.calls[0][0].where;
    expect(whereArg.status).toBe('INACTIVE');
  });

  it('filters by entityId', async () => {
    const storeFindMany = vi.fn().mockResolvedValue([BASE_STORE]);
    const storeCount    = vi.fn().mockResolvedValue(1);
    const { svc } = makeService({ storeFindMany, storeCount });
    await svc.list({ tenantId: TENANT_ID, entityId: ENTITY_ID, page: 1, pageSize: 50 });
    const whereArg = storeFindMany.mock.calls[0][0].where;
    expect(whereArg.entityId).toBe(ENTITY_ID);
  });

  it('applies search filter on storeCode and storeName', async () => {
    const storeFindMany = vi.fn().mockResolvedValue([BASE_STORE]);
    const storeCount    = vi.fn().mockResolvedValue(1);
    const { svc } = makeService({ storeFindMany, storeCount });
    await svc.list({ tenantId: TENANT_ID, search: 'north', page: 1, pageSize: 50 });
    const whereArg = storeFindMany.mock.calls[0][0].where;
    expect(whereArg.OR).toBeDefined();
  });
});

// ── StoreService.getById ──────────────────────────────────────────────────────

describe('StoreService.getById', () => {
  it('returns store when found', async () => {
    const { svc } = makeService();
    const result = await svc.getById(TENANT_ID, STORE_ID);
    expect(result.id).toBe(STORE_ID);
  });

  it('throws StoreNotFoundError when not found', async () => {
    const { svc } = makeService({ storeFindFirst: vi.fn().mockResolvedValue(null) });
    await expect(svc.getById(TENANT_ID, 'bad-id')).rejects.toBeInstanceOf(StoreNotFoundError);
  });
});

// ── StoreService.create ───────────────────────────────────────────────────────

describe('StoreService.create', () => {
  it('creates a store successfully', async () => {
    const storeCreate = vi.fn().mockResolvedValue({ ...BASE_STORE, id: STORE_ID });
    // first findFirst → no duplicate; second → skip (store will use entity check separately)
    const storeFindFirst = vi.fn().mockResolvedValue(null); // no duplicate code
    const { svc } = makeService({ storeCreate, storeFindFirst });
    const result = await svc.create({
      tenantId:     TENANT_ID,
      entityId:     ENTITY_ID,
      storeCode:    '01',
      storeName:    'North Store',
      stateProvince: 'IL',
    });
    expect(storeCreate).toHaveBeenCalled();
    expect(result.storeCode).toBe('01');
  });

  it('throws StoreValidationError (ORPHAN_STORE) when entity does not belong to tenant', async () => {
    const { svc } = makeService({
      entityFindFirst: vi.fn().mockResolvedValue(null), // entity not found in tenant
    });
    await expect(
      svc.create({
        tenantId:     TENANT_ID,
        entityId:     'alien-entity',
        storeCode:    '01',
        storeName:    'Store',
        stateProvince: 'IL',
      }),
    ).rejects.toBeInstanceOf(StoreValidationError);
  });

  it('throws StoreConflictError (DUPLICATE_STORE_CODE) on code collision', async () => {
    const storeFindFirst = vi.fn().mockResolvedValue(BASE_STORE); // existing store with same code
    const { svc } = makeService({ storeFindFirst });
    await expect(
      svc.create({
        tenantId:     TENANT_ID,
        entityId:     ENTITY_ID,
        storeCode:    '01',
        storeName:    'Duplicate',
        stateProvince: 'IL',
      }),
    ).rejects.toBeInstanceOf(StoreConflictError);
  });
});

// ── StoreService.update ───────────────────────────────────────────────────────

describe('StoreService.update', () => {
  it('updates a store successfully', async () => {
    const storeUpdate = vi.fn().mockResolvedValue({ ...BASE_STORE, storeName: 'Updated' });
    const { svc } = makeService({ storeUpdate });
    const result = await svc.update(TENANT_ID, STORE_ID, { version: 1, storeName: 'Updated' });
    expect(result.storeName).toBe('Updated');
  });

  it('throws StoreConflictError on version mismatch', async () => {
    const { svc } = makeService(); // BASE_STORE.version = 1
    await expect(
      svc.update(TENANT_ID, STORE_ID, { version: 99, storeName: 'New Name' }),
    ).rejects.toBeInstanceOf(StoreConflictError);
  });

  it('throws StoreValidationError when updating inactive store', async () => {
    const inactiveStore = { ...BASE_STORE, status: 'INACTIVE' };
    const { svc } = makeService({ storeFindFirst: vi.fn().mockResolvedValue(inactiveStore) });
    await expect(
      svc.update(TENANT_ID, STORE_ID, { version: 1, storeName: 'New' }),
    ).rejects.toBeInstanceOf(StoreValidationError);
  });

  it('throws StoreNotFoundError when store missing', async () => {
    const { svc } = makeService({ storeFindFirst: vi.fn().mockResolvedValue(null) });
    await expect(
      svc.update(TENANT_ID, 'missing', { version: 1 }),
    ).rejects.toBeInstanceOf(StoreNotFoundError);
  });
});

// ── StoreService.deactivate ───────────────────────────────────────────────────

describe('StoreService.deactivate', () => {
  it('deactivates an active store', async () => {
    const storeUpdate = vi.fn().mockResolvedValue({ ...BASE_STORE, status: 'INACTIVE' });
    const { svc } = makeService({ storeUpdate });
    const result = await svc.deactivate(TENANT_ID, STORE_ID, {
      version:         1,
      reason:          'Closing location',
      deactivatedBy:   'admin-user',
    });
    expect(storeUpdate).toHaveBeenCalled();
    expect(result.status).toBe('INACTIVE');
  });

  it('throws StoreValidationError when already inactive', async () => {
    const inactiveStore = { ...BASE_STORE, status: 'INACTIVE' };
    const { svc } = makeService({ storeFindFirst: vi.fn().mockResolvedValue(inactiveStore) });
    await expect(
      svc.deactivate(TENANT_ID, STORE_ID, { version: 1, reason: 'x', deactivatedBy: 'admin' }),
    ).rejects.toBeInstanceOf(StoreValidationError);
  });

  it('throws StoreConflictError on version mismatch', async () => {
    const { svc } = makeService();
    await expect(
      svc.deactivate(TENANT_ID, STORE_ID, { version: 99, reason: 'x', deactivatedBy: 'admin' }),
    ).rejects.toBeInstanceOf(StoreConflictError);
  });

  it('throws StoreNotFoundError when store missing', async () => {
    const { svc } = makeService({ storeFindFirst: vi.fn().mockResolvedValue(null) });
    await expect(
      svc.deactivate(TENANT_ID, 'missing', { version: 1, reason: 'x', deactivatedBy: 'admin' }),
    ).rejects.toBeInstanceOf(StoreNotFoundError);
  });
});
