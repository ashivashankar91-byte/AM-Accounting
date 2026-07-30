import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { container } from 'tsyringe';
import { DrawerService } from '../src/application/cash-drawer-service';
import { ReceiptSequenceService } from '../src/application/receipt-sequence-service';
import {
  ReceiptService, ReceiptValidationError, DrawerNotOpenError, ReceiptNotFoundError,
  VoidReasonRequiredError, VoidNotEligibleError,
} from '../src/application/cash-receipt-service';
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
  return {
    drawers: container.resolve<DrawerService>('DrawerService'),
    receipts: container.resolve<ReceiptService>('ReceiptService'),
    prisma, events,
  };
}

async function openDrawer(drawers: DrawerService, overrides: Partial<Record<string, any>> = {}) {
  return drawers.open({
    tenantId: 't1', entityId: 'e1', storeId: 's1', storeCode: 'S01', terminalCode: 'TERM1',
    cashierId: 'cashier-1', businessDate: '2026-07-29', openingFloat: 100, actor: 'cashier-1', ...overrides,
  });
}

const cashReceiptDto = (drawerId: string, overrides: Partial<Record<string, any>> = {}) => ({
  tenantId: 't1', entityId: 'e1', drawerId,
  sourceDocType: 'SERVICE_RO', sourceDocId: 'RO-1001', sourceDisplayNumber: 'RO-1001', amountDue: 50,
  totalAmount: 50, tenders: [{ tenderType: 'CASH', amount: 50 }],
  idempotencyKey: 'idem-1', actor: 'cashier-1', ...overrides,
});

describe('ReceiptService.createReceipt', () => {
  it('creates a cash receipt with change and commits header + tender + movement + audit + outbox atomically', async () => {
    const { drawers, receipts, prisma } = setup();
    const drawer = await openDrawer(drawers);
    const result = await receipts.createReceipt(cashReceiptDto(drawer.id, {
      totalAmount: 45, tenders: [{ tenderType: 'CASH', amount: 45, cashTendered: 50 }],
    }));
    expect(result.idempotent).toBe(false);
    expect(result.receiptNumber).toBe('CR-S01-20260729-0001');
    expect(result.tenders).toHaveLength(1);
    expect(Number(result.tenders[0].changeGiven)).toBe(5);
    expect(prisma.cashDrawerMovement._rows.some((m: any) => m.movementType === 'CASH_RECEIPT')).toBe(true);
    expect(prisma.auditOutboxEvent._rows.some((a: any) => a.action === 'CASH_RECEIPT_ISSUED')).toBe(true);
    expect(prisma.cashOutboxEvent._rows.some((e: any) => e.eventType === 'cash.receipt.issued')).toBe(true);
  });

  it('creates a check receipt', async () => {
    const { drawers, receipts } = setup();
    const drawer = await openDrawer(drawers);
    const result = await receipts.createReceipt(cashReceiptDto(drawer.id, {
      totalAmount: 120, tenders: [{ tenderType: 'CHECK', amount: 120, checkNumber: '1001' }],
    }));
    expect(result.tenders[0].tenderType).toBe('CHECK');
    expect(result.tenders[0].checkNumber).toBe('1001');
  });

  it('supports an exact split cash/check tender', async () => {
    const { drawers, receipts } = setup();
    const drawer = await openDrawer(drawers);
    const result = await receipts.createReceipt(cashReceiptDto(drawer.id, {
      totalAmount: 100,
      tenders: [{ tenderType: 'CASH', amount: 40 }, { tenderType: 'CHECK', amount: 60, checkNumber: '2002' }],
    }));
    expect(result.tenders).toHaveLength(2);
  });

  it('rejects a one-cent tender mismatch', async () => {
    const { drawers, receipts } = setup();
    const drawer = await openDrawer(drawers);
    await expect(receipts.createReceipt(cashReceiptDto(drawer.id, {
      totalAmount: 50, tenders: [{ tenderType: 'CASH', amount: 49.99 }],
    }))).rejects.toBeInstanceOf(ReceiptValidationError);
  });

  it('rejects a negative tender amount', async () => {
    const { drawers, receipts } = setup();
    const drawer = await openDrawer(drawers);
    await expect(receipts.createReceipt(cashReceiptDto(drawer.id, {
      totalAmount: -50, tenders: [{ tenderType: 'CASH', amount: -50 }],
    }))).rejects.toBeInstanceOf(ReceiptValidationError);
  });

  it('rejects receipt creation once the drawer is no longer OPEN', async () => {
    const { drawers, receipts, prisma } = setup();
    const drawer = await openDrawer(drawers);
    const row = prisma.cashDrawer._rows.find((r: any) => r.id === drawer.id);
    row.status = 'BLIND_COUNT_SUBMITTED';
    await expect(receipts.createReceipt(cashReceiptDto(drawer.id))).rejects.toBeInstanceOf(DrawerNotOpenError);
  });

  it('locks the opening float after the first receipt is issued', async () => {
    const { drawers, receipts, prisma } = setup();
    const drawer = await openDrawer(drawers);
    expect(prisma.cashDrawer._rows.find((r: any) => r.id === drawer.id).floatLocked).toBe(false);
    await receipts.createReceipt(cashReceiptDto(drawer.id));
    expect(prisma.cashDrawer._rows.find((r: any) => r.id === drawer.id).floatLocked).toBe(true);
  });

  it('idempotent: the same idempotencyKey returns the original receipt, not a duplicate', async () => {
    const { drawers, receipts } = setup();
    const drawer = await openDrawer(drawers);
    const dto = cashReceiptDto(drawer.id);
    const first = await receipts.createReceipt(dto);
    const second = await receipts.createReceipt(dto);
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it('a concurrent duplicate idempotencyKey submission resolves to a single receipt', async () => {
    const { drawers, receipts } = setup();
    const drawer = await openDrawer(drawers);
    const dto = cashReceiptDto(drawer.id, { idempotencyKey: 'race-key' });
    const [a, b] = await Promise.all([receipts.createReceipt(dto), receipts.createReceipt(dto)]);
    expect(a.id).toBe(b.id);
  });
});

describe('ReceiptService.voidReceipt', () => {
  it('voids an eligible receipt and creates compensating movements, preserving the original row', async () => {
    const { drawers, receipts, prisma } = setup();
    const drawer = await openDrawer(drawers);
    const receipt = await receipts.createReceipt(cashReceiptDto(drawer.id));
    const voided = await receipts.voidReceipt({ tenantId: 't1', receiptId: receipt.id, reason: 'wrong RO', actor: 'cashier-1' });
    expect(voided.status).toBe('VOIDED');
    expect(voided.totalAmount).toBe(receipt.totalAmount); // original financial fields preserved
    const reversal = prisma.cashDrawerMovement._rows.find((m: any) => m.movementType === 'CASH_VOID_REVERSAL');
    expect(reversal).toBeTruthy();
    expect(Number(reversal.amount)).toBe(-50);
  });

  it('rejects a void without a reason', async () => {
    const { drawers, receipts } = setup();
    const drawer = await openDrawer(drawers);
    const receipt = await receipts.createReceipt(cashReceiptDto(drawer.id));
    await expect(receipts.voidReceipt({ tenantId: 't1', receiptId: receipt.id, reason: '', actor: 'cashier-1' })).rejects.toBeInstanceOf(VoidReasonRequiredError);
  });

  it('rejects a void once the drawer has left OPEN (blind count submitted)', async () => {
    const { drawers, receipts, prisma } = setup();
    const drawer = await openDrawer(drawers);
    const receipt = await receipts.createReceipt(cashReceiptDto(drawer.id));
    prisma.cashDrawer._rows.find((r: any) => r.id === drawer.id).status = 'BLIND_COUNT_SUBMITTED';
    await expect(receipts.voidReceipt({ tenantId: 't1', receiptId: receipt.id, reason: 'late', actor: 'cashier-1' })).rejects.toBeInstanceOf(VoidNotEligibleError);
    expect(prisma.auditOutboxEvent._rows.some((a: any) => a.action === 'CASH_RECEIPT_VOID_REJECTED')).toBe(true);
  });

  it('rejects a void after reconciliation', async () => {
    const { drawers, receipts, prisma } = setup();
    const drawer = await openDrawer(drawers);
    const receipt = await receipts.createReceipt(cashReceiptDto(drawer.id));
    prisma.cashDrawer._rows.find((r: any) => r.id === drawer.id).status = 'RECONCILED';
    await expect(receipts.voidReceipt({ tenantId: 't1', receiptId: receipt.id, reason: 'late', actor: 'cashier-1' })).rejects.toBeInstanceOf(VoidNotEligibleError);
  });

  it('idempotent: voiding an already-VOIDED receipt returns the same result without a second reversal', async () => {
    const { drawers, receipts, prisma } = setup();
    const drawer = await openDrawer(drawers);
    const receipt = await receipts.createReceipt(cashReceiptDto(drawer.id));
    await receipts.voidReceipt({ tenantId: 't1', receiptId: receipt.id, reason: 'first', actor: 'cashier-1' });
    const second = await receipts.voidReceipt({ tenantId: 't1', receiptId: receipt.id, reason: 'second attempt', actor: 'cashier-1' });
    expect(second.idempotent).toBe(true);
    expect(prisma.cashDrawerMovement._rows.filter((m: any) => m.movementType === 'CASH_VOID_REVERSAL')).toHaveLength(1);
  });

  it('throws ReceiptNotFoundError for an unknown receipt', async () => {
    const { receipts } = setup();
    await expect(receipts.voidReceipt({ tenantId: 't1', receiptId: 'nope', reason: 'x', actor: 'a' })).rejects.toBeInstanceOf(ReceiptNotFoundError);
  });
});

describe('ReceiptService.searchReceipts / getReceiptById / getPrintable', () => {
  it('searches by status and drawer', async () => {
    const { drawers, receipts } = setup();
    const drawer = await openDrawer(drawers);
    await receipts.createReceipt(cashReceiptDto(drawer.id));
    const result = await receipts.searchReceipts('t1', { drawerId: drawer.id, status: 'ISSUED' });
    expect(result.items).toHaveLength(1);
  });

  it('getPrintable writes a CASH_RECEIPT_REPRINTED audit event on every call', async () => {
    const { drawers, receipts, prisma } = setup();
    const drawer = await openDrawer(drawers);
    const receipt = await receipts.createReceipt(cashReceiptDto(drawer.id));
    await receipts.getPrintable('t1', receipt.id, 'cashier-1');
    await receipts.getPrintable('t1', receipt.id, 'cashier-1');
    expect(prisma.auditOutboxEvent._rows.filter((a: any) => a.action === 'CASH_RECEIPT_REPRINTED')).toHaveLength(2);
  });

  it('getReceiptById enforces tenant isolation', async () => {
    const { drawers, receipts } = setup();
    const drawer = await openDrawer(drawers);
    const receipt = await receipts.createReceipt(cashReceiptDto(drawer.id));
    await expect(receipts.getReceiptById('other-tenant', receipt.id)).rejects.toBeInstanceOf(ReceiptNotFoundError);
  });
});
