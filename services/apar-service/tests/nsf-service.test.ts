/**
 * CE-09 S051 (NSF handling) — NsfService domain tests. Mocked-Prisma unit
 * tests, same style as write-off-service.test.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import {
  NsfService,
  ArEntryNotFoundForNsfError,
  NsfValidationError,
  NsfEventNotFoundError,
} from '../src/application/nsf-service';

const TENANT_ID = 'tenant-nsf';
const CUSTOMER_ID = 'customer-1';
const AR_ENTRY_ID = 'ar-entry-1';
const NSF_ID = 'nsf-event-1';

const BASE_AR_ENTRY_ROW = { id: AR_ENTRY_ID, tenant_id: TENANT_ID, amount: '250.00', status: 'POSTED', reconciled_at: null };
const BASE_CUSTOMER = { id: CUSTOMER_ID, tenantId: TENANT_ID, nsfCount: 0, creditHold: false };
const BASE_NSF_EVENT = { id: NSF_ID, tenantId: TENANT_ID, customerId: CUSTOMER_ID, originalArEntryId: AR_ENTRY_ID, amount: '250.00', depositReconciled: false, postedAsBankAdjustment: false };

function makePrisma(overrides: any = {}) {
  const client: any = {
    arNsfEvent: {
      findFirst: overrides.nsfFindFirst ?? vi.fn().mockResolvedValue(BASE_NSF_EVENT),
      findMany: overrides.nsfFindMany ?? vi.fn().mockResolvedValue([BASE_NSF_EVENT]),
      create: overrides.nsfCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: NSF_ID, ...data })),
      update: overrides.nsfUpdate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_NSF_EVENT, ...data })),
    },
    aREntry: {
      findFirst: overrides.arEntryFindFirst ?? vi.fn().mockResolvedValue({ id: AR_ENTRY_ID, tenantId: TENANT_ID, reconciledAt: null }),
      update: overrides.arEntryUpdate ?? vi.fn().mockResolvedValue({}),
      create: overrides.arEntryCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'fee-entry-1', ...data })),
    },
    customer: {
      findFirst: overrides.customerFindFirst ?? vi.fn().mockResolvedValue(BASE_CUSTOMER),
      update: overrides.customerUpdate ?? vi.fn().mockResolvedValue({}),
    },
    arNsfFeeConfig: {
      findFirst: overrides.feeConfigFindFirst ?? vi.fn().mockResolvedValue(null),
    },
    arNsfHoldConfig: {
      findFirst: overrides.holdConfigFindFirst ?? vi.fn().mockResolvedValue(null),
    },
    arNsfGlAccountConfig: {
      findFirst: overrides.glConfigFindFirst ?? vi.fn().mockResolvedValue(null),
    },
    auditOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
    $queryRawUnsafe: overrides.queryRawUnsafe ?? vi.fn().mockResolvedValue([BASE_AR_ENTRY_ROW]),
  };
  client.$transaction = async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg));
  return client;
}

describe('NsfService.recordNsf', () => {
  it('reverses the original receipt application (restores the AR entry to OPEN)', async () => {
    const prisma = makePrisma();
    const svc = new NsfService(prisma, {} as any);
    const nsfEvent = await svc.recordNsf(TENANT_ID, { customerId: CUSTOMER_ID, originalArEntryId: AR_ENTRY_ID, amount: 250, reason: 'Returned check' }, 'clerk-1');
    expect(nsfEvent.depositReconciled).toBe(false);
    expect(prisma.aREntry.update).toHaveBeenCalledWith({ where: { id: AR_ENTRY_ID }, data: { status: 'OPEN' } });
  });

  it('rejects a missing customerId', async () => {
    const prisma = makePrisma();
    const svc = new NsfService(prisma, {} as any);
    await expect(svc.recordNsf(TENANT_ID, { customerId: '', originalArEntryId: AR_ENTRY_ID, amount: 250, reason: 'x' }, 'clerk-1')).rejects.toBeInstanceOf(NsfValidationError);
  });

  it('rejects a missing reason', async () => {
    const prisma = makePrisma();
    const svc = new NsfService(prisma, {} as any);
    await expect(svc.recordNsf(TENANT_ID, { customerId: CUSTOMER_ID, originalArEntryId: AR_ENTRY_ID, amount: 250, reason: '' }, 'clerk-1')).rejects.toBeInstanceOf(NsfValidationError);
  });

  it('rejects a non-positive amount', async () => {
    const prisma = makePrisma();
    const svc = new NsfService(prisma, {} as any);
    await expect(svc.recordNsf(TENANT_ID, { customerId: CUSTOMER_ID, originalArEntryId: AR_ENTRY_ID, amount: 0, reason: 'x' }, 'clerk-1')).rejects.toBeInstanceOf(NsfValidationError);
  });

  it('throws ArEntryNotFoundForNsfError when the AR entry does not exist', async () => {
    const prisma = makePrisma({ queryRawUnsafe: vi.fn().mockResolvedValue([]) });
    const svc = new NsfService(prisma, {} as any);
    await expect(svc.recordNsf(TENANT_ID, { customerId: CUSTOMER_ID, originalArEntryId: 'missing', amount: 250, reason: 'x' }, 'clerk-1')).rejects.toBeInstanceOf(ArEntryNotFoundForNsfError);
  });

  it('rejects an NSF against an AR entry that is not POSTED', async () => {
    const prisma = makePrisma({ queryRawUnsafe: vi.fn().mockResolvedValue([{ ...BASE_AR_ENTRY_ROW, status: 'OPEN' }]) });
    const svc = new NsfService(prisma, {} as any);
    await expect(svc.recordNsf(TENANT_ID, { customerId: CUSTOMER_ID, originalArEntryId: AR_ENTRY_ID, amount: 250, reason: 'x' }, 'clerk-1')).rejects.toBeInstanceOf(NsfValidationError);
  });

  it('requires the NSF amount to tie out exactly to the AR entry amount', async () => {
    const prisma = makePrisma();
    const svc = new NsfService(prisma, {} as any);
    await expect(svc.recordNsf(TENANT_ID, { customerId: CUSTOMER_ID, originalArEntryId: AR_ENTRY_ID, amount: 100, reason: 'x' }, 'clerk-1')).rejects.toBeInstanceOf(NsfValidationError);
  });

  it('throws when the customer does not exist', async () => {
    const prisma = makePrisma({ customerFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new NsfService(prisma, {} as any);
    await expect(svc.recordNsf(TENANT_ID, { customerId: 'missing', originalArEntryId: AR_ENTRY_ID, amount: 250, reason: 'x' }, 'clerk-1')).rejects.toBeInstanceOf(NsfValidationError);
  });

  it('conservation boundary: NEVER mutates/reopens the AR entry when the deposit is already reconciled (same guard idiom as S045 void-after-cleared)', async () => {
    const prisma = makePrisma({ queryRawUnsafe: vi.fn().mockResolvedValue([{ ...BASE_AR_ENTRY_ROW, reconciled_at: new Date().toISOString() }]) });
    const svc = new NsfService(prisma, {} as any);
    const nsfEvent = await svc.recordNsf(TENANT_ID, { customerId: CUSTOMER_ID, originalArEntryId: AR_ENTRY_ID, amount: 250, reason: 'x' }, 'clerk-1');
    expect(nsfEvent.depositReconciled).toBe(true);
    expect(nsfEvent.postedAsBankAdjustment).toBe(true);
    expect(prisma.aREntry.update).not.toHaveBeenCalled();
  });

  it('creates a separate NSF fee AR item when a fee config exists (SAFE_CONFIGURATION)', async () => {
    const prisma = makePrisma({ feeConfigFindFirst: vi.fn().mockResolvedValue({ tenantId: TENANT_ID, feeAmount: '35.00' }) });
    const svc = new NsfService(prisma, {} as any);
    const nsfEvent = await svc.recordNsf(TENANT_ID, { customerId: CUSTOMER_ID, originalArEntryId: AR_ENTRY_ID, amount: 250, reason: 'x' }, 'clerk-1');
    expect(prisma.aREntry.create).toHaveBeenCalled();
    expect(nsfEvent.feeAmount).toBe('35.00');
  });

  it('never creates a fee item when no fee config exists (missing config = no fabricated fee)', async () => {
    const prisma = makePrisma();
    const svc = new NsfService(prisma, {} as any);
    await svc.recordNsf(TENANT_ID, { customerId: CUSTOMER_ID, originalArEntryId: AR_ENTRY_ID, amount: 250, reason: 'x' }, 'clerk-1');
    expect(prisma.aREntry.create).not.toHaveBeenCalled();
  });

  it('increments the customer NSF count', async () => {
    const prisma = makePrisma();
    const svc = new NsfService(prisma, {} as any);
    await svc.recordNsf(TENANT_ID, { customerId: CUSTOMER_ID, originalArEntryId: AR_ENTRY_ID, amount: 250, reason: 'x' }, 'clerk-1');
    expect(prisma.customer.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ nsfCount: 1 }) }));
  });

  it('auto-holds the customer after N NSF events per tenant config (SAFE_CONFIGURATION)', async () => {
    const prisma = makePrisma({
      customerFindFirst: vi.fn().mockResolvedValue({ ...BASE_CUSTOMER, nsfCount: 1 }),
      holdConfigFindFirst: vi.fn().mockResolvedValue({ tenantId: TENANT_ID, holdAfterCount: 2 }),
    });
    const svc = new NsfService(prisma, {} as any);
    await svc.recordNsf(TENANT_ID, { customerId: CUSTOMER_ID, originalArEntryId: AR_ENTRY_ID, amount: 250, reason: 'x' }, 'clerk-1');
    expect(prisma.customer.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ nsfCount: 2, creditHold: true, creditHoldReason: 'NSF_AUTO_HOLD' }) }));
  });

  it('never auto-holds when no hold config exists (missing config = no auto-hold ever applied)', async () => {
    const prisma = makePrisma({ customerFindFirst: vi.fn().mockResolvedValue({ ...BASE_CUSTOMER, nsfCount: 50 }) });
    const svc = new NsfService(prisma, {} as any);
    await svc.recordNsf(TENANT_ID, { customerId: CUSTOMER_ID, originalArEntryId: AR_ENTRY_ID, amount: 250, reason: 'x' }, 'clerk-1');
    expect(prisma.customer.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.not.objectContaining({ creditHold: true }) }));
  });
});

describe('NsfService.markDepositReconciled', () => {
  it('sets reconciledAt/reconciledBy (PUTR test-only boundary, mirrors PaymentLifecycleService.markCleared)', async () => {
    const prisma = makePrisma();
    const svc = new NsfService(prisma, {} as any);
    await svc.markDepositReconciled(TENANT_ID, AR_ENTRY_ID, {}, 'admin-1');
    expect(prisma.aREntry.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: AR_ENTRY_ID }, data: expect.objectContaining({ reconciledBy: 'admin-1' }) }));
  });

  it('throws ArEntryNotFoundForNsfError for an unknown AR entry', async () => {
    const prisma = makePrisma({ arEntryFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new NsfService(prisma, {} as any);
    await expect(svc.markDepositReconciled(TENANT_ID, 'missing', {}, 'admin-1')).rejects.toBeInstanceOf(ArEntryNotFoundForNsfError);
  });

  it('refuses to mark an already-reconciled entry again', async () => {
    const prisma = makePrisma({ arEntryFindFirst: vi.fn().mockResolvedValue({ id: AR_ENTRY_ID, tenantId: TENANT_ID, reconciledAt: new Date() }) });
    const svc = new NsfService(prisma, {} as any);
    await expect(svc.markDepositReconciled(TENANT_ID, AR_ENTRY_ID, {}, 'admin-1')).rejects.toBeInstanceOf(NsfValidationError);
  });
});

describe('NsfService.getById / list', () => {
  it('throws NsfEventNotFoundError when the NSF event is missing', async () => {
    const prisma = makePrisma({ nsfFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new NsfService(prisma, {} as any);
    await expect(svc.getById(TENANT_ID, 'missing')).rejects.toBeInstanceOf(NsfEventNotFoundError);
  });

  it('lists NSF events for a tenant', async () => {
    const prisma = makePrisma();
    const svc = new NsfService(prisma, {} as any);
    const rows = await svc.list(TENANT_ID);
    expect(rows).toHaveLength(1);
  });
});
