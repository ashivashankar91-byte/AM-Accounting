/**
 * S204 — Franchise Service Unit Tests
 *
 * Tests FranchiseService in isolation with a Prisma mock (no database).
 * Covers: OEM-list control (BR204-1), dealer-code format (BR204-2),
 * duplicate-oem-per-store (409), effective dating (BR204-3), update paths.
 */

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { container } from 'tsyringe';
import {
  FranchiseService,
  FranchiseNotFoundError,
  StoreNotFoundForFranchiseError,
  FranchiseConflictError,
  FranchiseValidationError,
  LAUNCH_OEMS,
} from '../src/application/franchise-service';

// ── Test data ─────────────────────────────────────────────────────────────────

const TENANT   = 'tenant-test';
const STORE_ID = 'store-001';
const FR_ID    = 'fr-001';

const OEM_PATTERNS: Record<string, string> = {
  FORD:       '^[0-9]{5}$',
  GM:         '^[0-9]{6}$',
  TOYOTA:     '^[0-9]{5}$',
  STELLANTIS: '^[0-9]{5}$',
  HONDA:      '^[0-9]{6}$',
  NISSAN:     '^[0-9]{6}$',
};

const ACTIVE_FR = {
  id:            FR_ID,
  tenantId:      TENANT,
  storeId:       STORE_ID,
  oemCode:       'FORD',
  dealerCode:    '12345',
  effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  effectiveTo:   null as Date | null,
  version:       1,
  createdAt:     new Date(),
  updatedAt:     new Date(),
};

function makePrisma(overrides: Record<string, any> = {}) {
  const client: any = {
    store: {
      findFirst: async () => ({ id: STORE_ID, tenantId: TENANT }),
      ...overrides.store,
    },
    oemRef: {
      findFirst: async ({ where }: any) => {
        const p = OEM_PATTERNS[where.oemCode];
        if (!p) return null;
        return { oemCode: where.oemCode, displayName: where.oemCode, dealerCodePattern: p, dealerCodeHint: 'hint', active: true };
      },
      findMany: async () => Object.keys(OEM_PATTERNS).map((c) => ({ oemCode: c })),
      ...overrides.oemRef,
    },
    franchise: {
      findMany:  async () => [ACTIVE_FR],
      findFirst: async ({ where }: any) => {
        // duplicate-active probe: (storeId, oemCode, effectiveTo=null), no id
        if (where.effectiveTo === null && !where.id) return null;
        if (where.id && where.id !== FR_ID) return null;
        return ACTIVE_FR;
      },
      create:    async ({ data }: any) => ({ ...ACTIVE_FR, ...data }),
      update:    async ({ data }: any) => ({ ...ACTIVE_FR, ...data }),
      ...overrides.franchise,
    },
    tenantOutboxEvent: {
      create: async () => ({}),
      ...overrides.tenantOutboxEvent,
    },
    auditOutboxEvent: {
      create: async () => ({}),
      ...overrides.auditOutboxEvent,
    },
  };
  client.$transaction = async (arg: any) =>
    typeof arg === 'function' ? arg(client) : Promise.all(arg);
  return client;
}

function noopPublisher() { return { publish: async () => {} }; }

function makeSvc(overrides: Record<string, any> = {}) {
  container.clearInstances();
  container.registerInstance('PrismaClient', makePrisma(overrides));
  container.registerInstance('IEventPublisher', noopPublisher());
  return container.resolve(FranchiseService);
}

// ── Launch OEM set ──────────────────────────────────────────────────────────

describe('LAUNCH_OEMS (BR204-1)', () => {
  it('FR204-0: launch set is exactly the six platform OEMs', () => {
    expect([...LAUNCH_OEMS].sort()).toEqual(['FORD', 'GM', 'HONDA', 'NISSAN', 'STELLANTIS', 'TOYOTA']);
  });
});

// ── create ──────────────────────────────────────────────────────────────────

describe('FranchiseService.create', () => {
  it('FR204-1: adds Ford to a store with a valid 5-digit dealer code', async () => {
    const svc = makeSvc();
    const fr = await svc.create({ tenantId: TENANT, storeId: STORE_ID, oemCode: 'FORD', dealerCode: '54321', effectiveFrom: '2026-02-01' });
    expect(fr.oemCode).toBe('FORD');
    expect(fr.dealerCode).toBe('54321');
    expect(fr.effectiveTo).toBeNull();
  });

  it('FR204-2: unknown OEM → UNKNOWN_OEM (422)', async () => {
    const svc = makeSvc();
    await expect(
      svc.create({ tenantId: TENANT, storeId: STORE_ID, oemCode: 'TESLA', dealerCode: '12345', effectiveFrom: '2026-02-01' }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_OEM' });
  });

  it('FR204-3: Ford dealer code with wrong length → DEALER_CODE_FORMAT (422)', async () => {
    const svc = makeSvc();
    await expect(
      svc.create({ tenantId: TENANT, storeId: STORE_ID, oemCode: 'FORD', dealerCode: '123', effectiveFrom: '2026-02-01' }),
    ).rejects.toMatchObject({ code: 'DEALER_CODE_FORMAT' });
  });

  it('FR204-4: GM requires a 6-digit BAC — 5 digits rejected, 6 accepted', async () => {
    const svc = makeSvc();
    await expect(
      svc.create({ tenantId: TENANT, storeId: STORE_ID, oemCode: 'GM', dealerCode: '12345', effectiveFrom: '2026-02-01' }),
    ).rejects.toMatchObject({ code: 'DEALER_CODE_FORMAT' });
    const ok = await svc.create({ tenantId: TENANT, storeId: STORE_ID, oemCode: 'GM', dealerCode: '123456', effectiveFrom: '2026-02-01' });
    expect(ok.oemCode).toBe('GM');
  });

  it('FR204-5: duplicate active OEM per store → DUPLICATE_OEM_PER_STORE (409)', async () => {
    const svc = makeSvc({
      franchise: {
        findFirst: async ({ where }: any) => {
          if (where.effectiveTo === null && !where.id) return ACTIVE_FR; // active dup exists
          return ACTIVE_FR;
        },
      },
    });
    await expect(
      svc.create({ tenantId: TENANT, storeId: STORE_ID, oemCode: 'FORD', dealerCode: '54321', effectiveFrom: '2026-02-01' }),
    ).rejects.toBeInstanceOf(FranchiseConflictError);
  });

  it('FR204-6: store not in tenant → StoreNotFoundForFranchiseError', async () => {
    const svc = makeSvc({ store: { findFirst: async () => null } });
    await expect(
      svc.create({ tenantId: TENANT, storeId: 'ghost', oemCode: 'FORD', dealerCode: '54321', effectiveFrom: '2026-02-01' }),
    ).rejects.toBeInstanceOf(StoreNotFoundForFranchiseError);
  });

  it('FR204-7: malformed effectiveFrom → INVALID_DATE', async () => {
    const svc = makeSvc();
    await expect(
      svc.create({ tenantId: TENANT, storeId: STORE_ID, oemCode: 'FORD', dealerCode: '54321', effectiveFrom: '02/01/2026' }),
    ).rejects.toMatchObject({ code: 'INVALID_DATE' });
  });
});

// ── list / getById ────────────────────────────────────────────────────────────

describe('FranchiseService.list / getById', () => {
  it('FR204-8: list returns store franchises', async () => {
    const svc = makeSvc();
    const res = await svc.list({ tenantId: TENANT, storeId: STORE_ID });
    expect(res.total).toBe(1);
    expect(res.items[0]?.oemCode).toBe('FORD');
  });

  it('FR204-9: getById unknown id → FranchiseNotFoundError', async () => {
    const svc = makeSvc();
    await expect(svc.getById(TENANT, STORE_ID, 'nope')).rejects.toBeInstanceOf(FranchiseNotFoundError);
  });
});

// ── update ──────────────────────────────────────────────────────────────────

describe('FranchiseService.update', () => {
  it('FR204-10: version conflict → VERSION_CONFLICT', async () => {
    const svc = makeSvc();
    await expect(svc.update(TENANT, STORE_ID, FR_ID, { version: 99 })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('FR204-11: update with bad dealer code → DEALER_CODE_FORMAT', async () => {
    const svc = makeSvc();
    await expect(svc.update(TENANT, STORE_ID, FR_ID, { version: 1, dealerCode: 'ABC' })).rejects.toMatchObject({ code: 'DEALER_CODE_FORMAT' });
  });

  it('FR204-12: effectiveTo before effectiveFrom → INVALID_EFFECTIVE_RANGE', async () => {
    const svc = makeSvc();
    await expect(svc.update(TENANT, STORE_ID, FR_ID, { version: 1, effectiveTo: '2025-01-01' })).rejects.toMatchObject({ code: 'INVALID_EFFECTIVE_RANGE' });
  });

  it('FR204-13: sell event sets effectiveTo and bumps version', async () => {
    const svc = makeSvc();
    const fr = await svc.update(TENANT, STORE_ID, FR_ID, { version: 1, effectiveTo: '2026-06-30' });
    expect(fr.version).toBe(2);
    expect(fr.effectiveTo).not.toBeNull();
  });
});
