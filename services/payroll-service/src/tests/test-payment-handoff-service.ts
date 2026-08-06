/**
 * @file test-payment-handoff-service.ts
 * @coverage fix(integration) Gap 2 — CE-09 payroll payment handoff. Proves:
 * truthful NOT_CONFIGURED default, PAYMENT_EXPORT_READY only when the
 * tenant has a real configured payment-handoff mode, idempotent handoff
 * creation, settlement requires independent cash-service verification
 * (fails closed — never fabricated), void/cancellation behavior, and a
 * SETTLED handoff cannot be silently voided.
 */
import { describe, it, expect, vi } from 'vitest';
import { PaymentHandoffService, PaymentHandoffStateError, SettlementVerificationFailedError } from '../application/payment-handoff-service';

function makeSvc(overrides: { prisma?: any; verifier?: any } = {}) {
  const prisma = overrides.prisma ?? {
    payrollPaymentHandoff: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'handoff-1', ...data })),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'handoff-1', ...data })),
    },
    payrollTenantConfig: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
  const verifier = overrides.verifier ?? { verifySettlementBatch: vi.fn().mockResolvedValue(true) };
  return { svc: new PaymentHandoffService(prisma as any, verifier), prisma, verifier };
}

const BASE_INPUT = {
  tenantId: 'tenant-test' as any,
  legalEntityId: 'entity-test',
  payrollBatchId: 'batch-1',
  journalEntryId: 'je-1',
  clearingGlAccountCode: '21000',
  totalAmount: 1000,
  actor: 'poster-1',
};

describe('PaymentHandoffService — truthful default state', () => {
  it('creates NOT_CONFIGURED when the tenant has no payment-handoff mode configured (never fabricates readiness)', async () => {
    const { svc, prisma } = makeSvc();
    const handoff = await svc.createHandoff(BASE_INPUT);
    expect(handoff.status).toBe('NOT_CONFIGURED');
    expect(prisma.payrollPaymentHandoff.create).toHaveBeenCalled();
  });

  it('creates PAYMENT_EXPORT_READY when the tenant has configured MANUAL_EXPORT', async () => {
    const { svc } = makeSvc({
      prisma: {
        payrollPaymentHandoff: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'handoff-1', ...data })) },
        payrollTenantConfig: { findFirst: vi.fn().mockResolvedValue({ paymentHandoffMode: 'MANUAL_EXPORT' }) },
      },
    });
    const handoff = await svc.createHandoff(BASE_INPUT);
    expect(handoff.status).toBe('PAYMENT_EXPORT_READY');
  });

  it('is idempotent — a retry for the same payrollBatchId returns the existing handoff, never a duplicate', async () => {
    const existing = { id: 'handoff-existing', status: 'PAYMENT_EXPORT_READY' };
    const create = vi.fn();
    const { svc } = makeSvc({ prisma: { payrollPaymentHandoff: { findFirst: vi.fn().mockResolvedValue(existing), create }, payrollTenantConfig: { findFirst: vi.fn() } } });
    const result = await svc.createHandoff(BASE_INPUT);
    expect(result).toBe(existing);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('PaymentHandoffService — settlement requires real verification', () => {
  it('SETTLED is reachable only when cash-service verification succeeds', async () => {
    const { svc, prisma, verifier } = makeSvc({
      prisma: {
        payrollPaymentHandoff: {
          findFirst: vi.fn().mockResolvedValue({ id: 'handoff-1', status: 'PAYMENT_EXPORT_READY', tenantId: 'tenant-test' }),
          update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'handoff-1', ...data })),
        },
      },
    });
    const result = await svc.recordSettlement('tenant-test' as any, 'handoff-1', 'settlement-batch-1', 'user-1');
    expect(result.status).toBe('SETTLED');
    expect(verifier.verifySettlementBatch).toHaveBeenCalledWith('tenant-test', 'settlement-batch-1');
  });

  it('fails closed (never fabricates settlement) when the settlement reference cannot be verified', async () => {
    const update = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'handoff-1', ...data }));
    const { svc } = makeSvc({
      prisma: {
        payrollPaymentHandoff: {
          findFirst: vi.fn().mockResolvedValue({ id: 'handoff-1', status: 'PAYMENT_EXPORT_READY', tenantId: 'tenant-test' }),
          update,
        },
      },
      verifier: { verifySettlementBatch: vi.fn().mockResolvedValue(false) },
    });
    await expect(svc.recordSettlement('tenant-test' as any, 'handoff-1', 'bogus-ref', 'user-1')).rejects.toThrow(SettlementVerificationFailedError);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));
  });

  it('refuses to settle a handoff that is already VOIDED', async () => {
    const { svc } = makeSvc({
      prisma: { payrollPaymentHandoff: { findFirst: vi.fn().mockResolvedValue({ id: 'handoff-1', status: 'VOIDED', tenantId: 'tenant-test' }) } },
    });
    await expect(svc.recordSettlement('tenant-test' as any, 'handoff-1', 'ref-1', 'user-1')).rejects.toThrow(PaymentHandoffStateError);
  });
});

describe('PaymentHandoffService — void/cancellation', () => {
  it('voids the handoff for a batch (cancellation behavior)', async () => {
    const update = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'handoff-1', ...data }));
    const { svc } = makeSvc({
      prisma: { payrollPaymentHandoff: { findFirst: vi.fn().mockResolvedValue({ id: 'handoff-1', status: 'PAYMENT_EXPORT_READY' }), update } },
    });
    const result = await svc.voidForBatch('tenant-test' as any, 'batch-1', 'batch voided', 'user-1');
    expect(result.status).toBe('VOIDED');
  });

  it('is idempotent — voiding an already-VOIDED handoff is a safe no-op', async () => {
    const update = vi.fn();
    const { svc } = makeSvc({
      prisma: { payrollPaymentHandoff: { findFirst: vi.fn().mockResolvedValue({ id: 'handoff-1', status: 'VOIDED' }), update } },
    });
    const result = await svc.voidForBatch('tenant-test' as any, 'batch-1', 'batch voided', 'user-1');
    expect(result.status).toBe('VOIDED');
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses to void a SETTLED handoff', async () => {
    const { svc } = makeSvc({
      prisma: { payrollPaymentHandoff: { findFirst: vi.fn().mockResolvedValue({ id: 'handoff-1', status: 'SETTLED' }) } },
    });
    await expect(svc.voidForBatch('tenant-test' as any, 'batch-1', 'batch voided', 'user-1')).rejects.toThrow(PaymentHandoffStateError);
  });

  it('is a no-op when no handoff exists for the batch (e.g. NOT_CONFIGURED path never created a payable record)', async () => {
    const { svc } = makeSvc({ prisma: { payrollPaymentHandoff: { findFirst: vi.fn().mockResolvedValue(null) } } });
    const result = await svc.voidForBatch('tenant-test' as any, 'batch-1', 'batch voided', 'user-1');
    expect(result).toBeNull();
  });
});
