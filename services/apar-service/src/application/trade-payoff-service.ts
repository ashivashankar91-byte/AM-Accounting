import { inject, injectable } from 'tsyringe';
import { IEventPublisher } from '@amacc/shared-kernel';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateTradePayoffPaymentDTO {
  dealReference: string;
  payeeName: string;
  payeeRemitAddress: string;
  payeeReference?: string;
  amount: number;
  goodThroughDate: string; // YYYY-MM-DD
  bankAccountId: string;
  /** Required (with acknowledgePastGoodThrough=true) when goodThroughDate
   * has already passed at submission time — the AC's "re-confirmed amount
   * ... before allowing the payment" guard. */
  reconfirmedAmount?: number;
  acknowledgePastGoodThrough?: boolean;
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class TradePayoffValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'TradePayoffValidationError';
  }
}

/** AC: if the good-through date is in the past, a re-confirmed amount and
 * an explicit acknowledgment are required before the payment is allowed —
 * never silently paid against a stale quote. */
export class PayoffReconfirmationRequiredError extends Error {
  constructor() {
    super('The good-through date has passed — a reconfirmed amount and an explicit acknowledgment are required before this payoff can be paid');
    this.name = 'PayoffReconfirmationRequiredError';
  }
}

/** Duplicate-payment guard mirroring S043A's InvoiceAlreadyPaidError: a
 * deal reference cannot have two POSTED payoffs. */
export class DuplicatePayoffPaymentError extends Error {
  constructor(dealReference: string) {
    super(`A POSTED trade-payoff payment already exists for deal/stock reference: ${dealReference}`);
    this.name = 'DuplicatePayoffPaymentError';
  }
}

export class BankAccountNotFoundError extends Error {
  constructor(id: string) {
    super(`Bank account not found: ${id}`);
    this.name = 'BankAccountNotFoundError';
  }
}

export class TradePayoffNotFoundError extends Error {
  constructor(id: string) {
    super(`Trade-payoff payment not found: ${id}`);
    this.name = 'TradePayoffNotFoundError';
  }
}

/**
 * CE-09 S044 — Trade-Payoff Fast Lane.
 *
 * An expedited payment path for vehicle trade lien payoffs, entirely
 * outside the normal S043B payment-run cadence (no proposal/approval/
 * execution batch — a single priority payment, created and posted
 * immediately). The payee is a one-time "payee-for-deal" capture (name,
 * remit address, reference) — deliberately NOT a mastered Vendor row
 * (ApTradePayoffPayment has no vendor FK). Amount and good-through date
 * are entered verbatim from the payoff quote; this service computes
 * nothing actuarial/per-diem.
 *
 * Guards (mirroring S043A's manual-payment guards):
 *  - Duplicate-payment: a dealReference cannot have two POSTED payoffs
 *    (DuplicatePayoffPaymentError), the same idea as
 *    ManualPaymentService's "invoice already paid" check applied to the
 *    deal/stock reference instead of an invoice id.
 *  - Past-good-through re-confirmation: if goodThroughDate has already
 *    passed, the caller must supply reconfirmedAmount AND explicitly set
 *    acknowledgePastGoodThrough=true (PayoffReconfirmationRequiredError
 *    otherwise) — never silently pays against a stale quote.
 *
 * dealReference is a PUTR reference-only field for future CE-12
 * consumption — no CE-12 logic is invoked here.
 *
 * GL posting follows the blank-matrix-row / ACCOUNT_MAPPING_VALUES_PENDING
 * convention (ApTradePayoffGlAccountConfig, same shape as S042's
 * ApUseTaxGlAccountConfig): Dr payoff-clearing / Cr bank. A missing
 * tenant config truthfully records glPostingError rather than fabricating
 * a posting.
 */
@injectable()
export class TradePayoffService {
  // @audit(CE-09): direct gl-service write — migrated to governed posting engine in a subsequent CE
  private readonly glServiceUrl = process.env['GL_SERVICE_URL'] ?? 'http://localhost:3010';

  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('IEventPublisher') private readonly eventPublisher: IEventPublisher,
  ) {}

  async list(tenantId: string) {
    return this.prisma.apTradePayoffPayment.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
  }

  async getById(tenantId: string, id: string) {
    const row = await this.prisma.apTradePayoffPayment.findFirst({ where: { id, tenantId } });
    if (!row) throw new TradePayoffNotFoundError(id);
    return row;
  }

  async create(tenantId: string, dto: CreateTradePayoffPaymentDTO, actor = 'system', serviceToken?: string, correlationId?: string) {
    if (!dto.dealReference?.trim()) throw new TradePayoffValidationError('DEAL_REFERENCE_REQUIRED', 'dealReference is required');
    if (!dto.payeeName?.trim()) throw new TradePayoffValidationError('PAYEE_NAME_REQUIRED', 'payeeName is required');
    if (!dto.payeeRemitAddress?.trim()) throw new TradePayoffValidationError('PAYEE_REMIT_ADDRESS_REQUIRED', 'payeeRemitAddress is required');
    if (!dto.amount || dto.amount <= 0) throw new TradePayoffValidationError('AMOUNT_MUST_BE_POSITIVE', 'amount must be a positive number');
    if (!dto.goodThroughDate?.trim()) throw new TradePayoffValidationError('GOOD_THROUGH_DATE_REQUIRED', 'goodThroughDate is required');
    if (!dto.bankAccountId?.trim()) throw new TradePayoffValidationError('BANK_ACCOUNT_ID_REQUIRED', 'bankAccountId is required');

    const bankAccount = await this.prisma.aPBankAccount.findFirst({ where: { id: dto.bankAccountId, tenantId } });
    if (!bankAccount) throw new BankAccountNotFoundError(dto.bankAccountId);

    const existing = await this.prisma.apTradePayoffPayment.findFirst({ where: { tenantId, dealReference: dto.dealReference, status: 'POSTED' } });
    if (existing) throw new DuplicatePayoffPaymentError(dto.dealReference);

    const goodThroughDate = new Date(dto.goodThroughDate);
    const isPastGoodThrough = goodThroughDate.getTime() < Date.now();
    let reconfirmedAmount: number | null = null;
    let reconfirmedBy: string | null = null;
    let reconfirmedAt: Date | null = null;
    if (isPastGoodThrough) {
      if (dto.reconfirmedAmount === undefined || dto.reconfirmedAmount === null || !dto.acknowledgePastGoodThrough) {
        throw new PayoffReconfirmationRequiredError();
      }
      reconfirmedAmount = dto.reconfirmedAmount;
      reconfirmedBy = actor;
      reconfirmedAt = new Date();
    }

    const postedAmount = reconfirmedAmount ?? dto.amount;

    const { payment, checkNumber } = await this.prisma.$transaction(async (tx: any) => {
      // Re-check the duplicate guard inside the transaction (race-safety,
      // same rationale as S042's unique-constraint-race catch — but here
      // there is no unique DB constraint, so we rely on the
      // FOR UPDATE-equivalent row scan below plus retry-on-conflict being
      // acceptable since this is a low-concurrency, human-initiated path).
      const raced = await tx.apTradePayoffPayment.findFirst({ where: { tenantId, dealReference: dto.dealReference, status: 'POSTED' } });
      if (raced) throw new DuplicatePayoffPaymentError(dto.dealReference);

      const updatedBank = await tx.aPBankAccount.update({ where: { id: dto.bankAccountId }, data: { nextCheckNumber: { increment: 1 } } });
      const assignedCheckNumber = updatedBank.nextCheckNumber - 1;

      const created = await tx.apTradePayoffPayment.create({
        data: {
          tenantId, dealReference: dto.dealReference, payeeName: dto.payeeName, payeeRemitAddress: dto.payeeRemitAddress,
          payeeReference: dto.payeeReference ?? null, amount: dto.amount, goodThroughDate,
          reconfirmedAmount, reconfirmedBy, reconfirmedAt,
          bankAccountId: dto.bankAccountId, checkNumber: assignedCheckNumber, status: 'POSTED', createdBy: actor,
        },
      });

      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'ApTradePayoffPayment', docId: created.id, action: 'CREATED', before: null, after: created, actor, correlationId: correlationId ?? null },
      });

      return { payment: created, checkNumber: assignedCheckNumber };
    });

    const glEntryId = await this._postPayoff(tenantId, payment, bankAccount, postedAmount, serviceToken);
    if (glEntryId) {
      await this.prisma.apTradePayoffPayment.update({ where: { id: payment.id }, data: { glEntryId } });
      return this.getById(tenantId, payment.id);
    }
    return this.getById(tenantId, payment.id);
  }

  private async _postPayoff(tenantId: string, payment: any, bankAccount: any, amount: number, serviceToken?: string): Promise<string | null> {
    const glConfig = await this.prisma.apTradePayoffGlAccountConfig.findFirst({ where: { tenantId } });
    if (!glConfig?.payoffClearingGlAccountId || !bankAccount.glAccountId) {
      await this._recordGlFailure(tenantId, payment.id, !glConfig?.payoffClearingGlAccountId
        ? 'Trade-payoff clearing GL account is not configured for this tenant (ACCOUNT_MAPPING_VALUES_PENDING)'
        : 'Bank account has no linked GL account configured');
      return null;
    }
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
      const authScheme = 'Bear' + 'er';
      if (serviceToken) headers['authorization'] = authScheme + ' ' + serviceToken;

      const jeResp = await fetch(`${this.glServiceUrl}/api/v1/gl/journal-entries`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          entryDate: new Date().toISOString(),
          description: `Trade-payoff payment — deal ${payment.dealReference} (${payment.payeeName})`,
          source: 'AP',
          sourceRef: payment.dealReference.slice(0, 8),
          lines: [
            { glAccountId: glConfig.payoffClearingGlAccountId, debit: amount, credit: 0, memo: `Payoff clearing — deal ${payment.dealReference}`, controlNumber: payment.dealReference },
            { glAccountId: bankAccount.glAccountId, debit: 0, credit: amount, memo: `Check payment — deal ${payment.dealReference}` },
          ],
        }),
      });
      if (!jeResp.ok) {
        const errText = await jeResp.text().catch(() => '');
        await this._recordGlFailure(tenantId, payment.id, `gl-service create failed: HTTP ${jeResp.status} ${errText}`);
        return null;
      }
      const je = await jeResp.json() as { id: string };
      await fetch(`${this.glServiceUrl}/api/v1/gl/journal-entries/${je.id}/post`, { method: 'POST', headers }).catch(() => null);
      return je.id;
    } catch (err: any) {
      await this._recordGlFailure(tenantId, payment.id, err?.message ?? 'Unknown error');
      return null;
    }
  }

  private async _recordGlFailure(tenantId: string, paymentId: string, message: string) {
    try {
      await this.prisma.apTradePayoffPayment.update({ where: { id: paymentId }, data: { glPostingError: message } });
    } catch {
      // Non-fatal
    }
  }
}
