/**
 * CE-09 S037 (1099/T4A Flag Rules & Preview) — Vendor1099Service domain
 * tests. Mocked-Prisma unit tests, same style as
 * fleet-billing-service.test.ts / insurance-ar-service.test.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import {
  Vendor1099Service,
  Vendor1099ValidationError,
  Vendor1099VendorNotFoundError,
} from '../src/application/vendor-1099-service';

const TENANT_ID = 'tenant-1099';
const VENDOR_ID = 'vendor-1';

const BASE_VENDOR = { id: VENDOR_ID, tenantId: TENANT_ID };

function baseRuleDto(overrides: any = {}) {
  return { vendorId: VENDOR_ID, taxYear: 2026, formType: '1099-NEC', boxCode: '1', ...overrides };
}

function makePrisma(overrides: any = {}) {
  const client: any = {
    vendor: {
      findFirst: overrides.vendorFindFirst ?? vi.fn().mockResolvedValue(BASE_VENDOR),
    },
    ap1099VendorBoxRule: {
      findFirst: overrides.ruleFindFirst ?? vi.fn().mockResolvedValue(null),
      findMany: overrides.ruleFindMany ?? vi.fn().mockResolvedValue([]),
      create: overrides.ruleCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'rule-1', ...data })),
      update: overrides.ruleUpdate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'rule-1', ...data })),
    },
    ap1099ThresholdConfig: {
      findFirst: overrides.thresholdFindFirst ?? vi.fn().mockResolvedValue(null),
      findMany: overrides.thresholdFindMany ?? vi.fn().mockResolvedValue([]),
      create: overrides.thresholdCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'threshold-1', ...data })),
      update: overrides.thresholdUpdate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'threshold-1', ...data })),
    },
    ap1099Correction: {
      findMany: overrides.correctionFindMany ?? vi.fn().mockResolvedValue([]),
      create: overrides.correctionCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'correction-1', ...data })),
    },
    apManualPayment: {
      findMany: overrides.paymentFindMany ?? vi.fn().mockResolvedValue([]),
    },
    auditOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  client.$transaction = async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg));
  return client;
}

describe('Vendor1099Service.setVendorBoxRule', () => {
  it('creates a new box rule for a vendor/tax year/form type', async () => {
    const prisma = makePrisma();
    const svc = new Vendor1099Service(prisma);
    const rule = await svc.setVendorBoxRule(TENANT_ID, baseRuleDto(), 'clerk-1');
    expect(prisma.ap1099VendorBoxRule.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ vendorId: VENDOR_ID, taxYear: 2026, formType: '1099-NEC', boxCode: '1' }),
    }));
    expect(rule.boxCode).toBe('1');
  });

  it('updates (upserts) an existing rule for the same key rather than duplicating', async () => {
    const existing = { id: 'rule-1', tenantId: TENANT_ID, vendorId: VENDOR_ID, taxYear: 2026, formType: '1099-NEC', boxCode: '1' };
    const prisma = makePrisma({ ruleFindFirst: vi.fn().mockResolvedValue(existing) });
    const svc = new Vendor1099Service(prisma);
    await svc.setVendorBoxRule(TENANT_ID, baseRuleDto({ boxCode: '7' }), 'clerk-1');
    expect(prisma.ap1099VendorBoxRule.update).toHaveBeenCalledWith({ where: { id: 'rule-1' }, data: { boxCode: '7' } });
    expect(prisma.ap1099VendorBoxRule.create).not.toHaveBeenCalled();
  });

  it('rejects a missing vendorId', async () => {
    const prisma = makePrisma();
    const svc = new Vendor1099Service(prisma);
    await expect(svc.setVendorBoxRule(TENANT_ID, baseRuleDto({ vendorId: '' }), 'clerk-1')).rejects.toBeInstanceOf(Vendor1099ValidationError);
  });

  it('rejects an invalid formType', async () => {
    const prisma = makePrisma();
    const svc = new Vendor1099Service(prisma);
    await expect(svc.setVendorBoxRule(TENANT_ID, baseRuleDto({ formType: 'W2' }), 'clerk-1')).rejects.toBeInstanceOf(Vendor1099ValidationError);
  });

  it('rejects a missing boxCode', async () => {
    const prisma = makePrisma();
    const svc = new Vendor1099Service(prisma);
    await expect(svc.setVendorBoxRule(TENANT_ID, baseRuleDto({ boxCode: '' }), 'clerk-1')).rejects.toBeInstanceOf(Vendor1099ValidationError);
  });

  it('rejects a missing/non-integer taxYear', async () => {
    const prisma = makePrisma();
    const svc = new Vendor1099Service(prisma);
    await expect(svc.setVendorBoxRule(TENANT_ID, baseRuleDto({ taxYear: 0 }), 'clerk-1')).rejects.toBeInstanceOf(Vendor1099ValidationError);
  });

  it('throws Vendor1099VendorNotFoundError for an unknown vendor', async () => {
    const prisma = makePrisma({ vendorFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new Vendor1099Service(prisma);
    await expect(svc.setVendorBoxRule(TENANT_ID, baseRuleDto(), 'clerk-1')).rejects.toBeInstanceOf(Vendor1099VendorNotFoundError);
  });

  it('writes an audit outbox event on create', async () => {
    const prisma = makePrisma();
    const svc = new Vendor1099Service(prisma);
    await svc.setVendorBoxRule(TENANT_ID, baseRuleDto(), 'clerk-1');
    expect(prisma.auditOutboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ docType: 'Ap1099VendorBoxRule', action: 'CREATED', actor: 'clerk-1' }),
    }));
  });
});

describe('Vendor1099Service.listVendorBoxRules', () => {
  it('filters by vendorId and taxYear when provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ ruleFindMany: findMany });
    const svc = new Vendor1099Service(prisma);
    await svc.listVendorBoxRules(TENANT_ID, VENDOR_ID, 2026);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: TENANT_ID, vendorId: VENDOR_ID, taxYear: 2026 },
    }));
  });
});

describe('Vendor1099Service.setThresholdConfig', () => {
  it('creates a new threshold config', async () => {
    const prisma = makePrisma();
    const svc = new Vendor1099Service(prisma);
    const config = await svc.setThresholdConfig(TENANT_ID, { formType: '1099-NEC', taxYear: 2026, thresholdAmount: 600 }, 'accountant-1');
    expect(config.thresholdAmount).toBe(600);
  });

  it('rejects a negative thresholdAmount', async () => {
    const prisma = makePrisma();
    const svc = new Vendor1099Service(prisma);
    await expect(svc.setThresholdConfig(TENANT_ID, { formType: '1099-NEC', taxYear: 2026, thresholdAmount: -1 }, 'accountant-1')).rejects.toBeInstanceOf(Vendor1099ValidationError);
  });

  it('rejects an invalid formType', async () => {
    const prisma = makePrisma();
    const svc = new Vendor1099Service(prisma);
    await expect(svc.setThresholdConfig(TENANT_ID, { formType: 'BOGUS', taxYear: 2026, thresholdAmount: 600 } as any, 'accountant-1')).rejects.toBeInstanceOf(Vendor1099ValidationError);
  });

  it('updates an existing config for the same tenant/form/year rather than duplicating', async () => {
    const existing = { id: 'threshold-1', tenantId: TENANT_ID, formType: '1099-NEC', taxYear: 2026, thresholdAmount: '600' };
    const prisma = makePrisma({ thresholdFindFirst: vi.fn().mockResolvedValue(existing) });
    const svc = new Vendor1099Service(prisma);
    await svc.setThresholdConfig(TENANT_ID, { formType: '1099-NEC', taxYear: 2026, thresholdAmount: 700 }, 'accountant-1');
    expect(prisma.ap1099ThresholdConfig.update).toHaveBeenCalledWith({ where: { id: 'threshold-1' }, data: { thresholdAmount: 700 } });
    expect(prisma.ap1099ThresholdConfig.create).not.toHaveBeenCalled();
  });
});

describe('Vendor1099Service.postCorrection', () => {
  it('computes originalAmount from posted payments at the moment of correction, never trusting caller input', async () => {
    const paymentFindMany = vi.fn().mockResolvedValue([{ amount: '400.00' }, { amount: '250.00' }]);
    const prisma = makePrisma({ paymentFindMany });
    const svc = new Vendor1099Service(prisma);
    const correction = await svc.postCorrection(TENANT_ID, {
      vendorId: VENDOR_ID, taxYear: 2026, formType: '1099-NEC', correctedAmount: 700, reason: 'Missed a late invoice payment',
    }, 'accountant-1');
    expect(correction.originalAmount).toBe(650);
    expect(correction.correctedAmount).toBe(700);
  });

  it('rejects a missing reason', async () => {
    const prisma = makePrisma();
    const svc = new Vendor1099Service(prisma);
    await expect(svc.postCorrection(TENANT_ID, {
      vendorId: VENDOR_ID, taxYear: 2026, formType: '1099-NEC', correctedAmount: 700, reason: '',
    }, 'accountant-1')).rejects.toBeInstanceOf(Vendor1099ValidationError);
  });

  it('rejects a negative correctedAmount', async () => {
    const prisma = makePrisma();
    const svc = new Vendor1099Service(prisma);
    await expect(svc.postCorrection(TENANT_ID, {
      vendorId: VENDOR_ID, taxYear: 2026, formType: '1099-NEC', correctedAmount: -5, reason: 'test',
    }, 'accountant-1')).rejects.toBeInstanceOf(Vendor1099ValidationError);
  });

  it('throws Vendor1099VendorNotFoundError for an unknown vendor', async () => {
    const prisma = makePrisma({ vendorFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new Vendor1099Service(prisma);
    await expect(svc.postCorrection(TENANT_ID, {
      vendorId: VENDOR_ID, taxYear: 2026, formType: '1099-NEC', correctedAmount: 700, reason: 'test',
    }, 'accountant-1')).rejects.toBeInstanceOf(Vendor1099VendorNotFoundError);
  });

  it('writes an audit outbox event including the computed originalAmount', async () => {
    const paymentFindMany = vi.fn().mockResolvedValue([{ amount: '100.00' }]);
    const prisma = makePrisma({ paymentFindMany });
    const svc = new Vendor1099Service(prisma);
    await svc.postCorrection(TENANT_ID, {
      vendorId: VENDOR_ID, taxYear: 2026, formType: '1099-NEC', correctedAmount: 150, reason: 'test',
    }, 'accountant-1');
    expect(prisma.auditOutboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ docType: 'Ap1099Correction', before: { originalAmount: 100 } }),
    }));
  });
});

describe('Vendor1099Service.getYearPreview', () => {
  it('reconciles byte-exactly to posted payments when no correction exists', async () => {
    const ruleFindMany = vi.fn().mockResolvedValue([{ vendorId: VENDOR_ID, taxYear: 2026, formType: '1099-NEC', boxCode: '1' }]);
    const paymentFindMany = vi.fn().mockResolvedValue([{ amount: '325.50' }, { amount: '74.50' }]);
    const prisma = makePrisma({ ruleFindMany, paymentFindMany });
    const svc = new Vendor1099Service(prisma);
    const preview = await svc.getYearPreview(TENANT_ID, 2026);
    expect(preview.lines).toHaveLength(1);
    expect(preview.lines[0].originalAmount).toBe(400);
    expect(preview.lines[0].reportedAmount).toBe(400);
    expect(preview.lines[0].correctionApplied).toBe(false);
    expect(preview.totalReported).toBe(400);
  });

  it('layers the latest correction on top of the computed amount without mutating originalAmount', async () => {
    const ruleFindMany = vi.fn().mockResolvedValue([{ vendorId: VENDOR_ID, taxYear: 2026, formType: '1099-NEC', boxCode: '1' }]);
    const paymentFindMany = vi.fn().mockResolvedValue([{ amount: '400.00' }]);
    const correctionFindMany = vi.fn().mockResolvedValue([{ id: 'c1', correctedAmount: '700.00', createdAt: new Date() }]);
    const prisma = makePrisma({ ruleFindMany, paymentFindMany, correctionFindMany });
    const svc = new Vendor1099Service(prisma);
    const preview = await svc.getYearPreview(TENANT_ID, 2026);
    expect(preview.lines[0].originalAmount).toBe(400);
    expect(preview.lines[0].reportedAmount).toBe(700);
    expect(preview.lines[0].correctionApplied).toBe(true);
  });

  it('reports thresholdConfigured: false and belowThreshold: null when no threshold is configured', async () => {
    const ruleFindMany = vi.fn().mockResolvedValue([{ vendorId: VENDOR_ID, taxYear: 2026, formType: '1099-NEC', boxCode: '1' }]);
    const prisma = makePrisma({ ruleFindMany });
    const svc = new Vendor1099Service(prisma);
    const preview = await svc.getYearPreview(TENANT_ID, 2026);
    expect(preview.lines[0].thresholdConfigured).toBe(false);
    expect(preview.lines[0].belowThreshold).toBeNull();
  });

  it('flags belowThreshold correctly when a threshold is configured', async () => {
    const ruleFindMany = vi.fn().mockResolvedValue([{ vendorId: VENDOR_ID, taxYear: 2026, formType: '1099-NEC', boxCode: '1' }]);
    const paymentFindMany = vi.fn().mockResolvedValue([{ amount: '500.00' }]);
    const thresholdFindMany = vi.fn().mockResolvedValue([{ formType: '1099-NEC', thresholdAmount: '600.00' }]);
    const prisma = makePrisma({ ruleFindMany, paymentFindMany, thresholdFindMany });
    const svc = new Vendor1099Service(prisma);
    const preview = await svc.getYearPreview(TENANT_ID, 2026);
    expect(preview.lines[0].thresholdConfigured).toBe(true);
    expect(preview.lines[0].belowThreshold).toBe(true);
  });

  it('always records efileTransmissionStatus as excluded from scope', async () => {
    const prisma = makePrisma();
    const svc = new Vendor1099Service(prisma);
    const preview = await svc.getYearPreview(TENANT_ID, 2026);
    expect(preview.efileTransmissionStatus).toBe('NOT_IN_SCOPE_COMPLIANCE_VENDOR');
  });

  it('rejects a missing/non-integer taxYear', async () => {
    const prisma = makePrisma();
    const svc = new Vendor1099Service(prisma);
    await expect(svc.getYearPreview(TENANT_ID, 0)).rejects.toBeInstanceOf(Vendor1099ValidationError);
  });

  it('returns an empty preview when no vendor has a box rule for the year', async () => {
    const prisma = makePrisma();
    const svc = new Vendor1099Service(prisma);
    const preview = await svc.getYearPreview(TENANT_ID, 2026);
    expect(preview.lines).toHaveLength(0);
    expect(preview.totalReported).toBe(0);
  });
});
