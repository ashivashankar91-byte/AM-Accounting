import { inject, injectable } from 'tsyringe';
import { IEventPublisher, setTenantContextOnConnection } from '@amacc/shared-kernel';
import { PostingEnginePort } from './posting-engine-port';
import { buildApPaymentPostedEnvelope } from './ap-payment-envelope';
import { resolveGlAccountCode } from './gl-account-code-resolver';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreatePaymentDTO {
  invoiceId: string;
  bankAccountId: string;
  paymentDate?: Date;
}

export interface VoidPaymentDTO {
  version: number;
  reason: string;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class InvoiceNotFoundForPaymentError extends Error {
  constructor(id: string) {
    super(`Vendor invoice not found: ${id}`);
    this.name = 'InvoiceNotFoundForPaymentError';
  }
}

export class InvoiceNotApprovedError extends Error {
  constructor(status: string) {
    super(`Invoice must be APPROVED to pay — current status is '${status}'`);
    this.name = 'InvoiceNotApprovedError';
  }
}

export class InvoiceAlreadyPaidError extends Error {
  constructor(invoiceId: string) {
    super(`Invoice ${invoiceId} already has a payment recorded`);
    this.name = 'InvoiceAlreadyPaidError';
  }
}

export class BankAccountNotFoundError extends Error {
  constructor(id: string) {
    super(`Bank account not found: ${id}`);
    this.name = 'BankAccountNotFoundError';
  }
}

export class PaymentNotFoundError extends Error {
  constructor(id: string) {
    super(`Manual payment not found: ${id}`);
    this.name = 'PaymentNotFoundError';
  }
}

export class PaymentConflictError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'PaymentConflictError';
  }
}

export class PaymentValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'PaymentValidationError';
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * S043A — Manual Single Payment (L1, lowest complexity of the five-story
 * wave). Pays exactly one APPROVED VendorInvoice in full by check — no
 * partial/split payment. Draws its check number from the existing S3-09
 * APBankAccount sequence.
 *
 * CE-07 (single authoritative ledger decision): submits a canonical
 * `ap.payment.posted` event (Dr AP control, Cr Bank) to coa-service's
 * S019/S020 posting engine, which posts the resulting journal through
 * gl-service's EXISTING posting door — no direct gl-service journal-entry
 * call from this service anymore. Still attempts to relieve the
 * schedule-service open item created at approval (keyed by controlNumber =
 * invoiceNumber, on whichever Schedule has the vendor's AP control GL
 * account code configured — existing schedule-service configuration, not
 * invented here). Both the GL posting and the schedule relief are
 * best-effort/non-blocking: the payment itself is durable regardless of
 * downstream service availability, and truthfully records what actually
 * happened (glPostingError / scheduleReliefStatus) rather than fabricating
 * success.
 */
@injectable()
export class ManualPaymentService {
  private glServiceUrl = process.env['GL_SERVICE_URL'] ?? 'http://gl-service:3010';
  private scheduleServiceUrl = process.env['SCHEDULE_SERVICE_URL'] ?? 'http://schedule-service:3020';

  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('IEventPublisher') private readonly eventPublisher: IEventPublisher,
    @inject('PostingEnginePort') private readonly postingEnginePort: PostingEnginePort,
  ) {}

  async list(tenantId: string, vendorId?: string) {
    return this.prisma.apManualPayment.findMany({ where: { tenantId, ...(vendorId ? { vendorId } : {}) }, orderBy: { createdAt: 'desc' } });
  }

  async getById(tenantId: string, id: string) {
    const payment = await this.prisma.apManualPayment.findFirst({ where: { id, tenantId } });
    if (!payment) throw new PaymentNotFoundError(id);
    return payment;
  }

  async create(tenantId: string, dto: CreatePaymentDTO, actor = 'system', serviceToken?: string, correlationId?: string) {
    const invoice = await this.prisma.vendorInvoice.findFirst({ where: { id: dto.invoiceId, tenantId }, include: { lines: true } });
    if (!invoice) throw new InvoiceNotFoundForPaymentError(dto.invoiceId);
    if (invoice.status !== 'APPROVED') throw new InvoiceNotApprovedError(invoice.status);

    const existing = await this.prisma.apManualPayment.findFirst({ where: { invoiceId: dto.invoiceId, status: 'POSTED' } });
    if (existing) throw new InvoiceAlreadyPaidError(dto.invoiceId);

    const bankAccount = await this.prisma.aPBankAccount.findFirst({ where: { id: dto.bankAccountId, tenantId } });
    if (!bankAccount) throw new BankAccountNotFoundError(dto.bankAccountId);

    const vendor = await this.prisma.vendor.findFirst({ where: { id: invoice.vendorId, tenantId } });
    if (!vendor) throw new InvoiceNotFoundForPaymentError(dto.invoiceId);

    const { payment, checkNumber } = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId); // CE-07 discovery: interactive $transaction runs on its own connection, separate from the base client's RLS middleware — see rls-middleware.ts.
      const updatedBank = await tx.aPBankAccount.update({
        where: { id: dto.bankAccountId },
        data: { nextCheckNumber: { increment: 1 } },
      });
      const assignedCheckNumber = updatedBank.nextCheckNumber - 1;

      const created = await tx.apManualPayment.create({
        data: {
          tenantId, invoiceId: dto.invoiceId, vendorId: invoice.vendorId, bankAccountId: dto.bankAccountId,
          checkNumber: assignedCheckNumber, paymentDate: dto.paymentDate ?? new Date(),
          amount: invoice.totalAmount, status: 'POSTED', createdBy: actor,
        },
      });

      await tx.vendorInvoice.update({ where: { id: dto.invoiceId }, data: { status: 'PAID', version: invoice.version + 1 } });

      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'ApManualPayment', docId: created.id, action: 'CREATED', before: null, after: created, actor, correlationId: correlationId ?? null },
      });

      return { payment: created, checkNumber: assignedCheckNumber };
    });

    await this._writeOutbox(tenantId, 'AP_MANUAL_PAYMENT_CREATED', payment.id, { invoiceId: dto.invoiceId, checkNumber, actor });

    const glEntryId = await this._postPaymentReversal(tenantId, invoice, vendor, bankAccount, payment.id, actor, serviceToken, correlationId, payment.paymentDate);
    let updated = payment;
    if (glEntryId) {
      updated = await this.prisma.apManualPayment.update({ where: { id: payment.id }, data: { glEntryId } });
      await this._relieveSchedule(tenantId, invoice, vendor, payment.id, actor, correlationId);
      updated = await this.prisma.apManualPayment.findFirst({ where: { id: payment.id } });
    }

    return updated;
  }

  async void(tenantId: string, id: string, dto: VoidPaymentDTO, actor = 'system', correlationId?: string) {
    const current = await this.prisma.apManualPayment.findFirst({ where: { id, tenantId } });
    if (!current) throw new PaymentNotFoundError(id);
    if (current.version !== dto.version) throw new PaymentConflictError('VERSION_CONFLICT', `Version conflict: expected ${dto.version}, current is ${current.version}`);
    if (current.status === 'VOID') throw new PaymentValidationError('ALREADY_VOID', 'Payment is already void');
    if (!dto.reason?.trim()) throw new PaymentValidationError('REASON_REQUIRED', 'A reason is required to void a payment');

    const invoice = await this.prisma.vendorInvoice.findFirst({ where: { id: current.invoiceId, tenantId } });

    const updated = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId); // CE-07 discovery: interactive $transaction runs on its own connection, separate from the base client's RLS middleware — see rls-middleware.ts.
      const voided = await tx.apManualPayment.update({
        where: { id }, data: { status: 'VOID', version: current.version + 1, voidedAt: new Date(), voidedBy: actor, voidReason: dto.reason },
      });
      if (invoice) {
        await tx.vendorInvoice.update({ where: { id: invoice.id }, data: { status: 'APPROVED', version: invoice.version + 1 } });
      }
      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'ApManualPayment', docId: id, action: 'VOIDED', before: current, after: voided, actor, correlationId: correlationId ?? null },
      });
      return voided;
    });

    await this._writeOutbox(tenantId, 'AP_MANUAL_PAYMENT_VOIDED', id, { reason: dto.reason, actor });
    return updated;
  }

  private async _postPaymentReversal(
    tenantId: string, invoice: any, vendor: any, bankAccount: any, paymentId: string,
    actor: string, serviceToken?: string, correlationId?: string, paymentDate?: Date,
  ): Promise<string | null> {
    if (!vendor.defaultGlAccount || !bankAccount.glAccountId) {
      await this._recordGlFailure(tenantId, paymentId, !vendor.defaultGlAccount ? 'Vendor has no default AP control GL account configured' : 'Bank account has no linked GL account configured');
      return null;
    }
    try {
      const apControlAccountNumber = await resolveGlAccountCode(this.glServiceUrl, tenantId, vendor.defaultGlAccount, serviceToken);
      if (!apControlAccountNumber) {
        await this._recordGlFailure(tenantId, paymentId, `Vendor's default GL account ${vendor.defaultGlAccount} could not be resolved to an account number`);
        return null;
      }
      const bankAccountNumber = await resolveGlAccountCode(this.glServiceUrl, tenantId, bankAccount.glAccountId, serviceToken);
      if (!bankAccountNumber) {
        await this._recordGlFailure(tenantId, paymentId, `Bank account's GL account ${bankAccount.glAccountId} could not be resolved to an account number`);
        return null;
      }

      // NARROW SCOPE SIMPLIFICATION (disclosed) — see invoice-approval-
      // service.ts's AP_DEFAULT_STORE_ID: apar-service has no per-payment
      // store dimension today.
      const envelope = buildApPaymentPostedEnvelope({
        paymentId,
        tenantId,
        legalEntityId: tenantId, // see ap-payment-envelope.ts's doc-comment — single-entity-per-tenant default
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        paymentDate: paymentDate ?? invoice.invoiceDate,
        amount: invoice.totalAmount,
        apControlAccountNumber,
        bankAccountNumber,
        storeId: 'AP-CENTRAL',
      }, correlationId);

      const result = await this.postingEnginePort.submit(envelope);
      if (!result.ok) {
        await this._recordGlFailure(tenantId, paymentId, result.failureReason ?? 'posting engine submission failed');
        return null;
      }
      return result.journalEntryId ?? null;
    } catch (err: any) {
      await this._recordGlFailure(tenantId, paymentId, err?.message ?? 'Unknown error');
      return null;
    }
  }

  /** Best-effort relief of the schedule-service open item created at
   * approval — truthful outcome recorded on the payment row, never
   * fabricated as RELIEVED unless schedule-service actually confirmed it. */
  private async _relieveSchedule(tenantId: string, invoice: any, vendor: any, paymentId: string, actor: string, correlationId?: string) {
    try {
      const headers: Record<string, string> = { 'x-tenant-id': tenantId };
      const accountResp = await fetch(`${this.glServiceUrl}/api/v1/gl/accounts/${vendor.defaultGlAccount}`, { headers });
      if (!accountResp.ok) return this._recordScheduleOutcome(tenantId, paymentId, 'NOT_FOUND', null, null, 'Could not resolve AP control account code from gl-service');
      const account = await accountResp.json() as { code?: string };
      if (!account.code) return this._recordScheduleOutcome(tenantId, paymentId, 'NOT_FOUND', null, null, 'AP control account has no code');

      const schedulesResp = await fetch(`${this.scheduleServiceUrl}/api/v1/schedules`, { headers });
      if (!schedulesResp.ok) return this._recordScheduleOutcome(tenantId, paymentId, 'NOT_FOUND', null, null, 'Could not list schedules');
      const schedules = await schedulesResp.json() as Array<{ id: string; glAccountNumbers: string[] }>;
      const schedule = schedules.find((s) => s.glAccountNumbers?.includes(account.code!));
      if (!schedule) return this._recordScheduleOutcome(tenantId, paymentId, 'NOT_FOUND', null, null, `No schedule configured for AP control account ${account.code}`);

      const itemsResp = await fetch(`${this.scheduleServiceUrl}/api/v1/schedules/${schedule.id}/open-items?controlNumber=${encodeURIComponent(invoice.invoiceNumber)}`, { headers });
      if (!itemsResp.ok) return this._recordScheduleOutcome(tenantId, paymentId, 'NOT_FOUND', schedule.id, null, 'Could not query open items');
      const items = await itemsResp.json() as Array<{ id: string; status: string }>;
      const openItem = items.find((i) => i.status === 'OPEN' || i.status === 'PARTIALLY_APPLIED');
      if (!openItem) return this._recordScheduleOutcome(tenantId, paymentId, 'NOT_FOUND', schedule.id, null, `No open item found for control number ${invoice.invoiceNumber}`);

      const applyResp = await fetch(`${this.scheduleServiceUrl}/api/v1/schedules/${schedule.id}/open-items/${openItem.id}/apply`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: String(invoice.totalAmount), idempotencyKey: `ap-manual-payment-${paymentId}`, note: `Relieved by manual payment ${paymentId}` }),
      });
      if (!applyResp.ok) {
        const errText = await applyResp.text().catch(() => '');
        return this._recordScheduleOutcome(tenantId, paymentId, 'FAILED', schedule.id, null, `apply failed: HTTP ${applyResp.status} ${errText}`);
      }
      const application = await applyResp.json() as { id: string };
      return this._recordScheduleOutcome(tenantId, paymentId, 'RELIEVED', schedule.id, application.id, null);
    } catch (err: any) {
      return this._recordScheduleOutcome(tenantId, paymentId, 'FAILED', null, null, err?.message ?? 'Unknown error');
    }
  }

  /** Retries schedule relief for a payment whose prior attempt did not
   * result in RELIEVED (NOT_FOUND/FAILED). */
  async retryScheduleRelief(tenantId: string, paymentId: string) {
    const payment = await this.getById(tenantId, paymentId);
    if (payment.scheduleReliefStatus === 'RELIEVED') throw new PaymentValidationError('ALREADY_RELIEVED', 'This payment has already relieved its schedule open item');
    const invoice = await this.prisma.vendorInvoice.findFirst({ where: { id: payment.invoiceId, tenantId } });
    if (!invoice) throw new InvoiceNotFoundForPaymentError(payment.invoiceId);
    const vendor = await this.prisma.vendor.findFirst({ where: { id: payment.vendorId, tenantId } });
    await this._relieveSchedule(tenantId, invoice, vendor, paymentId, 'system');
    return this.getById(tenantId, paymentId);
  }

  private async _recordGlFailure(tenantId: string, paymentId: string, message: string) {
    try {
      await this.prisma.apManualPayment.update({ where: { id: paymentId }, data: { glPostingError: message } });
    } catch {
      // Non-fatal
    }
  }

  private async _recordScheduleOutcome(tenantId: string, paymentId: string, status: string, scheduleId: string | null, applicationId: string | null, error: string | null) {
    try {
      await this.prisma.apManualPayment.update({
        where: { id: paymentId },
        data: { scheduleReliefStatus: status, scheduleId, scheduleApplicationId: applicationId, scheduleReliefError: error },
      });
    } catch {
      // Non-fatal
    }
  }

  private async _writeOutbox(tenantId: string, eventType: string, aggregateId: string, payload: Record<string, unknown>) {
    try {
      await this.prisma.outboxEvent.create({ data: { tenantId, eventType, payload: { aggregateId, ...payload } } });
    } catch {
      // Non-fatal
    }
  }
}
