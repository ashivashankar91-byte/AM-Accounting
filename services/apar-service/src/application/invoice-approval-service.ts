import { inject, injectable } from 'tsyringe';
import { IEventPublisher } from '@amacc/shared-kernel';
import { ApprovalRuleService, ANY_APPROVER_ROLE } from './approval-rule-service';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface DecisionDTO {
  version: number;
  note?: string;
}

export interface RejectDTO {
  version: number;
  reason: string;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class InvoiceNotFoundForApprovalError extends Error {
  constructor(id: string) {
    super(`Vendor invoice not found: ${id}`);
    this.name = 'InvoiceNotFoundForApprovalError';
  }
}

export class InvoiceNotSubmittedError extends Error {
  constructor(status: string) {
    super(`Invoice must be SUBMITTED to start approval — current status is '${status}'`);
    this.name = 'InvoiceNotSubmittedError';
  }
}

export class ApprovalInstanceNotFoundError extends Error {
  constructor(invoiceId: string) {
    super(`No approval instance exists for invoice: ${invoiceId}`);
    this.name = 'ApprovalInstanceNotFoundError';
  }
}

export class ApprovalAlreadyDecidedError extends Error {
  constructor(status: string) {
    super(`This approval instance is already ${status}`);
    this.name = 'ApprovalAlreadyDecidedError';
  }
}

export class ApprovalConflictError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ApprovalConflictError';
  }
}

export class WrongApproverRoleError extends Error {
  constructor(public readonly requiredRole: string) {
    super(`This step requires role '${requiredRole}'`);
    this.name = 'WrongApproverRoleError';
  }
}

export class ApprovalValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ApprovalValidationError';
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * S041 — Invoice Approval Matrix workflow. Sits directly on top of S039's
 * VendorInvoice.status (SUBMITTED -> PENDING_APPROVAL -> APPROVED/REJECTED).
 * On final-tier approval, creates + submits the AP liability GL journal
 * entry (Dr expense/asset lines from the invoice, Cr the vendor's AP
 * control account) via HTTP to gl-service — mirrors the FinanceChargeJob
 * cross-service posting pattern. The entry is left at PENDING_REVIEW; S041
 * never force-calls approveJournalEntry itself (that gate — agent review or
 * GlSource.autoPost — belongs to gl-service per PO-DEC-001). GL posting
 * failure does not roll back the approval decision (same non-blocking/
 * retry-later philosophy as the EOM archive step) — approvalGlEntryId stays
 * null and a GL_POSTING_FAILED audit event is recorded; retryGlPosting()
 * lets a caller retry later.
 */
@injectable()
export class InvoiceApprovalService {
  private glServiceUrl = process.env['GL_SERVICE_URL'] ?? 'http://gl-service:3010';

  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('IEventPublisher') private readonly eventPublisher: IEventPublisher,
    @inject(ApprovalRuleService) private readonly ruleService: ApprovalRuleService,
  ) {}

  async getInstance(tenantId: string, invoiceId: string) {
    const instance = await this.prisma.apInvoiceApprovalInstance.findFirst({
      where: { tenantId, invoiceId },
      include: { steps: { orderBy: { sequence: 'asc' } } },
    });
    if (!instance) throw new ApprovalInstanceNotFoundError(invoiceId);
    return instance;
  }

  async start(tenantId: string, invoiceId: string, actor = 'system', correlationId?: string) {
    const invoice = await this.prisma.vendorInvoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!invoice) throw new InvoiceNotFoundForApprovalError(invoiceId);
    if (invoice.status !== 'SUBMITTED') throw new InvoiceNotSubmittedError(invoice.status);

    const tiers = await this.ruleService.resolveTiers(tenantId, Number(invoice.totalAmount));

    const instance = await this.prisma.$transaction(async (tx: any) => {
      const created = await tx.apInvoiceApprovalInstance.create({
        data: {
          tenantId, invoiceId, status: 'PENDING',
          totalAmountSnapshot: invoice.totalAmount,
          createdBy: actor,
          steps: { create: tiers.map((t) => ({ sequence: t.sequence, requiredRole: t.requiredRole, status: 'PENDING' })) },
        },
        include: { steps: { orderBy: { sequence: 'asc' } } },
      });
      await tx.vendorInvoice.update({ where: { id: invoiceId }, data: { status: 'PENDING_APPROVAL', version: invoice.version + 1 } });
      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'VendorInvoice', docId: invoiceId, action: 'APPROVAL_STARTED', before: { status: invoice.status }, after: { tiers }, actor, correlationId: correlationId ?? null },
      });
      return created;
    });

    await this._writeOutbox(tenantId, 'AP_INVOICE_APPROVAL_STARTED', invoiceId, { instanceId: instance.id, tierCount: tiers.length });
    return instance;
  }

  private _currentPendingStep(instance: any) {
    return instance.steps.filter((s: any) => s.status === 'PENDING').sort((a: any, b: any) => a.sequence - b.sequence)[0] ?? null;
  }

  async approveStep(
    tenantId: string, invoiceId: string, dto: DecisionDTO,
    actor = 'system', actorRole = 'UNKNOWN', serviceToken?: string, correlationId?: string,
  ) {
    const instance = await this.getInstance(tenantId, invoiceId);
    if (instance.status !== 'PENDING') throw new ApprovalAlreadyDecidedError(instance.status);

    const invoice = await this.prisma.vendorInvoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!invoice) throw new InvoiceNotFoundForApprovalError(invoiceId);
    if (invoice.version !== dto.version) throw new ApprovalConflictError('VERSION_CONFLICT', `Version conflict: expected ${dto.version}, current is ${invoice.version}`);

    const step = this._currentPendingStep(instance);
    if (!step) throw new ApprovalAlreadyDecidedError(instance.status);
    if (step.requiredRole !== ANY_APPROVER_ROLE && step.requiredRole !== actorRole) {
      throw new WrongApproverRoleError(step.requiredRole);
    }

    const remainingAfterThis = instance.steps.filter((s: any) => s.status === 'PENDING' && s.id !== step.id).length;
    const isFinalTier = remainingAfterThis === 0;

    const result = await this.prisma.$transaction(async (tx: any) => {
      await tx.apInvoiceApprovalStep.update({ where: { id: step.id }, data: { status: 'APPROVED', decidedBy: actor, decidedAt: new Date(), note: dto.note ?? null } });

      if (isFinalTier) {
        await tx.apInvoiceApprovalInstance.update({ where: { id: instance.id }, data: { status: 'APPROVED', completedAt: new Date() } });
        const updatedInvoice = await tx.vendorInvoice.update({ where: { id: invoiceId }, data: { status: 'APPROVED', version: invoice.version + 1 } });
        await tx.auditOutboxEvent.create({
          data: { tenantId, docType: 'VendorInvoice', docId: invoiceId, action: 'APPROVED', before: { status: invoice.status }, after: { status: 'APPROVED' }, actor, correlationId: correlationId ?? null },
        });
        return { invoice: updatedInvoice, finalized: true };
      }

      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'VendorInvoice', docId: invoiceId, action: 'APPROVAL_STEP_APPROVED', before: null, after: { stepId: step.id, sequence: step.sequence }, actor, correlationId: correlationId ?? null },
      });
      return { invoice, finalized: false };
    });

    if (result.finalized) {
      await this._postApprovalLiability(tenantId, result.invoice, actor, serviceToken, correlationId);
    }

    return this.getInstance(tenantId, invoiceId);
  }

  async rejectStep(tenantId: string, invoiceId: string, dto: RejectDTO, actor = 'system', actorRole = 'UNKNOWN', correlationId?: string) {
    if (!dto.reason?.trim()) throw new ApprovalValidationError('REASON_REQUIRED', 'A reason is required to reject an invoice');

    const instance = await this.getInstance(tenantId, invoiceId);
    if (instance.status !== 'PENDING') throw new ApprovalAlreadyDecidedError(instance.status);

    const invoice = await this.prisma.vendorInvoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!invoice) throw new InvoiceNotFoundForApprovalError(invoiceId);
    if (invoice.version !== dto.version) throw new ApprovalConflictError('VERSION_CONFLICT', `Version conflict: expected ${dto.version}, current is ${invoice.version}`);

    const step = this._currentPendingStep(instance);
    if (!step) throw new ApprovalAlreadyDecidedError(instance.status);
    if (step.requiredRole !== ANY_APPROVER_ROLE && step.requiredRole !== actorRole) {
      throw new WrongApproverRoleError(step.requiredRole);
    }

    await this.prisma.$transaction(async (tx: any) => {
      await tx.apInvoiceApprovalStep.update({ where: { id: step.id }, data: { status: 'REJECTED', decidedBy: actor, decidedAt: new Date(), note: dto.reason } });
      await tx.apInvoiceApprovalStep.updateMany({
        where: { instanceId: instance.id, status: 'PENDING' },
        data: { status: 'SKIPPED' },
      });
      await tx.apInvoiceApprovalInstance.update({ where: { id: instance.id }, data: { status: 'REJECTED', completedAt: new Date() } });
      await tx.vendorInvoice.update({ where: { id: invoiceId }, data: { status: 'REJECTED', version: invoice.version + 1 } });
      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'VendorInvoice', docId: invoiceId, action: 'REJECTED', before: { status: invoice.status }, after: { reason: dto.reason }, actor, correlationId: correlationId ?? null },
      });
    });

    await this._writeOutbox(tenantId, 'AP_INVOICE_REJECTED', invoiceId, { reason: dto.reason, actor });
    return this.getInstance(tenantId, invoiceId);
  }

  /** Retries the AP liability GL posting for an already-APPROVED invoice
   * that has no approvalGlEntryId yet (prior attempt failed/unreachable). */
  async retryGlPosting(tenantId: string, invoiceId: string, actor = 'system', serviceToken?: string, correlationId?: string) {
    const invoice = await this.prisma.vendorInvoice.findFirst({ where: { id: invoiceId, tenantId }, include: { lines: true } });
    if (!invoice) throw new InvoiceNotFoundForApprovalError(invoiceId);
    if (invoice.status !== 'APPROVED') throw new ApprovalValidationError('NOT_APPROVED', `Invoice must be APPROVED — current status is '${invoice.status}'`);
    if (invoice.approvalGlEntryId) throw new ApprovalValidationError('ALREADY_POSTED', 'This invoice already has a posted GL entry reference');
    return this._postApprovalLiability(tenantId, invoice, actor, serviceToken, correlationId);
  }

  private async _postApprovalLiability(tenantId: string, invoice: any, actor: string, serviceToken?: string, correlationId?: string) {
    try {
      const fullInvoice = invoice.lines ? invoice : await this.prisma.vendorInvoice.findFirst({ where: { id: invoice.id, tenantId }, include: { lines: true } });
      const vendor = await this.prisma.vendor.findFirst({ where: { id: fullInvoice.vendorId, tenantId } });
      if (!vendor?.defaultGlAccount) {
        await this._auditGlFailure(tenantId, fullInvoice.id, actor, 'Vendor has no default AP control GL account configured', correlationId);
        return null;
      }

      // controlNumber = invoiceNumber on every line, so schedule-service (if
      // the AP control account is configured with a scheduleCode) creates an
      // open item keyed to this specific invoice — S043A's manual payment
      // relieves it by the same controlNumber. See gl-service GLAccount
      // scheduleCode / JOURNAL_ENTRY_POSTED outbox event.
      const debitLines: Array<{ glAccountId: string; debit: number; credit: number; memo: string; controlNumber: string }> = [];
      for (const line of fullInvoice.lines) {
        let glAccountId = line.glAccountId;
        if (!glAccountId && line.poLineId) {
          const poLine = await this.prisma.pOLine.findFirst({ where: { id: line.poLineId } });
          glAccountId = poLine?.glAccountId ?? null;
        }
        if (!glAccountId) {
          await this._auditGlFailure(tenantId, fullInvoice.id, actor, `Invoice line ${line.id} has no resolvable GL account`, correlationId);
          return null;
        }
        debitLines.push({ glAccountId, debit: Number(line.lineTotal), credit: 0, memo: line.description, controlNumber: fullInvoice.invoiceNumber });
      }
      debitLines.push({ glAccountId: vendor.defaultGlAccount, debit: 0, credit: Number(fullInvoice.totalAmount), memo: `AP liability — invoice ${fullInvoice.invoiceNumber}`, controlNumber: fullInvoice.invoiceNumber });

      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
      if (serviceToken) headers['authorization'] = `Bearer ${serviceToken}`;

      const jeResp = await fetch(`${this.glServiceUrl}/api/v1/gl/journal-entries`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          entryDate: new Date().toISOString(),
          description: `AP invoice ${fullInvoice.invoiceNumber} approved — liability`,
          source: 'AP',
          sourceRef: fullInvoice.invoiceNumber.slice(0, 8),
          lines: debitLines,
        }),
      });

      if (!jeResp.ok) {
        const errText = await jeResp.text().catch(() => '');
        await this._auditGlFailure(tenantId, fullInvoice.id, actor, `gl-service create failed: HTTP ${jeResp.status} ${errText}`, correlationId);
        return null;
      }
      const je = await jeResp.json() as { id: string };

      // Submit for review (DRAFT -> PENDING_REVIEW). Never force-approve —
      // that gate belongs to gl-service's own agent-review/autoPost logic.
      await fetch(`${this.glServiceUrl}/api/v1/gl/journal-entries/${je.id}/post`, { method: 'POST', headers }).catch(() => null);

      await this.prisma.vendorInvoice.update({ where: { id: fullInvoice.id }, data: { approvalGlEntryId: je.id } });
      await this.prisma.auditOutboxEvent.create({
        data: { tenantId, docType: 'VendorInvoice', docId: fullInvoice.id, action: 'GL_LIABILITY_POSTED', before: null, after: { journalEntryId: je.id }, actor, correlationId: correlationId ?? null },
      });
      return je.id;
    } catch (err: any) {
      await this._auditGlFailure(tenantId, invoice.id, actor, err?.message ?? 'Unknown error', correlationId);
      return null;
    }
  }

  private async _auditGlFailure(tenantId: string, invoiceId: string, actor: string, message: string, correlationId?: string) {
    try {
      await this.prisma.auditOutboxEvent.create({
        data: { tenantId, docType: 'VendorInvoice', docId: invoiceId, action: 'GL_POSTING_FAILED', before: null, after: { error: message }, actor, correlationId: correlationId ?? null },
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
