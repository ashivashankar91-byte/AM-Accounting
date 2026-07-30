import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { container } from 'tsyringe';
import { DrawerService } from '../src/application/cash-drawer-service';
import { ReceiptSequenceService } from '../src/application/receipt-sequence-service';
import { ReceiptService } from '../src/application/cash-receipt-service';
import { ToleranceService } from '../src/application/tolerance-service';
import { BlindCloseService, DrawerNotOpenError } from '../src/application/blind-close-service';
import { makeFakePrisma, makeFakeEvents } from './support/fake-prisma';

function setup() {
  container.reset();
  const prisma = makeFakePrisma();
  const events = makeFakeEvents();
  container.registerInstance('PrismaClient', prisma as any);
  container.registerInstance('IEventPublisher', events as any);
  container.register('DrawerService', { useClass: DrawerService });
  container.register('ReceiptSequenceService', { useClass: ReceiptSequenceService });
  container.register('ReceiptService', { useClass: ReceiptService });
  container.register('ToleranceService', { useClass: ToleranceService });
  container.register('BlindCloseService', { useClass: BlindCloseService });
  return {
    drawers: container.resolve<DrawerService>('DrawerService'),
    receipts: container.resolve<ReceiptService>('ReceiptService'),
    blindClose: container.resolve<BlindCloseService>('BlindCloseService'),
    prisma,
  };
}

async function openDrawer(drawers: DrawerService) {
  return drawers.open({
    tenantId: 't1', entityId: 'e1', storeId: 's1', storeCode: 'S01', terminalCode: 'TERM1',
    cashierId: 'cashier-1', businessDate: '2026-07-29', openingFloat: 100, actor: 'cashier-1',
  });
}

describe('BlindCloseService.submit', () => {
  it('an EXACT count moves the drawer straight to BLIND_COUNT_SUBMITTED (reconcile-eligible) and never exposes expected totals', async () => {
    const { drawers, receipts, blindClose } = setup();
    const drawer = await drawers.open({
      tenantId: 't1', entityId: 'e1', storeId: 's1', storeCode: 'S01', terminalCode: 'TERM1',
      cashierId: 'cashier-1', businessDate: '2026-07-29', openingFloat: 100, actor: 'cashier-1',
    });
    await receipts.createReceipt({
      tenantId: 't1', entityId: 'e1', drawerId: drawer.id, sourceDocType: 'SERVICE_RO', sourceDocId: 'RO-1',
      totalAmount: 50, tenders: [{ tenderType: 'CASH', amount: 50 }], idempotencyKey: 'k1', actor: 'cashier-1',
    });
    const result = await blindClose.submit({
      tenantId: 't1', drawerId: drawer.id, countedCash: 150, checkCount: 0, checkTotal: 0, retainedFloat: 0, actor: 'cashier-1',
    });
    expect(result.status).toBe('BLIND_COUNT_SUBMITTED');
    expect(Object.keys(result)).toEqual(['drawerId', 'status', 'submittedAt', 'idempotent']);
    expect((result as any).expectedCash).toBeUndefined();
    expect((result as any).cashVariance).toBeUndefined();
  });

  it('an out-of-tolerance shortage routes the drawer to VARIANCE_REVIEW_REQUIRED', async () => {
    const { drawers, blindClose } = setup();
    const drawer = await openDrawer(drawers);
    const result = await blindClose.submit({
      tenantId: 't1', drawerId: drawer.id, countedCash: 50, checkCount: 0, checkTotal: 0, retainedFloat: 0, actor: 'cashier-1',
    });
    expect(result.status).toBe('VARIANCE_REVIEW_REQUIRED');
  });

  it('an exact overage/shortage of zero classifies EXACT', async () => {
    const { drawers, blindClose, prisma } = setup();
    const drawer = await openDrawer(drawers);
    await blindClose.submit({ tenantId: 't1', drawerId: drawer.id, countedCash: 100, checkCount: 0, checkTotal: 0, retainedFloat: 0, actor: 'cashier-1' });
    const variance = prisma.cashDrawerVariance._rows.find((v: any) => v.drawerId === drawer.id);
    expect(variance.classification).toBe('EXACT');
  });

  it('applies a configured tolerance so a small variance stays WITHIN_TOLERANCE', async () => {
    const { drawers, blindClose, prisma } = setup();
    const drawer = await openDrawer(drawers);
    await prisma.cashVarianceToleranceConfig.create({
      data: { id: 'tol-1', tenantId: 't1', scope: 'STORE', scopeId: 's1', toleranceAmount: 5, updatedBy: 'admin' },
    });
    const result = await blindClose.submit({ tenantId: 't1', drawerId: drawer.id, countedCash: 103, checkCount: 0, checkTotal: 0, retainedFloat: 0, actor: 'cashier-1' });
    expect(result.status).toBe('BLIND_COUNT_SUBMITTED');
    const variance = prisma.cashDrawerVariance._rows.find((v: any) => v.drawerId === drawer.id);
    expect(variance.classification).toBe('WITHIN_TOLERANCE');
  });

  it('computes deposit-eligible cash as counted cash minus retained float', async () => {
    const { drawers, blindClose, prisma } = setup();
    const drawer = await openDrawer(drawers);
    await blindClose.submit({ tenantId: 't1', drawerId: drawer.id, countedCash: 100, checkCount: 0, checkTotal: 0, retainedFloat: 40, actor: 'cashier-1' });
    const variance = prisma.cashDrawerVariance._rows.find((v: any) => v.drawerId === drawer.id);
    expect(Number(variance.depositEligibleCash)).toBe(60);
  });

  it('rejects blind-close submission once already blind-closed by returning the idempotent confirmation instead', async () => {
    const { drawers, blindClose } = setup();
    const drawer = await openDrawer(drawers);
    await blindClose.submit({ tenantId: 't1', drawerId: drawer.id, countedCash: 100, checkCount: 0, checkTotal: 0, retainedFloat: 0, actor: 'cashier-1' });
    const second = await blindClose.submit({ tenantId: 't1', drawerId: drawer.id, countedCash: 999, checkCount: 0, checkTotal: 0, retainedFloat: 0, actor: 'cashier-1' });
    expect(second.idempotent).toBe(true);
  });

  it('prevents blind-close submission before the drawer has ever been opened', async () => {
    const { blindClose } = setup();
    await expect(blindClose.submit({ tenantId: 't1', drawerId: 'nope', countedCash: 0, checkCount: 0, checkTotal: 0, retainedFloat: 0, actor: 'x' }))
      .rejects.toThrow();
  });

  it('rejects submission against a drawer that is not OPEN and has no existing blind count', async () => {
    const { drawers, blindClose, prisma } = setup();
    const drawer = await openDrawer(drawers);
    prisma.cashDrawer._rows.find((r: any) => r.id === drawer.id).status = 'RECONCILED';
    await expect(blindClose.submit({ tenantId: 't1', drawerId: drawer.id, countedCash: 100, checkCount: 0, checkTotal: 0, retainedFloat: 0, actor: 'cashier-1' }))
      .rejects.toBeInstanceOf(DrawerNotOpenError);
  });

  it('a check-count/total discrepancy with exact cash classifies NON_CASH_EXCEPTION, not a cash variance', async () => {
    const { drawers, receipts, blindClose, prisma } = setup();
    const drawer = await openDrawer(drawers);
    await receipts.createReceipt({
      tenantId: 't1', entityId: 'e1', drawerId: drawer.id, sourceDocType: 'PARTS_INVOICE', sourceDocId: 'PI-1',
      totalAmount: 120, tenders: [{ tenderType: 'CHECK', amount: 120, checkNumber: '1001' }], idempotencyKey: 'k2', actor: 'cashier-1',
    });
    const result = await blindClose.submit({
      tenantId: 't1', drawerId: drawer.id, countedCash: 100, checkCount: 0, checkTotal: 0, retainedFloat: 0, actor: 'cashier-1',
    });
    expect(result.status).toBe('VARIANCE_REVIEW_REQUIRED');
    const variance = prisma.cashDrawerVariance._rows.find((v: any) => v.drawerId === drawer.id);
    expect(variance.classification).toBe('NON_CASH_EXCEPTION');
    expect(variance.checkDiscrepancy).toBe(true);
    expect(Number(variance.cashVariance)).toBe(0);
  });
});
