/**
 * S204 — Franchise Cross-Tenant Isolation Tests (ISO204)
 *
 * Verifies tenant-B cannot read or mutate tenant-A's franchises at the service
 * layer, even when bypassing HTTP auth. The service scopes every single-record
 * query with { id, tenantId, storeId }, so any cross-tenant lookup sees null and
 * throws FranchiseNotFoundError. Create additionally requires the store to
 * resolve within the caller's tenant → StoreNotFoundForFranchiseError.
 */

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { container } from 'tsyringe';
import {
  FranchiseService,
  FranchiseNotFoundError,
  StoreNotFoundForFranchiseError,
} from '../src/application/franchise-service';

const TENANT_A = 'tenant-iso-a';
const TENANT_B = 'tenant-iso-b';
const STORE_A  = 'store-iso-a';
const FR_ID    = 'fr-iso-001';

const FR_A = {
  id:            FR_ID,
  tenantId:      TENANT_A,
  storeId:       STORE_A,
  oemCode:       'FORD',
  dealerCode:    '54321',
  effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  effectiveTo:   null as Date | null,
  version:       1,
  createdAt:     new Date(),
  updatedAt:     new Date(),
};

function isolatingPrisma() {
  return {
    store: {
      findFirst: async ({ where }: any) => (where.tenantId === TENANT_A ? { id: STORE_A, tenantId: TENANT_A } : null),
    },
    oemRef: {
      findFirst: async ({ where }: any) =>
        where.oemCode === 'FORD' ? { oemCode: 'FORD', displayName: 'Ford', dealerCodePattern: '^[0-9]{5}$', dealerCodeHint: '5-digit', active: true } : null,
      findMany: async () => [{ oemCode: 'FORD' }],
    },
    franchise: {
      findFirst: async ({ where }: any) => {
        if (where.effectiveTo === null && !where.id) return null; // no active dup
        if (where.tenantId === TENANT_A) return FR_A;
        return null;
      },
      findMany: async ({ where }: any) => (where.tenantId === TENANT_A ? [FR_A] : []),
      create:   async ({ data }: any) => ({ ...FR_A, ...data }),
      update:   async ({ data }: any) => ({ ...FR_A, ...data }),
    },
    tenantOutboxEvent: { create: async () => ({}) },
  };
}

function noopPublisher() { return { publish: async () => {} }; }

function makeSvc() {
  container.clearInstances();
  container.registerInstance('PrismaClient', isolatingPrisma());
  container.registerInstance('IEventPublisher', noopPublisher());
  return container.resolve(FranchiseService);
}

describe('Franchise cross-tenant isolation (ISO204)', () => {
  it('ISO204-1: tenant-A can read its own franchise', async () => {
    const svc = makeSvc();
    const fr = await svc.getById(TENANT_A, STORE_A, FR_ID);
    expect(fr.id).toBe(FR_ID);
  });

  it('ISO204-2: tenant-B getById is blocked → FranchiseNotFoundError', async () => {
    const svc = makeSvc();
    await expect(svc.getById(TENANT_B, STORE_A, FR_ID)).rejects.toBeInstanceOf(FranchiseNotFoundError);
  });

  it('ISO204-3: tenant-A list returns rows', async () => {
    const svc = makeSvc();
    const res = await svc.list({ tenantId: TENANT_A, storeId: STORE_A });
    expect(res.total).toBe(1);
  });

  it('ISO204-4: tenant-B list returns empty', async () => {
    const svc = makeSvc();
    const res = await svc.list({ tenantId: TENANT_B, storeId: STORE_A });
    expect(res.total).toBe(0);
  });

  it('ISO204-5: tenant-B update is blocked → FranchiseNotFoundError', async () => {
    const svc = makeSvc();
    await expect(svc.update(TENANT_B, STORE_A, FR_ID, { version: 1, dealerCode: '11111' })).rejects.toBeInstanceOf(FranchiseNotFoundError);
  });

  it('ISO204-6: tenant-B cannot create against tenant-A store → StoreNotFoundForFranchiseError', async () => {
    const svc = makeSvc();
    await expect(
      svc.create({ tenantId: TENANT_B, storeId: STORE_A, oemCode: 'FORD', dealerCode: '54321', effectiveFrom: '2026-02-01' }),
    ).rejects.toBeInstanceOf(StoreNotFoundForFranchiseError);
  });

  it('ISO204-7: tenant-A can create against its own store', async () => {
    const svc = makeSvc();
    const fr = await svc.create({ tenantId: TENANT_A, storeId: STORE_A, oemCode: 'FORD', dealerCode: '54321', effectiveFrom: '2026-02-01' });
    expect(fr.tenantId).toBe(TENANT_A);
  });
});
