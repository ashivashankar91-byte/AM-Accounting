/**
 * CE-09 S047 (Fleet AR Consolidated Billing) — FleetBillingService domain
 * tests. Mocked-Prisma unit tests, same style as trade-payoff-service.test.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import {
  FleetBillingService,
  FleetBillingValidationError,
  FleetCustomerNotFoundError,
  FleetUnitAlreadyLinkedError,
  FleetUnitLinkNotFoundError,
  FleetUnitNotLinkedToParentError,
  ConsolidatedInvoiceNotFoundError,
} from '../src/application/fleet-billing-service';

const TENANT_ID = 'tenant-fleet-billing';
const PARENT_ID = 'customer-parent-1';
const CHILD_ID_1 = 'customer-unit-1';
const CHILD_ID_2 = 'customer-unit-2';
const LINK_ID = 'link-1';
const INVOICE_ID = 'invoice-1';

const PARENT_CUSTOMER = { id: PARENT_ID, tenantId: TENANT_ID, customerType: 'Fleet' };
const CHILD_CUSTOMER_1 = { id: CHILD_ID_1, tenantId: TENANT_ID, customerType: 'Business' };
const CHILD_CUSTOMER_2 = { id: CHILD_ID_2, tenantId: TENANT_ID, customerType: 'Business' };
const LINK_1 = { id: LINK_ID, tenantId: TENANT_ID, parentCustomerId: PARENT_ID, childCustomerId: CHILD_ID_1, createdAt: new Date() };
const LINK_2 = { id: 'link-2', tenantId: TENANT_ID, parentCustomerId: PARENT_ID, childCustomerId: CHILD_ID_2, createdAt: new Date() };

function baseLinkDto(overrides: any = {}) {
  return { parentCustomerId: PARENT_ID, childCustomerId: CHILD_ID_1, ...overrides };
}

function baseInvoiceDto(overrides: any = {}) {
  return {
    parentCustomerId: PARENT_ID,
    invoiceDate: '2026-08-01',
    items: [
      { childCustomerId: CHILD_ID_1, amount: 100 },
      { childCustomerId: CHILD_ID_2, amount: 250 },
    ],
    ...overrides,
  };
}

function makePrisma(overrides: any = {}) {
  const client: any = {
    customer: {
      findFirst: overrides.customerFindFirst ?? vi.fn().mockImplementation(({ where }: any) => {
        if (where.id === PARENT_ID) return Promise.resolve(PARENT_CUSTOMER);
        if (where.id === CHILD_ID_1) return Promise.resolve(CHILD_CUSTOMER_1);
        if (where.id === CHILD_ID_2) return Promise.resolve(CHILD_CUSTOMER_2);
        return Promise.resolve(null);
      }),
    },
    arFleetUnitLink: {
      findFirst: overrides.linkFindFirst ?? vi.fn().mockResolvedValue(null),
      findMany: overrides.linkFindMany ?? vi.fn().mockResolvedValue([LINK_1, LINK_2]),
      create: overrides.linkCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: LINK_ID, ...data, createdAt: new Date() })),
      delete: overrides.linkDelete ?? vi.fn().mockResolvedValue({}),
    },
    arConsolidatedInvoice: {
      findFirst: overrides.invoiceFindFirst ?? vi.fn().mockResolvedValue({ id: INVOICE_ID, tenantId: TENANT_ID, parentCustomerId: PARENT_ID, totalAmount: '350.00', items: [{ id: 'item-1', amount: '100.00' }, { id: 'item-2', amount: '250.00' }] }),
      findMany: overrides.invoiceFindMany ?? vi.fn().mockResolvedValue([{ id: INVOICE_ID, tenantId: TENANT_ID, parentCustomerId: PARENT_ID, totalAmount: '350.00', invoiceDate: new Date('2026-08-01'), items: [{ id: 'item-1', amount: '100.00' }, { id: 'item-2', amount: '250.00' }] }]),
      create: overrides.invoiceCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: INVOICE_ID, ...data })),
      update: overrides.invoiceUpdate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: INVOICE_ID, ...data })),
    },
    arConsolidatedInvoiceItem: {
      create: overrides.itemCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'item-x', ...data })),
    },
    arFleetBillingGlAccountConfig: {
      findFirst: overrides.glConfigFindFirst ?? vi.fn().mockResolvedValue(null),
    },
    auditOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  client.$transaction = async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg));
  return client;
}

describe('FleetBillingService.linkUnit', () => {
  it('links a unit customer to a fleet parent', async () => {
    const prisma = makePrisma();
    const svc = new FleetBillingService(prisma, {} as any);
    const link = await svc.linkUnit(TENANT_ID, baseLinkDto(), 'clerk-1');
    expect(prisma.arFleetUnitLink.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ parentCustomerId: PARENT_ID, childCustomerId: CHILD_ID_1 }),
    }));
    expect(link.childCustomerId).toBe(CHILD_ID_1);
  });

  it('rejects a missing parentCustomerId', async () => {
    const prisma = makePrisma();
    const svc = new FleetBillingService(prisma, {} as any);
    await expect(svc.linkUnit(TENANT_ID, baseLinkDto({ parentCustomerId: '' }), 'clerk-1')).rejects.toBeInstanceOf(FleetBillingValidationError);
  });

  it('rejects linking a customer to itself', async () => {
    const prisma = makePrisma();
    const svc = new FleetBillingService(prisma, {} as any);
    await expect(svc.linkUnit(TENANT_ID, baseLinkDto({ childCustomerId: PARENT_ID }), 'clerk-1')).rejects.toBeInstanceOf(FleetBillingValidationError);
  });

  it('throws FleetCustomerNotFoundError for an unknown parent customer', async () => {
    const prisma = makePrisma({ customerFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new FleetBillingService(prisma, {} as any);
    await expect(svc.linkUnit(TENANT_ID, baseLinkDto(), 'clerk-1')).rejects.toBeInstanceOf(FleetCustomerNotFoundError);
  });

  it('refuses linking a unit that already belongs to a different fleet parent', async () => {
    const prisma = makePrisma({ linkFindFirst: vi.fn().mockResolvedValue(LINK_1) });
    const svc = new FleetBillingService(prisma, {} as any);
    await expect(svc.linkUnit(TENANT_ID, baseLinkDto(), 'clerk-1')).rejects.toBeInstanceOf(FleetUnitAlreadyLinkedError);
  });
});

describe('FleetBillingService.unlinkUnit', () => {
  it('unlinks an existing unit', async () => {
    const prisma = makePrisma({ linkFindFirst: vi.fn().mockResolvedValue(LINK_1) });
    const svc = new FleetBillingService(prisma, {} as any);
    const result = await svc.unlinkUnit(TENANT_ID, LINK_ID, 'clerk-1');
    expect(result.unlinked).toBe(true);
    expect(prisma.arFleetUnitLink.delete).toHaveBeenCalled();
  });

  it('throws FleetUnitLinkNotFoundError for an unknown link', async () => {
    const prisma = makePrisma({ linkFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new FleetBillingService(prisma, {} as any);
    await expect(svc.unlinkUnit(TENANT_ID, 'missing', 'clerk-1')).rejects.toBeInstanceOf(FleetUnitLinkNotFoundError);
  });
});

describe('FleetBillingService.createConsolidatedInvoice', () => {
  it('creates a consolidated invoice whose total equals the sum of its items (conservation)', async () => {
    const prisma = makePrisma();
    const svc = new FleetBillingService(prisma, {} as any);
    await svc.createConsolidatedInvoice(TENANT_ID, baseInvoiceDto(), 'clerk-1');
    expect(prisma.arConsolidatedInvoice.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ totalAmount: 350 }),
    }));
    expect(prisma.arConsolidatedInvoiceItem.create).toHaveBeenCalledTimes(2);
  });

  it('rejects an empty items array', async () => {
    const prisma = makePrisma();
    const svc = new FleetBillingService(prisma, {} as any);
    await expect(svc.createConsolidatedInvoice(TENANT_ID, baseInvoiceDto({ items: [] }), 'clerk-1')).rejects.toBeInstanceOf(FleetBillingValidationError);
  });

  it('rejects a non-positive item amount', async () => {
    const prisma = makePrisma();
    const svc = new FleetBillingService(prisma, {} as any);
    await expect(svc.createConsolidatedInvoice(TENANT_ID, baseInvoiceDto({ items: [{ childCustomerId: CHILD_ID_1, amount: 0 }] }), 'clerk-1')).rejects.toBeInstanceOf(FleetBillingValidationError);
  });

  it('throws FleetCustomerNotFoundError for an unknown parent', async () => {
    const prisma = makePrisma({ customerFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new FleetBillingService(prisma, {} as any);
    await expect(svc.createConsolidatedInvoice(TENANT_ID, baseInvoiceDto(), 'clerk-1')).rejects.toBeInstanceOf(FleetCustomerNotFoundError);
  });

  it('refuses an item whose childCustomerId is not a linked unit of the parent', async () => {
    const prisma = makePrisma({ linkFindMany: vi.fn().mockResolvedValue([LINK_1]) }); // CHILD_ID_2 not linked
    const svc = new FleetBillingService(prisma, {} as any);
    await expect(svc.createConsolidatedInvoice(TENANT_ID, baseInvoiceDto(), 'clerk-1')).rejects.toBeInstanceOf(FleetUnitNotLinkedToParentError);
  });

  it('records a truthful GL posting failure when no GL config exists (ACCOUNT_MAPPING_VALUES_PENDING)', async () => {
    const prisma = makePrisma();
    const svc = new FleetBillingService(prisma, {} as any);
    await svc.createConsolidatedInvoice(TENANT_ID, baseInvoiceDto(), 'clerk-1');
    expect(prisma.arConsolidatedInvoice.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ glPostingError: expect.stringContaining('ACCOUNT_MAPPING_VALUES_PENDING') }),
    }));
  });
});

describe('FleetBillingService.getById / list / getStatement', () => {
  it('throws ConsolidatedInvoiceNotFoundError when missing', async () => {
    const prisma = makePrisma({ invoiceFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new FleetBillingService(prisma, {} as any);
    await expect(svc.getById(TENANT_ID, 'missing')).rejects.toBeInstanceOf(ConsolidatedInvoiceNotFoundError);
  });

  it('lists consolidated invoices for a tenant', async () => {
    const prisma = makePrisma();
    const svc = new FleetBillingService(prisma, {} as any);
    const rows = await svc.list(TENANT_ID);
    expect(rows).toHaveLength(1);
  });

  it('produces a statement whose recomputed sum reconciles to the stored total', async () => {
    const prisma = makePrisma();
    const svc = new FleetBillingService(prisma, {} as any);
    const statement = await svc.getStatement(TENANT_ID, PARENT_ID);
    expect(statement.invoices[0].recomputedTotal).toBe(350);
    expect(statement.invoices[0].reconciles).toBe(true);
    expect(statement.grandTotal).toBe(350);
  });
});
