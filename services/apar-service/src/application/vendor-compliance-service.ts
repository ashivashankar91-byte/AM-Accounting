import { inject, injectable } from 'tsyringe';
import { IEventPublisher } from '@amacc/shared-kernel';
import { ComplianceVerificationAdapter } from './compliance-adapter';

// ── Constants ────────────────────────────────────────────────────────────────

/** Labels only — no regulatory logic is keyed off any of these anywhere in
 * the application layer. */
export const COMPLIANCE_CHECK_TYPE_VALUES = [
  'TAX_ID_VERIFICATION', 'INSURANCE_CERTIFICATE', 'W9_VERIFICATION', 'GENERAL_COMPLIANCE_DOCUMENT', 'OTHER',
] as const;

/** VERIFIED/REJECTED/EXPIRED are reachable only via review(); NOT_CONFIGURED/
 * VERIFICATION_UNAVAILABLE only via runVerification(); PENDING_REVIEW is the
 * initial state on create(). */
export const COMPLIANCE_CHECK_STATUS_VALUES = [
  'NOT_CONFIGURED', 'PENDING_REVIEW', 'VERIFICATION_UNAVAILABLE', 'VERIFIED', 'REJECTED', 'EXPIRED',
] as const;

const REVIEW_DECISION_VALUES = ['VERIFIED', 'REJECTED', 'EXPIRED'] as const;
export type ReviewDecision = typeof REVIEW_DECISION_VALUES[number];

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateComplianceCheckDTO {
  vendorId: string;
  checkType: string;
  jurisdiction?: string;
  country?: string;
  externalReference?: string;
  notes?: string;
  expirationDate?: Date;
}

export interface UpdateComplianceCheckDTO {
  version: number;
  jurisdiction?: string;
  country?: string;
  externalReference?: string;
  notes?: string;
  expirationDate?: Date | null;
}

export interface ReviewComplianceCheckDTO {
  version: number;
  decision: ReviewDecision;
  /** Required for REJECTED; optional for VERIFIED/EXPIRED. */
  reason?: string;
}

export interface ComplianceCheckListQuery {
  tenantId: string;
  vendorId: string;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class ComplianceCheckNotFoundError extends Error {
  constructor(id: string) {
    super(`Compliance check not found: ${id}`);
    this.name = 'ComplianceCheckNotFoundError';
  }
}

export class ComplianceCheckValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ComplianceCheckValidationError';
  }
}

export class ComplianceCheckConflictError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ComplianceCheckConflictError';
  }
}

export class VendorNotFoundForComplianceError extends Error {
  constructor(vendorId: string) {
    super(`Vendor not found: ${vendorId}`);
    this.name = 'VendorNotFoundForComplianceError';
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

@injectable()
export class VendorComplianceService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('IEventPublisher') private readonly eventPublisher: IEventPublisher,
    @inject('ComplianceVerificationAdapter') private readonly adapter: ComplianceVerificationAdapter,
  ) {}

  async list(query: ComplianceCheckListQuery) {
    const { tenantId, vendorId } = query;
    await this._requireVendor(tenantId, vendorId);
    return this.prisma.vendorComplianceCheck.findMany({
      where: { tenantId, vendorId },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async getById(tenantId: string, vendorId: string, id: string) {
    const check = await this.prisma.vendorComplianceCheck.findFirst({ where: { id, tenantId, vendorId } });
    if (!check) throw new ComplianceCheckNotFoundError(id);
    return check;
  }

  async create(tenantId: string, dto: CreateComplianceCheckDTO, actor = 'system', correlationId?: string) {
    await this._requireVendor(tenantId, dto.vendorId);

    if (!(COMPLIANCE_CHECK_TYPE_VALUES as readonly string[]).includes(dto.checkType)) {
      throw new ComplianceCheckValidationError('VALIDATION_ERROR', `Unsupported check type: ${dto.checkType}`);
    }

    const check = await this.prisma.$transaction(async (tx: any) => {
      const c = await tx.vendorComplianceCheck.create({
        data: {
          tenantId,
          vendorId: dto.vendorId,
          checkType: dto.checkType,
          status: 'PENDING_REVIEW',
          jurisdiction: dto.jurisdiction ?? null,
          country: dto.country ?? null,
          externalReference: dto.externalReference ?? null,
          notes: dto.notes ?? null,
          expirationDate: dto.expirationDate ?? null,
          version: 1,
        },
      });
      await this._audit(tenantId, dto.vendorId, 'COMPLIANCE_CHECK_CREATED', null, c, actor, tx, correlationId);
      return c;
    });

    await this._writeOutbox(tenantId, 'VENDOR_COMPLIANCE_CHECK_CREATED', check.id, { vendorId: dto.vendorId, checkType: dto.checkType });
    return check;
  }

  async update(tenantId: string, vendorId: string, id: string, dto: UpdateComplianceCheckDTO, actor = 'system', correlationId?: string) {
    const current = await this.getById(tenantId, vendorId, id);
    if (current.version !== dto.version) {
      throw new ComplianceCheckConflictError('VERSION_CONFLICT', `Version conflict: expected ${dto.version}, current is ${current.version}`);
    }
    if (['VERIFIED', 'REJECTED'].includes(current.status)) {
      throw new ComplianceCheckValidationError('CHECK_ALREADY_REVIEWED', 'Cannot edit a check that has already been reviewed — its record is final');
    }

    const data: any = { version: current.version + 1 };
    if (dto.jurisdiction !== undefined) data.jurisdiction = dto.jurisdiction;
    if (dto.country !== undefined) data.country = dto.country;
    if (dto.externalReference !== undefined) data.externalReference = dto.externalReference;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.expirationDate !== undefined) data.expirationDate = dto.expirationDate;

    const check = await this.prisma.$transaction(async (tx: any) => {
      const c = await tx.vendorComplianceCheck.update({ where: { id }, data });
      await this._audit(tenantId, vendorId, 'COMPLIANCE_CHECK_UPDATED', current, c, actor, tx, correlationId);
      return c;
    });

    await this._writeOutbox(tenantId, 'VENDOR_COMPLIANCE_CHECK_UPDATED', id, { changes: Object.keys(data).filter(k => k !== 'version') });
    return check;
  }

  /** Invokes the configured ComplianceVerificationAdapter (ManualComplianceAdapter
   * by default). Can only ever move status to NOT_CONFIGURED or
   * VERIFICATION_UNAVAILABLE — never VERIFIED (see compliance-adapter.ts). */
  async runVerification(tenantId: string, vendorId: string, id: string, actor = 'system', correlationId?: string) {
    const current = await this.getById(tenantId, vendorId, id);
    if (['VERIFIED', 'REJECTED'].includes(current.status)) {
      throw new ComplianceCheckValidationError('CHECK_ALREADY_REVIEWED', 'Cannot run verification on a check that has already been reviewed');
    }

    const result = await this.adapter.verify({
      tenantId, vendorId, checkType: current.checkType, externalReference: current.externalReference,
    });

    const check = await this.prisma.$transaction(async (tx: any) => {
      const c = await tx.vendorComplianceCheck.update({
        where: { id },
        data: {
          status: result.status,
          providerName: result.providerName,
          resultMessage: result.message,
          lastCheckedAt: new Date(),
          version: current.version + 1,
        },
      });
      await this._audit(tenantId, vendorId, 'COMPLIANCE_CHECK_VERIFICATION_RUN', current, c, actor, tx, correlationId);
      return c;
    });

    await this._writeOutbox(tenantId, 'VENDOR_COMPLIANCE_CHECK_VERIFICATION_RUN', id, { status: result.status, providerName: result.providerName });
    return check;
  }

  /** Human-in-the-loop attestation. This is the ONLY path that can set
   * VERIFIED/REJECTED/EXPIRED — no automated adapter result ever does. */
  async review(tenantId: string, vendorId: string, id: string, dto: ReviewComplianceCheckDTO, actor = 'system', correlationId?: string) {
    const current = await this.getById(tenantId, vendorId, id);
    if (current.version !== dto.version) {
      throw new ComplianceCheckConflictError('VERSION_CONFLICT', `Version conflict: expected ${dto.version}, current is ${current.version}`);
    }
    if (!(REVIEW_DECISION_VALUES as readonly string[]).includes(dto.decision)) {
      throw new ComplianceCheckValidationError('VALIDATION_ERROR', `Unsupported review decision: ${dto.decision}`);
    }
    if (dto.decision === 'REJECTED' && !dto.reason?.trim()) {
      throw new ComplianceCheckValidationError('REASON_REQUIRED', 'A reason is required to reject a compliance check');
    }
    if (['VERIFIED', 'REJECTED'].includes(current.status)) {
      throw new ComplianceCheckValidationError('CHECK_ALREADY_REVIEWED', 'This check has already been reviewed');
    }

    const check = await this.prisma.$transaction(async (tx: any) => {
      const c = await tx.vendorComplianceCheck.update({
        where: { id },
        data: {
          status: dto.decision,
          reviewedAt: new Date(),
          reviewedBy: actor,
          reviewNote: dto.reason ?? null,
          version: current.version + 1,
        },
      });
      await this._audit(tenantId, vendorId, 'COMPLIANCE_CHECK_REVIEWED', current, c, actor, tx, correlationId);
      return c;
    });

    await this._writeOutbox(tenantId, 'VENDOR_COMPLIANCE_CHECK_REVIEWED', id, { decision: dto.decision, actor });
    return check;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async _requireVendor(tenantId: string, vendorId: string) {
    const vendor = await this.prisma.vendor.findFirst({ where: { id: vendorId, tenantId, status: { not: 'DELETED' } } });
    if (!vendor) throw new VendorNotFoundForComplianceError(vendorId);
    return vendor;
  }

  /** Same docType('Vendor')/docId(vendorId) as VendorService's own audit
   * writes, so compliance events surface in the existing vendor audit-history
   * trail/endpoint rather than needing a second one. */
  private async _audit(
    tenantId: string, vendorId: string, action: string,
    before: unknown, after: unknown, actor: string,
    tx: any = this.prisma,
    correlationId?: string,
  ): Promise<void> {
    await tx.auditOutboxEvent.create({
      data: {
        tenantId, docType: 'Vendor', docId: vendorId, action,
        before: (before ?? undefined) as any, after: (after ?? undefined) as any,
        actor: actor ?? 'system',
        correlationId: correlationId ?? null,
      },
    });
  }

  private async _writeOutbox(tenantId: string, eventType: string, aggregateId: string, payload: Record<string, unknown>) {
    try {
      await this.prisma.outboxEvent.create({
        data: { tenantId, eventType, payload: { aggregateId, ...payload } },
      });
    } catch {
      // Non-fatal: log but don't fail the business operation
    }
  }
}
