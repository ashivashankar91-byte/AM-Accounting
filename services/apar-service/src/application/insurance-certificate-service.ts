import { inject, injectable } from 'tsyringe';
import { IEventPublisher, setTenantContextOnConnection } from '@amacc/shared-kernel';

/**
 * AMACC-CH04 S038 — Vendor Insurance Certificate Management.
 *
 * Owns certificate records, lifecycle (create → renew/supersede → revoke),
 * expiration status and the user-facing workflow. Reuses S036A's Vendor
 * table for identity/ownership (see VendorNotFoundForCertificateError below
 * — every write re-checks the parent vendor belongs to the caller's tenant).
 *
 * S036B BOUNDARY: this service has no concept of "verified"/"compliance
 * status" — that belongs to S036B's external compliance-verification
 * adapters. getVendorInsuranceSummary() is the intended integration point: it
 * exposes only the raw certificate facts (provider, dates, computed
 * expiration) for a future S036B adapter to read/display. Do not add
 * verification fields or external-check calls here.
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** PO-equivalent initial categorization values — a plain label, not a
 * jurisdiction/regulatory requirement declaration. */
export const INSURANCE_TYPE_VALUES = [
  'GENERAL_LIABILITY', 'AUTO_LIABILITY', 'WORKERS_COMP', 'UMBRELLA', 'PROPERTY', 'OTHER',
] as const;

export type ExpirationStatus = 'CURRENT' | 'EXPIRING_SOON' | 'EXPIRED';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface CertificateFieldsDTO {
  certificateNumber: string;
  insuranceProvider: string;
  insuranceType: string;
  effectiveDate: Date;
  expirationDate: Date;
  coverageAmount?: number;
  coverageDescription?: string;
  documentId?: string;
  documentFileName?: string;
  documentMimeType?: string;
  notes?: string;
}

export interface CreateCertificateDTO extends CertificateFieldsDTO {
  tenantId: string;
  vendorId: string;
}

/** Only non-defining fields are editable in place — the record that defines
 * the historical coverage period (dates/provider/type/number) is immutable
 * once created; use renew() to replace it. */
export interface UpdateCertificateDTO {
  version: number;
  coverageAmount?: number;
  coverageDescription?: string;
  documentId?: string;
  documentFileName?: string;
  documentMimeType?: string;
  notes?: string;
}

export interface RenewCertificateDTO {
  /** Version of the certificate being renewed/replaced. */
  version: number;
  certificateNumber: string;
  insuranceProvider: string;
  effectiveDate: Date;
  expirationDate: Date;
  coverageAmount?: number;
  coverageDescription?: string;
  documentId?: string;
  documentFileName?: string;
  documentMimeType?: string;
  notes?: string;
}

export interface RevokeCertificateDTO {
  version: number;
  reason: string;
}

export interface CertificateListQuery {
  tenantId: string;
  vendorId?: string;
  status?: string;
  insuranceType?: string;
  /** current = only is_current rows (default); all = includes superseded/revoked history. */
  scope?: 'current' | 'all';
  /** expired = expirationDate in the past; expiring = within `withinDays`; undefined = no expiration filter. */
  expirationFilter?: 'expired' | 'expiring';
  /** Required when expirationFilter === 'expiring' — S038 does not invent a
   * default warning-period; the caller (UI or future config) must supply it. */
  withinDays?: number;
  page?: number;
  pageSize?: number;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class InsuranceCertificateNotFoundError extends Error {
  constructor(id: string) {
    super(`Insurance certificate not found: ${id}`);
    this.name = 'InsuranceCertificateNotFoundError';
  }
}

export class VendorNotFoundForCertificateError extends Error {
  constructor(vendorId: string) {
    super(`Vendor not found: ${vendorId}`);
    this.name = 'VendorNotFoundForCertificateError';
  }
}

export class InsuranceCertificateConflictError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'InsuranceCertificateConflictError';
  }
}

export class InsuranceCertificateValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'InsuranceCertificateValidationError';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Deterministic, computed at read-time only — never stored. */
export function computeExpirationStatus(expirationDate: Date, now: Date, withinDays?: number): ExpirationStatus {
  if (expirationDate.getTime() < now.getTime()) return 'EXPIRED';
  if (withinDays !== undefined) {
    const horizon = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);
    if (expirationDate.getTime() <= horizon.getTime()) return 'EXPIRING_SOON';
  }
  return 'CURRENT';
}

export function withExpirationStatus<T extends { expirationDate: Date }>(
  cert: T, now: Date = new Date(), withinDays?: number,
): T & { expirationStatus: ExpirationStatus } {
  return { ...cert, expirationStatus: computeExpirationStatus(new Date(cert.expirationDate), now, withinDays) };
}

function validateDates(effectiveDate: Date, expirationDate: Date) {
  if (Number.isNaN(effectiveDate.getTime()) || Number.isNaN(expirationDate.getTime())) {
    throw new InsuranceCertificateValidationError('VALIDATION_ERROR', 'effectiveDate and expirationDate must be valid dates');
  }
  if (expirationDate.getTime() <= effectiveDate.getTime()) {
    throw new InsuranceCertificateValidationError('INVALID_DATE_RANGE', 'expirationDate must be after effectiveDate');
  }
}

function validateInsuranceType(insuranceType: string) {
  if (!(INSURANCE_TYPE_VALUES as readonly string[]).includes(insuranceType)) {
    throw new InsuranceCertificateValidationError('VALIDATION_ERROR', `Unsupported insurance type: ${insuranceType}`);
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

@injectable()
export class InsuranceCertificateService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('IEventPublisher') private readonly eventPublisher: IEventPublisher,
  ) {}

  /** Re-checked on every write — prevents attaching a certificate to another
   * tenant's vendor even if the caller guesses/forges a vendorId (RLS is the
   * database-level backstop; this is the application-level check). */
  private async _assertVendorOwnership(tx: any, tenantId: string, vendorId: string) {
    const vendor = await tx.vendor.findFirst({ where: { id: vendorId, tenantId, status: { not: 'DELETED' } } });
    if (!vendor) throw new VendorNotFoundForCertificateError(vendorId);
    return vendor;
  }

  async list(query: CertificateListQuery) {
    const { tenantId, vendorId, status, insuranceType, scope = 'current', expirationFilter, withinDays, page = 1, pageSize = 50 } = query;

    if (expirationFilter === 'expiring' && withinDays === undefined) {
      throw new InsuranceCertificateValidationError('WITHIN_DAYS_REQUIRED', 'withinDays is required when expirationFilter=expiring');
    }

    const where: any = { tenantId };
    if (vendorId) where.vendorId = vendorId;
    if (status) where.status = status;
    if (insuranceType) where.insuranceType = insuranceType;
    if (scope === 'current') where.isCurrent = true;

    const now = new Date();
    if (expirationFilter === 'expired') {
      where.expirationDate = { lt: now };
    } else if (expirationFilter === 'expiring') {
      const horizon = new Date(now.getTime() + withinDays! * 24 * 60 * 60 * 1000);
      where.expirationDate = { gte: now, lte: horizon };
    }

    const [items, total] = await Promise.all([
      this.prisma.vendorInsuranceCertificate.findMany({
        where,
        orderBy: [{ expirationDate: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.vendorInsuranceCertificate.count({ where }),
    ]);

    return {
      items: items.map((c: any) => withExpirationStatus(c, now, withinDays)),
      total, page, pageSize,
    };
  }

  async getById(tenantId: string, id: string) {
    const cert = await this.prisma.vendorInsuranceCertificate.findFirst({ where: { id, tenantId } });
    if (!cert) throw new InsuranceCertificateNotFoundError(id);
    return withExpirationStatus(cert);
  }

  /** S036B integration point — raw facts only, no verification/compliance status. */
  async getVendorInsuranceSummary(tenantId: string, vendorId: string) {
    await this._assertVendorOwnership(this.prisma, tenantId, vendorId);
    const current = await this.prisma.vendorInsuranceCertificate.findMany({
      where: { tenantId, vendorId, isCurrent: true },
      orderBy: [{ insuranceType: 'asc' }],
    });
    const now = new Date();
    return {
      vendorId,
      certificates: current.map((c: any) => withExpirationStatus(c, now)),
    };
  }

  async create(dto: CreateCertificateDTO, actor = 'system', correlationId?: string) {
    validateInsuranceType(dto.insuranceType);
    validateDates(dto.effectiveDate, dto.expirationDate);
    if (!dto.certificateNumber?.trim()) {
      throw new InsuranceCertificateValidationError('VALIDATION_ERROR', 'certificateNumber is required');
    }
    if (!dto.insuranceProvider?.trim()) {
      throw new InsuranceCertificateValidationError('VALIDATION_ERROR', 'insuranceProvider is required');
    }

    const cert = await this.prisma.$transaction(async (tx: any) => {
      // FIX (S038 live-stack certification): the RLS-tenant-context SET must
      // land on this interactive transaction's own dedicated connection
      // before any model query runs on it — see shared-kernel's
      // rls-middleware.ts header comment for why the base-client `$use`
      // middleware alone does not cover `$transaction(async (tx) => ...)`.
      // Without this, every RLS-protected read/write inside this callback
      // (starting with the vendor-ownership check below) deterministically
      // fails/returns empty, reproduced live against a real isolated Postgres.
      await setTenantContextOnConnection(tx, dto.tenantId);
      await this._assertVendorOwnership(tx, dto.tenantId, dto.vendorId);

      const existingCurrent = await tx.vendorInsuranceCertificate.findFirst({
        where: { tenantId: dto.tenantId, vendorId: dto.vendorId, insuranceType: dto.insuranceType, isCurrent: true },
      });
      if (existingCurrent) {
        throw new InsuranceCertificateConflictError(
          'DUPLICATE_ACTIVE_CERTIFICATE',
          `An active ${dto.insuranceType} certificate already exists for this vendor — use renew instead of create`,
        );
      }

      const c = await tx.vendorInsuranceCertificate.create({
        data: {
          tenantId: dto.tenantId,
          vendorId: dto.vendorId,
          certificateNumber: dto.certificateNumber.trim(),
          insuranceProvider: dto.insuranceProvider.trim(),
          insuranceType: dto.insuranceType,
          effectiveDate: dto.effectiveDate,
          expirationDate: dto.expirationDate,
          coverageAmount: dto.coverageAmount !== undefined ? String(dto.coverageAmount) : undefined,
          coverageDescription: dto.coverageDescription ?? null,
          documentId: dto.documentId ?? null,
          documentFileName: dto.documentFileName ?? null,
          documentMimeType: dto.documentMimeType ?? null,
          notes: dto.notes ?? null,
          status: 'ACTIVE',
          isCurrent: true,
          version: 1,
          createdBy: actor,
          updatedBy: actor,
        },
      });

      await this._audit(dto.tenantId, c.id, 'CREATED', null, c, actor, tx, correlationId);
      return c;
    });

    await this._writeOutbox(dto.tenantId, 'VENDOR_INSURANCE_CERTIFICATE_CREATED', cert.id, {
      vendorId: cert.vendorId, insuranceType: cert.insuranceType, expirationDate: cert.expirationDate,
    });

    return withExpirationStatus(cert);
  }

  async update(tenantId: string, id: string, dto: UpdateCertificateDTO, actor = 'system', correlationId?: string) {
    const current = await this.prisma.vendorInsuranceCertificate.findFirst({ where: { id, tenantId } });
    if (!current) throw new InsuranceCertificateNotFoundError(id);
    if (current.version !== dto.version) {
      throw new InsuranceCertificateConflictError('VERSION_CONFLICT', `Version conflict: expected ${dto.version}, current is ${current.version}`);
    }
    if (!current.isCurrent || current.status !== 'ACTIVE') {
      throw new InsuranceCertificateValidationError(
        'CERTIFICATE_NOT_EDITABLE',
        'Only the current, active certificate can be edited — this record has been superseded or revoked',
      );
    }

    const data: any = { version: current.version + 1, updatedBy: actor };
    if (dto.coverageAmount !== undefined) data.coverageAmount = String(dto.coverageAmount);
    if (dto.coverageDescription !== undefined) data.coverageDescription = dto.coverageDescription;
    if (dto.documentId !== undefined) data.documentId = dto.documentId;
    if (dto.documentFileName !== undefined) data.documentFileName = dto.documentFileName;
    if (dto.documentMimeType !== undefined) data.documentMimeType = dto.documentMimeType;
    if (dto.notes !== undefined) data.notes = dto.notes;

    const updated = await this.prisma.$transaction(async (tx: any) => {
      // FIX (S038 live-stack certification): see create() above.
      await setTenantContextOnConnection(tx, tenantId);
      const u = await tx.vendorInsuranceCertificate.update({ where: { id }, data });
      await this._audit(tenantId, id, 'UPDATED', current, u, actor, tx, correlationId);
      return u;
    });

    await this._writeOutbox(tenantId, 'VENDOR_INSURANCE_CERTIFICATE_UPDATED', id, { changes: Object.keys(data).filter((k) => k !== 'version') });
    return withExpirationStatus(updated);
  }

  /** Atomically supersedes the old certificate with a new one — never
   * silently overwrites the old record; it is preserved with
   * status=SUPERSEDED and a pointer to its replacement. */
  async renew(tenantId: string, id: string, dto: RenewCertificateDTO, actor = 'system', correlationId?: string) {
    validateDates(dto.effectiveDate, dto.expirationDate);
    if (!dto.certificateNumber?.trim()) {
      throw new InsuranceCertificateValidationError('VALIDATION_ERROR', 'certificateNumber is required');
    }
    if (!dto.insuranceProvider?.trim()) {
      throw new InsuranceCertificateValidationError('VALIDATION_ERROR', 'insuranceProvider is required');
    }

    const result = await this.prisma.$transaction(async (tx: any) => {
      // FIX (S038 live-stack certification): see create() above.
      await setTenantContextOnConnection(tx, tenantId);
      const old = await tx.vendorInsuranceCertificate.findFirst({ where: { id, tenantId } });
      if (!old) throw new InsuranceCertificateNotFoundError(id);
      if (old.version !== dto.version) {
        throw new InsuranceCertificateConflictError('VERSION_CONFLICT', `Version conflict: expected ${dto.version}, current is ${old.version}`);
      }
      if (!old.isCurrent || old.status !== 'ACTIVE') {
        throw new InsuranceCertificateValidationError(
          'CERTIFICATE_NOT_RENEWABLE',
          'Only the current, active certificate can be renewed — this record has already been superseded or revoked',
        );
      }

      // FIX (S038 live-stack certification): reproduced live — creating the
      // new "current" row before demoting the old one violates the partial
      // unique index (tenant_id, vendor_id, insurance_type) WHERE is_current
      // = true, since Postgres enforces a non-deferrable unique index
      // immediately (not at transaction end), so both rows would briefly be
      // is_current=true at once. Demote the old certificate FIRST (without
      // yet knowing the new certificate's id), then create the new current
      // certificate, then a second small update backfills
      // supersededByCertificateId on the old row (this second update does
      // not touch is_current, so it cannot re-trigger the unique conflict).
      await tx.vendorInsuranceCertificate.update({
        where: { id: old.id },
        data: { isCurrent: false, status: 'SUPERSEDED', version: old.version + 1, updatedBy: actor },
      });

      const next = await tx.vendorInsuranceCertificate.create({
        data: {
          tenantId,
          vendorId: old.vendorId,
          certificateNumber: dto.certificateNumber.trim(),
          insuranceProvider: dto.insuranceProvider.trim(),
          insuranceType: old.insuranceType,
          effectiveDate: dto.effectiveDate,
          expirationDate: dto.expirationDate,
          coverageAmount: dto.coverageAmount !== undefined ? String(dto.coverageAmount) : undefined,
          coverageDescription: dto.coverageDescription ?? null,
          documentId: dto.documentId ?? null,
          documentFileName: dto.documentFileName ?? null,
          documentMimeType: dto.documentMimeType ?? null,
          notes: dto.notes ?? null,
          status: 'ACTIVE',
          isCurrent: true,
          previousCertificateId: old.id,
          version: 1,
          createdBy: actor,
          updatedBy: actor,
        },
      });

      const supersededOld = await tx.vendorInsuranceCertificate.update({
        where: { id: old.id },
        data: { supersededByCertificateId: next.id },
      });


      await this._audit(tenantId, old.id, 'SUPERSEDED', old, supersededOld, actor, tx, correlationId);
      await this._audit(tenantId, next.id, 'CREATED_VIA_RENEWAL', null, next, actor, tx, correlationId);

      return { old: supersededOld, next };
    });

    await this._writeOutbox(tenantId, 'VENDOR_INSURANCE_CERTIFICATE_RENEWED', result.next.id, {
      vendorId: result.next.vendorId, previousCertificateId: result.old.id, expirationDate: result.next.expirationDate,
    });

    return withExpirationStatus(result.next);
  }

  /** Revokes the current certificate without a replacement (e.g. policy
   * cancelled). The record is preserved (never deleted) with status=REVOKED. */
  async revoke(tenantId: string, id: string, dto: RevokeCertificateDTO, actor = 'system', correlationId?: string) {
    if (!dto.reason?.trim()) {
      throw new InsuranceCertificateValidationError('VALIDATION_ERROR', 'reason is required to revoke a certificate');
    }

    const revoked = await this.prisma.$transaction(async (tx: any) => {
      // FIX (S038 live-stack certification): see create() above.
      await setTenantContextOnConnection(tx, tenantId);
      const current = await tx.vendorInsuranceCertificate.findFirst({ where: { id, tenantId } });
      if (!current) throw new InsuranceCertificateNotFoundError(id);
      if (current.version !== dto.version) {
        throw new InsuranceCertificateConflictError('VERSION_CONFLICT', `Version conflict: expected ${dto.version}, current is ${current.version}`);
      }
      if (!current.isCurrent || current.status !== 'ACTIVE') {
        throw new InsuranceCertificateValidationError('CERTIFICATE_NOT_REVOCABLE', 'Only the current, active certificate can be revoked');
      }

      const r = await tx.vendorInsuranceCertificate.update({
        where: { id },
        data: {
          status: 'REVOKED', isCurrent: false, revokedAt: new Date(), revokedReason: dto.reason, revokedBy: actor,
          version: current.version + 1, updatedBy: actor,
        },
      });
      await this._audit(tenantId, id, 'REVOKED', current, r, actor, tx, correlationId);
      return r;
    });

    await this._writeOutbox(tenantId, 'VENDOR_INSURANCE_CERTIFICATE_REVOKED', id, { reason: dto.reason, actor });
    return withExpirationStatus(revoked);
  }

  private async _audit(
    tenantId: string, docId: string, action: string,
    before: unknown, after: unknown, actor: string,
    tx: any = this.prisma,
    correlationId?: string,
  ): Promise<void> {
    await tx.auditOutboxEvent.create({
      data: {
        tenantId, docType: 'VendorInsuranceCertificate', docId, action,
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
