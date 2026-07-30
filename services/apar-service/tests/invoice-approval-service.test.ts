/**
 * AMACC-CH04 S041 — InvoiceApprovalService domain tests. Mocked-Prisma unit
 * tests; the GL posting HTTP call is verified via a mocked global fetch.
 */
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  InvoiceApprovalService,
  InvoiceNotSubmittedError,
  ApprovalInstanceNotFoundError,
  ApprovalAlreadyDecidedError,
  ApprovalConflictError,
  WrongApproverRoleError,
} from '../src/application/invoice-approval-service';
import { ANY_APPROVER_ROLE } from '../src/application/approval-rule-service';

const TENANT_ID = 'tenant-approval-svc';
const INVOICE_ID = 'invoice-1';
const VENDOR_ID = 'vendor-1';

const BASE_INVOICE = {
  id: INVOICE_ID, tenantId: TENANT_ID, vendorId: VENDOR_ID, invoiceNumber: 'INV-500',
  totalAmount: '1000.00', status: 'SUBMITTED', version: 1,
  lines: [{ id: 'line-1', glAccountId: 'gl-expense-1', poLineId: null, description: 'Widget', lineTotal: '1000.00' }],
};

function makePrisma(overrides: any = {}) {
  const client: any = {
    vendorInvoice: {
      findFirst: overrides.invoiceFindFirst ?? vi.fn().mockResolvedValue(BASE_INVOICE),
      update: overrides.invoiceUpdate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_INVOICE, ...data })),
    },
    apInvoiceApprovalInstance: {
      create: overrides.instanceCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'instance-1', ...data, steps: data.steps.create.map((s: any, i: number) => ({ id: `step-${i + 1}`, instanceId: 'instance-1', ...s })) })),
      findFirst: overrides.instanceFindFirst,
      update: overrides.instanceUpdate ?? vi.fn().mockResolvedValue({}),
    },
    apInvoiceApprovalStep: {
      update: overrides.stepUpdate ?? vi.fn().mockResolvedValue({}),
      updateMany: overrides.stepUpdateMany ?? vi.fn().mockResolvedValue({}),
    },
    vendor: { findFirst: overrides.vendorFindFirst ?? vi.fn().mockResolvedValue({ id: VENDOR_ID, tenantId: TENANT_ID, defaultGlAccount: 'gl-ap-control' }) },
    pOLine: { findFirst: vi.fn().mockResolvedValue(null) },
    auditOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  client.$transaction = async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg));
  return client;
}

const fakeRuleService: any = {
  resolveTiers: vi.fn().mockResolvedValue([{ sequence: 1, requiredRole: ANY_APPROVER_ROLE, thresholdAmount: 0 }]),
};

describe('InvoiceApprovalService.start', () => {
  it('throws when the invoice is not SUBMITTED', async () => {
    const prisma = makePrisma({ invoiceFindFirst: vi.fn().mockResolvedValue({ ...BASE_INVOICE, status: 'DRAFT' }) });
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService);
    await expect(svc.start(TENANT_ID, INVOICE_ID)).rejects.toBeInstanceOf(InvoiceNotSubmittedError);
  });

  it('creates an approval instance with tiers from the rule service and moves the invoice to PENDING_APPROVAL', async () => {
    const prisma = makePrisma();
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService);
    const instance = await svc.start(TENANT_ID, INVOICE_ID);
    expect(instance.steps).toHaveLength(1);
    expect(prisma.vendorInvoice.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING_APPROVAL' }) }));
  });
});

describe('InvoiceApprovalService.approveStep', () => {
  const singleStepInstance = {
    id: 'instance-1', tenantId: TENANT_ID, invoiceId: INVOICE_ID, status: 'PENDING',
    steps: [{ id: 'step-1', instanceId: 'instance-1', sequence: 1, requiredRole: ANY_APPROVER_ROLE, status: 'PENDING' }],
  };

  const twoStepInstance = {
    id: 'instance-2', tenantId: TENANT_ID, invoiceId: INVOICE_ID, status: 'PENDING',
    steps: [
      { id: 'step-1', instanceId: 'instance-2', sequence: 1, requiredRole: 'ACCOUNTANT', status: 'PENDING' },
      { id: 'step-2', instanceId: 'instance-2', sequence: 2, requiredRole: 'CONTROLLER', status: 'PENDING' },
    ],
  };

  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'je-123' }) });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('throws ApprovalInstanceNotFoundError when no instance exists', async () => {
    const prisma = makePrisma({ instanceFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService);
    await expect(svc.approveStep(TENANT_ID, INVOICE_ID, { version: 1 })).rejects.toBeInstanceOf(ApprovalInstanceNotFoundError);
  });

  it('throws ApprovalConflictError on a version mismatch', async () => {
    const prisma = makePrisma({ instanceFindFirst: vi.fn().mockResolvedValue(singleStepInstance) });
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService);
    await expect(svc.approveStep(TENANT_ID, INVOICE_ID, { version: 99 })).rejects.toBeInstanceOf(ApprovalConflictError);
  });

  it('throws WrongApproverRoleError when the actor role does not match the required tier role', async () => {
    const prisma = makePrisma({ instanceFindFirst: vi.fn().mockResolvedValue(twoStepInstance) });
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService);
    await expect(svc.approveStep(TENANT_ID, INVOICE_ID, { version: 1 }, 'user-1', 'CONTROLLER')).rejects.toBeInstanceOf(WrongApproverRoleError);
  });

  it('allows ANY_APPROVER tiers regardless of actor role', async () => {
    const prisma = makePrisma({ instanceFindFirst: vi.fn().mockResolvedValue(singleStepInstance) });
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService);
    const result = await svc.approveStep(TENANT_ID, INVOICE_ID, { version: 1 }, 'user-1', 'WHATEVER_ROLE');
    expect(prisma.vendorInvoice.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED' }) }));
  });

  it('finalizes on the last tier and posts the AP liability GL entry', async () => {
    const prisma = makePrisma({ instanceFindFirst: vi.fn().mockResolvedValue(singleStepInstance) });
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService);
    await svc.approveStep(TENANT_ID, INVOICE_ID, { version: 1 }, 'user-1', ANY_APPROVER_ROLE, 'fake-token');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/gl/journal-entries'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(prisma.vendorInvoice.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ approvalGlEntryId: 'je-123' }) }));
  });

  it('does not finalize (no GL posting) when more tiers remain', async () => {
    const prisma = makePrisma({ instanceFindFirst: vi.fn().mockResolvedValue(twoStepInstance) });
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService);
    await svc.approveStep(TENANT_ID, INVOICE_ID, { version: 1 }, 'user-1', 'ACCOUNTANT');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.vendorInvoice.update).not.toHaveBeenCalled();
  });

  it('does not fail the approval decision when GL posting fails — records a GL_POSTING_FAILED audit event instead', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'gl-service down' });
    const prisma = makePrisma({ instanceFindFirst: vi.fn().mockResolvedValue(singleStepInstance) });
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService);
    const instance = await svc.approveStep(TENANT_ID, INVOICE_ID, { version: 1 }, 'user-1', ANY_APPROVER_ROLE);
    expect(instance).toBeDefined();
    expect(prisma.auditOutboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'GL_POSTING_FAILED' }),
    }));
  });

  it('does not post a GL entry when the vendor has no default GL account configured', async () => {
    const prisma = makePrisma({
      instanceFindFirst: vi.fn().mockResolvedValue(singleStepInstance),
      vendorFindFirst: vi.fn().mockResolvedValue({ id: VENDOR_ID, tenantId: TENANT_ID, defaultGlAccount: null }),
    });
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService);
    await svc.approveStep(TENANT_ID, INVOICE_ID, { version: 1 }, 'user-1', ANY_APPROVER_ROLE);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.auditOutboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'GL_POSTING_FAILED' }),
    }));
  });
});

describe('InvoiceApprovalService.rejectStep', () => {
  const singleStepInstance = {
    id: 'instance-1', tenantId: TENANT_ID, invoiceId: INVOICE_ID, status: 'PENDING',
    steps: [{ id: 'step-1', instanceId: 'instance-1', sequence: 1, requiredRole: ANY_APPROVER_ROLE, status: 'PENDING' }],
  };

  it('requires a reason', async () => {
    const prisma = makePrisma({ instanceFindFirst: vi.fn().mockResolvedValue(singleStepInstance) });
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService);
    await expect(svc.rejectStep(TENANT_ID, INVOICE_ID, { version: 1, reason: '' })).rejects.toThrow();
  });

  it('rejects the instance and marks the invoice REJECTED', async () => {
    const prisma = makePrisma({ instanceFindFirst: vi.fn().mockResolvedValue(singleStepInstance) });
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService);
    await svc.rejectStep(TENANT_ID, INVOICE_ID, { version: 1, reason: 'Missing backup documentation' });
    expect(prisma.vendorInvoice.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }));
    expect(prisma.apInvoiceApprovalStep.updateMany).toHaveBeenCalled();
  });

  it('throws ApprovalAlreadyDecidedError when the instance is already decided', async () => {
    const prisma = makePrisma({ instanceFindFirst: vi.fn().mockResolvedValue({ ...singleStepInstance, status: 'APPROVED' }) });
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService);
    await expect(svc.rejectStep(TENANT_ID, INVOICE_ID, { version: 1, reason: 'x' })).rejects.toBeInstanceOf(ApprovalAlreadyDecidedError);
  });
});
