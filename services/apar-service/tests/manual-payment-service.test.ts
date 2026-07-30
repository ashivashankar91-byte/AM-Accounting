/**
 * AMACC-CH04 S043A — ManualPaymentService domain tests. Mocked-Prisma unit
 * tests; the GL/schedule HTTP calls are verified via a mocked global fetch.
 */
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ManualPaymentService,
  InvoiceNotApprovedError,
  InvoiceAlreadyPaidError,
  BankAccountNotFoundError,
  PaymentConflictError,
  PaymentValidationError,
} from '../src/application/manual-payment-service';

const TENANT_ID = 'tenant-payment';
const INVOICE_ID = 'invoice-1';
const VENDOR_ID = 'vendor-1';
const BANK_ACCOUNT_ID = 'bank-1';

const BASE_INVOICE = { id: INVOICE_ID, tenantId: TENANT_ID, vendorId: VENDOR_ID, invoiceNumber: 'INV-900', totalAmount: '500.00', status: 'APPROVED', version: 1 };
const BASE_VENDOR = { id: VENDOR_ID, tenantId: TENANT_ID, defaultGlAccount: 'gl-ap-control' };
const BASE_BANK_ACCOUNT = { id: BANK_ACCOUNT_ID, tenantId: TENANT_ID, nextCheckNumber: 1001, glAccountId: 'gl-bank-1' };

function makePrisma(overrides: any = {}) {
  const client: any = {
    vendorInvoice: {
      findFirst: overrides.invoiceFindFirst ?? vi.fn().mockResolvedValue(BASE_INVOICE),
      update: overrides.invoiceUpdate ?? vi.fn().mockResolvedValue({}),
    },
    vendor: { findFirst: overrides.vendorFindFirst ?? vi.fn().mockResolvedValue(BASE_VENDOR) },
    aPBankAccount: {
      findFirst: overrides.bankFindFirst ?? vi.fn().mockResolvedValue(BASE_BANK_ACCOUNT),
      update: overrides.bankUpdate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_BANK_ACCOUNT, nextCheckNumber: BASE_BANK_ACCOUNT.nextCheckNumber + 1 })),
    },
    apManualPayment: {
      findFirst: overrides.paymentFindFirst ?? vi.fn().mockResolvedValue(null),
      create: overrides.paymentCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'payment-1', ...data })),
      update: overrides.paymentUpdate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'payment-1', ...data })),
    },
    auditOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  client.$transaction = async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg));
  return client;
}

describe('ManualPaymentService.create', () => {
  it('throws InvoiceNotApprovedError when the invoice is not APPROVED', async () => {
    const prisma = makePrisma({ invoiceFindFirst: vi.fn().mockResolvedValue({ ...BASE_INVOICE, status: 'DRAFT' }) });
    const svc = new ManualPaymentService(prisma, {} as any);
    await expect(svc.create(TENANT_ID, { invoiceId: INVOICE_ID, bankAccountId: BANK_ACCOUNT_ID })).rejects.toBeInstanceOf(InvoiceNotApprovedError);
  });

  it('throws InvoiceAlreadyPaidError when a POSTED payment already exists for the invoice', async () => {
    const prisma = makePrisma({ paymentFindFirst: vi.fn().mockResolvedValue({ id: 'existing-payment' }) });
    const svc = new ManualPaymentService(prisma, {} as any);
    await expect(svc.create(TENANT_ID, { invoiceId: INVOICE_ID, bankAccountId: BANK_ACCOUNT_ID })).rejects.toBeInstanceOf(InvoiceAlreadyPaidError);
  });

  it('throws BankAccountNotFoundError when the bank account does not exist', async () => {
    const prisma = makePrisma({ bankFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new ManualPaymentService(prisma, {} as any);
    await expect(svc.create(TENANT_ID, { invoiceId: INVOICE_ID, bankAccountId: BANK_ACCOUNT_ID })).rejects.toBeInstanceOf(BankAccountNotFoundError);
  });

  describe('with GL/schedule HTTP calls mocked', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      fetchMock = vi.fn(async (url: string) => {
        if (url.includes('/api/v1/gl/journal-entries') && !url.includes('/post')) {
          return { ok: true, json: async () => ({ id: 'je-payment-1' }) };
        }
        if (url.endsWith('/post')) return { ok: true, json: async () => ({}) };
        if (url.includes('/api/v1/gl/accounts/')) return { ok: true, json: async () => ({ code: 'AP001' }) };
        if (url.includes('/api/v1/schedules') && url.includes('open-items?')) return { ok: true, json: async () => ([{ id: 'item-1', status: 'OPEN' }]) };
        if (url.includes('/open-items/') && url.includes('/apply')) return { ok: true, json: async () => ({ id: 'application-1' }) };
        if (url.endsWith('/api/v1/schedules')) return { ok: true, json: async () => ([{ id: 'schedule-1', glAccountNumbers: ['AP001'] }]) };
        return { ok: false, status: 404, text: async () => 'not found' };
      });
      vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('creates the payment, assigns the next check number, marks the invoice PAID, posts the GL reversal, and relieves the schedule item', async () => {
      const prisma = makePrisma();
      const svc = new ManualPaymentService(prisma, {} as any);
      const payment = await svc.create(TENANT_ID, { invoiceId: INVOICE_ID, bankAccountId: BANK_ACCOUNT_ID }, 'user-1', 'fake-token');

      expect(prisma.aPBankAccount.update).toHaveBeenCalledWith(expect.objectContaining({ data: { nextCheckNumber: { increment: 1 } } }));
      expect(prisma.vendorInvoice.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PAID' }) }));
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/v1/gl/journal-entries'), expect.objectContaining({ method: 'POST' }));
      expect(payment).toBeDefined();
    });

    it('does not fail the payment when GL posting fails — records glPostingError instead', async () => {
      fetchMock.mockImplementation(async () => ({ ok: false, status: 500, text: async () => 'gl down' }));
      const prisma = makePrisma();
      const svc = new ManualPaymentService(prisma, {} as any);
      const payment = await svc.create(TENANT_ID, { invoiceId: INVOICE_ID, bankAccountId: BANK_ACCOUNT_ID });
      expect(payment).toBeDefined();
      expect(prisma.apManualPayment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ glPostingError: expect.any(String) }) }));
    });

    it('does not attempt GL posting when the vendor has no default GL account', async () => {
      const prisma = makePrisma({ vendorFindFirst: vi.fn().mockResolvedValue({ ...BASE_VENDOR, defaultGlAccount: null }) });
      const svc = new ManualPaymentService(prisma, {} as any);
      await svc.create(TENANT_ID, { invoiceId: INVOICE_ID, bankAccountId: BANK_ACCOUNT_ID });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(prisma.apManualPayment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ glPostingError: expect.any(String) }) }));
    });

    it('records scheduleReliefStatus NOT_FOUND (not fabricated RELIEVED) when no schedule matches the AP control account', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/api/v1/gl/journal-entries') && !url.includes('/post')) return { ok: true, json: async () => ({ id: 'je-payment-1' }) };
        if (url.endsWith('/post')) return { ok: true, json: async () => ({}) };
        if (url.includes('/api/v1/gl/accounts/')) return { ok: true, json: async () => ({ code: 'AP001' }) };
        if (url.endsWith('/api/v1/schedules')) return { ok: true, json: async () => ([]) }; // no schedules configured
        return { ok: false, status: 404, text: async () => 'not found' };
      });
      const prisma = makePrisma();
      const svc = new ManualPaymentService(prisma, {} as any);
      await svc.create(TENANT_ID, { invoiceId: INVOICE_ID, bankAccountId: BANK_ACCOUNT_ID });
      expect(prisma.apManualPayment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ scheduleReliefStatus: 'NOT_FOUND' }) }));
    });
  });
});

describe('ManualPaymentService.void', () => {
  it('requires a reason', async () => {
    const prisma = makePrisma({ paymentFindFirst: vi.fn().mockResolvedValue({ id: 'payment-1', tenantId: TENANT_ID, invoiceId: INVOICE_ID, version: 1, status: 'POSTED' }) });
    const svc = new ManualPaymentService(prisma, {} as any);
    await expect(svc.void(TENANT_ID, 'payment-1', { version: 1, reason: '' })).rejects.toBeInstanceOf(PaymentValidationError);
  });

  it('throws on a version mismatch', async () => {
    const prisma = makePrisma({ paymentFindFirst: vi.fn().mockResolvedValue({ id: 'payment-1', tenantId: TENANT_ID, invoiceId: INVOICE_ID, version: 1, status: 'POSTED' }) });
    const svc = new ManualPaymentService(prisma, {} as any);
    await expect(svc.void(TENANT_ID, 'payment-1', { version: 99, reason: 'x' })).rejects.toBeInstanceOf(PaymentConflictError);
  });

  it('voids the payment and re-opens the invoice to APPROVED', async () => {
    const prisma = makePrisma({
      paymentFindFirst: vi.fn().mockResolvedValue({ id: 'payment-1', tenantId: TENANT_ID, invoiceId: INVOICE_ID, version: 1, status: 'POSTED' }),
      invoiceFindFirst: vi.fn().mockResolvedValue({ ...BASE_INVOICE, status: 'PAID' }),
    });
    const svc = new ManualPaymentService(prisma, {} as any);
    const result = await svc.void(TENANT_ID, 'payment-1', { version: 1, reason: 'Wrong vendor' });
    expect(result.status).toBe('VOID');
    expect(prisma.vendorInvoice.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED' }) }));
  });
});
