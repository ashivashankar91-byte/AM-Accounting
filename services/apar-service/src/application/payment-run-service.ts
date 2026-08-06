import { inject, injectable } from 'tsyringe';
import { IEventPublisher } from '@amacc/shared-kernel';
import { ManualPaymentService } from './manual-payment-service';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreatePaymentRunProposalDTO {
  bankAccountId: string;
  dueDateThrough: string; // YYYY-MM-DD — select invoices due on/before this date
  /** Accepted but a documented no-op — this schema's VendorInvoice has no
   * discount-date field yet (see PaymentRunService.createProposal doc). */
  discountDateThrough?: string;
  vendorIds?: string[];
}

export interface ApproveRunDTO {
  note?: string;
}

export interface RejectRunDTO {
  reason: string;
}

export interface GenerateRailArtifactDTO {
  mode: 'CHECK_PRINT' | 'POSITIVE_PAY' | 'ACH_NACHA';
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class PaymentRunNotFoundError extends Error {
  constructor(id: string) {
    super(`Payment run not found: ${id}`);
    this.name = 'PaymentRunNotFoundError';
  }
}

export class PaymentRunValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'PaymentRunValidationError';
  }
}

/** D-CE09 (S043B AC): the run's proposer and approver must be different
 * people (segregation of duties) — server-enforced, never client-trusted. */
export class RunApprovalRefusedSoDError extends Error {
  constructor() {
    super('The run approver must be a different person than the proposer (segregation of duties)');
    this.name = 'RunApprovalRefusedSoDError';
  }
}

/**
 * CE-09 S043B — AP Payment Runs & Rails.
 *
 * Proposal (createProposal): selects APPROVED VendorInvoices due on/before
 * dueDateThrough (optionally filtered by vendorIds), snapshotting one
 * ApPaymentRunItem per invoice and a cash-requirement preview total. Status
 * PROPOSED.
 *
 * Approval (approveRun): a distinct person from the proposer must approve
 * (RunApprovalRefusedSoDError / RUN_APPROVAL_REFUSED_SOD otherwise) —
 * server-enforced SoD, never trusting a client-supplied flag. Status
 * APPROVED.
 *
 * Execution (executeRun): idempotent by run id — a run already EXECUTED
 * returns its stored item results without re-attempting anything (no
 * double-pay); a run already EXECUTING (a concurrent call) is refused.
 * Each PENDING item is executed by delegating to
 * ManualPaymentService.create() — the SAME code path as any other manual
 * payment (identical GL matrix-row posting, gap-accounted check-number
 * issuance via APBankAccount.nextCheckNumber, invoice status transition) —
 * so no separate posting/check-numbering logic is invented here. Each item
 * is isolated: a single invoice's failure (e.g. InvoiceNotApprovedError,
 * InvoiceAlreadyPaidError) marks that item FAILED with a named
 * failureReason and the run continues to the next item — a partial run is
 * an expected, non-exceptional outcome, never silent.
 *
 * Rail artifacts (generateRailArtifact): CHECK_PRINT / POSITIVE_PAY file
 * generation always succeeds as GENERATED (file-generation-only is a valid
 * completed mode — never a claim of actual transmission). ACH_NACHA has no
 * real bank-rail integration in this repo, so its artifact is recorded
 * truthfully as PAYMENT_RAIL_NOT_CONFIGURED (mirrors
 * ApStopPaymentRequest.bankAck's identical precedent from S045) while
 * STILL generating the underlying file content — never a fabricated
 * transmission/ack.
 */
@injectable()
export class PaymentRunService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('IEventPublisher') private readonly eventPublisher: IEventPublisher,
    @inject('ManualPaymentService') private readonly manualPaymentService: ManualPaymentService,
  ) {}

  async list(tenantId: string) {
    return this.prisma.apPaymentRun.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
  }

  async getById(tenantId: string, id: string) {
    const run = await this.prisma.apPaymentRun.findFirst({ where: { id, tenantId }, include: { items: true, railArtifacts: true } });
    if (!run) throw new PaymentRunNotFoundError(id);
    return run;
  }

  async createProposal(tenantId: string, dto: CreatePaymentRunProposalDTO, actor = 'system') {
    if (!dto.bankAccountId?.trim()) throw new PaymentRunValidationError('BANK_ACCOUNT_ID_REQUIRED', 'bankAccountId is required');
    if (!dto.dueDateThrough?.trim()) throw new PaymentRunValidationError('DUE_DATE_THROUGH_REQUIRED', 'dueDateThrough is required');

    const bankAccount = await this.prisma.aPBankAccount.findFirst({ where: { id: dto.bankAccountId, tenantId } });
    if (!bankAccount) throw new PaymentRunValidationError('BANK_ACCOUNT_NOT_FOUND', `Bank account not found: ${dto.bankAccountId}`);

    const dueDateThrough = new Date(dto.dueDateThrough);
    const eligibleInvoices = await this.prisma.vendorInvoice.findMany({
      where: {
        tenantId, status: 'APPROVED', dueDate: { lte: dueDateThrough },
        ...(dto.vendorIds?.length ? { vendorId: { in: dto.vendorIds } } : {}),
      },
    });

    const cashRequirementTotal = eligibleInvoices.reduce((sum: number, inv: any) => sum + Number(inv.totalAmount), 0);

    const run = await this.prisma.$transaction(async (tx: any) => {
      const created = await tx.apPaymentRun.create({
        data: {
          tenantId, bankAccountId: dto.bankAccountId, status: 'PROPOSED',
          dueDateThrough, discountDateThrough: dto.discountDateThrough ? new Date(dto.discountDateThrough) : null,
          vendorFilter: dto.vendorIds?.length ? dto.vendorIds : null,
          cashRequirementTotal: Math.round(cashRequirementTotal * 100) / 100,
          proposedBy: actor,
        },
      });
      if (eligibleInvoices.length > 0) {
        await tx.apPaymentRunItem.createMany({
          data: eligibleInvoices.map((inv: any) => ({
            tenantId, runId: created.id, invoiceId: inv.id, vendorId: inv.vendorId, amount: inv.totalAmount, status: 'PENDING',
          })),
        });
      }
      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'ApPaymentRun', docId: created.id, action: 'PROPOSED', before: null, after: created, actor },
      });
      return created;
    });

    return this.getById(tenantId, run.id);
  }

  async approveRun(tenantId: string, id: string, dto: ApproveRunDTO, actor = 'system') {
    const run = await this._getRunOrThrow(tenantId, id);
    if (run.status !== 'PROPOSED') throw new PaymentRunValidationError('RUN_NOT_PROPOSED', `Run must be PROPOSED to approve — current status is '${run.status}'`);
    if (run.proposedBy === actor) throw new RunApprovalRefusedSoDError();

    const updated = await this.prisma.apPaymentRun.update({
      where: { id }, data: { status: 'APPROVED', approvedBy: actor, approvedAt: new Date() },
    });
    await this._audit(tenantId, id, 'APPROVED', run, updated, actor);
    return updated;
  }

  async rejectRun(tenantId: string, id: string, dto: RejectRunDTO, actor = 'system') {
    if (!dto.reason?.trim()) throw new PaymentRunValidationError('REASON_REQUIRED', 'A reason is required to reject a payment run');
    const run = await this._getRunOrThrow(tenantId, id);
    if (run.status !== 'PROPOSED') throw new PaymentRunValidationError('RUN_NOT_PROPOSED', `Run must be PROPOSED to reject — current status is '${run.status}'`);

    const updated = await this.prisma.apPaymentRun.update({
      where: { id }, data: { status: 'REJECTED', rejectedBy: actor, rejectedAt: new Date(), rejectionReason: dto.reason },
    });
    await this._audit(tenantId, id, 'REJECTED', run, updated, actor);
    return updated;
  }

  /**
   * Idempotent by run id: EXECUTED returns stored results; EXECUTING (a
   * concurrent/duplicate call arriving mid-execution) is refused, never
   * silently re-run.
   */
  async executeRun(tenantId: string, id: string, actor = 'system', serviceToken?: string, correlationId?: string) {
    const claimed = await this.prisma.$transaction(async (tx: any) => {
      const locked = await tx.$queryRawUnsafe(
        `SELECT id, tenant_id, status FROM ap_payment_runs WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        id, tenantId,
      );
      if (!locked || locked.length === 0) throw new PaymentRunNotFoundError(id);
      const current = locked[0];
      if (current.status === 'EXECUTED') return { alreadyExecuted: true };
      if (current.status === 'EXECUTING') throw new PaymentRunValidationError('RUN_ALREADY_EXECUTING', 'This run is already being executed (concurrent execution attempt)');
      if (current.status !== 'APPROVED') throw new PaymentRunValidationError('RUN_NOT_APPROVED', `Run must be APPROVED to execute — current status is '${current.status}'`);
      await tx.apPaymentRun.update({ where: { id }, data: { status: 'EXECUTING' } });
      return { alreadyExecuted: false };
    });

    if (claimed.alreadyExecuted) {
      // Idempotent: duplicate execution attempt returns the original results — no double-pay.
      return this.getById(tenantId, id);
    }

    const runForBankAccount = await this.prisma.apPaymentRun.findFirst({ where: { id, tenantId } });
    const items = await this.prisma.apPaymentRunItem.findMany({ where: { tenantId, runId: id, status: 'PENDING' } });
    for (const item of items) {
      try {
        const payment = await this.manualPaymentService.create(
          tenantId, { invoiceId: item.invoiceId, bankAccountId: runForBankAccount.bankAccountId },
          actor, serviceToken, correlationId,
        );
        await this.prisma.apPaymentRunItem.update({
          where: { id: item.id }, data: { status: 'PAID', paymentId: payment.id, checkNumber: payment.checkNumber },
        });
      } catch (err: any) {
        await this.prisma.apPaymentRunItem.update({
          where: { id: item.id }, data: { status: 'FAILED', failureReason: `${err?.name ?? 'Error'}: ${err?.message ?? 'Unknown error'}` },
        });
      }
    }

    const updatedRun = await this.prisma.apPaymentRun.update({
      where: { id }, data: { status: 'EXECUTED', executedBy: actor, executedAt: new Date() },
    });
    await this._audit(tenantId, id, 'EXECUTED', null, updatedRun, actor, correlationId);
    return this.getById(tenantId, id);
  }

  async generateRailArtifact(tenantId: string, id: string, dto: GenerateRailArtifactDTO, actor = 'system') {
    const run = await this._getRunOrThrow(tenantId, id);
    if (run.status !== 'EXECUTED') throw new PaymentRunValidationError('RUN_NOT_EXECUTED', 'Rail artifacts can only be generated for an EXECUTED run');

    const paidItems = await this.prisma.apPaymentRunItem.findMany({ where: { tenantId, runId: id, status: 'PAID' } });
    const totalAmount = paidItems.reduce((sum: number, i: any) => sum + Number(i.amount), 0);

    let fileContent: string;
    let status: string;
    if (dto.mode === 'ACH_NACHA') {
      // No real ACH-origination rail is configured in this repo — truthful
      // adapter state, never a fabricated transmission (same precedent as
      // S045's ApStopPaymentRequest.bankAck = PAYMENT_RAIL_NOT_CONFIGURED).
      status = 'PAYMENT_RAIL_NOT_CONFIGURED';
      fileContent = this._buildNachaLikeFile(paidItems);
    } else {
      status = 'GENERATED';
      fileContent = dto.mode === 'CHECK_PRINT' ? this._buildCheckPrintFile(paidItems) : this._buildPositivePayFile(paidItems);
    }

    const artifact = await this.prisma.apPaymentRunRailArtifact.create({
      data: {
        tenantId, runId: id, mode: dto.mode, status, fileContent,
        totalAmount: Math.round(totalAmount * 100) / 100, itemCount: paidItems.length, generatedBy: actor,
      },
    });
    return artifact;
  }

  async listRailArtifacts(tenantId: string, runId: string) {
    return this.prisma.apPaymentRunRailArtifact.findMany({ where: { tenantId, runId }, orderBy: { generatedAt: 'desc' } });
  }

  private _buildCheckPrintFile(items: any[]): string {
    const lines = ['CHECK_NUMBER,VENDOR_ID,AMOUNT'];
    for (const i of items) lines.push(`${i.checkNumber ?? ''},${i.vendorId},${Number(i.amount).toFixed(2)}`);
    return lines.join('\n');
  }

  private _buildPositivePayFile(items: any[]): string {
    const lines = ['CHECK_NUMBER,AMOUNT,PAYEE_ID'];
    for (const i of items) lines.push(`${i.checkNumber ?? ''},${Number(i.amount).toFixed(2)},${i.vendorId}`);
    return lines.join('\n');
  }

  private _buildNachaLikeFile(items: any[]): string {
    const lines = ['6' /* entry-detail-record-like header, simplified/non-transmitted */];
    for (const i of items) lines.push(`ENTRY,${i.vendorId},${Math.round(Number(i.amount) * 100)}`);
    return lines.join('\n');
  }

  private async _getRunOrThrow(tenantId: string, id: string) {
    const run = await this.prisma.apPaymentRun.findFirst({ where: { id, tenantId } });
    if (!run) throw new PaymentRunNotFoundError(id);
    return run;
  }

  private async _audit(tenantId: string, runId: string, action: string, before: any, after: any, actor: string, correlationId?: string) {
    try {
      await this.prisma.auditOutboxEvent.create({
        data: { tenantId, docType: 'ApPaymentRun', docId: runId, action, before, after, actor, correlationId: correlationId ?? null },
      });
    } catch {
      // Non-fatal
    }
  }
}
