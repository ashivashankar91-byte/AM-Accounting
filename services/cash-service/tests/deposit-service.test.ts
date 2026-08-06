import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { container } from 'tsyringe';
import { makeFakePrisma, makeFakeEvents, uuid } from './support/fake-prisma';
import { DepositService, ReceiptNotEligibleError, DepositNotPostableError } from '../src/application/deposit-service';
import { DepositConservationError } from '../src/domain/deposit';

const TENANT = 'tenant-s053';

function seedReceipt(prisma: any, overrides: Partial<any> = {}) {
  const id = uuid();
  const receipt = {
    id, tenantId: TENANT, entityId: 'entity-1', storeId: 'store-1', drawerId: 'drawer-1',
    receiptNumber: `R-${id.slice(0, 4)}`, status: 'ISSUED', sourceDocType: 'RO', sourceDocId: 'ro-1',
    totalAmount: '100.00', currency: 'USD', cashierId: 'cashier-1', idempotencyKey: uuid(),
    issuedAt: new Date(), createdAt: new Date(), version: 1,
    ...overrides,
  };
  prisma.cashReceipt._rows.push(receipt);
  return receipt;
}

describe('DepositService (S053)', () => {
  let prisma: any;
  let deposits: DepositService;

  beforeEach(() => {
    container.reset();
    prisma = makeFakePrisma();
    container.registerInstance('PrismaClient', prisma);
    container.registerInstance('IEventPublisher', makeFakeEvents());
    container.register('DepositService', { useClass: DepositService });
    deposits = container.resolve('DepositService');
  });

  it('creates a deposit batch from undeposited receipts, summing the total', async () => {
    const r1 = seedReceipt(prisma, { totalAmount: '50.00' });
    const r2 = seedReceipt(prisma, { totalAmount: '75.25' });

    const result = await deposits.createDepositBatch({
      tenantId: TENANT, entityId: 'entity-1', storeId: 'store-1', bankAccountCode: 'OPERATING-001',
      businessDate: '2026-08-01', receiptIds: [r1.id, r2.id], idempotencyKey: 'batch-1', actor: 'controller-1',
    });

    expect(result.idempotent).toBe(false);
    expect(result.status).toBe('OPEN');
    expect(Number(result.totalAmount)).toBeCloseTo(125.25);
    expect(result.lines).toHaveLength(2);
  });

  it('is idempotent on idempotencyKey — repeat create returns the same deposit, no duplicate', async () => {
    const r1 = seedReceipt(prisma);
    const dto = {
      tenantId: TENANT, entityId: 'entity-1', storeId: 'store-1', bankAccountCode: 'OPERATING-001',
      businessDate: '2026-08-01', receiptIds: [r1.id], idempotencyKey: 'batch-2', actor: 'controller-1',
    };
    const first = await deposits.createDepositBatch(dto);
    const second = await deposits.createDepositBatch(dto);
    expect(second.idempotent).toBe(true);
    expect(second.id).toBe(first.id);
    expect(prisma.cashDeposit._rows.length).toBe(1);
  });

  it('BR: a receipt cannot be deposited twice — second batch attempt is rejected', async () => {
    const r1 = seedReceipt(prisma);
    await deposits.createDepositBatch({
      tenantId: TENANT, entityId: 'entity-1', storeId: 'store-1', bankAccountCode: 'OPERATING-001',
      businessDate: '2026-08-01', receiptIds: [r1.id], idempotencyKey: 'batch-a', actor: 'controller-1',
    });

    await expect(
      deposits.createDepositBatch({
        tenantId: TENANT, entityId: 'entity-1', storeId: 'store-1', bankAccountCode: 'OPERATING-001',
        businessDate: '2026-08-01', receiptIds: [r1.id], idempotencyKey: 'batch-b', actor: 'controller-1',
      }),
    ).rejects.toBeInstanceOf(ReceiptNotEligibleError);
  });

  it('rejects a VOIDED receipt from being deposited', async () => {
    const r1 = seedReceipt(prisma, { status: 'VOIDED' });
    await expect(
      deposits.createDepositBatch({
        tenantId: TENANT, entityId: 'entity-1', storeId: 'store-1', bankAccountCode: 'OPERATING-001',
        businessDate: '2026-08-01', receiptIds: [r1.id], idempotencyKey: 'batch-c', actor: 'controller-1',
      }),
    ).rejects.toBeInstanceOf(ReceiptNotEligibleError);
  });

  it('posts a deposit exactly once — idempotent on repeat post, no second event', async () => {
    const r1 = seedReceipt(prisma, { totalAmount: '40.00' });
    const created = await deposits.createDepositBatch({
      tenantId: TENANT, entityId: 'entity-1', storeId: 'store-1', bankAccountCode: 'OPERATING-001',
      businessDate: '2026-08-01', receiptIds: [r1.id], idempotencyKey: 'batch-d', actor: 'controller-1',
    });

    const posted = await deposits.postDeposit(TENANT, created.id, 'controller-1');
    expect(posted.status).toBe('POSTED');
    expect(prisma.cashOutboxEvent._rows.filter((e: any) => e.eventType === 'cash.deposit.posted')).toHaveLength(1);

    const postedAgain = await deposits.postDeposit(TENANT, created.id, 'controller-1');
    expect(postedAgain.idempotent).toBe(true);
    expect(prisma.cashOutboxEvent._rows.filter((e: any) => e.eventType === 'cash.deposit.posted')).toHaveLength(1);
  });

  it('emits a canonical matrix-row envelope with blank/pending accounting facts only (no GL account decided here)', async () => {
    const r1 = seedReceipt(prisma, { totalAmount: '40.00' });
    const created = await deposits.createDepositBatch({
      tenantId: TENANT, entityId: 'entity-1', storeId: 'store-1', bankAccountCode: 'OPERATING-001',
      businessDate: '2026-08-01', receiptIds: [r1.id], idempotencyKey: 'batch-e', actor: 'controller-1',
    });
    await deposits.postDeposit(TENANT, created.id, 'controller-1');
    const evt = prisma.cashOutboxEvent._rows.find((e: any) => e.eventType === 'cash.deposit.posted');
    expect(evt.payload.tenantId).toBe(TENANT);
    expect(evt.payload.accountingAmounts[0].amount).toBe('40');
    expect(evt.payload.eventType).toBe('cash.deposit.posted');
    expect(evt.payload.idempotencyIdentity).toContain('cash.deposit.posted');
  });

  it('refuses to post a VOID deposit', async () => {
    const r1 = seedReceipt(prisma);
    const created = await deposits.createDepositBatch({
      tenantId: TENANT, entityId: 'entity-1', storeId: 'store-1', bankAccountCode: 'OPERATING-001',
      businessDate: '2026-08-01', receiptIds: [r1.id], idempotencyKey: 'batch-f', actor: 'controller-1',
    });
    await deposits.voidDeposit(TENANT, created.id, 'wrong batch', 'controller-1');
    await expect(deposits.postDeposit(TENANT, created.id, 'controller-1')).rejects.toBeInstanceOf(DepositNotPostableError);
  });

  it('conservation: rejects posting when the line sum does not equal the stated total', async () => {
    const r1 = seedReceipt(prisma, { totalAmount: '40.00' });
    const created = await deposits.createDepositBatch({
      tenantId: TENANT, entityId: 'entity-1', storeId: 'store-1', bankAccountCode: 'OPERATING-001',
      businessDate: '2026-08-01', receiptIds: [r1.id], idempotencyKey: 'batch-g', actor: 'controller-1',
    });
    // Simulate drift: mutate the stored total directly (bypassing normal flow).
    const row = prisma.cashDeposit._rows.find((d: any) => d.id === created.id);
    row.totalAmount = '999.99';

    await expect(deposits.postDeposit(TENANT, created.id, 'controller-1')).rejects.toBeInstanceOf(DepositConservationError);
  });
});
