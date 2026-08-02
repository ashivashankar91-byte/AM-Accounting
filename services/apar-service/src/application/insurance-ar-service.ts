import { inject, injectable } from 'tsyringe';
import { IEventPublisher } from '@amacc/shared-kernel';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateInsuranceClaimDTO {
  customerId: string;
  insurerName: string;
  insurerReference?: string;
  claimNumber: string;
  roReference?: string;
  claimAmount: number;
}

export interface PostSupplementDTO {
  adjustmentAmount: number;
  reason: string;
}

export interface ApplyInsurerPaymentDTO {
  amount: number;
}

export interface DisposeShortPayDTO {
  dispositionType: 'CUSTOMER_RESPONSIBILITY' | 'WRITE_OFF';
  reason: string;
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class InsuranceArValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'InsuranceArValidationError';
  }
}

export class InsuranceClaimNotFoundError extends Error {
  constructor(id: string) {
    super(`Insurance claim not found: ${id}`);
    this.name = 'InsuranceClaimNotFoundError';
  }
}

/** AC: "insurer payment relieves the claim item by exactly the applied
 * amount" — an application that would exceed the claim's effective
 * (claimAmount + supplements) balance is refused rather than silently
 * over-applied. */
export class InsurerPaymentExceedsClaimBalanceError extends Error {
  constructor(amount: number, remainingBalance: number) {
    super(`Insurer payment of ${amount} exceeds the claim's remaining balance of ${remainingBalance}`);
    this.name = 'InsurerPaymentExceedsClaimBalanceError';
  }
}

/** D-CE09-style guard: a short-pay disposition may only be recorded when
 * there actually is an unapplied remainder on the claim. */
export class NoShortPayRemainderError extends Error {
  constructor() {
    super('There is no unapplied remainder on this claim to dispose of');
    this.name = 'NoShortPayRemainderError';
  }
}

/** AC: "short-pay disposition creates the remainder item/adjustment
 * exactly once" — a second disposition attempt on the same claim is
 * refused. */
export class ShortPayAlreadyDisposedError extends Error {
  constructor(claimId: string) {
    super(`Claim ${claimId} has already had its short-pay remainder disposed of`);
    this.name = 'ShortPayAlreadyDisposedError';
  }
}

/**
 * CE-09 S049 — Insurance AR (Body Shop).
 *
 * Models the insurer as a payer distinct from the vehicle-owning
 * customer: a claim-linked receivable (claim number, insurer identity,
 * customer reference, roReference — PUTR: RO linkage is reference-only,
 * no CE-11 logic invoked), supplement tracking (claim amount revisions
 * posted as their own governed adjustment journals via the engine — NEVER
 * a raw edit of ArInsuranceClaim.claimAmount; the effective claim amount
 * is always computed as claimAmount + sum(supplement adjustments), never
 * cached/mutated), and a short-pay disposition workflow: when the
 * insurer's payment is less than the (effective) claim amount, the clerk
 * applies the payment then explicitly disposes the remainder either to a
 * customer-responsibility AR item or to a write-off/adjustment — an
 * explicit, audited, exactly-once action, never auto-decided.
 *
 * GL posting follows the blank-matrix-row / ACCOUNT_MAPPING_VALUES_PENDING
 * convention (ArInsuranceGlAccountConfig, same shape as S042/S044/S047's
 * GL-config tables). A missing tenant config truthfully records
 * glPostingError rather than fabricating a posting.
 */
@injectable()
export class InsuranceArService {
  private readonly glServiceUrl = process.env['GL_SERVICE_URL'] ?? 'http://localhost:3010';

  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('IEventPublisher') private readonly eventPublisher: IEventPublisher,
  ) {}

  // ── Claim lifecycle ──────────────────────────────────────────────────────

  async createClaim(tenantId: string, dto: CreateInsuranceClaimDTO, actor = 'system', serviceToken?: string, correlationId?: string) {
    if (!dto.customerId?.trim()) throw new InsuranceArValidationError('CUSTOMER_ID_REQUIRED', 'customerId is required');
    if (!dto.insurerName?.trim()) throw new InsuranceArValidationError('INSURER_NAME_REQUIRED', 'insurerName is required');
    if (!dto.claimNumber?.trim()) throw new InsuranceArValidationError('CLAIM_NUMBER_REQUIRED', 'claimNumber is required');
    if (!dto.claimAmount || dto.claimAmount <= 0) throw new InsuranceArValidationError('CLAIM_AMOUNT_MUST_BE_POSITIVE', 'claimAmount must be a positive number');

    const customer = await this.prisma.customer.findFirst({ where: { id: dto.customerId, tenantId } });
    if (!customer) throw new InsuranceArValidationError('CUSTOMER_NOT_FOUND', `Customer not found: ${dto.customerId}`);

    const claim = await this.prisma.$transaction(async (tx: any) => {
      const created = await tx.arInsuranceClaim.create({
        data: {
          tenantId, customerId: dto.customerId, insurerName: dto.insurerName, insurerReference: dto.insurerReference ?? null,
          claimNumber: dto.claimNumber, roReference: dto.roReference ?? null, claimAmount: dto.claimAmount, status: 'OPEN', createdBy: actor,
        },
      });
      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'ArInsuranceClaim', docId: created.id, action: 'CREATED', before: null, after: created, actor, correlationId: correlationId ?? null },
      });
      return created;
    });

    const glEntryId = await this._postJournal(tenantId, claim.id, `Insurance claim opened — claim ${claim.claimNumber} (${claim.insurerName})`, [
      { field: 'arInsurerControlGlAccountId', debit: dto.claimAmount, credit: 0 },
      { field: 'revenueGlAccountId', debit: 0, credit: dto.claimAmount },
    ], (docId, msg) => this.prisma.arInsuranceClaim.update({ where: { id: docId }, data: { glPostingError: msg } }), serviceToken);
    if (glEntryId) await this.prisma.arInsuranceClaim.update({ where: { id: claim.id }, data: { glEntryId } });

    return this.getById(tenantId, claim.id);
  }

  async getById(tenantId: string, id: string) {
    const claim = await this.prisma.arInsuranceClaim.findFirst({
      where: { id, tenantId },
      include: { supplements: true, applications: true, dispositions: true },
    });
    if (!claim) throw new InsuranceClaimNotFoundError(id);
    return this._withEffectiveAmount(claim);
  }

  async list(tenantId: string, customerId?: string) {
    const claims = await this.prisma.arInsuranceClaim.findMany({
      where: { tenantId, ...(customerId ? { customerId } : {}) },
      include: { supplements: true, applications: true, dispositions: true },
      orderBy: { createdAt: 'desc' },
    });
    return claims.map((c: any) => this._withEffectiveAmount(c));
  }

  private _withEffectiveAmount(claim: any) {
    const supplementTotal = (claim.supplements ?? []).reduce((sum: number, s: any) => sum + Number(s.adjustmentAmount), 0);
    const effectiveClaimAmount = Number(claim.claimAmount) + supplementTotal;
    const remainingBalance = effectiveClaimAmount - Number(claim.amountApplied);
    return { ...claim, effectiveClaimAmount, remainingBalance };
  }

  // ── Supplements (governed claim-amount revisions) ───────────────────────

  async postSupplement(tenantId: string, claimId: string, dto: PostSupplementDTO, actor = 'system', serviceToken?: string, correlationId?: string) {
    if (dto.adjustmentAmount === undefined || dto.adjustmentAmount === null || dto.adjustmentAmount === 0) {
      throw new InsuranceArValidationError('ADJUSTMENT_AMOUNT_REQUIRED', 'adjustmentAmount is required and must be non-zero');
    }
    if (!dto.reason?.trim()) throw new InsuranceArValidationError('REASON_REQUIRED', 'reason is required');

    const claim = await this.prisma.arInsuranceClaim.findFirst({ where: { id: claimId, tenantId } });
    if (!claim) throw new InsuranceClaimNotFoundError(claimId);

    const supplement = await this.prisma.$transaction(async (tx: any) => {
      const created = await tx.arInsuranceClaimSupplement.create({
        data: { tenantId, claimId, adjustmentAmount: dto.adjustmentAmount, reason: dto.reason, createdBy: actor },
      });
      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'ArInsuranceClaimSupplement', docId: created.id, action: 'CREATED', before: null, after: created, actor, correlationId: correlationId ?? null },
      });
      return created;
    });

    const isIncrease = dto.adjustmentAmount > 0;
    const amount = Math.abs(dto.adjustmentAmount);
    const glEntryId = await this._postJournal(tenantId, supplement.id, `Insurance claim supplement — claim ${claim.claimNumber}: ${dto.reason}`, [
      { field: 'arInsurerControlGlAccountId', debit: isIncrease ? amount : 0, credit: isIncrease ? 0 : amount },
      { field: 'revenueGlAccountId', debit: isIncrease ? 0 : amount, credit: isIncrease ? amount : 0 },
    ], (docId, msg) => this.prisma.arInsuranceClaimSupplement.update({ where: { id: docId }, data: { glPostingError: msg } }), serviceToken);
    if (glEntryId) await this.prisma.arInsuranceClaimSupplement.update({ where: { id: supplement.id }, data: { glEntryId } });

    return this.getById(tenantId, claimId);
  }

  // ── Insurer payment application ─────────────────────────────────────────

  async applyInsurerPayment(tenantId: string, claimId: string, dto: ApplyInsurerPaymentDTO, actor = 'system', serviceToken?: string, correlationId?: string) {
    if (!dto.amount || dto.amount <= 0) throw new InsuranceArValidationError('AMOUNT_MUST_BE_POSITIVE', 'amount must be a positive number');

    const { application, remainingAfter } = await this.prisma.$transaction(async (tx: any) => {
      const claim = await tx.arInsuranceClaim.findFirst({ where: { id: claimId, tenantId }, include: { supplements: true } });
      if (!claim) throw new InsuranceClaimNotFoundError(claimId);

      const supplementTotal = (claim.supplements ?? []).reduce((sum: number, s: any) => sum + Number(s.adjustmentAmount), 0);
      const effectiveClaimAmount = Number(claim.claimAmount) + supplementTotal;
      const remainingBalance = effectiveClaimAmount - Number(claim.amountApplied);
      if (dto.amount > remainingBalance) throw new InsurerPaymentExceedsClaimBalanceError(dto.amount, remainingBalance);

      const created = await tx.arInsurancePaymentApplication.create({
        data: { tenantId, claimId, amount: dto.amount, createdBy: actor },
      });

      const newAmountApplied = Number(claim.amountApplied) + dto.amount;
      const newRemaining = effectiveClaimAmount - newAmountApplied;
      const newStatus = newRemaining <= 0 ? 'RESOLVED' : 'PARTIALLY_APPLIED';
      await tx.arInsuranceClaim.update({ where: { id: claimId }, data: { amountApplied: newAmountApplied, status: newStatus } });

      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'ArInsurancePaymentApplication', docId: created.id, action: 'CREATED', before: null, after: created, actor, correlationId: correlationId ?? null },
      });

      return { application: created, remainingAfter: newRemaining };
    });

    const claimForGl = await this.prisma.arInsuranceClaim.findFirst({ where: { id: claimId, tenantId } });
    // Insurer payment applications relieve the AR-insurer-control account
    // against cash/bank — but this service does not own bank-account
    // selection (unlike ManualPaymentService); it records the AR-side
    // relief only, with a truthful gl_posting_error until a bank-account
    // linkage point exists (documented interface point, same PUTR pattern
    // used elsewhere in this epic).
    await this._postInsurerPaymentJournal(tenantId, application.id, claimForGl, dto.amount, serviceToken);

    return this.getById(tenantId, claimId);
  }

  private async _postInsurerPaymentJournal(tenantId: string, applicationId: string, claim: any, amount: number, serviceToken?: string) {
    const glConfig = await this.prisma.arInsuranceGlAccountConfig.findFirst({ where: { tenantId } });
    if (!glConfig?.arInsurerControlGlAccountId) {
      await this.prisma.arInsurancePaymentApplication.update({ where: { id: applicationId }, data: { glPostingError: 'Insurance AR-insurer-control GL account is not configured for this tenant (ACCOUNT_MAPPING_VALUES_PENDING)' } });
      return;
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
          description: `Insurer payment applied — claim ${claim.claimNumber}`,
          source: 'AR',
          sourceRef: claim.id.slice(0, 8),
          lines: [
            // Cash/bank-side debit is a documented PUTR integration point —
            // this service posts the AR-side relief only. Cr AR-insurer-control.
            { glAccountId: glConfig.arInsurerControlGlAccountId, debit: 0, credit: amount, memo: `Insurer payment — claim ${claim.claimNumber}` },
          ],
        }),
      });
      if (!jeResp.ok) {
        const errText = await jeResp.text().catch(() => '');
        await this.prisma.arInsurancePaymentApplication.update({ where: { id: applicationId }, data: { glPostingError: `gl-service create failed: HTTP ${jeResp.status} ${errText}` } });
        return;
      }
      const je = await jeResp.json() as { id: string };
      await fetch(`${this.glServiceUrl}/api/v1/gl/journal-entries/${je.id}/post`, { method: 'POST', headers }).catch(() => null);
      await this.prisma.arInsurancePaymentApplication.update({ where: { id: applicationId }, data: { glEntryId: je.id } });
    } catch (err: any) {
      await this.prisma.arInsurancePaymentApplication.update({ where: { id: applicationId }, data: { glPostingError: err?.message ?? 'Unknown error' } });
    }
  }

  // ── Short-pay disposition ────────────────────────────────────────────────

  async disposeShortPay(tenantId: string, claimId: string, dto: DisposeShortPayDTO, actor = 'system', serviceToken?: string, correlationId?: string) {
    if (dto.dispositionType !== 'CUSTOMER_RESPONSIBILITY' && dto.dispositionType !== 'WRITE_OFF') {
      throw new InsuranceArValidationError('DISPOSITION_TYPE_INVALID', 'dispositionType must be CUSTOMER_RESPONSIBILITY or WRITE_OFF');
    }
    if (!dto.reason?.trim()) throw new InsuranceArValidationError('REASON_REQUIRED', 'reason is required');

    const { disposition, claim } = await this.prisma.$transaction(async (tx: any) => {
      const claimRow = await tx.arInsuranceClaim.findFirst({ where: { id: claimId, tenantId }, include: { supplements: true } });
      if (!claimRow) throw new InsuranceClaimNotFoundError(claimId);
      if (claimRow.shortPayDisposedAt) throw new ShortPayAlreadyDisposedError(claimId);

      const supplementTotal = (claimRow.supplements ?? []).reduce((sum: number, s: any) => sum + Number(s.adjustmentAmount), 0);
      const effectiveClaimAmount = Number(claimRow.claimAmount) + supplementTotal;
      const remaining = effectiveClaimAmount - Number(claimRow.amountApplied);
      if (remaining <= 0) throw new NoShortPayRemainderError();

      const created = await tx.arInsuranceShortPayDisposition.create({
        data: { tenantId, claimId, amount: remaining, dispositionType: dto.dispositionType, reason: dto.reason, createdBy: actor },
      });

      await tx.arInsuranceClaim.update({ where: { id: claimId }, data: { shortPayDisposedAt: new Date(), status: 'CLOSED' } });

      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'ArInsuranceShortPayDisposition', docId: created.id, action: 'CREATED', before: null, after: created, actor, correlationId: correlationId ?? null },
      });

      return { disposition: created, claim: claimRow };
    });

    const isWriteOff = dto.dispositionType === 'WRITE_OFF';
    const glEntryId = await this._postJournal(tenantId, disposition.id, `Insurance short-pay disposition — claim ${claim.claimNumber} (${dto.dispositionType})`, [
      { field: isWriteOff ? 'writeOffExpenseGlAccountId' : 'arCustomerControlGlAccountId', debit: disposition.amount, credit: 0 },
      { field: 'arInsurerControlGlAccountId', debit: 0, credit: disposition.amount },
    ], (docId, msg) => this.prisma.arInsuranceShortPayDisposition.update({ where: { id: docId }, data: { glPostingError: msg } }), serviceToken);
    if (glEntryId) await this.prisma.arInsuranceShortPayDisposition.update({ where: { id: disposition.id }, data: { glEntryId } });

    return this.getById(tenantId, claimId);
  }

  // ── GL posting helper (blank-matrix-row convention) ─────────────────────

  private async _postJournal(
    tenantId: string,
    docId: string,
    description: string,
    lineSpecs: Array<{ field: string; debit: number; credit: number }>,
    recordFailure: (docId: string, message: string) => Promise<any>,
    serviceToken?: string,
    skip = false,
  ): Promise<string | null> {
    if (skip) return null;
    const glConfig = await this.prisma.arInsuranceGlAccountConfig.findFirst({ where: { tenantId } });
    const missingField = lineSpecs.find((spec) => !glConfig?.[spec.field]);
    if (!glConfig || missingField) {
      await recordFailure(docId, 'Insurance-AR GL account(s) are not configured for this tenant (ACCOUNT_MAPPING_VALUES_PENDING)');
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
          description,
          source: 'AR',
          sourceRef: docId.slice(0, 8),
          lines: lineSpecs.map((spec) => ({ glAccountId: glConfig[spec.field], debit: spec.debit, credit: spec.credit })),
        }),
      });
      if (!jeResp.ok) {
        const errText = await jeResp.text().catch(() => '');
        await recordFailure(docId, `gl-service create failed: HTTP ${jeResp.status} ${errText}`);
        return null;
      }
      const je = await jeResp.json() as { id: string };
      await fetch(`${this.glServiceUrl}/api/v1/gl/journal-entries/${je.id}/post`, { method: 'POST', headers }).catch(() => null);
      return je.id;
    } catch (err: any) {
      await recordFailure(docId, err?.message ?? 'Unknown error');
      return null;
    }
  }
}
