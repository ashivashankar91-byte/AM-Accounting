/**
 * CE-09 S042 — UseTaxService domain tests. Mocked-Prisma unit tests, same
 * style as manual-payment-service.test.ts; the GL posting HTTP call is
 * verified via a mocked global fetch.
 */
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  UseTaxService,
  InvoiceNotFoundForUseTaxError,
  UseTaxAssessmentValidationError,
  UseTaxAssessmentAlreadyExistsError,
  UseTaxAssessmentNotFoundError,
} from '../src/application/use-tax-service';

const TENANT_ID = 'tenant-use-tax';
const INVOICE_ID = 'invoice-1';

const BASE_INVOICE = { id: INVOICE_ID, tenantId: TENANT_ID, invoiceNumber: 'INV-900', invoiceDate: new Date('2026-08-05T00:00:00Z'), status: 'APPROVED' };
const BASE_GL_CONFIG = { tenantId: TENANT_ID, useTaxExpenseGlAccountId: 'gl-use-tax-expense', useTaxPayableGlAccountId: 'gl-use-tax-payable' };

function makePrisma(overrides: any = {}) {
  const client: any = {
    vendorInvoice: { findFirst: overrides.invoiceFindFirst ?? vi.fn().mockResolvedValue(BASE_INVOICE) },
    apUseTaxRateConfig: { findFirst: overrides.rateConfigFindFirst ?? vi.fn().mockResolvedValue(null) },
    apUseTaxGlAccountConfig: { findFirst: overrides.glConfigFindFirst ?? vi.fn().mockResolvedValue(BASE_GL_CONFIG) },
    apUseTaxAssessment: {
      findFirst: overrides.assessmentFindFirst ?? vi.fn().mockResolvedValue(null),
      findMany: overrides.assessmentFindMany ?? vi.fn().mockResolvedValue([]),
      create: overrides.assessmentCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'assessment-1', ...data })),
      update: overrides.assessmentUpdate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'assessment-1', ...data })),
    },
    auditOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  client.$transaction = async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg));
  return client;
}

describe('UseTaxService.assess', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('throws InvoiceNotFoundForUseTaxError when the invoice does not exist', async () => {
    const prisma = makePrisma({ invoiceFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new UseTaxService(prisma, {} as any);
    await expect(
      svc.assess(TENANT_ID, INVOICE_ID, { jurisdiction: 'TEST-JURISDICTION-01', taxableAmount: 100 }),
    ).rejects.toBeInstanceOf(InvoiceNotFoundForUseTaxError);
  });

  it('throws MANUAL_RATE_REQUIRED when no rate config exists and no manual rate is supplied', async () => {
    const prisma = makePrisma();
    const svc = new UseTaxService(prisma, {} as any);
    await expect(
      svc.assess(TENANT_ID, INVOICE_ID, { jurisdiction: 'UNCONFIGURED-JURISDICTION', taxableAmount: 100 }),
    ).rejects.toMatchObject({ code: 'MANUAL_RATE_REQUIRED' });
  });

  it('throws ATTESTATION_REQUIRED when a manual rate is supplied without an attestation basis', async () => {
    const prisma = makePrisma();
    const svc = new UseTaxService(prisma, {} as any);
    await expect(
      svc.assess(TENANT_ID, INVOICE_ID, { jurisdiction: 'UNCONFIGURED-JURISDICTION', taxableAmount: 100, manualRate: 0.07 }),
    ).rejects.toMatchObject({ code: 'ATTESTATION_REQUIRED' });
  });

  it('records ADAPTER_BOUNDARY_MANUAL_RATE with attestation when no rate source is configured', async () => {
    let created: any;
    const prisma = makePrisma({
      assessmentCreate: vi.fn().mockImplementation(({ data }: any) => { created = { id: 'assessment-1', ...data }; return Promise.resolve(created); }),
      assessmentFindFirst: vi.fn().mockImplementation(() => Promise.resolve(created ?? null)),
      assessmentUpdate: vi.fn().mockImplementation(({ data }: any) => { created = { ...created, ...data }; return Promise.resolve(created); }),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'je-1' }) }));
    const svc = new UseTaxService(prisma, {} as any);
    const result = await svc.assess(
      TENANT_ID, INVOICE_ID,
      { jurisdiction: 'UNCONFIGURED-JURISDICTION', taxableAmount: 100, manualRate: 0.08, attestationBasis: 'Verbal confirmation from state DOR hotline' },
      'clerk-1',
    );
    expect(result.rateSource).toBe('ADAPTER_BOUNDARY_MANUAL_RATE');
    expect(result.attestedBy).toBe('clerk-1');
    expect(result.assessedAmount).toBe('8');
  });

  it('uses the configured rate source when one exists for the jurisdiction', async () => {
    let created: any;
    const prisma = makePrisma({
      rateConfigFindFirst: vi.fn().mockResolvedValue({ rate: '0.070000' }),
      assessmentCreate: vi.fn().mockImplementation(({ data }: any) => { created = { id: 'assessment-1', ...data }; return Promise.resolve(created); }),
      assessmentFindFirst: vi.fn().mockImplementation(() => Promise.resolve(created ?? null)),
      assessmentUpdate: vi.fn().mockImplementation(({ data }: any) => { created = { ...created, ...data }; return Promise.resolve(created); }),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'je-1' }) }));
    const svc = new UseTaxService(prisma, {} as any);
    const result = await svc.assess(TENANT_ID, INVOICE_ID, { jurisdiction: 'TEST-JURISDICTION-01', taxableAmount: 200 });
    expect(result.rateSource).toBe('RATE_SOURCE_CONFIGURED');
    expect(result.assessedAmount).toBe('14');
  });

  it('throws UseTaxAssessmentAlreadyExistsError when an ASSESSED row already exists for the invoice (idempotent on replay)', async () => {
    const prisma = makePrisma({ assessmentFindFirst: vi.fn().mockResolvedValue({ id: 'existing' }) });
    const svc = new UseTaxService(prisma, {} as any);
    await expect(
      svc.assess(TENANT_ID, INVOICE_ID, { jurisdiction: 'TEST-JURISDICTION-01', taxableAmount: 100, manualRate: 0.07, attestationBasis: 'x' }),
    ).rejects.toBeInstanceOf(UseTaxAssessmentAlreadyExistsError);
  });

  it('maps a unique-constraint race (P2002) to UseTaxAssessmentAlreadyExistsError', async () => {
    const prisma = makePrisma({
      assessmentCreate: vi.fn().mockRejectedValue(Object.assign(new Error('unique violation'), { code: 'P2002' })),
    });
    const svc = new UseTaxService(prisma, {} as any);
    await expect(
      svc.assess(TENANT_ID, INVOICE_ID, { jurisdiction: 'TEST-JURISDICTION-01', taxableAmount: 100, manualRate: 0.07, attestationBasis: 'x' }),
    ).rejects.toBeInstanceOf(UseTaxAssessmentAlreadyExistsError);
  });

  it('records a truthful glPostingError when the use-tax GL accounts are not configured (blank matrix row)', async () => {
    const prisma = makePrisma({ glConfigFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new UseTaxService(prisma, {} as any);
    const result = await svc.assess(TENANT_ID, INVOICE_ID, { jurisdiction: 'TEST-JURISDICTION-01', taxableAmount: 100, manualRate: 0.07, attestationBasis: 'x' });
    expect(prisma.apUseTaxAssessment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ glPostingError: expect.stringContaining('not configured') }) }),
    );
    expect(result).toBeTruthy();
  });

  it('rejects an invalid taxableAmount', async () => {
    const prisma = makePrisma();
    const svc = new UseTaxService(prisma, {} as any);
    await expect(
      svc.assess(TENANT_ID, INVOICE_ID, { jurisdiction: 'TEST-JURISDICTION-01', taxableAmount: 0 }),
    ).rejects.toBeInstanceOf(UseTaxAssessmentValidationError);
  });
});

describe('UseTaxService.register', () => {
  it('sums assessedAmount across ASSESSED rows for the period', async () => {
    const prisma = makePrisma({
      assessmentFindMany: vi.fn().mockResolvedValue([{ assessedAmount: '10.00' }, { assessedAmount: '5.50' }]),
    });
    const svc = new UseTaxService(prisma, {} as any);
    const register = await svc.register(TENANT_ID, { period: '2026-08' });
    expect(register.totalAssessed).toBe(15.5);
    expect(register.assessmentCount).toBe(2);
  });
});

describe('UseTaxService.getById', () => {
  it('throws UseTaxAssessmentNotFoundError when no matching row exists', async () => {
    const prisma = makePrisma({ assessmentFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new UseTaxService(prisma, {} as any);
    await expect(svc.getById(TENANT_ID, 'missing')).rejects.toBeInstanceOf(UseTaxAssessmentNotFoundError);
  });
});
