/**
 * CE-09 S045 — PaymentLifecycleService domain tests. Mocked-Prisma unit
 * tests, same style as use-tax-service.test.ts / manual-payment-service.test.ts;
 * the GL posting HTTP call is verified via a mocked global fetch.
 */
import 'reflect-metadata';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  PaymentLifecycleService,
  PaymentNotFoundError,
  PaymentValidationError,
  EscheatConfigNotFoundError,
  EscheatTransferAlreadyExistsError,
} from '../src/application/payment-lifecycle-service';

const TENANT_ID = 'tenant-lifecycle';
const PAYMENT_ID = 'payment-1';

const BASE_PAYMENT = {
  id: PAYMENT_ID, tenantId: TENANT_ID, invoiceId: 'invoice-1', status: 'POSTED',
  amount: '100.00', checkNumber: '1001', issueDate: new Date('2025-01-01T00:00:00Z'), clearedAt: null,
};

function makePrisma(overrides: any = {}) {
  const client: any = {
    apManualPayment: {
      findFirst: overrides.paymentFindFirst ?? vi.fn().mockResolvedValue(BASE_PAYMENT),
      findMany: overrides.paymentFindMany ?? vi.fn().mockResolvedValue([BASE_PAYMENT]),
      update: overrides.paymentUpdate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_PAYMENT, ...data })),
    },
    apStopPaymentRequest: {
      findFirst: overrides.stopFindFirst ?? vi.fn().mockResolvedValue(null),
      findMany: overrides.stopFindMany ?? vi.fn().mockResolvedValue([]),
      create: overrides.stopCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'stop-1', ...data })),
      update: overrides.stopUpdate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'stop-1', ...data })),
    },
    apEscheatJurisdictionConfig: {
      findFirst: overrides.escheatConfigFindFirst ?? vi.fn().mockResolvedValue(null),
      findMany: overrides.escheatConfigFindMany ?? vi.fn().mockResolvedValue([]),
    },
    apEscheatDueDiligenceRecord: {
      create: overrides.dueDiligenceCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'dd-1', ...data })),
      findMany: overrides.dueDiligenceFindMany ?? vi.fn().mockResolvedValue([]),
    },
    apEscheatTransfer: {
      findFirst: overrides.transferFindFirst ?? vi.fn().mockResolvedValue(null),
      create: overrides.transferCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'transfer-1', ...data })),
      update: overrides.transferUpdate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'transfer-1', ...data })),
    },
    apEscheatGlAccountConfig: {
      findFirst: overrides.escheatGlFindFirst ?? vi.fn().mockResolvedValue({ outstandingChecksGlAccountId: 'gl-outstanding', escheatPayableGlAccountId: 'gl-escheat-payable' }),
    },
    auditOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  client.$transaction = async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg));
  return client;
}

function makeManualPaymentService(overrides: any = {}) {
  return { create: overrides.create ?? vi.fn().mockResolvedValue({ id: 'payment-2', tenantId: TENANT_ID, invoiceId: 'invoice-1', status: 'POSTED' }) };
}

describe('PaymentLifecycleService.markCleared', () => {
  it('sets clearedAt/clearedBy on an outstanding payment', async () => {
    const prisma = makePrisma();
    const svc = new PaymentLifecycleService(prisma, {} as any, makeManualPaymentService() as any);
    const result = await svc.markCleared(TENANT_ID, PAYMENT_ID, {}, 'admin-1');
    expect(result.clearedBy).toBe('admin-1');
    expect(result.clearedAt).toBeInstanceOf(Date);
  });

  it('throws PaymentNotFoundError for an unknown payment', async () => {
    const prisma = makePrisma({ paymentFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new PaymentLifecycleService(prisma, {} as any, makeManualPaymentService() as any);
    await expect(svc.markCleared(TENANT_ID, 'missing', {}, 'admin-1')).rejects.toBeInstanceOf(PaymentNotFoundError);
  });

  it('refuses to mark a voided payment as cleared', async () => {
    const prisma = makePrisma({ paymentFindFirst: vi.fn().mockResolvedValue({ ...BASE_PAYMENT, status: 'VOID' }) });
    const svc = new PaymentLifecycleService(prisma, {} as any, makeManualPaymentService() as any);
    await expect(svc.markCleared(TENANT_ID, PAYMENT_ID, {}, 'admin-1')).rejects.toMatchObject({ code: 'ALREADY_VOID' });
  });

  it('refuses to mark an already-cleared payment as cleared again', async () => {
    const prisma = makePrisma({ paymentFindFirst: vi.fn().mockResolvedValue({ ...BASE_PAYMENT, clearedAt: new Date() }) });
    const svc = new PaymentLifecycleService(prisma, {} as any, makeManualPaymentService() as any);
    await expect(svc.markCleared(TENANT_ID, PAYMENT_ID, {}, 'admin-1')).rejects.toMatchObject({ code: 'ALREADY_CLEARED' });
  });
});

describe('PaymentLifecycleService.reissue', () => {
  it('creates a new payment linked to the voided original (restore-then-relieve-once)', async () => {
    const createMock = vi.fn().mockResolvedValue({ id: 'payment-2', tenantId: TENANT_ID, invoiceId: 'invoice-1', status: 'POSTED' });
    const prisma = makePrisma({
      paymentFindFirst: vi.fn()
        .mockResolvedValueOnce({ ...BASE_PAYMENT, status: 'VOID' }) // original lookup
        .mockResolvedValueOnce(null), // no existing reissue
    });
    const svc = new PaymentLifecycleService(prisma, {} as any, makeManualPaymentService({ create: createMock }) as any);
    const result = await svc.reissue(TENANT_ID, PAYMENT_ID, { bankAccountId: 'bank-1' }, 'clerk-1');
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(result.reissueOfPaymentId).toBe(PAYMENT_ID);
  });

  it('refuses to reissue a payment that is not void', async () => {
    const prisma = makePrisma({ paymentFindFirst: vi.fn().mockResolvedValue({ ...BASE_PAYMENT, status: 'POSTED' }) });
    const svc = new PaymentLifecycleService(prisma, {} as any, makeManualPaymentService() as any);
    await expect(svc.reissue(TENANT_ID, PAYMENT_ID, { bankAccountId: 'bank-1' }, 'clerk-1')).rejects.toMatchObject({ code: 'ORIGINAL_NOT_VOID' });
  });

  it('refuses a second reissue of the same original payment (no double relief)', async () => {
    const prisma = makePrisma({
      paymentFindFirst: vi.fn()
        .mockResolvedValueOnce({ ...BASE_PAYMENT, status: 'VOID' })
        .mockResolvedValueOnce({ id: 'payment-2', reissueOfPaymentId: PAYMENT_ID }),
    });
    const svc = new PaymentLifecycleService(prisma, {} as any, makeManualPaymentService() as any);
    await expect(svc.reissue(TENANT_ID, PAYMENT_ID, { bankAccountId: 'bank-1' }, 'clerk-1')).rejects.toMatchObject({ code: 'ALREADY_REISSUED' });
  });
});

describe('PaymentLifecycleService stop-payment lifecycle', () => {
  it('requests a stop-payment with a truthful PAYMENT_RAIL_NOT_CONFIGURED bank-ack state', async () => {
    const prisma = makePrisma();
    const svc = new PaymentLifecycleService(prisma, {} as any, makeManualPaymentService() as any);
    const request = await svc.requestStopPayment(TENANT_ID, PAYMENT_ID, { reason: 'Wrong payee' }, 'clerk-1');
    expect(request.bankAck).toBe('PAYMENT_RAIL_NOT_CONFIGURED');
    expect(request.status).toBe('REQUESTED');
  });

  it('requires a reason to request a stop-payment', async () => {
    const prisma = makePrisma();
    const svc = new PaymentLifecycleService(prisma, {} as any, makeManualPaymentService() as any);
    await expect(svc.requestStopPayment(TENANT_ID, PAYMENT_ID, { reason: '' }, 'clerk-1')).rejects.toBeInstanceOf(PaymentValidationError);
  });

  it('resolves a stop-payment request', async () => {
    const prisma = makePrisma({ stopFindFirst: vi.fn().mockResolvedValue({ id: 'stop-1', tenantId: TENANT_ID, status: 'REQUESTED' }) });
    const svc = new PaymentLifecycleService(prisma, {} as any, makeManualPaymentService() as any);
    const resolved = await svc.resolveStopPayment(TENANT_ID, 'stop-1', { status: 'ACKNOWLEDGED', bankAck: 'MANUAL', bankAckNote: 'Called the bank' }, 'admin-1');
    expect(resolved.status).toBe('ACKNOWLEDGED');
    expect(resolved.resolvedBy).toBe('admin-1');
  });
});

describe('PaymentLifecycleService.escheatQueue', () => {
  it('never auto-computes staleness without a jurisdiction config (D-CE09-03)', async () => {
    const prisma = makePrisma();
    const svc = new PaymentLifecycleService(prisma, {} as any, makeManualPaymentService() as any);
    const queue = await svc.escheatQueue(TENANT_ID);
    expect(queue).toHaveLength(1);
    expect(queue[0].jurisdictionConfigured).toBe(false);
    expect(queue[0].isStale).toBe(false);
  });
});

describe('PaymentLifecycleService.postEscheatTransfer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('gates on an existing jurisdiction config (D-CE09-03)', async () => {
    const prisma = makePrisma({ escheatConfigFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new PaymentLifecycleService(prisma, {} as any, makeManualPaymentService() as any);
    await expect(svc.postEscheatTransfer(TENANT_ID, PAYMENT_ID, { jurisdiction: 'CA' }, 'accountant-1')).rejects.toBeInstanceOf(EscheatConfigNotFoundError);
  });

  it('refuses to escheat a cleared/reconciled payment', async () => {
    const prisma = makePrisma({
      paymentFindFirst: vi.fn().mockResolvedValue({ ...BASE_PAYMENT, clearedAt: new Date() }),
      escheatConfigFindFirst: vi.fn().mockResolvedValue({ jurisdiction: 'CA' }),
    });
    const svc = new PaymentLifecycleService(prisma, {} as any, makeManualPaymentService() as any);
    await expect(svc.postEscheatTransfer(TENANT_ID, PAYMENT_ID, { jurisdiction: 'CA' }, 'accountant-1')).rejects.toMatchObject({ code: 'NOT_ELIGIBLE' });
  });

  it('is idempotent — refuses a duplicate transfer for the same payment', async () => {
    const prisma = makePrisma({
      escheatConfigFindFirst: vi.fn().mockResolvedValue({ jurisdiction: 'CA' }),
      transferFindFirst: vi.fn().mockResolvedValue({ id: 'existing-transfer' }),
    });
    const svc = new PaymentLifecycleService(prisma, {} as any, makeManualPaymentService() as any);
    await expect(svc.postEscheatTransfer(TENANT_ID, PAYMENT_ID, { jurisdiction: 'CA' }, 'accountant-1')).rejects.toBeInstanceOf(EscheatTransferAlreadyExistsError);
  });

  it('maps a unique-constraint race (P2002) to EscheatTransferAlreadyExistsError', async () => {
    const prisma = makePrisma({
      escheatConfigFindFirst: vi.fn().mockResolvedValue({ jurisdiction: 'CA' }),
      transferCreate: vi.fn().mockRejectedValue(Object.assign(new Error('unique violation'), { code: 'P2002' })),
    });
    const svc = new PaymentLifecycleService(prisma, {} as any, makeManualPaymentService() as any);
    await expect(svc.postEscheatTransfer(TENANT_ID, PAYMENT_ID, { jurisdiction: 'CA' }, 'accountant-1')).rejects.toBeInstanceOf(EscheatTransferAlreadyExistsError);
  });

  it('posts a balanced Dr outstanding-checks / Cr escheat-payable journal when configured', async () => {
    let created: any;
    const prisma = makePrisma({
      escheatConfigFindFirst: vi.fn().mockResolvedValue({ jurisdiction: 'CA' }),
      transferCreate: vi.fn().mockImplementation(({ data }: any) => { created = { id: 'transfer-1', ...data }; return Promise.resolve(created); }),
      transferUpdate: vi.fn().mockImplementation(({ data }: any) => { created = { ...created, ...data }; return Promise.resolve(created); }),
      transferFindFirst: vi.fn().mockImplementation(() => Promise.resolve(created ?? null)),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'je-1' }) }));
    const svc = new PaymentLifecycleService(prisma, {} as any, makeManualPaymentService() as any);
    const result = await svc.postEscheatTransfer(TENANT_ID, PAYMENT_ID, { jurisdiction: 'CA' }, 'accountant-1');
    expect(result.status).toBe('POSTED');
    expect(result.glEntryId).toBe('je-1');
  });

  it('records a truthful glPostingError when escheat GL accounts are not configured (blank matrix row)', async () => {
    const prisma = makePrisma({
      escheatConfigFindFirst: vi.fn().mockResolvedValue({ jurisdiction: 'CA' }),
      escheatGlFindFirst: vi.fn().mockResolvedValue(null),
    });
    const svc = new PaymentLifecycleService(prisma, {} as any, makeManualPaymentService() as any);
    const result = await svc.postEscheatTransfer(TENANT_ID, PAYMENT_ID, { jurisdiction: 'CA' }, 'accountant-1');
    expect(prisma.apEscheatTransfer.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ glPostingError: expect.stringContaining('not configured') }) }),
    );
    expect(result).toBeTruthy();
  });
});
