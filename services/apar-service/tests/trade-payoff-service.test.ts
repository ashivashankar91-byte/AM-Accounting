/**
 * CE-09 S044 (Trade-Payoff Fast Lane) — TradePayoffService domain tests.
 * Mocked-Prisma unit tests, same style as payment-run-service.test.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import {
  TradePayoffService,
  TradePayoffValidationError,
  PayoffReconfirmationRequiredError,
  DuplicatePayoffPaymentError,
  BankAccountNotFoundError,
  TradePayoffNotFoundError,
} from '../src/application/trade-payoff-service';

const TENANT_ID = 'tenant-trade-payoff';
const BANK_ACCOUNT_ID = 'bank-1';
const PAYMENT_ID = 'payoff-1';
const DEAL_REF = 'deal-stock-1234';

const BASE_BANK_ACCOUNT = { id: BANK_ACCOUNT_ID, tenantId: TENANT_ID, nextCheckNumber: 2001, glAccountId: 'gl-bank-1' };
const BASE_PAYMENT = { id: PAYMENT_ID, tenantId: TENANT_ID, dealReference: DEAL_REF, payeeName: 'ACME Lienholder', payeeRemitAddress: '1 Main St', amount: '15000.00', status: 'POSTED' };

const FUTURE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const PAST_DATE = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function baseDto(overrides: any = {}) {
  return {
    dealReference: DEAL_REF, payeeName: 'ACME Lienholder', payeeRemitAddress: '1 Main St',
    amount: 15000, goodThroughDate: FUTURE_DATE, bankAccountId: BANK_ACCOUNT_ID,
    ...overrides,
  };
}

function makePrisma(overrides: any = {}) {
  const client: any = {
    apTradePayoffPayment: {
      findFirst: overrides.paymentFindFirst ?? vi.fn()
        .mockResolvedValueOnce(null) // pre-check (outside tx)
        .mockResolvedValueOnce(null) // race re-check (inside tx)
        .mockResolvedValue(BASE_PAYMENT), // final getById() call after create
      findMany: overrides.paymentFindMany ?? vi.fn().mockResolvedValue([BASE_PAYMENT]),
      create: overrides.paymentCreate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: PAYMENT_ID, ...data })),
      update: overrides.paymentUpdate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_PAYMENT, ...data })),
    },
    apTradePayoffGlAccountConfig: {
      findFirst: overrides.glConfigFindFirst ?? vi.fn().mockResolvedValue(null),
    },
    aPBankAccount: {
      findFirst: overrides.bankFindFirst ?? vi.fn().mockResolvedValue(BASE_BANK_ACCOUNT),
      update: overrides.bankUpdate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_BANK_ACCOUNT, ...data, nextCheckNumber: BASE_BANK_ACCOUNT.nextCheckNumber + 1 })),
    },
    auditOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  client.$transaction = async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg));
  return client;
}

describe('TradePayoffService.create', () => {
  it('creates a POSTED payoff payment with a gap-accounted check number', async () => {
    const prisma = makePrisma();
    const svc = new TradePayoffService(prisma, {} as any);
    const payment = await svc.create(TENANT_ID, baseDto(), 'clerk-1');
    expect(prisma.apTradePayoffPayment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ dealReference: DEAL_REF, status: 'POSTED', checkNumber: 2001 }),
    }));
  });

  it('rejects a missing dealReference', async () => {
    const prisma = makePrisma();
    const svc = new TradePayoffService(prisma, {} as any);
    await expect(svc.create(TENANT_ID, baseDto({ dealReference: '' }), 'clerk-1')).rejects.toBeInstanceOf(TradePayoffValidationError);
  });

  it('rejects a missing payeeName', async () => {
    const prisma = makePrisma();
    const svc = new TradePayoffService(prisma, {} as any);
    await expect(svc.create(TENANT_ID, baseDto({ payeeName: '' }), 'clerk-1')).rejects.toBeInstanceOf(TradePayoffValidationError);
  });

  it('rejects a non-positive amount', async () => {
    const prisma = makePrisma();
    const svc = new TradePayoffService(prisma, {} as any);
    await expect(svc.create(TENANT_ID, baseDto({ amount: 0 }), 'clerk-1')).rejects.toBeInstanceOf(TradePayoffValidationError);
  });

  it('throws BankAccountNotFoundError for an unknown bank account', async () => {
    const prisma = makePrisma({ bankFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new TradePayoffService(prisma, {} as any);
    await expect(svc.create(TENANT_ID, baseDto({ bankAccountId: 'missing' }), 'clerk-1')).rejects.toBeInstanceOf(BankAccountNotFoundError);
  });

  it('refuses a second POSTED payoff for the same deal reference (duplicate-payment guard)', async () => {
    const prisma = makePrisma({ paymentFindFirst: vi.fn().mockResolvedValue(BASE_PAYMENT) });
    const svc = new TradePayoffService(prisma, {} as any);
    await expect(svc.create(TENANT_ID, baseDto(), 'clerk-1')).rejects.toBeInstanceOf(DuplicatePayoffPaymentError);
  });

  it('requires a reconfirmed amount and acknowledgment when the good-through date has passed', async () => {
    const prisma = makePrisma();
    const svc = new TradePayoffService(prisma, {} as any);
    await expect(svc.create(TENANT_ID, baseDto({ goodThroughDate: PAST_DATE }), 'clerk-1')).rejects.toBeInstanceOf(PayoffReconfirmationRequiredError);
  });

  it('rejects a past good-through date with a reconfirmed amount but no acknowledgment', async () => {
    const prisma = makePrisma();
    const svc = new TradePayoffService(prisma, {} as any);
    await expect(svc.create(TENANT_ID, baseDto({ goodThroughDate: PAST_DATE, reconfirmedAmount: 14500 }), 'clerk-1')).rejects.toBeInstanceOf(PayoffReconfirmationRequiredError);
  });

  it('allows a past good-through date when reconfirmed and acknowledged, storing the reconfirmation', async () => {
    const prisma = makePrisma();
    const svc = new TradePayoffService(prisma, {} as any);
    await svc.create(TENANT_ID, baseDto({ goodThroughDate: PAST_DATE, reconfirmedAmount: 14500, acknowledgePastGoodThrough: true }), 'clerk-1');
    expect(prisma.apTradePayoffPayment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reconfirmedAmount: 14500, reconfirmedBy: 'clerk-1' }),
    }));
  });

  it('references the deal/stock id on the created payment (PUTR reference-only field)', async () => {
    const prisma = makePrisma();
    const svc = new TradePayoffService(prisma, {} as any);
    const payment = await svc.create(TENANT_ID, baseDto(), 'clerk-1');
    expect(payment.dealReference).toBe(DEAL_REF);
  });

  it('records a truthful GL posting failure when no GL config exists (ACCOUNT_MAPPING_VALUES_PENDING)', async () => {
    const prisma = makePrisma();
    const svc = new TradePayoffService(prisma, {} as any);
    await svc.create(TENANT_ID, baseDto(), 'clerk-1');
    expect(prisma.apTradePayoffPayment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ glPostingError: expect.stringContaining('ACCOUNT_MAPPING_VALUES_PENDING') }),
    }));
  });
});

describe('TradePayoffService.getById / list', () => {
  it('throws TradePayoffNotFoundError when the payment is missing', async () => {
    const prisma = makePrisma({ paymentFindFirst: vi.fn().mockResolvedValue(null) });
    const svc = new TradePayoffService(prisma, {} as any);
    await expect(svc.getById(TENANT_ID, 'missing')).rejects.toBeInstanceOf(TradePayoffNotFoundError);
  });

  it('lists trade-payoff payments for a tenant', async () => {
    const prisma = makePrisma();
    const svc = new TradePayoffService(prisma, {} as any);
    const rows = await svc.list(TENANT_ID);
    expect(rows).toHaveLength(1);
  });
});
