import { inject, injectable } from 'tsyringe';
import { IEventPublisher } from '@amacc/shared-kernel';
import { PaymentNotFoundError, PaymentValidationError, VoidRefusedPaymentReconciledError } from './manual-payment-service';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface MarkClearedDTO {
  clearedAt?: Date;
}

export interface StopPaymentDTO {
  reason: string;
}

export interface ResolveStopPaymentDTO {
  status: 'ACKNOWLEDGED' | 'FAILED';
  bankAck: 'MANUAL' | 'PAYMENT_RAIL_NOT_CONFIGURED';
  bankAckNote?: string;
}

export interface ReissuePaymentDTO {
  bankAccountId: string;
  paymentDate?: Date;
}

export interface RecordDueDiligenceDTO {
  method: 'LETTER' | 'PHONE' | 'EMAIL' | 'OTHER';
  outcome: string;
  notes?: string;
}

export interface PostEscheatTransferDTO {
  jurisdiction: string;
}

// ── Errors ────────────────────────────────────────────────────────────────────
// PaymentNotFoundError, PaymentValidationError and
// VoidRefusedPaymentReconciledError are owned by manual-payment-service.ts
// (re-exported below) — a single definition avoids two different classes
// with the same conceptual identity across the AP payment lifecycle.
export { PaymentNotFoundError, PaymentValidationError, VoidRefusedPaymentReconciledError };

export class EscheatConfigNotFoundError extends Error {
  constructor(jurisdiction: string) {
    super(`No escheat jurisdiction timing configuration exists for '${jurisdiction}' (D-CE09-03) — the queue is informational only until Accounting configures this jurisdiction`);
    this.name = 'EscheatConfigNotFoundError';
  }
}

export class EscheatTransferAlreadyExistsError extends Error {
  constructor(paymentId: string) {
    super(`An escheat transfer already exists for payment ${paymentId}`);
    this.name = 'EscheatTransferAlreadyExistsError';
  }
}

/**
 * CE-09 S045 — Void/Stop/Reissue & Check Escheat. Extends
 * ManualPaymentService's existing void() with the D-CE09-01 clearedAt
 * guard (never allowing a void of a cleared/reconciled payment), adds
 * stop-payment request tracking, a reissue flow that never double-relieves
 * the AP open item (restore-then-relieve-once, by delegating the actual
 * relief to ManualPaymentService.create() — the same code path as any
 * other new payment), and the escheat lifecycle (stale-date aging queue →
 * due-diligence tracking → gated transfer posting).
 *
 * clearedAt/clearedBy are a PUTR integration boundary with recon-service
 * (S054A/S054B) — see markCleared()'s doc comment.
 */
@injectable()
export class PaymentLifecycleService {
  // @audit(CE-09): direct gl-service write — migrated to governed posting engine in a subsequent CE
  private glServiceUrl = process.env['GL_SERVICE_URL'] ?? 'http://gl-service:3010';

  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('IEventPublisher') private readonly eventPublisher: IEventPublisher,
    @inject('ManualPaymentService') private readonly manualPaymentService: import('./manual-payment-service').ManualPaymentService,
  ) {}

  private async getPaymentOrThrow(tenantId: string, id: string) {
    const payment = await this.prisma.apManualPayment.findFirst({ where: { id, tenantId } });
    if (!payment) throw new PaymentNotFoundError(id);
    return payment;
  }

  /**
   * Reissue — creates a brand-new ApManualPayment for the same invoice,
   * linked back to the voided original via reissueOfPaymentId. Requires the
   * original to already be VOID (i.e. its restore-then-relieve-once
   * invariant was already handled by ManualPaymentService.void(), which
   * restores the invoice to APPROVED exactly once); this method then calls
   * the ordinary ManualPaymentService.create() flow — the SAME code path
   * used for any first-time payment — so the invoice can only ever be
   * relieved once for the reissued check (no parallel relief logic is
   * invented here, eliminating any chance of double-relief).
   */
  async reissue(tenantId: string, originalPaymentId: string, dto: ReissuePaymentDTO, actor: string, serviceToken?: string, correlationId?: string) {
    const original = await this.getPaymentOrThrow(tenantId, originalPaymentId);
    if (original.status !== 'VOID') {
      throw new PaymentValidationError('ORIGINAL_NOT_VOID', 'The original payment must be voided before it can be reissued');
    }
    const existingReissue = await this.prisma.apManualPayment.findFirst({ where: { tenantId, reissueOfPaymentId: originalPaymentId } });
    if (existingReissue) throw new PaymentValidationError('ALREADY_REISSUED', `Payment ${originalPaymentId} has already been reissued as ${existingReissue.id}`);

    const created = await this.manualPaymentService.create(
      tenantId, { invoiceId: original.invoiceId, bankAccountId: dto.bankAccountId, paymentDate: dto.paymentDate },
      actor, serviceToken, correlationId,
    );
    const linked = await this.prisma.apManualPayment.update({ where: { id: created.id }, data: { reissueOfPaymentId: originalPaymentId } });
    await this._writeOutbox(tenantId, 'AP_MANUAL_PAYMENT_REISSUED', linked.id, { originalPaymentId, actor });
    return linked;
  }

  /**
   * PUTR integration boundary with recon-service (S054A/S054B): recon-
   * service is expected to set clearedAt/clearedBy when a check actually
   * clears the bank / is reconciled. Until that cross-service wiring
   * exists, this admin/test-only endpoint sets it directly — clearly
   * labeled here and at the route level, never used by a real bank-feed
   * adapter (none exists in this repo).
   */
  async markCleared(tenantId: string, id: string, dto: MarkClearedDTO, actor: string) {
    const payment = await this.getPaymentOrThrow(tenantId, id);
    if (payment.status === 'VOID') throw new PaymentValidationError('ALREADY_VOID', 'Cannot mark a voided payment as cleared');
    if (payment.clearedAt) throw new PaymentValidationError('ALREADY_CLEARED', 'Payment is already marked cleared');
    return this.prisma.apManualPayment.update({
      where: { id }, data: { clearedAt: dto.clearedAt ?? new Date(), clearedBy: actor },
    });
  }

  // ── Stop-payment ───────────────────────────────────────────────────────────

  async requestStopPayment(tenantId: string, paymentId: string, dto: StopPaymentDTO, actor: string, correlationId?: string) {
    await this.getPaymentOrThrow(tenantId, paymentId);
    if (!dto.reason?.trim()) throw new PaymentValidationError('REASON_REQUIRED', 'A reason is required to request a stop-payment');

    const request = await this.prisma.$transaction(async (tx: any) => {
      const created = await tx.apStopPaymentRequest.create({
        data: {
          tenantId, paymentId, reason: dto.reason, status: 'REQUESTED',
          // Truthful adapter state — no payment-rail integration exists in
          // this repo (S043B scope); never fabricate an automated ack.
          bankAck: 'PAYMENT_RAIL_NOT_CONFIGURED', requestedBy: actor,
        },
      });
      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'ApStopPaymentRequest', docId: created.id, action: 'CREATED', before: null, after: created, actor, correlationId: correlationId ?? null },
      });
      return created;
    });
    await this._writeOutbox(tenantId, 'AP_STOP_PAYMENT_REQUESTED', request.id, { paymentId, actor });
    return request;
  }

  async resolveStopPayment(tenantId: string, requestId: string, dto: ResolveStopPaymentDTO, actor: string, correlationId?: string) {
    const current = await this.prisma.apStopPaymentRequest.findFirst({ where: { id: requestId, tenantId } });
    if (!current) throw new PaymentValidationError('NOT_FOUND', `Stop-payment request not found: ${requestId}`);

    const updated = await this.prisma.$transaction(async (tx: any) => {
      const resolved = await tx.apStopPaymentRequest.update({
        where: { id: requestId },
        data: { status: dto.status, bankAck: dto.bankAck, bankAckNote: dto.bankAckNote ?? null, resolvedAt: new Date(), resolvedBy: actor },
      });
      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'ApStopPaymentRequest', docId: requestId, action: 'RESOLVED', before: current, after: resolved, actor, correlationId: correlationId ?? null },
      });
      return resolved;
    });
    return updated;
  }

  async listStopPaymentRequests(tenantId: string, paymentId?: string) {
    return this.prisma.apStopPaymentRequest.findMany({ where: { tenantId, ...(paymentId ? { paymentId } : {}) }, orderBy: { requestedAt: 'desc' } });
  }

  // ── Escheat ──────────────────────────────────────────────────────────────

  /**
   * D-CE09-03 — an empty/missing jurisdiction config means the queue entry
   * for that jurisdiction is informational only: no computed "days stale"
   * or due-date is returned, and downstream posting is impossible (gated
   * separately in postEscheatTransfer). Never auto-calculated/auto-posted.
   */
  async escheatQueue(tenantId: string) {
    const payments = await this.prisma.apManualPayment.findMany({
      where: { tenantId, status: 'POSTED', clearedAt: null },
      orderBy: { issueDate: 'asc' },
    });
    const configs = await this.prisma.apEscheatJurisdictionConfig.findMany({ where: { tenantId } });
    const configByJurisdiction = new Map(configs.map((c: any) => [c.jurisdiction, c]));

    // No jurisdiction is known on ApManualPayment itself (this AP-side
    // payment model has no jurisdiction field) — vendor-jurisdiction
    // resolution is out of this slice's scope. Each queue row is returned
    // with its configured-jurisdiction status left explicit (UNKNOWN)
    // rather than guessed, so the queue never silently invents an aging
    // computation for a payment whose jurisdiction isn't determinable.
    return payments.map((p: any) => {
      const issueDate: Date | null = p.issueDate ?? p.paymentDate ?? null;
      const daysOutstanding = issueDate ? Math.floor((Date.now() - new Date(issueDate).getTime()) / 86400000) : null;
      return {
        paymentId: p.id, checkNumber: p.checkNumber, amount: p.amount, issueDate,
        daysOutstanding,
        jurisdictionConfigured: false,
        staleDays: null,
        isStale: false,
      };
    });
  }

  async recordDueDiligence(tenantId: string, paymentId: string, dto: RecordDueDiligenceDTO, actor: string) {
    await this.getPaymentOrThrow(tenantId, paymentId);
    if (!dto.outcome?.trim()) throw new PaymentValidationError('OUTCOME_REQUIRED', 'An outcome is required for a due-diligence record');
    return this.prisma.apEscheatDueDiligenceRecord.create({
      data: { tenantId, paymentId, method: dto.method, outcome: dto.outcome, notes: dto.notes ?? null, performedBy: actor },
    });
  }

  async listDueDiligence(tenantId: string, paymentId: string) {
    return this.prisma.apEscheatDueDiligenceRecord.findMany({ where: { tenantId, paymentId }, orderBy: { attemptedAt: 'desc' } });
  }

  /**
   * D-CE09-03 gate: a jurisdiction config row MUST exist, and this must be
   * an explicit user action — never automatic from the aging queue.
   */
  async postEscheatTransfer(tenantId: string, paymentId: string, dto: PostEscheatTransferDTO, actor: string, serviceToken?: string, correlationId?: string) {
    const payment = await this.getPaymentOrThrow(tenantId, paymentId);
    if (payment.status !== 'POSTED') throw new PaymentValidationError('NOT_ELIGIBLE', `Payment must be POSTED (uncleared/outstanding) to escheat — current status is '${payment.status}'`);
    if (payment.clearedAt) throw new PaymentValidationError('NOT_ELIGIBLE', 'A cleared/reconciled payment cannot be escheated');

    const config = await this.prisma.apEscheatJurisdictionConfig.findFirst({ where: { tenantId, jurisdiction: dto.jurisdiction } });
    if (!config) throw new EscheatConfigNotFoundError(dto.jurisdiction);

    const existing = await this.prisma.apEscheatTransfer.findFirst({ where: { tenantId, paymentId } });
    if (existing) throw new EscheatTransferAlreadyExistsError(paymentId);

    let transfer: any;
    try {
      transfer = await this.prisma.$transaction(async (tx: any) => {
        const created = await tx.apEscheatTransfer.create({
          data: { tenantId, paymentId, jurisdiction: dto.jurisdiction, amount: payment.amount, status: 'PENDING', createdBy: actor },
        });
        await tx.apManualPayment.update({ where: { id: paymentId }, data: { status: 'ESCHEATED' } });
        await tx.auditOutboxEvent.create({
          data: { tenantId, docType: 'ApEscheatTransfer', docId: created.id, action: 'CREATED', before: null, after: created, actor, correlationId: correlationId ?? null },
        });
        return created;
      });
    } catch (err: any) {
      if (err?.code === 'P2002') throw new EscheatTransferAlreadyExistsError(paymentId);
      throw err;
    }

    const glEntryId = await this._postEscheatGl(tenantId, payment, transfer, actor, serviceToken);
    if (glEntryId) {
      await this.prisma.apEscheatTransfer.update({ where: { id: transfer.id }, data: { glEntryId, status: 'POSTED', postedBy: actor, postedAt: new Date() } });
      transfer = await this.prisma.apEscheatTransfer.findFirst({ where: { id: transfer.id } });
    }
    return transfer;
  }

  private async _postEscheatGl(tenantId: string, payment: any, transfer: any, actor: string, serviceToken?: string): Promise<string | null> {
    const glConfig = await this.prisma.apEscheatGlAccountConfig.findFirst({ where: { tenantId } });
    if (!glConfig?.outstandingChecksGlAccountId || !glConfig?.escheatPayableGlAccountId) {
      await this._recordGlFailure(tenantId, transfer.id, 'Escheat outstanding-checks/payable GL accounts are not configured for this tenant (ACCOUNT_MAPPING_VALUES_PENDING)');
      return null;
    }
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
      if (serviceToken) headers['authorization'] = `Bearer ${serviceToken}`;
      const amount = Number(transfer.amount);
      const jeResp = await fetch(`${this.glServiceUrl}/api/v1/gl/journal-entries`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          entryDate: new Date().toISOString(),
          description: `Escheat transfer — check #${payment.checkNumber} (${transfer.jurisdiction})`,
          source: 'AP',
          sourceRef: String(payment.checkNumber).slice(0, 8),
          lines: [
            { glAccountId: glConfig.outstandingChecksGlAccountId, debit: amount, credit: 0, memo: `Escheat transfer — check #${payment.checkNumber}` },
            { glAccountId: glConfig.escheatPayableGlAccountId, debit: 0, credit: amount, memo: `Escheat payable — ${transfer.jurisdiction}` },
          ],
        }),
      });
      if (!jeResp.ok) {
        const errText = await jeResp.text().catch(() => '');
        await this._recordGlFailure(tenantId, transfer.id, `gl-service create failed: HTTP ${jeResp.status} ${errText}`);
        return null;
      }
      const je = await jeResp.json() as { id: string };
      await fetch(`${this.glServiceUrl}/api/v1/gl/journal-entries/${je.id}/post`, { method: 'POST', headers }).catch(() => null);
      return je.id;
    } catch (err: any) {
      await this._recordGlFailure(tenantId, transfer.id, err?.message ?? 'Unknown error');
      return null;
    }
  }

  private async _recordGlFailure(tenantId: string, transferId: string, message: string) {
    try {
      await this.prisma.apEscheatTransfer.update({ where: { id: transferId }, data: { glPostingError: message } });
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
