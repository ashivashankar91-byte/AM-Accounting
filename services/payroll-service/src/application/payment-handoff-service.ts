// fix(integration) Gap 2 — CE-09 payroll payment handoff.
//
// Narrow, real handoff from an already-POSTED payroll batch's governed GL
// liability to CE-09's real payment/bank boundary. This is NOT a second
// payment or banking engine: it never constructs a payment rail file,
// never calls a bank API, and never claims ACH transmission or settlement
// on its own authority. SETTLED is reachable only by attaching a real
// cash-service settlement-batch reference that this service verifies
// exists via a live lookup (cash-service's real GET /settlements/batches/:id
// contract) — an unverifiable or missing reference fails closed.
import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/payroll-client';
import { TenantId } from '@amacc/shared-kernel';
import crypto from 'crypto';

export class PaymentHandoffNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'PAYMENT_HANDOFF_NOT_FOUND';
  constructor(message: string) { super(message); this.name = 'PaymentHandoffNotFoundError'; }
}

export class PaymentHandoffStateError extends Error {
  readonly status = 422;
  readonly code = 'PAYMENT_HANDOFF_INVALID_STATE';
  constructor(message: string) { super(message); this.name = 'PaymentHandoffStateError'; }
}

export class SettlementVerificationFailedError extends Error {
  readonly status = 422;
  readonly code = 'SETTLEMENT_VERIFICATION_FAILED';
  constructor(message: string) { super(message); this.name = 'SettlementVerificationFailedError'; }
}

export interface CreateHandoffInput {
  tenantId: TenantId;
  legalEntityId: string | null;
  payrollBatchId: string;
  journalEntryId: string;
  clearingGlAccountCode: string;
  totalAmount: number;
  actor: string;
}

/** Real, narrow verification call to cash-service's own settlement-batch lookup — never a fabricated/assumed match. Fails closed (returns false) on any non-2xx, including 404 and transport errors. */
export interface ICashSettlementVerifier {
  verifySettlementBatch(tenantId: string, settlementReference: string): Promise<boolean>;
}

export class HttpCashSettlementVerifier implements ICashSettlementVerifier {
  constructor(private readonly baseUrl: string = process.env['CASH_SERVICE_URL'] ?? 'http://cash-service:3060') {}

  async verifySettlementBatch(tenantId: string, settlementReference: string): Promise<boolean> {
    try {
      const { createServiceToken } = await import('@amacc/shared-kernel');
      const jwtSecret = process.env['AMACC_JWT_SECRET'];
      if (!jwtSecret) return false;
      const serviceToken = createServiceToken('payroll-service', jwtSecret);
      const res = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/api/v1/cash/settlements/batches/${encodeURIComponent(settlementReference)}`, {
        headers: { 'x-tenant-id': tenantId, Authorization: 'Bearer ' + serviceToken },
      });
      return res.ok;
    } catch {
      // Fail closed — never treat an unreachable cash-service as a verified settlement.
      return false;
    }
  }
}

@injectable()
export class PaymentHandoffService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('ICashSettlementVerifier') private readonly settlementVerifier: ICashSettlementVerifier,
  ) {}

  private async resolveMode(tenantId: TenantId, legalEntityId: string | null): Promise<string> {
    const scoped = legalEntityId
      ? await (this.prisma as any).payrollTenantConfig.findFirst({ where: { tenantId, legalEntityId } })
      : null;
    const config = scoped ?? (await (this.prisma as any).payrollTenantConfig.findFirst({ where: { tenantId, legalEntityId: null } }));
    return config?.paymentHandoffMode ?? 'NOT_CONFIGURED';
  }

  /**
   * Called by payroll-service.ts's postBatch() immediately after CE-07
   * confirms POSTED. Idempotent — a retry of the same batchId is a safe
   * no-op (returns the existing handoff), never a duplicate record.
   */
  async createHandoff(input: CreateHandoffInput) {
    const existing = await (this.prisma as any).payrollPaymentHandoff.findFirst({
      where: { tenantId: input.tenantId, payrollBatchId: input.payrollBatchId },
    });
    if (existing) return existing;

    const mode = await this.resolveMode(input.tenantId, input.legalEntityId);
    // Truthful state: without a real, tenant-configured payment method,
    // this is NOT_CONFIGURED — never a fabricated "export ready"/"sent"
    // claim. MANUAL_EXPORT means the tenant has decided the posted
    // liability is handed off to a real external/manual disbursement
    // process outside this system; payroll-service itself never touches a
    // bank rail.
    const status = mode === 'MANUAL_EXPORT' ? 'PAYMENT_EXPORT_READY' : 'NOT_CONFIGURED';

    const idempotencyKey = crypto.createHash('sha256').update(`payment-handoff:${input.tenantId}:${input.payrollBatchId}`).digest('hex');
    return (this.prisma as any).payrollPaymentHandoff.create({
      data: {
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        payrollBatchId: input.payrollBatchId,
        journalEntryId: input.journalEntryId,
        clearingGlAccountCode: input.clearingGlAccountCode,
        totalAmount: input.totalAmount,
        status,
        idempotencyKey,
        createdBy: input.actor,
      },
    });
  }

  async getByBatch(tenantId: TenantId, payrollBatchId: string) {
    return (this.prisma as any).payrollPaymentHandoff.findFirst({ where: { tenantId, payrollBatchId } });
  }

  async get(tenantId: TenantId, id: string) {
    const handoff = await (this.prisma as any).payrollPaymentHandoff.findFirst({ where: { id, tenantId } });
    if (!handoff) throw new PaymentHandoffNotFoundError(`Payment handoff ${id} not found`);
    return handoff;
  }

  async list(tenantId: TenantId, filters?: { legalEntityId?: string; status?: string }) {
    return (this.prisma as any).payrollPaymentHandoff.findMany({
      where: { tenantId, ...(filters?.legalEntityId && { legalEntityId: filters.legalEntityId }), ...(filters?.status && { status: filters.status }) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Marks the handoff externally transmitted — a truthful "we sent it out", never "it cleared". */
  async markTransmissionPending(tenantId: TenantId, id: string, actor: string) {
    const handoff = await this.get(tenantId, id);
    if (handoff.status !== 'PAYMENT_EXPORT_READY') {
      throw new PaymentHandoffStateError(`Handoff must be PAYMENT_EXPORT_READY to mark transmission pending; current status: ${handoff.status}`);
    }
    return (this.prisma as any).payrollPaymentHandoff.update({ where: { id }, data: { status: 'EXTERNAL_TRANSMISSION_PENDING' } });
  }

  /**
   * SETTLED is reachable only with a real, independently-verified
   * cash-service settlement-batch reference — never a client-asserted
   * claim. Verification failure surfaces as a 422, not a fabricated
   * success and not a silent no-op.
   */
  async recordSettlement(tenantId: TenantId, id: string, settlementReference: string, actor: string) {
    const handoff = await this.get(tenantId, id);
    if (!['PAYMENT_EXPORT_READY', 'EXTERNAL_TRANSMISSION_PENDING', 'CERTIFICATION_PENDING'].includes(handoff.status)) {
      throw new PaymentHandoffStateError(`Handoff in status ${handoff.status} cannot be marked settled.`);
    }
    const verified = await this.settlementVerifier.verifySettlementBatch(tenantId, settlementReference);
    if (!verified) {
      await (this.prisma as any).payrollPaymentHandoff.update({
        where: { id },
        data: { status: 'FAILED', failureReason: `Settlement reference "${settlementReference}" could not be verified against cash-service.` },
      });
      throw new SettlementVerificationFailedError(
        `Settlement reference "${settlementReference}" could not be verified against a real cash-service settlement batch — refusing to fabricate settlement.`,
      );
    }
    return (this.prisma as any).payrollPaymentHandoff.update({
      where: { id },
      data: { status: 'SETTLED', settlementReference, settledAt: new Date() },
    });
  }

  /** Called by payroll-service.ts's voidBatch() — cancellation behavior. Idempotent (already-voided is a safe no-op). */
  async voidForBatch(tenantId: TenantId, payrollBatchId: string, voidReason: string, actor: string) {
    const handoff = await this.getByBatch(tenantId, payrollBatchId);
    if (!handoff) return null; // no handoff exists (e.g. NOT_CONFIGURED path never created a payable record) — nothing to cancel
    if (handoff.status === 'VOIDED') return handoff;
    if (handoff.status === 'SETTLED') {
      throw new PaymentHandoffStateError('A SETTLED payment handoff cannot be voided — reverse the settlement through cash-service first.');
    }
    return (this.prisma as any).payrollPaymentHandoff.update({
      where: { id: handoff.id },
      data: { status: 'VOIDED', voidedAt: new Date(), voidReason },
    });
  }
}
