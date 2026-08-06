/**
 * CE-09 S048 — WholesaleVehicleService domain tests. Mocked-Prisma unit
 * tests, same style as payment-lifecycle-service.test.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import {
  WholesaleVehicleService,
  WholesaleVehicleItemNotFoundError,
  WholesaleVehicleValidationError,
  TitleReleaseRefusedUnpaidError,
} from '../src/application/wholesale-vehicle-service';

const TENANT_ID = 'tenant-wholesale';
const ITEM_ID = 'item-1';

const BASE_ITEM = {
  id: ITEM_ID, tenantId: TENANT_ID, customerId: 'customer-1', vehicleVin: 'VIN123', saleAmount: '25000.00', amountPaid: '0.00',
  status: 'OPEN', titleReleased: false, version: 1,
};

function makePrisma(overrides: any = {}) {
  const client: any = {
    arWholesaleVehicleItem: {
      findFirst: overrides.itemFindFirst ?? vi.fn().mockResolvedValue(BASE_ITEM),
      findMany: overrides.itemFindMany ?? vi.fn().mockResolvedValue([BASE_ITEM]),
      create: overrides.itemCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'item-2', ...data })),
      update: overrides.itemUpdate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_ITEM, ...data })),
    },
    arTitleReleaseException: {
      create: overrides.exceptionCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'exception-1', ...data })),
      findMany: overrides.exceptionFindMany ?? vi.fn().mockResolvedValue([]),
    },
    auditOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
    // Row-lock re-read for recordPayment/releaseTitle/releaseTitleWithException
    // — by default mirrors BASE_ITEM (snake_case columns).
    $queryRawUnsafe: overrides.queryRawUnsafe ?? vi.fn().mockImplementation(async () => [{
      id: BASE_ITEM.id, sale_amount: BASE_ITEM.saleAmount, amount_paid: BASE_ITEM.amountPaid,
      status: BASE_ITEM.status, title_released: BASE_ITEM.titleReleased, version: BASE_ITEM.version,
    }]),
  };
  client.$transaction = async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg));
  return client;
}

describe('WholesaleVehicleService.create', () => {
  it('creates an OPEN item', async () => {
    const prisma = makePrisma();
    const svc = new WholesaleVehicleService(prisma, {} as any);
    const item = await svc.create(TENANT_ID, { customerId: 'customer-1', vehicleVin: 'VIN123', saleAmount: 25000 }, 'clerk-1');
    expect(item.status).toBe('OPEN');
  });

  it('rejects a non-positive sale amount', async () => {
    const prisma = makePrisma();
    const svc = new WholesaleVehicleService(prisma, {} as any);
    await expect(svc.create(TENANT_ID, { customerId: 'customer-1', vehicleVin: 'VIN123', saleAmount: 0 }, 'clerk-1')).rejects.toBeInstanceOf(WholesaleVehicleValidationError);
  });
});

describe('WholesaleVehicleService.recordPayment', () => {
  it('transitions to PAID_IN_FULL once amountPaid reaches saleAmount', async () => {
    const prisma = makePrisma({
      queryRawUnsafe: vi.fn().mockResolvedValue([{ id: ITEM_ID, sale_amount: '25000.00', amount_paid: '0.00', status: 'OPEN', version: 1 }]),
    });
    const svc = new WholesaleVehicleService(prisma, {} as any);
    const item = await svc.recordPayment(TENANT_ID, ITEM_ID, { amount: 25000 }, 'clerk-1');
    expect(item.status).toBe('PAID_IN_FULL');
  });

  it('stays OPEN for a partial payment', async () => {
    const prisma = makePrisma({
      queryRawUnsafe: vi.fn().mockResolvedValue([{ id: ITEM_ID, sale_amount: '25000.00', amount_paid: '0.00', status: 'OPEN', version: 1 }]),
    });
    const svc = new WholesaleVehicleService(prisma, {} as any);
    const item = await svc.recordPayment(TENANT_ID, ITEM_ID, { amount: 10000 }, 'clerk-1');
    expect(item.status).toBe('OPEN');
  });

  it('refuses payments against a closed item', async () => {
    const prisma = makePrisma({
      queryRawUnsafe: vi.fn().mockResolvedValue([{ id: ITEM_ID, sale_amount: '25000.00', amount_paid: '25000.00', status: 'CLOSED', version: 1 }]),
    });
    const svc = new WholesaleVehicleService(prisma, {} as any);
    await expect(svc.recordPayment(TENANT_ID, ITEM_ID, { amount: 100 }, 'clerk-1')).rejects.toMatchObject({ code: 'ITEM_CLOSED' });
  });
});

describe('WholesaleVehicleService.releaseTitle', () => {
  it('refuses an unpaid item with a named error (AC: TITLE_RELEASE_REFUSED_UNPAID)', async () => {
    const prisma = makePrisma({
      queryRawUnsafe: vi.fn().mockResolvedValue([{ id: ITEM_ID, sale_amount: '25000.00', amount_paid: '10000.00', status: 'OPEN', title_released: false, version: 1 }]),
    });
    const svc = new WholesaleVehicleService(prisma, {} as any);
    await expect(svc.releaseTitle(TENANT_ID, ITEM_ID, 'clerk-1')).rejects.toBeInstanceOf(TitleReleaseRefusedUnpaidError);
  });

  it('releases title automatically for a paid-in-full item (AC: auto-eligible)', async () => {
    const prisma = makePrisma({
      queryRawUnsafe: vi.fn().mockResolvedValue([{ id: ITEM_ID, sale_amount: '25000.00', amount_paid: '25000.00', status: 'PAID_IN_FULL', title_released: false, version: 1 }]),
    });
    const svc = new WholesaleVehicleService(prisma, {} as any);
    const item = await svc.releaseTitle(TENANT_ID, ITEM_ID, 'clerk-1');
    expect(item.titleReleased).toBe(true);
    expect(item.titleReleasedBy).toBe('clerk-1');
  });

  it('refuses to release an already-released title', async () => {
    const prisma = makePrisma({
      queryRawUnsafe: vi.fn().mockResolvedValue([{ id: ITEM_ID, sale_amount: '25000.00', amount_paid: '25000.00', status: 'PAID_IN_FULL', title_released: true, version: 2 }]),
    });
    const svc = new WholesaleVehicleService(prisma, {} as any);
    await expect(svc.releaseTitle(TENANT_ID, ITEM_ID, 'clerk-1')).rejects.toMatchObject({ code: 'ALREADY_RELEASED' });
  });

  it('throws WholesaleVehicleItemNotFoundError for an unknown item', async () => {
    const prisma = makePrisma({ queryRawUnsafe: vi.fn().mockResolvedValue([]) });
    const svc = new WholesaleVehicleService(prisma, {} as any);
    await expect(svc.releaseTitle(TENANT_ID, 'missing', 'clerk-1')).rejects.toBeInstanceOf(WholesaleVehicleItemNotFoundError);
  });
});

describe('WholesaleVehicleService.releaseTitleWithException', () => {
  it('requires a reason', async () => {
    const prisma = makePrisma();
    const svc = new WholesaleVehicleService(prisma, {} as any);
    await expect(svc.releaseTitleWithException(TENANT_ID, ITEM_ID, { reason: '' }, 'manager-1')).rejects.toBeInstanceOf(WholesaleVehicleValidationError);
  });

  it('releases an unpaid item via the exception path and creates a fully-audited exception record naming the authorizing user (AC)', async () => {
    const prisma = makePrisma({
      queryRawUnsafe: vi.fn().mockResolvedValue([{ id: ITEM_ID, sale_amount: '25000.00', amount_paid: '10000.00', status: 'OPEN', title_released: false, version: 1 }]),
    });
    const svc = new WholesaleVehicleService(prisma, {} as any);
    const result = await svc.releaseTitleWithException(TENANT_ID, ITEM_ID, { reason: 'GM override for fleet deal' }, 'manager-1');
    expect(result.item.titleReleased).toBe(true);
    expect(result.item.titleReleaseException).toBe(true);
    expect(result.exception.authorizedBy).toBe('manager-1');
    expect(result.exception.reason).toBe('GM override for fleet deal');
    expect(Number(result.exception.outstandingBalance)).toBe(15000);
  });

  it('refuses a second exception release once already released', async () => {
    const prisma = makePrisma({
      queryRawUnsafe: vi.fn().mockResolvedValue([{ id: ITEM_ID, sale_amount: '25000.00', amount_paid: '10000.00', status: 'OPEN', title_released: true, version: 2 }]),
    });
    const svc = new WholesaleVehicleService(prisma, {} as any);
    await expect(svc.releaseTitleWithException(TENANT_ID, ITEM_ID, { reason: 'x' }, 'manager-1')).rejects.toMatchObject({ code: 'ALREADY_RELEASED' });
  });
});

describe('WholesaleVehicleService.listExceptions', () => {
  it('lists exceptions for an item', async () => {
    const prisma = makePrisma({ exceptionFindMany: vi.fn().mockResolvedValue([{ id: 'exception-1', itemId: ITEM_ID }]) });
    const svc = new WholesaleVehicleService(prisma, {} as any);
    const exceptions = await svc.listExceptions(TENANT_ID, ITEM_ID);
    expect(exceptions).toHaveLength(1);
  });
});
