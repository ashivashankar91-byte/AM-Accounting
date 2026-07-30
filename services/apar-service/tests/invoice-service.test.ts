/**
 * AMACC-CH04 S039 — InvoiceService domain tests. Mocked-Prisma unit tests,
 * mirroring the pattern in tests/vendor-service.test.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import {
  InvoiceService,
  InvoiceNotFoundError,
  VendorNotFoundForInvoiceError,
  VendorNotEligibleForInvoiceError,
  InvoiceValidationError,
  InvoiceConflictError,
  DuplicateInvoiceAcknowledgementRequiredError,
  MatchExceptionOverrideRequiredError,
} from '../src/application/invoice-service';

const TENANT_ID = 'tenant-inv';
const VENDOR_ID = 'vendor-1';
const INVOICE_ID = 'invoice-1';

const BASE_VENDOR = { id: VENDOR_ID, tenantId: TENANT_ID, status: 'ACTIVE', paymentTerms: 'Net30' };

const BASE_INVOICE = {
  id: INVOICE_ID,
  tenantId: TENANT_ID,
  vendorId: VENDOR_ID,
  invoiceNumber: 'INV-001',
  normalizedInvoiceNumber: 'INV-001',
  invoiceDate: new Date(),
  dueDate: new Date(),
  paymentTerms: 'Net30',
  poId: null,
  subtotal: '100.00',
  taxAmount: '0.00',
  freightAmount: '0.00',
  totalAmount: '100.00',
  status: 'DRAFT',
  matchType: 'NONE',
  matchStatus: 'NOT_RUN',
  version: 1,
  lines: [{ id: 'line-1', invoiceId: INVOICE_ID, lineNumber: 1, poLineId: null, glAccountId: 'gl-1', description: 'Widget', quantity: '2', unitPrice: '50.00', taxAmount: '0.00', lineTotal: '100.00' }],
  matchResults: [],
};

function makePrisma(overrides: Partial<{
  vendorFindFirst: ReturnType<typeof vi.fn>;
  invoiceFindFirst: ReturnType<typeof vi.fn>;
  invoiceFindMany: ReturnType<typeof vi.fn>;
  invoiceCount: ReturnType<typeof vi.fn>;
  invoiceCreate: ReturnType<typeof vi.fn>;
  invoiceUpdate: ReturnType<typeof vi.fn>;
}> = {}) {
  const client: any = {
    vendor: { findFirst: overrides.vendorFindFirst ?? vi.fn().mockResolvedValue(BASE_VENDOR) },
    vendorInvoice: {
      findFirst: overrides.invoiceFindFirst ?? vi.fn().mockResolvedValue(BASE_INVOICE),
      findMany: overrides.invoiceFindMany ?? vi.fn().mockResolvedValue([BASE_INVOICE]),
      count: overrides.invoiceCount ?? vi.fn().mockResolvedValue(1),
      create: overrides.invoiceCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_INVOICE, ...data, id: INVOICE_ID, lines: BASE_INVOICE.lines })),
      update: overrides.invoiceUpdate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_INVOICE, ...data })),
    },
    vendorInvoiceLine: { deleteMany: vi.fn().mockResolvedValue({}) },
    vendorInvoiceMatchResult: { create: vi.fn().mockResolvedValue({}) },
    apInvoiceMatchOverride: { create: vi.fn().mockResolvedValue({}) },
    auditOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  client.$transaction = async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg));
  return client;
}

const fakeMatchService: any = {
  match: vi.fn().mockResolvedValue({ matchType: 'NONE', status: 'MATCHED', toleranceAmountUsed: 0, tolerancePercentUsed: 0, variances: [] }),
};

const VALID_CREATE_DTO = {
  tenantId: TENANT_ID,
  vendorId: VENDOR_ID,
  invoiceNumber: 'INV-001',
  invoiceDate: new Date(),
  dueDate: new Date(),
  lines: [{ glAccountId: 'gl-1', description: 'Widget', quantity: 2, unitPrice: 50 }],
};

describe('InvoiceService.create', () => {
  it('throws VendorNotFoundForInvoiceError when the vendor does not exist', async () => {
    const prisma = makePrisma({ vendorFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new InvoiceService(prisma, {} as any, fakeMatchService);
    await expect(svc.create(VALID_CREATE_DTO as any)).rejects.toBeInstanceOf(VendorNotFoundForInvoiceError);
  });

  it('throws VendorNotEligibleForInvoiceError when the vendor is not ACTIVE', async () => {
    const prisma = makePrisma({ vendorFindFirst: vi.fn().mockResolvedValue({ ...BASE_VENDOR, status: 'INACTIVE' }) });
    const svc = new InvoiceService(prisma, {} as any, fakeMatchService);
    await expect(svc.create(VALID_CREATE_DTO as any)).rejects.toBeInstanceOf(VendorNotEligibleForInvoiceError);
  });

  it('throws InvoiceValidationError when a line has neither poLineId nor glAccountId', async () => {
    const prisma = makePrisma();
    const svc = new InvoiceService(prisma, {} as any, fakeMatchService);
    const dto = { ...VALID_CREATE_DTO, lines: [{ description: 'Bad line', unitPrice: 10 }] };
    await expect(svc.create(dto as any)).rejects.toBeInstanceOf(InvoiceValidationError);
  });

  it('throws InvoiceValidationError when a line has BOTH poLineId and glAccountId', async () => {
    const prisma = makePrisma();
    const svc = new InvoiceService(prisma, {} as any, fakeMatchService);
    const dto = { ...VALID_CREATE_DTO, lines: [{ poLineId: 'po-line-1', glAccountId: 'gl-1', description: 'Bad line', unitPrice: 10 }] };
    await expect(svc.create(dto as any)).rejects.toBeInstanceOf(InvoiceValidationError);
  });

  it('throws DuplicateInvoiceAcknowledgementRequiredError when a matching invoice number exists for the vendor and no override is given', async () => {
    const prisma = makePrisma();
    prisma.vendorInvoice.findMany = vi.fn().mockResolvedValue([{ id: 'other-invoice', invoiceNumber: 'INV-001', status: 'DRAFT', totalAmount: '50.00' }]);
    const svc = new InvoiceService(prisma, {} as any, fakeMatchService);
    await expect(svc.create(VALID_CREATE_DTO as any)).rejects.toBeInstanceOf(DuplicateInvoiceAcknowledgementRequiredError);
  });

  it('creates successfully when a duplicate exists but an override reason is supplied', async () => {
    const prisma = makePrisma();
    prisma.vendorInvoice.findMany = vi.fn().mockResolvedValue([{ id: 'other-invoice', invoiceNumber: 'INV-001', status: 'DRAFT', totalAmount: '50.00' }]);
    const svc = new InvoiceService(prisma, {} as any, fakeMatchService);
    const result = await svc.create({ ...VALID_CREATE_DTO, override: { reason: 'Confirmed distinct invoice' } } as any);
    expect(result.id).toBe(INVOICE_ID);
  });

  it('creates a DRAFT invoice with computed totals and the vendor payment terms snapshot', async () => {
    const prisma = makePrisma({ invoiceFindMany: vi.fn().mockResolvedValue([]) });
    const svc = new InvoiceService(prisma, {} as any, fakeMatchService);
    const result = await svc.create(VALID_CREATE_DTO as any);
    expect(result.status).toBe('DRAFT');
    expect(prisma.vendorInvoice.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ totalAmount: '100', paymentTerms: 'Net30' }),
    }));
  });
});

describe('InvoiceService.update', () => {
  it('throws when the invoice is not in DRAFT status', async () => {
    const prisma = makePrisma({ invoiceFindFirst: vi.fn().mockResolvedValue({ ...BASE_INVOICE, status: 'SUBMITTED' }) });
    const svc = new InvoiceService(prisma, {} as any, fakeMatchService);
    await expect(svc.update(TENANT_ID, INVOICE_ID, { version: 1 })).rejects.toBeInstanceOf(InvoiceValidationError);
  });

  it('throws InvoiceConflictError on a version mismatch', async () => {
    const prisma = makePrisma();
    const svc = new InvoiceService(prisma, {} as any, fakeMatchService);
    await expect(svc.update(TENANT_ID, INVOICE_ID, { version: 99 })).rejects.toBeInstanceOf(InvoiceConflictError);
  });
});

describe('InvoiceService.runMatch', () => {
  it('persists a match result and updates the invoice matchType/matchStatus', async () => {
    const prisma = makePrisma();
    const matchSvc: any = { match: vi.fn().mockResolvedValue({ matchType: 'TWO_WAY', status: 'EXCEPTION', toleranceAmountUsed: 0, tolerancePercentUsed: 0, variances: [{ type: 'PRICE_VARIANCE' }] }) };
    const svc = new InvoiceService(prisma, {} as any, matchSvc);
    const { result } = await svc.runMatch(TENANT_ID, INVOICE_ID);
    expect(result.status).toBe('EXCEPTION');
    expect(prisma.vendorInvoiceMatchResult.create).toHaveBeenCalled();
    expect(prisma.vendorInvoice.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ matchType: 'TWO_WAY', matchStatus: 'EXCEPTION' }),
    }));
  });
});

describe('InvoiceService.submit', () => {
  it('submits successfully when matchStatus is MATCHED', async () => {
    const prisma = makePrisma({ invoiceFindFirst: vi.fn().mockResolvedValue({ ...BASE_INVOICE, matchStatus: 'MATCHED' }) });
    const svc = new InvoiceService(prisma, {} as any, fakeMatchService);
    const result = await svc.submit(TENANT_ID, INVOICE_ID, { version: 1 });
    expect(result.status).toBe('SUBMITTED');
  });

  it('throws MatchExceptionOverrideRequiredError when matchStatus is EXCEPTION and no override is given', async () => {
    const prisma = makePrisma({ invoiceFindFirst: vi.fn().mockResolvedValue({ ...BASE_INVOICE, matchStatus: 'EXCEPTION', matchResults: [{ variances: [{ type: 'PRICE_VARIANCE' }] }] }) });
    const svc = new InvoiceService(prisma, {} as any, fakeMatchService);
    await expect(svc.submit(TENANT_ID, INVOICE_ID, { version: 1 })).rejects.toBeInstanceOf(MatchExceptionOverrideRequiredError);
  });

  it('submits with matchStatus OVERRIDDEN when an override reason is supplied for an EXCEPTION', async () => {
    const prisma = makePrisma({ invoiceFindFirst: vi.fn().mockResolvedValue({ ...BASE_INVOICE, matchStatus: 'EXCEPTION', matchResults: [{ variances: [] }] }) });
    const svc = new InvoiceService(prisma, {} as any, fakeMatchService);
    const result = await svc.submit(TENANT_ID, INVOICE_ID, { version: 1, override: { reason: 'Approved by controller' } });
    expect(result.status).toBe('SUBMITTED');
    expect(prisma.apInvoiceMatchOverride.create).toHaveBeenCalled();
  });

  it('throws when the invoice is already SUBMITTED', async () => {
    const prisma = makePrisma({ invoiceFindFirst: vi.fn().mockResolvedValue({ ...BASE_INVOICE, status: 'SUBMITTED' }) });
    const svc = new InvoiceService(prisma, {} as any, fakeMatchService);
    await expect(svc.submit(TENANT_ID, INVOICE_ID, { version: 1 })).rejects.toBeInstanceOf(InvoiceValidationError);
  });
});

describe('InvoiceService.void', () => {
  it('requires a reason', async () => {
    const prisma = makePrisma();
    const svc = new InvoiceService(prisma, {} as any, fakeMatchService);
    await expect(svc.void(TENANT_ID, INVOICE_ID, { version: 1, reason: '' })).rejects.toBeInstanceOf(InvoiceValidationError);
  });

  it('voids a DRAFT invoice successfully', async () => {
    const prisma = makePrisma();
    const svc = new InvoiceService(prisma, {} as any, fakeMatchService);
    const result = await svc.void(TENANT_ID, INVOICE_ID, { version: 1, reason: 'Entered in error' });
    expect(result.status).toBe('VOID');
  });

  it('throws when the invoice is not found', async () => {
    const prisma = makePrisma({ invoiceFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new InvoiceService(prisma, {} as any, fakeMatchService);
    await expect(svc.void(TENANT_ID, 'missing', { version: 1, reason: 'x' })).rejects.toBeInstanceOf(InvoiceNotFoundError);
  });
});
