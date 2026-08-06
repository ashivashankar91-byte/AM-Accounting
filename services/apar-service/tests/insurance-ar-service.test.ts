/**
 * CE-09 S049 (Insurance AR / Body Shop) — InsuranceArService domain tests.
 * Mocked-Prisma unit tests, same style as fleet-billing-service.test.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import {
  InsuranceArService,
  InsuranceArValidationError,
  InsuranceClaimNotFoundError,
  InsurerPaymentExceedsClaimBalanceError,
  NoShortPayRemainderError,
  ShortPayAlreadyDisposedError,
} from '../src/application/insurance-ar-service';

const TENANT_ID = 'tenant-insurance-ar';
const CUSTOMER_ID = 'customer-1';
const CLAIM_ID = 'claim-1';

const BASE_CUSTOMER = { id: CUSTOMER_ID, tenantId: TENANT_ID };
const BASE_CLAIM = {
  id: CLAIM_ID, tenantId: TENANT_ID, customerId: CUSTOMER_ID, insurerName: 'Acme Insurance', claimNumber: 'CLM-1',
  claimAmount: '1000.00', amountApplied: '0', status: 'OPEN', shortPayDisposedAt: null,
  supplements: [], applications: [], dispositions: [],
};

function baseClaimDto(overrides: any = {}) {
  return { customerId: CUSTOMER_ID, insurerName: 'Acme Insurance', claimNumber: 'CLM-1', claimAmount: 1000, ...overrides };
}

function makePrisma(overrides: any = {}) {
  const client: any = {
    customer: {
      findFirst: overrides.customerFindFirst ?? vi.fn().mockResolvedValue(BASE_CUSTOMER),
    },
    arInsuranceClaim: {
      findFirst: overrides.claimFindFirst ?? vi.fn().mockResolvedValue(BASE_CLAIM),
      findMany: overrides.claimFindMany ?? vi.fn().mockResolvedValue([BASE_CLAIM]),
      create: overrides.claimCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: CLAIM_ID, ...data, supplements: [], applications: [], dispositions: [] })),
      update: overrides.claimUpdate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_CLAIM, ...data })),
    },
    arInsuranceClaimSupplement: {
      create: overrides.supplementCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'supplement-1', ...data })),
      update: overrides.supplementUpdate ?? vi.fn().mockResolvedValue({}),
    },
    arInsurancePaymentApplication: {
      create: overrides.applicationCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'application-1', ...data })),
      update: overrides.applicationUpdate ?? vi.fn().mockResolvedValue({}),
    },
    arInsuranceShortPayDisposition: {
      create: overrides.dispositionCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'disposition-1', ...data })),
      update: overrides.dispositionUpdate ?? vi.fn().mockResolvedValue({}),
    },
    arInsuranceGlAccountConfig: {
      findFirst: overrides.glConfigFindFirst ?? vi.fn().mockResolvedValue(null),
    },
    auditOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  client.$transaction = async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg));
  return client;
}

describe('InsuranceArService.createClaim', () => {
  it('creates an OPEN insurance claim', async () => {
    const prisma = makePrisma();
    const svc = new InsuranceArService(prisma, {} as any);
    const claim = await svc.createClaim(TENANT_ID, baseClaimDto(), 'clerk-1');
    expect(prisma.arInsuranceClaim.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ claimNumber: 'CLM-1', status: 'OPEN' }),
    }));
    expect(claim.effectiveClaimAmount).toBe(1000);
  });

  it('rejects a missing customerId', async () => {
    const prisma = makePrisma();
    const svc = new InsuranceArService(prisma, {} as any);
    await expect(svc.createClaim(TENANT_ID, baseClaimDto({ customerId: '' }), 'clerk-1')).rejects.toBeInstanceOf(InsuranceArValidationError);
  });

  it('rejects a non-positive claimAmount', async () => {
    const prisma = makePrisma();
    const svc = new InsuranceArService(prisma, {} as any);
    await expect(svc.createClaim(TENANT_ID, baseClaimDto({ claimAmount: 0 }), 'clerk-1')).rejects.toBeInstanceOf(InsuranceArValidationError);
  });

  it('rejects an unknown customer', async () => {
    const prisma = makePrisma({ customerFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new InsuranceArService(prisma, {} as any);
    await expect(svc.createClaim(TENANT_ID, baseClaimDto(), 'clerk-1')).rejects.toBeInstanceOf(InsuranceArValidationError);
  });

  it('records a truthful GL posting failure when no GL config exists (ACCOUNT_MAPPING_VALUES_PENDING)', async () => {
    const prisma = makePrisma();
    const svc = new InsuranceArService(prisma, {} as any);
    await svc.createClaim(TENANT_ID, baseClaimDto(), 'clerk-1');
    expect(prisma.arInsuranceClaim.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ glPostingError: expect.stringContaining('ACCOUNT_MAPPING_VALUES_PENDING') }),
    }));
  });
});

describe('InsuranceArService.postSupplement', () => {
  it('posts a positive supplement without mutating the original claim amount', async () => {
    const prisma = makePrisma();
    const svc = new InsuranceArService(prisma, {} as any);
    await svc.postSupplement(TENANT_ID, CLAIM_ID, { adjustmentAmount: 200, reason: 'Additional parts found' }, 'clerk-1');
    expect(prisma.arInsuranceClaimSupplement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ adjustmentAmount: 200, reason: 'Additional parts found' }),
    }));
    // claimAmount itself is never passed to an update call with a new value.
    const claimUpdateCalls = prisma.arInsuranceClaim.update.mock.calls;
    for (const call of claimUpdateCalls) {
      expect(call[0].data.claimAmount).toBeUndefined();
    }
  });

  it('rejects a zero adjustmentAmount', async () => {
    const prisma = makePrisma();
    const svc = new InsuranceArService(prisma, {} as any);
    await expect(svc.postSupplement(TENANT_ID, CLAIM_ID, { adjustmentAmount: 0, reason: 'x' }, 'clerk-1')).rejects.toBeInstanceOf(InsuranceArValidationError);
  });

  it('rejects a missing reason', async () => {
    const prisma = makePrisma();
    const svc = new InsuranceArService(prisma, {} as any);
    await expect(svc.postSupplement(TENANT_ID, CLAIM_ID, { adjustmentAmount: 100, reason: '' }, 'clerk-1')).rejects.toBeInstanceOf(InsuranceArValidationError);
  });

  it('throws InsuranceClaimNotFoundError for an unknown claim', async () => {
    const prisma = makePrisma({ claimFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new InsuranceArService(prisma, {} as any);
    await expect(svc.postSupplement(TENANT_ID, 'missing', { adjustmentAmount: 100, reason: 'x' }, 'clerk-1')).rejects.toBeInstanceOf(InsuranceClaimNotFoundError);
  });
});

describe('InsuranceArService.applyInsurerPayment', () => {
  it('applies a payment that relieves the claim by exactly the applied amount', async () => {
    const prisma = makePrisma();
    const svc = new InsuranceArService(prisma, {} as any);
    await svc.applyInsurerPayment(TENANT_ID, CLAIM_ID, { amount: 700 }, 'clerk-1');
    expect(prisma.arInsurancePaymentApplication.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: 700 }),
    }));
    expect(prisma.arInsuranceClaim.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amountApplied: 700, status: 'PARTIALLY_APPLIED' }),
    }));
  });

  it('marks the claim RESOLVED when the payment fully covers the effective claim amount', async () => {
    const prisma = makePrisma();
    const svc = new InsuranceArService(prisma, {} as any);
    await svc.applyInsurerPayment(TENANT_ID, CLAIM_ID, { amount: 1000 }, 'clerk-1');
    expect(prisma.arInsuranceClaim.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amountApplied: 1000, status: 'RESOLVED' }),
    }));
  });

  it('rejects a non-positive amount', async () => {
    const prisma = makePrisma();
    const svc = new InsuranceArService(prisma, {} as any);
    await expect(svc.applyInsurerPayment(TENANT_ID, CLAIM_ID, { amount: 0 }, 'clerk-1')).rejects.toBeInstanceOf(InsuranceArValidationError);
  });

  it('refuses a payment that exceeds the claim remaining balance', async () => {
    const prisma = makePrisma();
    const svc = new InsuranceArService(prisma, {} as any);
    await expect(svc.applyInsurerPayment(TENANT_ID, CLAIM_ID, { amount: 1500 }, 'clerk-1')).rejects.toBeInstanceOf(InsurerPaymentExceedsClaimBalanceError);
  });

  it('accounts for supplements when computing the remaining balance', async () => {
    const claimWithSupplement = { ...BASE_CLAIM, supplements: [{ adjustmentAmount: '200.00' }] };
    const prisma = makePrisma({ claimFindFirst: vi.fn().mockResolvedValue(claimWithSupplement) });
    const svc = new InsuranceArService(prisma, {} as any);
    await svc.applyInsurerPayment(TENANT_ID, CLAIM_ID, { amount: 1200 }, 'clerk-1');
    expect(prisma.arInsurancePaymentApplication.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: 1200 }),
    }));
  });
});

describe('InsuranceArService.disposeShortPay', () => {
  it('disposes the remainder to CUSTOMER_RESPONSIBILITY exactly once', async () => {
    const claimWithBalance = { ...BASE_CLAIM, amountApplied: '700.00' };
    const prisma = makePrisma({ claimFindFirst: vi.fn().mockResolvedValue(claimWithBalance) });
    const svc = new InsuranceArService(prisma, {} as any);
    await svc.disposeShortPay(TENANT_ID, CLAIM_ID, { dispositionType: 'CUSTOMER_RESPONSIBILITY', reason: 'Deductible' }, 'clerk-1');
    expect(prisma.arInsuranceShortPayDisposition.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: 300, dispositionType: 'CUSTOMER_RESPONSIBILITY' }),
    }));
    expect(prisma.arInsuranceClaim.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CLOSED' }),
    }));
  });

  it('disposes the remainder to WRITE_OFF', async () => {
    const claimWithBalance = { ...BASE_CLAIM, amountApplied: '700.00' };
    const prisma = makePrisma({ claimFindFirst: vi.fn().mockResolvedValue(claimWithBalance) });
    const svc = new InsuranceArService(prisma, {} as any);
    await svc.disposeShortPay(TENANT_ID, CLAIM_ID, { dispositionType: 'WRITE_OFF', reason: 'Uncollectible' }, 'clerk-1');
    expect(prisma.arInsuranceShortPayDisposition.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: 300, dispositionType: 'WRITE_OFF' }),
    }));
  });

  it('rejects an invalid dispositionType', async () => {
    const prisma = makePrisma();
    const svc = new InsuranceArService(prisma, {} as any);
    await expect(svc.disposeShortPay(TENANT_ID, CLAIM_ID, { dispositionType: 'OTHER' as any, reason: 'x' }, 'clerk-1')).rejects.toBeInstanceOf(InsuranceArValidationError);
  });

  it('refuses when there is no remainder to dispose of', async () => {
    const fullyPaidClaim = { ...BASE_CLAIM, amountApplied: '1000.00' };
    const prisma = makePrisma({ claimFindFirst: vi.fn().mockResolvedValue(fullyPaidClaim) });
    const svc = new InsuranceArService(prisma, {} as any);
    await expect(svc.disposeShortPay(TENANT_ID, CLAIM_ID, { dispositionType: 'WRITE_OFF', reason: 'x' }, 'clerk-1')).rejects.toBeInstanceOf(NoShortPayRemainderError);
  });

  it('refuses a second disposition attempt on the same claim', async () => {
    const alreadyDisposedClaim = { ...BASE_CLAIM, amountApplied: '700.00', shortPayDisposedAt: new Date() };
    const prisma = makePrisma({ claimFindFirst: vi.fn().mockResolvedValue(alreadyDisposedClaim) });
    const svc = new InsuranceArService(prisma, {} as any);
    await expect(svc.disposeShortPay(TENANT_ID, CLAIM_ID, { dispositionType: 'WRITE_OFF', reason: 'x' }, 'clerk-1')).rejects.toBeInstanceOf(ShortPayAlreadyDisposedError);
  });
});

describe('InsuranceArService.getById / list', () => {
  it('throws InsuranceClaimNotFoundError when missing', async () => {
    const prisma = makePrisma({ claimFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new InsuranceArService(prisma, {} as any);
    await expect(svc.getById(TENANT_ID, 'missing')).rejects.toBeInstanceOf(InsuranceClaimNotFoundError);
  });

  it('lists insurance claims for a tenant', async () => {
    const prisma = makePrisma();
    const svc = new InsuranceArService(prisma, {} as any);
    const rows = await svc.list(TENANT_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].effectiveClaimAmount).toBe(1000);
  });
});
