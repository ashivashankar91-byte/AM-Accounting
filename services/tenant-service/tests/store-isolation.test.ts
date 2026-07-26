/**
 * S201 — Store Cross-Tenant Isolation Tests
 *
 * Verifies that tenant-B cannot read or mutate tenant-A's stores at the
 * service layer, even when bypassing the HTTP auth middleware.
 *
 * Strategy: inject a Prisma mock that returns null/empty whenever a query
 * includes tenantId !== TENANT_A. The service uses findFirst({ where: { id,
 * tenantId } }) for all single-record operations, so any cross-tenant lookup
 * will see null and throw StoreNotFoundError — exactly as required.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { container } from 'tsyringe';
import {
  StoreService,
  StoreNotFoundError,
  StoreConflictError,
} from '../src/application/store-service';

// ── Constants ─────────────────────────────────────────────────────────────────

const TENANT_A = 'tenant-isolation-a';
const TENANT_B = 'tenant-isolation-b';
const STORE_ID = 'store-isolation-001';
const ENTITY_ID = 'a1000000-0000-0000-0000-000000000001';

const STORE_A = {
  id:                 STORE_ID,
  tenantId:           TENANT_A,
  entityId:           ENTITY_ID,
  storeCode:          '01',
  storeName:          'Tenant A Store',
  stateProvince:      'IL',
  addressLine1:       null,
  addressLine2:       null,
  city:               null,
  postalCode:         null,
  dmvId:              null,
  status:             'ACTIVE',
  version:            1,
  deactivatedAt:      null,
  deactivatedBy:      null,
  deactivationReason: null,
  createdAt:          new Date(),
  updatedAt:          new Date(),
};

/**
 * Prisma mock that enforces isolation: findFirst returns the store only when
 * the WHERE clause contains tenantId === TENANT_A. Any query from TENANT_B
 * returns null (simulates the DB row being invisible to that tenant).
 */
function isolatingPrisma() {
  return {
    store: {
      findFirst: async ({ where }: any) => {
        // Only return data when tenantId matches TENANT_A
        if (where.tenantId === TENANT_A) return STORE_A;
        return null;
      },
      findMany:  async ({ where }: any) => {
        if (where.tenantId === TENANT_A) return [STORE_A];
        return [];
      },
      count:     async ({ where }: any) => {
        if (where.tenantId === TENANT_A) return 1;
        return 0;
      },
      create:    async ({ data }: any) => ({ ...data, id: STORE_ID, createdAt: new Date(), updatedAt: new Date() }),
      update:    async ({ data }: any) => ({ ...STORE_A, ...data }),
    },
    legalEntity: {
      findFirst: async ({ where }: any) => {
        if (where.tenantId === TENANT_A) return { id: ENTITY_ID, tenantId: TENANT_A };
        return null;
      },
    },
    outboxEvent: {
      create: async () => ({}),
    },
  };
}

function noopPublisher() {
  return { publish: async () => {} };
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('StoreService — cross-tenant data isolation (ISO201)', () => {
  let svc: StoreService;

  beforeEach(() => {
    container.clearInstances();
    container.registerInstance('PrismaClient', isolatingPrisma());
    container.registerInstance('IEventPublisher', noopPublisher());
    svc = container.resolve(StoreService);
  });

  // ── List isolation ────────────────────────────────────────────────────────

  it('ISO201-1: list returns 0 items for tenant-B even when tenant-A has stores', async () => {
    const result = await svc.list({ tenantId: TENANT_B });
    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it('ISO201-2: list returns correct stores for tenant-A', async () => {
    const result = await svc.list({ tenantId: TENANT_A });
    expect(result.total).toBe(1);
    expect(result.items[0]!.id).toBe(STORE_ID);
  });

  // ── GetById isolation ─────────────────────────────────────────────────────

  it('ISO201-3: getById throws StoreNotFoundError when tenant-B requests tenant-A store', async () => {
    await expect(svc.getById(TENANT_B, STORE_ID)).rejects.toThrow(StoreNotFoundError);
  });

  it('ISO201-4: getById resolves when tenant-A requests its own store', async () => {
    const result = await svc.getById(TENANT_A, STORE_ID);
    expect(result.id).toBe(STORE_ID);
    expect(result.tenantId).toBe(TENANT_A);
  });

  // ── Update isolation ──────────────────────────────────────────────────────

  it('ISO201-5: update throws StoreNotFoundError when tenant-B tries to update tenant-A store', async () => {
    await expect(
      svc.update(TENANT_B, STORE_ID, { version: 1, storeName: 'Hijacked Name' }),
    ).rejects.toThrow(StoreNotFoundError);
  });

  it('ISO201-6: update succeeds when tenant-A updates its own store', async () => {
    const result = await svc.update(TENANT_A, STORE_ID, { version: 1, storeName: 'Updated' });
    expect(result.storeName).toBe('Updated');
  });

  // ── Deactivate isolation ──────────────────────────────────────────────────

  it('ISO201-7: deactivate throws StoreNotFoundError when tenant-B tries to deactivate tenant-A store', async () => {
    await expect(
      svc.deactivate(TENANT_B, STORE_ID, { version: 1, reason: 'hostile', deactivatedBy: 'attacker' }),
    ).rejects.toThrow(StoreNotFoundError);
  });

  it('ISO201-8: deactivate succeeds when tenant-A deactivates its own store', async () => {
    const result = await svc.deactivate(TENANT_A, STORE_ID, {
      version: 1, reason: 'closing', deactivatedBy: 'admin',
    });
    expect(result.status).toBe('INACTIVE');
  });

  // ── Create isolation — entity cross-tenant ─────────────────────────────────

  it('ISO201-9: create throws ORPHAN_STORE when tenant-B supplies a tenant-A entityId', async () => {
    await expect(
      svc.create({
        tenantId:     TENANT_B,
        entityId:     ENTITY_ID,  // belongs to TENANT_A
        storeCode:    'ZZ',
        storeName:    'Hijacked',
        stateProvince: 'IL',
      }),
    ).rejects.toMatchObject({ code: 'ORPHAN_STORE' });
  });
});
