/**
 * AMACC-CH04 S043A — ManualPaymentService domain tests. Mocked-Prisma unit
 * tests.
 *
 * CE-07 (single authoritative ledger decision): the AP-relief GL posting no
 * longer calls gl-service's journal-entries endpoints directly — it submits
 * a canonical event through PostingEnginePort (mocked here, real behavior
 * covered by coa-service's own live-db gl-posting-bridge-live.test.ts). A
 * mocked global fetch still covers the read-only gl-service account-number
 * resolution GET calls and the schedule-service relief calls this service
 * still makes.
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
import type { PostingEnginePort } from '../src/application/posting-engine-port';

const TENANT_ID = 'tenant-payment';
const INVOICE_ID = 'invoice-1';
const VENDOR_ID = 'vendor-1';
const BANK_ACCOUNT_ID = 'bank-1';

const BASE_INVOICE = { id: INVOICE_ID, tenantId: TENANT_ID, vendorId: VENDOR_ID, invoiceNumber: 'INV-900', totalAmount: '500.00', status: 'APPROVED', version: 1, invoiceDate: new Date('2026-06-01') };
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
      create: overrides.paymentCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'payment-1', paymentDate: new Date('2026-06-02'), ...data })),
      update: overrides.paymentUpdate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'payment-1', ...data })),
    },
    auditOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  // CE-07 — setTenantContextOnConnection() (first statement inside every
  // interactive $transaction callback, see rls-middleware.ts) issues a raw
  // SET on the transaction's own connection; the mock tx here is this same
  // client object (see $transaction below), so it needs the method too.
  client.$executeRawUnsafe = vi.fn().mockResolvedValue(undefined);
  client.$transaction = async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg));
  return client;
}

function makePostingEnginePort(overrides: Partial<PostingEnginePort> = {}): PostingEnginePort {
  return {
    submit: vi.fn().mockResolvedValue({ ok: true, status: 'PENDING_REVIEW', journalEntryId: 'je-payment-1', journalNumber: 'JE-000456' }),
    ...overrides,
  };
}

describe('ManualPaymentService.create', () => {
  it('throws InvoiceNotApprovedError when the invoice is not APPROVED', async () => {
    const prisma = makePrisma({ invoiceFindFirst: vi.fn().mockResolvedValue({ ...BASE_INVOICE, status: 'DRAFT' }) });
    const svc = new ManualPaymentService(prisma, {} as any, makePostingEnginePort());
    await expect(svc.create(TENANT_ID, { invoiceId: INVOICE_ID, bankAccountId: BANK_ACCOUNT_ID })).rejects.toBeInstanceOf(InvoiceNotApprovedError);
  });

  it('throws InvoiceAlreadyPaidError when a POSTED payment already exists for the invoice', async () => {
    const prisma = makePrisma({ paymentFindFirst: vi.fn().mockResolvedValue({ id: 'existing-payment' }) });
    const svc = new ManualPaymentService(prisma, {} as any, makePostingEnginePort());
    await expect(svc.create(TENANT_ID, { invoiceId: INVOICE_ID, bankAccountId: BANK_ACCOUNT_ID })).rejects.toBeInstanceOf(InvoiceAlreadyPaidError);
  });

  it('throws BankAccountNotFoundError when the bank account does not exist', async () => {
    const prisma = makePrisma({ bankFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new ManualPaymentService(prisma, {} as any, makePostingEnginePort());
    await expect(svc.create(TENANT_ID, { invoiceId: INVOICE_ID, bankAccountId: BANK_ACCOUNT_ID })).rejects.toBeInstanceOf(BankAccountNotFoundError);
  });

  describe('with GL account-resolution/schedule HTTP calls mocked', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      fetchMock = vi.fn(async (url: string) => {
        if (url.includes('/api/v1/gl/accounts/')) return { ok: true, json: async () => ({ code: 'AP001' }) };
        if (url.includes('/api/v1/schedules') && url.includes('open-items?')) return { ok: true, json: async () => ([{ id: 'item-1', status: 'OPEN' }]) };
        if (url.includes('/open-items/') && url.includes('/apply')) return { ok: true, json: async () => ({ id: 'application-1' }) };
        if (url.endsWith('/api/v1/schedules')) return { ok: true, json: async () => ([{ id: 'schedule-1', glAccountNumbers: ['AP001'] }]) };
        return { ok: false, status: 404, text: async () => 'not found' };
      });
      vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('creates the payment, assigns the next check number, marks the invoice PAID, submits the AP-relief event through the posting engine, and relieves the schedule item', async () => {
      const prisma = makePrisma();
      const postingEnginePort = makePostingEnginePort();
      const svc = new ManualPaymentService(prisma, {} as any, postingEnginePort);
      const payment = await svc.create(TENANT_ID, { invoiceId: INVOICE_ID, bankAccountId: BANK_ACCOUNT_ID }, 'user-1', 'fake-token');

      expect(prisma.aPBankAccount.update).toHaveBeenCalledWith(expect.objectContaining({ data: { nextCheckNumber: { increment: 1 } } }));
      expect(prisma.vendorInvoice.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PAID' }) }));
      expect(postingEnginePort.submit).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'ap.payment.posted.v1', tenantId: TENANT_ID }));
      expect(payment).toBeDefined();
    });

    it('does not fail the payment when account-code resolution fails — records glPostingError instead', async () => {
      fetchMock.mockImplementation(async () => ({ ok: false, status: 500, text: async () => 'gl down' }));
      const prisma = makePrisma();
      const svc = new ManualPaymentService(prisma, {} as any, makePostingEnginePort());
      const payment = await svc.create(TENANT_ID, { invoiceId: INVOICE_ID, bankAccountId: BANK_ACCOUNT_ID });
      expect(payment).toBeDefined();
      expect(prisma.apManualPayment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ glPostingError: expect.any(String) }) }));
    });

    it('does not fail the payment when the posting engine rejects the submission — records glPostingError instead', async () => {
      const prisma = makePrisma();
      const postingEnginePort = makePostingEnginePort({ submit: vi.fn().mockResolvedValue({ ok: false, failureReason: 'INVALID_ACCOUNT' }) });
      const svc = new ManualPaymentService(prisma, {} as any, postingEnginePort);
      const payment = await svc.create(TENANT_ID, { invoiceId: INVOICE_ID, bankAccountId: BANK_ACCOUNT_ID });
      expect(payment).toBeDefined();
      expect(prisma.apManualPayment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ glPostingError: expect.any(String) }) }));
    });

    it('does not attempt GL posting when the vendor has no default GL account', async () => {
      const prisma = makePrisma({ vendorFindFirst: vi.fn().mockResolvedValue({ ...BASE_VENDOR, defaultGlAccount: null }) });
      const postingEnginePort = makePostingEnginePort();
      const svc = new ManualPaymentService(prisma, {} as any, postingEnginePort);
      await svc.create(TENANT_ID, { invoiceId: INVOICE_ID, bankAccountId: BANK_ACCOUNT_ID });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(postingEnginePort.submit).not.toHaveBeenCalled();
      expect(prisma.apManualPayment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ glPostingError: expect.any(String) }) }));
    });

    it('records scheduleReliefStatus NOT_FOUND (not fabricated RELIEVED) when no schedule matches the AP control account', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/api/v1/gl/accounts/')) return { ok: true, json: async () => ({ code: 'AP001' }) };
        if (url.endsWith('/api/v1/schedules')) return { ok: true, json: async () => ([]) }; // no schedules configured
        return { ok: false, status: 404, text: async () => 'not found' };
      });
      const prisma = makePrisma();
      const svc = new ManualPaymentService(prisma, {} as any, makePostingEnginePort());
      await svc.create(TENANT_ID, { invoiceId: INVOICE_ID, bankAccountId: BANK_ACCOUNT_ID });
      expect(prisma.apManualPayment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ scheduleReliefStatus: 'NOT_FOUND' }) }));
    });
  });
});

describe('ManualPaymentService.void', () => {
  it('requires a reason', async () => {
    const prisma = makePrisma({ paymentFindFirst: vi.fn().mockResolvedValue({ id: 'payment-1', tenantId: TENANT_ID, invoiceId: INVOICE_ID, version: 1, status: 'POSTED' }) });
    const svc = new ManualPaymentService(prisma, {} as any, makePostingEnginePort());
    await expect(svc.void(TENANT_ID, 'payment-1', { version: 1, reason: '' })).rejects.toBeInstanceOf(PaymentValidationError);
  });

  it('throws on a version mismatch', async () => {
    const prisma = makePrisma({ paymentFindFirst: vi.fn().mockResolvedValue({ id: 'payment-1', tenantId: TENANT_ID, invoiceId: INVOICE_ID, version: 1, status: 'POSTED' }) });
    const svc = new ManualPaymentService(prisma, {} as any, makePostingEnginePort());
    await expect(svc.void(TENANT_ID, 'payment-1', { version: 99, reason: 'x' })).rejects.toBeInstanceOf(PaymentConflictError);
  });

  it('voids the payment and re-opens the invoice to APPROVED', async () => {
    const prisma = makePrisma({
      paymentFindFirst: vi.fn().mockResolvedValue({ id: 'payment-1', tenantId: TENANT_ID, invoiceId: INVOICE_ID, version: 1, status: 'POSTED' }),
      invoiceFindFirst: vi.fn().mockResolvedValue({ ...BASE_INVOICE, status: 'PAID' }),
    });
    const svc = new ManualPaymentService(prisma, {} as any, makePostingEnginePort());
    const result = await svc.void(TENANT_ID, 'payment-1', { version: 1, reason: 'Wrong vendor' });
    expect(result.status).toBe('VOID');
    expect(prisma.vendorInvoice.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED' }) }));
  });
});
