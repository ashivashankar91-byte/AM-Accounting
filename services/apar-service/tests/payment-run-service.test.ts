/**
 * CE-09 S043B (Payment Runs & Rails) — PaymentRunService domain tests.
 * Mocked-Prisma unit tests, same style as nsf-service.test.ts /
 * write-off-service.test.ts. ManualPaymentService is mocked directly since
 * PaymentRunService.executeRun() delegates per-item execution to it (the
 * SAME code path as any other manual payment — no duplicated posting/
 * check-numbering logic).
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import {
  PaymentRunService,
  PaymentRunNotFoundError,
  PaymentRunValidationError,
  RunApprovalRefusedSoDError,
} from '../src/application/payment-run-service';

const TENANT_ID = 'tenant-payment-run';
const RUN_ID = 'run-1';
const BANK_ACCOUNT_ID = 'bank-1';
const VENDOR_ID = 'vendor-1';
const INVOICE_ID = 'invoice-1';

const BASE_BANK_ACCOUNT = { id: BANK_ACCOUNT_ID, tenantId: TENANT_ID, nextCheckNumber: 1001 };
const BASE_INVOICE = { id: INVOICE_ID, tenantId: TENANT_ID, vendorId: VENDOR_ID, status: 'APPROVED', totalAmount: '500.00', dueDate: new Date('2026-08-01') };
const BASE_RUN = {
  id: RUN_ID, tenantId: TENANT_ID, bankAccountId: BANK_ACCOUNT_ID, status: 'PROPOSED',
  proposedBy: 'clerk-1', cashRequirementTotal: '500.00',
};
const BASE_ITEM = { id: 'item-1', tenantId: TENANT_ID, runId: RUN_ID, invoiceId: INVOICE_ID, vendorId: VENDOR_ID, amount: '500.00', status: 'PENDING' };

function makePrisma(overrides: any = {}) {
  const client: any = {
    apPaymentRun: {
      findFirst: overrides.runFindFirst ?? vi.fn().mockResolvedValue(BASE_RUN),
      findMany: overrides.runFindMany ?? vi.fn().mockResolvedValue([BASE_RUN]),
      create: overrides.runCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: RUN_ID, ...data })),
      update: overrides.runUpdate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_RUN, ...data })),
    },
    apPaymentRunItem: {
      createMany: overrides.itemCreateMany ?? vi.fn().mockResolvedValue({ count: 1 }),
      findMany: overrides.itemFindMany ?? vi.fn().mockResolvedValue([BASE_ITEM]),
      update: overrides.itemUpdate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_ITEM, ...data })),
    },
    apPaymentRunRailArtifact: {
      create: overrides.artifactCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'artifact-1', ...data })),
      findMany: overrides.artifactFindMany ?? vi.fn().mockResolvedValue([]),
    },
    aPBankAccount: {
      findFirst: overrides.bankFindFirst ?? vi.fn().mockResolvedValue(BASE_BANK_ACCOUNT),
    },
    vendorInvoice: {
      findMany: overrides.invoiceFindMany ?? vi.fn().mockResolvedValue([BASE_INVOICE]),
    },
    auditOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
    $queryRawUnsafe: overrides.queryRawUnsafe ?? vi.fn().mockResolvedValue([{ id: RUN_ID, tenant_id: TENANT_ID, status: 'APPROVED' }]),
  };
  client.$transaction = async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg));
  return client;
}

function makeManualPaymentService(overrides: any = {}) {
  return {
    create: overrides.create ?? vi.fn().mockResolvedValue({ id: 'payment-1', checkNumber: 1001 }),
  } as any;
}

describe('PaymentRunService.createProposal', () => {
  it('creates a PROPOSED run with one item per eligible invoice and a cash-requirement preview total', async () => {
    const prisma = makePrisma();
    const svc = new PaymentRunService(prisma, {} as any, makeManualPaymentService());
    await svc.createProposal(TENANT_ID, { bankAccountId: BANK_ACCOUNT_ID, dueDateThrough: '2026-08-15' }, 'clerk-1');
    expect(prisma.apPaymentRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PROPOSED', proposedBy: 'clerk-1', cashRequirementTotal: 500 }),
    }));
    expect(prisma.apPaymentRunItem.createMany).toHaveBeenCalled();
  });

  it('accepts discountDateThrough as a documented no-op (no such invoice field exists yet)', async () => {
    const prisma = makePrisma();
    const svc = new PaymentRunService(prisma, {} as any, makeManualPaymentService());
    await expect(svc.createProposal(TENANT_ID, { bankAccountId: BANK_ACCOUNT_ID, dueDateThrough: '2026-08-15', discountDateThrough: '2026-08-10' }, 'clerk-1')).resolves.toBeDefined();
  });

  it('rejects a missing bankAccountId', async () => {
    const prisma = makePrisma();
    const svc = new PaymentRunService(prisma, {} as any, makeManualPaymentService());
    await expect(svc.createProposal(TENANT_ID, { bankAccountId: '', dueDateThrough: '2026-08-15' }, 'clerk-1')).rejects.toBeInstanceOf(PaymentRunValidationError);
  });

  it('rejects an unknown bank account', async () => {
    const prisma = makePrisma({ bankFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new PaymentRunService(prisma, {} as any, makeManualPaymentService());
    await expect(svc.createProposal(TENANT_ID, { bankAccountId: 'missing', dueDateThrough: '2026-08-15' }, 'clerk-1')).rejects.toBeInstanceOf(PaymentRunValidationError);
  });

  it('creates no items when there are no eligible invoices', async () => {
    const prisma = makePrisma({ invoiceFindMany: vi.fn().mockResolvedValue([]) });
    const svc = new PaymentRunService(prisma, {} as any, makeManualPaymentService());
    await svc.createProposal(TENANT_ID, { bankAccountId: BANK_ACCOUNT_ID, dueDateThrough: '2026-08-15' }, 'clerk-1');
    expect(prisma.apPaymentRunItem.createMany).not.toHaveBeenCalled();
  });
});

describe('PaymentRunService.approveRun (SoD)', () => {
  it('refuses when the approver is the same person as the proposer (RUN_APPROVAL_REFUSED_SOD)', async () => {
    const prisma = makePrisma();
    const svc = new PaymentRunService(prisma, {} as any, makeManualPaymentService());
    await expect(svc.approveRun(TENANT_ID, RUN_ID, {}, 'clerk-1')).rejects.toBeInstanceOf(RunApprovalRefusedSoDError);
  });

  it('approves when the approver differs from the proposer', async () => {
    const prisma = makePrisma();
    const svc = new PaymentRunService(prisma, {} as any, makeManualPaymentService());
    const run = await svc.approveRun(TENANT_ID, RUN_ID, {}, 'approver-2');
    expect(prisma.apPaymentRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED', approvedBy: 'approver-2' }) }));
  });

  it('throws PaymentRunNotFoundError for an unknown run', async () => {
    const prisma = makePrisma({ runFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new PaymentRunService(prisma, {} as any, makeManualPaymentService());
    await expect(svc.approveRun(TENANT_ID, 'missing', {}, 'approver-2')).rejects.toBeInstanceOf(PaymentRunNotFoundError);
  });

  it('rejects approval of a run that is not PROPOSED', async () => {
    const prisma = makePrisma({ runFindFirst: vi.fn().mockResolvedValue({ ...BASE_RUN, status: 'APPROVED' }) });
    const svc = new PaymentRunService(prisma, {} as any, makeManualPaymentService());
    await expect(svc.approveRun(TENANT_ID, RUN_ID, {}, 'approver-2')).rejects.toBeInstanceOf(PaymentRunValidationError);
  });
});

describe('PaymentRunService.rejectRun', () => {
  it('requires a reason', async () => {
    const prisma = makePrisma();
    const svc = new PaymentRunService(prisma, {} as any, makeManualPaymentService());
    await expect(svc.rejectRun(TENANT_ID, RUN_ID, { reason: '' }, 'clerk-1')).rejects.toBeInstanceOf(PaymentRunValidationError);
  });

  it('rejects the run with a reason', async () => {
    const prisma = makePrisma();
    const svc = new PaymentRunService(prisma, {} as any, makeManualPaymentService());
    await svc.rejectRun(TENANT_ID, RUN_ID, { reason: 'Cash constrained this week' }, 'clerk-1');
    expect(prisma.apPaymentRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED', rejectionReason: 'Cash constrained this week' }) }));
  });
});

describe('PaymentRunService.executeRun', () => {
  it('marks a successfully-paid item PAID with the payment id and check number', async () => {
    const prisma = makePrisma();
    const manualPaymentService = makeManualPaymentService();
    const svc = new PaymentRunService(prisma, {} as any, manualPaymentService);
    await svc.executeRun(TENANT_ID, RUN_ID, 'clerk-1');
    expect(manualPaymentService.create).toHaveBeenCalledWith(TENANT_ID, { invoiceId: INVOICE_ID, bankAccountId: BANK_ACCOUNT_ID }, 'clerk-1', undefined, undefined);
    expect(prisma.apPaymentRunItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PAID', paymentId: 'payment-1', checkNumber: 1001 }) }));
    expect(prisma.apPaymentRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'EXECUTED', executedBy: 'clerk-1' }) }));
  });

  it('isolates a single-invoice failure: item is marked FAILED with a named reason, run still completes', async () => {
    const prisma = makePrisma();
    const manualPaymentService = makeManualPaymentService({ create: vi.fn().mockRejectedValue(Object.assign(new Error('Invoice already paid'), { name: 'InvoiceAlreadyPaidError' })) });
    const svc = new PaymentRunService(prisma, {} as any, manualPaymentService);
    await svc.executeRun(TENANT_ID, RUN_ID, 'clerk-1');
    expect(prisma.apPaymentRunItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', failureReason: expect.stringContaining('InvoiceAlreadyPaidError') }) }));
    expect(prisma.apPaymentRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'EXECUTED' }) }));
  });

  it('is idempotent by run id: a duplicate execution attempt on an already-EXECUTED run does not re-invoke ManualPaymentService', async () => {
    const prisma = makePrisma({ queryRawUnsafe: vi.fn().mockResolvedValue([{ id: RUN_ID, tenant_id: TENANT_ID, status: 'EXECUTED' }]) });
    const manualPaymentService = makeManualPaymentService();
    const svc = new PaymentRunService(prisma, {} as any, manualPaymentService);
    await svc.executeRun(TENANT_ID, RUN_ID, 'clerk-1');
    expect(manualPaymentService.create).not.toHaveBeenCalled();
  });

  it('refuses a concurrent execution attempt on a run already EXECUTING', async () => {
    const prisma = makePrisma({ queryRawUnsafe: vi.fn().mockResolvedValue([{ id: RUN_ID, tenant_id: TENANT_ID, status: 'EXECUTING' }]) });
    const svc = new PaymentRunService(prisma, {} as any, makeManualPaymentService());
    await expect(svc.executeRun(TENANT_ID, RUN_ID, 'clerk-1')).rejects.toBeInstanceOf(PaymentRunValidationError);
  });

  it('refuses execution of a run that is not APPROVED', async () => {
    const prisma = makePrisma({ queryRawUnsafe: vi.fn().mockResolvedValue([{ id: RUN_ID, tenant_id: TENANT_ID, status: 'PROPOSED' }]) });
    const svc = new PaymentRunService(prisma, {} as any, makeManualPaymentService());
    await expect(svc.executeRun(TENANT_ID, RUN_ID, 'clerk-1')).rejects.toBeInstanceOf(PaymentRunValidationError);
  });

  it('throws PaymentRunNotFoundError for an unknown run', async () => {
    const prisma = makePrisma({ queryRawUnsafe: vi.fn().mockResolvedValue([]) });
    const svc = new PaymentRunService(prisma, {} as any, makeManualPaymentService());
    await expect(svc.executeRun(TENANT_ID, 'missing', 'clerk-1')).rejects.toBeInstanceOf(PaymentRunNotFoundError);
  });
});

describe('PaymentRunService.generateRailArtifact', () => {
  it('generates a CHECK_PRINT artifact as GENERATED with totals matching paid items', async () => {
    const prisma = makePrisma({
      runFindFirst: vi.fn().mockResolvedValue({ ...BASE_RUN, status: 'EXECUTED' }),
      itemFindMany: vi.fn().mockResolvedValue([{ ...BASE_ITEM, status: 'PAID', checkNumber: 1001 }]),
    });
    const svc = new PaymentRunService(prisma, {} as any, makeManualPaymentService());
    const artifact = await svc.generateRailArtifact(TENANT_ID, RUN_ID, { mode: 'CHECK_PRINT' }, 'clerk-1');
    expect(artifact.status).toBe('GENERATED');
    expect(artifact.totalAmount).toBe(500);
    expect(artifact.itemCount).toBe(1);
  });

  it('generates a POSITIVE_PAY artifact as GENERATED', async () => {
    const prisma = makePrisma({
      runFindFirst: vi.fn().mockResolvedValue({ ...BASE_RUN, status: 'EXECUTED' }),
      itemFindMany: vi.fn().mockResolvedValue([{ ...BASE_ITEM, status: 'PAID', checkNumber: 1001 }]),
    });
    const svc = new PaymentRunService(prisma, {} as any, makeManualPaymentService());
    const artifact = await svc.generateRailArtifact(TENANT_ID, RUN_ID, { mode: 'POSITIVE_PAY' }, 'clerk-1');
    expect(artifact.status).toBe('GENERATED');
  });

  it('generates an ACH_NACHA artifact as PAYMENT_RAIL_NOT_CONFIGURED (truthful adapter state) while still producing a file', async () => {
    const prisma = makePrisma({
      runFindFirst: vi.fn().mockResolvedValue({ ...BASE_RUN, status: 'EXECUTED' }),
      itemFindMany: vi.fn().mockResolvedValue([{ ...BASE_ITEM, status: 'PAID', checkNumber: 1001 }]),
    });
    const svc = new PaymentRunService(prisma, {} as any, makeManualPaymentService());
    const artifact = await svc.generateRailArtifact(TENANT_ID, RUN_ID, { mode: 'ACH_NACHA' }, 'clerk-1');
    expect(artifact.status).toBe('PAYMENT_RAIL_NOT_CONFIGURED');
    expect(artifact.fileContent).toBeTruthy();
    expect(artifact.totalAmount).toBe(500);
  });

  it('refuses rail artifact generation for a non-EXECUTED run', async () => {
    const prisma = makePrisma({ runFindFirst: vi.fn().mockResolvedValue({ ...BASE_RUN, status: 'APPROVED' }) });
    const svc = new PaymentRunService(prisma, {} as any, makeManualPaymentService());
    await expect(svc.generateRailArtifact(TENANT_ID, RUN_ID, { mode: 'CHECK_PRINT' }, 'clerk-1')).rejects.toBeInstanceOf(PaymentRunValidationError);
  });
});

describe('PaymentRunService.getById / list', () => {
  it('throws PaymentRunNotFoundError when the run is missing', async () => {
    const prisma = makePrisma({ runFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new PaymentRunService(prisma, {} as any, makeManualPaymentService());
    await expect(svc.getById(TENANT_ID, 'missing')).rejects.toBeInstanceOf(PaymentRunNotFoundError);
  });

  it('lists payment runs for a tenant', async () => {
    const prisma = makePrisma();
    const svc = new PaymentRunService(prisma, {} as any, makeManualPaymentService());
    const rows = await svc.list(TENANT_ID);
    expect(rows).toHaveLength(1);
  });
});
