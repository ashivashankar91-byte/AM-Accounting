import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { container } from 'tsyringe';
import { DrawerService } from '../src/application/cash-drawer-service';
import { ReceiptSequenceService } from '../src/application/receipt-sequence-service';
import { ReceiptService } from '../src/application/cash-receipt-service';
import { ToleranceService } from '../src/application/tolerance-service';
import { BlindCloseService } from '../src/application/blind-close-service';
import {
  ReconciliationService, ApprovalNotEligibleError, ApprovalReasonRequiredError, ReconcileNotEligibleError, VarianceNotFoundError,
} from '../src/application/reconciliation-service';
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
  container.register('ReconciliationService', { useClass: ReconciliationService });
  return {
    drawers: container.resolve<DrawerService>('DrawerService'),
    blindClose: container.resolve<BlindCloseService>('BlindCloseService'),
    recon: container.resolve<ReconciliationService>('ReconciliationService'),
    prisma,
  };
}

async function openDrawer(drawers: DrawerService) {
  return drawers.open({
    tenantId: 't1', entityId: 'e1', storeId: 's1', storeCode: 'S01', terminalCode: 'TERM1',
    cashierId: 'cashier-1', businessDate: '2026-07-29', openingFloat: 100, actor: 'cashier-1',
  });
}

describe('ReconciliationService.getReconciliation', () => {
  it('exposes expected vs counted totals to the supervisor once blind count exists', async () => {
    const { drawers, blindClose, recon } = setup();
    const drawer = await openDrawer(drawers);
    await blindClose.submit({ tenantId: 't1', drawerId: drawer.id, countedCash: 100, checkCount: 0, checkTotal: 0, retainedFloat: 0, actor: 'cashier-1' });
    const view = await recon.getReconciliation('t1', drawer.id);
    expect(Number(view.variance.expectedCash)).toBe(100);
    expect(Number(view.variance.countedCash)).toBe(100);
  });

  it('throws before a blind count has been submitted', async () => {
    const { drawers, recon } = setup();
    const drawer = await openDrawer(drawers);
    await expect(recon.getReconciliation('t1', drawer.id)).rejects.toBeInstanceOf(VarianceNotFoundError);
  });
});

describe('ReconciliationService.approveVariance + reconcile', () => {
  it('an OUTSIDE_TOLERANCE variance requires approval before it can reconcile', async () => {
    const { drawers, blindClose, recon } = setup();
    const drawer = await openDrawer(drawers);
    await blindClose.submit({ tenantId: 't1', drawerId: drawer.id, countedCash: 50, checkCount: 0, checkTotal: 0, retainedFloat: 0, actor: 'cashier-1' });
    await expect(recon.reconcile({ tenantId: 't1', drawerId: drawer.id, actor: 'supervisor-1' })).rejects.toBeInstanceOf(ReconcileNotEligibleError);
  });

  it('approving the variance returns the drawer to BLIND_COUNT_SUBMITTED, then reconcile succeeds', async () => {
    const { drawers, blindClose, recon, prisma } = setup();
    const drawer = await openDrawer(drawers);
    await blindClose.submit({ tenantId: 't1', drawerId: drawer.id, countedCash: 50, checkCount: 0, checkTotal: 0, retainedFloat: 0, actor: 'cashier-1' });
    await recon.approveVariance({ tenantId: 't1', drawerId: drawer.id, reason: 'confirmed with cashier', actor: 'supervisor-1' });
    expect(prisma.cashDrawer._rows.find((r: any) => r.id === drawer.id).status).toBe('BLIND_COUNT_SUBMITTED');
    const result = await recon.reconcile({ tenantId: 't1', drawerId: drawer.id, actor: 'supervisor-1' });
    expect(result.status).toBe('RECONCILED');
  });

  it('rejects approval without a reason', async () => {
    const { drawers, blindClose, recon } = setup();
    const drawer = await openDrawer(drawers);
    await blindClose.submit({ tenantId: 't1', drawerId: drawer.id, countedCash: 50, checkCount: 0, checkTotal: 0, retainedFloat: 0, actor: 'cashier-1' });
    await expect(recon.approveVariance({ tenantId: 't1', drawerId: drawer.id, reason: '', actor: 'supervisor-1' })).rejects.toBeInstanceOf(ApprovalReasonRequiredError);
  });

  it('rejects approval when the drawer does not require it', async () => {
    const { drawers, blindClose, recon } = setup();
    const drawer = await openDrawer(drawers);
    await blindClose.submit({ tenantId: 't1', drawerId: drawer.id, countedCash: 100, checkCount: 0, checkTotal: 0, retainedFloat: 0, actor: 'cashier-1' });
    await expect(recon.approveVariance({ tenantId: 't1', drawerId: drawer.id, reason: 'n/a', actor: 'supervisor-1' })).rejects.toBeInstanceOf(ApprovalNotEligibleError);
  });

  it('approval is idempotent', async () => {
    const { drawers, blindClose, recon } = setup();
    const drawer = await openDrawer(drawers);
    await blindClose.submit({ tenantId: 't1', drawerId: drawer.id, countedCash: 50, checkCount: 0, checkTotal: 0, retainedFloat: 0, actor: 'cashier-1' });
    const first = await recon.approveVariance({ tenantId: 't1', drawerId: drawer.id, reason: 'first', actor: 'supervisor-1' });
    const second = await recon.approveVariance({ tenantId: 't1', drawerId: drawer.id, reason: 'second', actor: 'supervisor-1' });
    expect(second.idempotent).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it('reconciliation is idempotent and a reconciled drawer cannot be reopened by a second reconcile call', async () => {
    const { drawers, blindClose, recon } = setup();
    const drawer = await openDrawer(drawers);
    await blindClose.submit({ tenantId: 't1', drawerId: drawer.id, countedCash: 100, checkCount: 0, checkTotal: 0, retainedFloat: 0, actor: 'cashier-1' });
    const first = await recon.reconcile({ tenantId: 't1', drawerId: drawer.id, actor: 'supervisor-1' });
    const second = await recon.reconcile({ tenantId: 't1', drawerId: drawer.id, actor: 'supervisor-1' });
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.status).toBe('RECONCILED');
  });

  it('reconcile before blind close is rejected', async () => {
    const { drawers, recon } = setup();
    const drawer = await openDrawer(drawers);
    await expect(recon.reconcile({ tenantId: 't1', drawerId: drawer.id, actor: 'supervisor-1' })).rejects.toBeInstanceOf(ReconcileNotEligibleError);
  });
});
