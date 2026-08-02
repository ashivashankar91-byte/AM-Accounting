/**
 * AMACC-CH04 S041 — InvoiceApprovalService domain tests. Mocked-Prisma unit
 * tests.
 *
 * CE-07 (single authoritative ledger decision): the AP liability posting no
 * longer calls gl-service's journal-entries endpoints directly — it submits
 * a canonical event through PostingEnginePort (mocked here, real behavior
 * covered by coa-service's own live-db gl-posting-bridge-live.test.ts). A
 * mocked global fetch still covers the read-only gl-service account-number
 * resolution GET calls (_resolveAccountCode) this service still makes.
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
import type { PostingEnginePort } from '../src/application/posting-engine-port';

const TENANT_ID = 'tenant-approval-svc';
const INVOICE_ID = 'invoice-1';
const VENDOR_ID = 'vendor-1';

const BASE_INVOICE = {
  id: INVOICE_ID, tenantId: TENANT_ID, vendorId: VENDOR_ID, invoiceNumber: 'INV-500',
  totalAmount: '1000.00', status: 'SUBMITTED', version: 1, invoiceDate: new Date('2026-06-01'),
  lines: [{ id: 'line-1', glAccountId: 'gl-expense-1', poLineId: null, description: 'Widget', lineTotal: '1000.00' }],
};

function makePostingEnginePort(overrides: Partial<PostingEnginePort> = {}): PostingEnginePort {
  return {
    submit: vi.fn().mockResolvedValue({ ok: true, status: 'PENDING_REVIEW', journalEntryId: 'je-123', journalNumber: 'JE-000123' }),
    ...overrides,
  };
}

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
  // CE-07 — setTenantContextOnConnection() (first statement inside every
  // interactive $transaction callback, see rls-middleware.ts) issues a raw
  // SET on the transaction's own connection; the mock tx here is this same
  // client object (see $transaction below), so it needs the method too.
  client.$executeRawUnsafe = vi.fn().mockResolvedValue(undefined);
  client.$transaction = async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg));
  return client;
}

const fakeRuleService: any = {
  resolveTiers: vi.fn().mockResolvedValue([{ sequence: 1, requiredRole: ANY_APPROVER_ROLE, thresholdAmount: 0 }]),
};

describe('InvoiceApprovalService.start', () => {
  it('throws when the invoice is not SUBMITTED', async () => {
    const prisma = makePrisma({ invoiceFindFirst: vi.fn().mockResolvedValue({ ...BASE_INVOICE, status: 'DRAFT' }) });
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService, makePostingEnginePort());
    await expect(svc.start(TENANT_ID, INVOICE_ID)).rejects.toBeInstanceOf(InvoiceNotSubmittedError);
  });

  it('creates an approval instance with tiers from the rule service and moves the invoice to PENDING_APPROVAL', async () => {
    const prisma = makePrisma();
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService, makePostingEnginePort());
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
    // Serves the read-only GET /gl/accounts/:id calls _resolveAccountCode
    // makes (line accounts + vendor's default GL account) — never a GL write.
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 'MOCK-ACCT' }) });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('throws ApprovalInstanceNotFoundError when no instance exists', async () => {
    const prisma = makePrisma({ instanceFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService, makePostingEnginePort());
    await expect(svc.approveStep(TENANT_ID, INVOICE_ID, { version: 1 })).rejects.toBeInstanceOf(ApprovalInstanceNotFoundError);
  });

  it('throws ApprovalConflictError on a version mismatch', async () => {
    const prisma = makePrisma({ instanceFindFirst: vi.fn().mockResolvedValue(singleStepInstance) });
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService, makePostingEnginePort());
    await expect(svc.approveStep(TENANT_ID, INVOICE_ID, { version: 99 })).rejects.toBeInstanceOf(ApprovalConflictError);
  });

  it('throws WrongApproverRoleError when the actor role does not match the required tier role', async () => {
    const prisma = makePrisma({ instanceFindFirst: vi.fn().mockResolvedValue(twoStepInstance) });
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService, makePostingEnginePort());
    await expect(svc.approveStep(TENANT_ID, INVOICE_ID, { version: 1 }, 'user-1', 'CONTROLLER')).rejects.toBeInstanceOf(WrongApproverRoleError);
  });

  it('allows ANY_APPROVER tiers regardless of actor role', async () => {
    const prisma = makePrisma({ instanceFindFirst: vi.fn().mockResolvedValue(singleStepInstance) });
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService, makePostingEnginePort());
    const result = await svc.approveStep(TENANT_ID, INVOICE_ID, { version: 1 }, 'user-1', 'WHATEVER_ROLE');
    expect(prisma.vendorInvoice.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED' }) }));
  });

  it('finalizes on the last tier and submits the AP liability event through the posting engine', async () => {
    const prisma = makePrisma({ instanceFindFirst: vi.fn().mockResolvedValue(singleStepInstance) });
    const postingEnginePort = makePostingEnginePort();
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService, postingEnginePort);
    await svc.approveStep(TENANT_ID, INVOICE_ID, { version: 1 }, 'user-1', ANY_APPROVER_ROLE, 'fake-token');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/gl/accounts/'),
      expect.anything(),
    );
    expect(postingEnginePort.submit).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'ap.invoice.accepted.v1', tenantId: TENANT_ID }));
    expect(prisma.vendorInvoice.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ approvalGlEntryId: 'je-123' }) }));
  });

  it('does not finalize (no GL posting) when more tiers remain', async () => {
    const prisma = makePrisma({ instanceFindFirst: vi.fn().mockResolvedValue(twoStepInstance) });
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService, makePostingEnginePort());
    await svc.approveStep(TENANT_ID, INVOICE_ID, { version: 1 }, 'user-1', 'ACCOUNTANT');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.vendorInvoice.update).not.toHaveBeenCalled();
  });

  it('does not fail the approval decision when account-code resolution fails — records a GL_POSTING_FAILED audit event instead', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'gl-service down' });
    const prisma = makePrisma({ instanceFindFirst: vi.fn().mockResolvedValue(singleStepInstance) });
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService, makePostingEnginePort());
    const instance = await svc.approveStep(TENANT_ID, INVOICE_ID, { version: 1 }, 'user-1', ANY_APPROVER_ROLE);
    expect(instance).toBeDefined();
    expect(prisma.auditOutboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'GL_POSTING_FAILED' }),
    }));
  });

  it('does not fail the approval decision when the posting engine rejects the submission — records a GL_POSTING_FAILED audit event instead', async () => {
    const prisma = makePrisma({ instanceFindFirst: vi.fn().mockResolvedValue(singleStepInstance) });
    const postingEnginePort = makePostingEnginePort({ submit: vi.fn().mockResolvedValue({ ok: false, failureReason: 'INVALID_ACCOUNT' }) });
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService, postingEnginePort);
    const instance = await svc.approveStep(TENANT_ID, INVOICE_ID, { version: 1 }, 'user-1', ANY_APPROVER_ROLE);
    expect(instance).toBeDefined();
    expect(prisma.vendorInvoice.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ approvalGlEntryId: expect.anything() }) }));
    expect(prisma.auditOutboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'GL_POSTING_FAILED' }),
    }));
  });

  it('does not post a GL entry when the vendor has no default GL account configured', async () => {
    const prisma = makePrisma({
      instanceFindFirst: vi.fn().mockResolvedValue(singleStepInstance),
      vendorFindFirst: vi.fn().mockResolvedValue({ id: VENDOR_ID, tenantId: TENANT_ID, defaultGlAccount: null }),
    });
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService, makePostingEnginePort());
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
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService, makePostingEnginePort());
    await expect(svc.rejectStep(TENANT_ID, INVOICE_ID, { version: 1, reason: '' })).rejects.toThrow();
  });

  it('rejects the instance and marks the invoice REJECTED', async () => {
    const prisma = makePrisma({ instanceFindFirst: vi.fn().mockResolvedValue(singleStepInstance) });
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService, makePostingEnginePort());
    await svc.rejectStep(TENANT_ID, INVOICE_ID, { version: 1, reason: 'Missing backup documentation' });
    expect(prisma.vendorInvoice.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }));
    expect(prisma.apInvoiceApprovalStep.updateMany).toHaveBeenCalled();
  });

  it('throws ApprovalAlreadyDecidedError when the instance is already decided', async () => {
    const prisma = makePrisma({ instanceFindFirst: vi.fn().mockResolvedValue({ ...singleStepInstance, status: 'APPROVED' }) });
    const svc = new InvoiceApprovalService(prisma, {} as any, fakeRuleService, makePostingEnginePort());
    await expect(svc.rejectStep(TENANT_ID, INVOICE_ID, { version: 1, reason: 'x' })).rejects.toBeInstanceOf(ApprovalAlreadyDecidedError);
  });
});
