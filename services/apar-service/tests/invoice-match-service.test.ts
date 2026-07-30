/**
 * AMACC-CH04 S039 — InvoiceMatchService domain tests (tolerance resolution
 * + 2-way/3-way match engine). Mocked-Prisma unit tests, mirroring the
 * pattern in tests/vendor-service.test.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { InvoiceMatchService } from '../src/application/invoice-match-service';

const TENANT_ID = 'tenant-match';
const VENDOR_ID = 'vendor-1';
const PO_ID = 'po-1';
const PO_LINE_ID = 'po-line-1';

function makePrisma(overrides: Partial<{
  toleranceFindFirst: ReturnType<typeof vi.fn>;
  poLineFindMany: ReturnType<typeof vi.fn>;
  receiptLineFindMany: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    apInvoiceMatchToleranceConfig: {
      findFirst: overrides.toleranceFindFirst ?? vi.fn().mockResolvedValue(null),
    },
    pOLine: {
      findMany: overrides.poLineFindMany ?? vi.fn().mockResolvedValue([
        { id: PO_LINE_ID, poId: PO_ID, qty: '10', unitCost: '5.00' },
      ]),
    },
    goodsReceiptLine: {
      findMany: overrides.receiptLineFindMany ?? vi.fn().mockResolvedValue([]),
    },
  };
}

describe('InvoiceMatchService.resolveTolerance', () => {
  it('defaults to 0.00/0% when no tolerance config exists at any scope (conservative default)', async () => {
    const prisma = makePrisma();
    const svc = new InvoiceMatchService(prisma as any);
    const result = await svc.resolveTolerance({ tenantId: TENANT_ID, vendorId: VENDOR_ID });
    expect(result).toEqual({ amountTolerance: 0, percentTolerance: 0 });
  });

  it('resolves VENDOR scope before TENANT scope', async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce({ amountTolerance: '2.50', percentTolerance: '1.00' }); // VENDOR hit
    const prisma = makePrisma({ toleranceFindFirst: findFirst });
    const svc = new InvoiceMatchService(prisma as any);
    const result = await svc.resolveTolerance({ tenantId: TENANT_ID, vendorId: VENDOR_ID });
    expect(result).toEqual({ amountTolerance: 2.5, percentTolerance: 1 });
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('falls back to TENANT scope when no VENDOR-scoped config exists', async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce(null) // VENDOR miss
      .mockResolvedValueOnce({ amountTolerance: '10.00', percentTolerance: '2.00' }); // TENANT hit
    const prisma = makePrisma({ toleranceFindFirst: findFirst });
    const svc = new InvoiceMatchService(prisma as any);
    const result = await svc.resolveTolerance({ tenantId: TENANT_ID, vendorId: VENDOR_ID });
    expect(result).toEqual({ amountTolerance: 10, percentTolerance: 2 });
  });
});

describe('InvoiceMatchService.match', () => {
  it('returns matchType NONE and MATCHED when the invoice has no PO', async () => {
    const prisma = makePrisma();
    const svc = new InvoiceMatchService(prisma as any);
    const result = await svc.match({ tenantId: TENANT_ID, vendorId: VENDOR_ID, poId: null, invoiceLines: [] });
    expect(result.matchType).toBe('NONE');
    expect(result.status).toBe('MATCHED');
    expect(result.variances).toEqual([]);
  });

  it('TWO_WAY: matches exactly when invoice price/qty equal the PO line and there are no receipts', async () => {
    const prisma = makePrisma({ receiptLineFindMany: vi.fn().mockResolvedValue([]) });
    const svc = new InvoiceMatchService(prisma as any);
    const result = await svc.match({
      tenantId: TENANT_ID, vendorId: VENDOR_ID, poId: PO_ID,
      invoiceLines: [{ id: 'il-1', poLineId: PO_LINE_ID, quantity: 10, unitPrice: 5.0 }],
    });
    expect(result.matchType).toBe('TWO_WAY');
    expect(result.status).toBe('MATCHED');
  });

  it('TWO_WAY: flags a price variance outside tolerance as EXCEPTION', async () => {
    const prisma = makePrisma();
    const svc = new InvoiceMatchService(prisma as any);
    const result = await svc.match({
      tenantId: TENANT_ID, vendorId: VENDOR_ID, poId: PO_ID,
      invoiceLines: [{ id: 'il-1', poLineId: PO_LINE_ID, quantity: 10, unitPrice: 7.5 }], // PO cost is 5.00
    });
    expect(result.status).toBe('EXCEPTION');
    const priceVariance = result.variances.find((v) => v.type === 'PRICE_VARIANCE');
    expect(priceVariance?.withinTolerance).toBe(false);
    expect(priceVariance?.varianceAmount).toBeCloseTo(2.5);
  });

  it('TWO_WAY: a price variance within configured tolerance is MATCHED', async () => {
    const prisma = makePrisma({
      toleranceFindFirst: vi.fn().mockResolvedValue({ amountTolerance: '5.00', percentTolerance: '0' }),
    });
    const svc = new InvoiceMatchService(prisma as any);
    const result = await svc.match({
      tenantId: TENANT_ID, vendorId: VENDOR_ID, poId: PO_ID,
      invoiceLines: [{ id: 'il-1', poLineId: PO_LINE_ID, quantity: 10, unitPrice: 7.5 }],
    });
    expect(result.status).toBe('MATCHED');
  });

  it('flags QUANTITY_OVER_PO when invoiced quantity exceeds the PO line quantity', async () => {
    const prisma = makePrisma();
    const svc = new InvoiceMatchService(prisma as any);
    const result = await svc.match({
      tenantId: TENANT_ID, vendorId: VENDOR_ID, poId: PO_ID,
      invoiceLines: [{ id: 'il-1', poLineId: PO_LINE_ID, quantity: 15, unitPrice: 5.0 }], // PO qty is 10
    });
    expect(result.status).toBe('EXCEPTION');
    const qtyVariance = result.variances.find((v) => v.type === 'QUANTITY_OVER_PO');
    expect(qtyVariance?.withinTolerance).toBe(false);
  });

  it('THREE_WAY: is selected once a goods receipt exists for the PO, and flags QUANTITY_OVER_RECEIPT', async () => {
    const prisma = makePrisma({
      receiptLineFindMany: vi.fn().mockResolvedValue([{ poLineId: PO_LINE_ID, qtyReceived: '6' }]),
    });
    const svc = new InvoiceMatchService(prisma as any);
    const result = await svc.match({
      tenantId: TENANT_ID, vendorId: VENDOR_ID, poId: PO_ID,
      invoiceLines: [{ id: 'il-1', poLineId: PO_LINE_ID, quantity: 10, unitPrice: 5.0 }], // only 6 received
    });
    expect(result.matchType).toBe('THREE_WAY');
    expect(result.status).toBe('EXCEPTION');
    const receiptVariance = result.variances.find((v) => v.type === 'QUANTITY_OVER_RECEIPT');
    expect(receiptVariance?.withinTolerance).toBe(false);
    expect(receiptVariance?.expected).toBe(6);
  });

  it('THREE_WAY: matches when invoiced quantity is fully covered by the receipt', async () => {
    const prisma = makePrisma({
      receiptLineFindMany: vi.fn().mockResolvedValue([{ poLineId: PO_LINE_ID, qtyReceived: '10' }]),
    });
    const svc = new InvoiceMatchService(prisma as any);
    const result = await svc.match({
      tenantId: TENANT_ID, vendorId: VENDOR_ID, poId: PO_ID,
      invoiceLines: [{ id: 'il-1', poLineId: PO_LINE_ID, quantity: 10, unitPrice: 5.0 }],
    });
    expect(result.matchType).toBe('THREE_WAY');
    expect(result.status).toBe('MATCHED');
  });
});
