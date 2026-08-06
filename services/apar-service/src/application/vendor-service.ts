import { inject, injectable } from 'tsyringe';
import { IEventPublisher, setTenantContextOnConnection } from '@amacc/shared-kernel';

// ── Constants ────────────────────────────────────────────────────────────────

/** PO decision (2026-07-29): approved initial vendor-type values. */
export const VENDOR_TYPE_VALUES = ['SUPPLIER', 'SERVICE_PROVIDER', 'GOVERNMENT', 'OTHER'] as const;

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface VendorFieldsDTO {
  vendorName: string;
  vendorType?: string;
  dba?: string;
  contactName?: string;
  phone?: string;
  fax?: string;
  email?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
  is1099Misc?: boolean;
  is1099Nec?: boolean;
  income1099Type?: string;
  w9OnFile?: boolean;
  w9ReceivedDate?: Date;
  paymentTerms?: string;
  defaultGlAccount?: string;
  paymentMethod?: string;
  discountPercent?: number;
  discountDays?: number;
  separateCheck?: boolean;
  holdPayments?: boolean;
  defaultExpenseAccount?: string;
  notes?: string;
}

export interface CreateVendorDTO extends VendorFieldsDTO {
  tenantId: string;
  vendorNumber?: string;
  /** Present only when the caller has already been shown the duplicate
   * warning and chosen to proceed. Permission (AP_VENDOR_DUPLICATE_OVERRIDE)
   * is verified by the route layer BEFORE this is passed in. */
  override?: { reason: string };
}

export interface UpdateVendorDTO extends Partial<VendorFieldsDTO> {
  version: number;
}

export interface DuplicateCheckDTO {
  tenantId: string;
  vendorName?: string;
  email?: string;
  phone?: string;
  zip?: string;
  /** Excluded from its own duplicate check (editing an existing vendor). */
  excludeVendorId?: string;
}

export interface InactivateVendorDTO {
  version: number;
  reason: string;
}

export interface ReactivateVendorDTO {
  version: number;
}

export interface DeleteVendorDTO {
  version: number;
  reason?: string;
}

export interface VendorListQuery {
  tenantId: string;
  search?: string;
  /** ACTIVE | INACTIVE | undefined = ACTIVE+INACTIVE (excludes DELETED always) */
  status?: string;
  vendorType?: string;
  page?: number;
  pageSize?: number;
}

export interface DuplicateCandidate {
  vendorId: string;
  vendorNumber: string;
  vendorName: string;
  status: string;
  matchedSignals: string[];
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class VendorNotFoundError extends Error {
  constructor(id: string) {
    super(`Vendor not found: ${id}`);
    this.name = 'VendorNotFoundError';
  }
}

export class VendorConflictError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'VendorConflictError';
  }
}

export class VendorValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'VendorValidationError';
  }
}

export class VendorHasReferencesError extends Error {
  constructor(public readonly references: { purchaseOrders: number; apEntries: number }) {
    super('Vendor is referenced by existing transactions and cannot be deleted');
    this.name = 'VendorHasReferencesError';
  }
}

export class DuplicateVendorAcknowledgementRequiredError extends Error {
  constructor(public readonly candidates: DuplicateCandidate[]) {
    super('Potential duplicate vendor(s) found — acknowledgement with a reason is required to proceed');
    this.name = 'DuplicateVendorAcknowledgementRequiredError';
  }
}

// ── Normalization helpers ────────────────────────────────────────────────────

function normalizeVendorNumber(v: string): string {
  return v.trim().toUpperCase();
}
function normalizeVendorName(v: string): string {
  return v.trim().toLowerCase();
}
function normalizeEmail(v?: string | null): string | null {
  const t = v?.trim().toLowerCase();
  return t ? t : null;
}
function normalizePhone(v?: string | null): string | null {
  const digits = v?.replace(/\D/g, '') ?? '';
  return digits ? digits : null;
}

/** Mask a tax identifier to last-4 only, e.g. "*****6789". Never returns the
 * full value — S036A disables reveal entirely (no approved encrypted-field
 * mechanism exists repository-wide; see docs / final report). */
export function maskTaxId(taxId: string | null | undefined): string | null {
  if (!taxId) return null;
  const digits = taxId.replace(/\D/g, '');
  if (digits.length <= 4) return '*'.repeat(digits.length);
  return '*'.repeat(digits.length - 4) + digits.slice(-4);
}

/** Strips/masks every sensitive field from a raw Vendor row before it is ever
 * sent in an API response. Applied unconditionally — full tax-ID reveal is
 * not implemented this slice regardless of AP_VENDOR_TAX_IDENTIFIER_VIEW. */
export function toSafeVendor(v: any) {
  if (!v) return v;
  const {
    bankName, bankRoutingNumber, bankAccountNumber, bankAccountType,
    normalizedVendorNumber, normalizedVendorName, normalizedEmail, normalizedPhone,
    taxId,
    ...rest
  } = v;
  return { ...rest, taxIdMasked: maskTaxId(taxId) };
}

/** Redacts a raw Vendor row before it is written into an audit_outbox
 * before/after snapshot. Distinct from toSafeVendor (API responses) because
 * audit records are retained long-term and forwarded to a separate service —
 * "do not log the complete tax identifier in audit payloads" applies here
 * even though masking already happens at the API layer. */
export function redactForAudit(v: any) {
  if (!v) return v;
  const { bankAccountNumber, bankRoutingNumber, taxId, ...rest } = v;
  return { ...rest, taxIdMasked: maskTaxId(taxId) };
}

// ── Service ───────────────────────────────────────────────────────────────────

@injectable()
export class VendorService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('IEventPublisher') private readonly eventPublisher: IEventPublisher,
  ) {}

  async list(query: VendorListQuery) {
    const { tenantId, search, status, vendorType, page = 1, pageSize = 50 } = query;

    const where: any = { tenantId };
    // Default APIs treat logically deleted vendors as not found — never
    // included unless explicitly asked for via status=DELETED.
    if (status) {
      where.status = status;
    } else {
      where.status = { in: ['ACTIVE', 'INACTIVE'] };
    }
    if (vendorType) where.vendorType = vendorType;
    if (search) {
      const q = search.trim();
      where.OR = [
        { vendorNumber: { contains: q, mode: 'insensitive' } },
        { vendorName: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.vendor.findMany({
        where,
        orderBy: [{ status: 'asc' }, { vendorNumber: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.vendor.count({ where }),
    ]);

    return { items: items.map(toSafeVendor), total, page, pageSize };
  }

  async getById(tenantId: string, id: string) {
    const vendor = await this.prisma.vendor.findFirst({ where: { id, tenantId, status: { not: 'DELETED' } } });
    if (!vendor) throw new VendorNotFoundError(id);
    return toSafeVendor(vendor);
  }

  /** Pure query — no mutation, no permission beyond ap.vendor.view/create. */
  async checkDuplicates(dto: DuplicateCheckDTO): Promise<DuplicateCandidate[]> {
    const { tenantId, excludeVendorId } = dto;
    const normName = dto.vendorName ? normalizeVendorName(dto.vendorName) : undefined;
    const normEmail = normalizeEmail(dto.email);
    const normPhone = normalizePhone(dto.phone);

    const or: any[] = [];
    if (normName && dto.zip) or.push({ normalizedVendorName: normName, zip: dto.zip });
    if (normEmail) or.push({ normalizedEmail: normEmail });
    if (normPhone) or.push({ normalizedPhone: normPhone });
    if (or.length === 0) return [];

    const candidates = await this.prisma.vendor.findMany({
      where: {
        tenantId, // never compares across tenants
        status: { not: 'DELETED' },
        ...(excludeVendorId ? { NOT: { id: excludeVendorId } } : {}),
        OR: or,
      },
      select: { id: true, vendorNumber: true, vendorName: true, status: true, normalizedVendorName: true, normalizedEmail: true, normalizedPhone: true, zip: true },
    });

    return candidates.map((c: any) => {
      const matchedSignals: string[] = [];
      if (normName && dto.zip && c.normalizedVendorName === normName && c.zip === dto.zip) matchedSignals.push('NAME_AND_POSTAL_CODE');
      if (normEmail && c.normalizedEmail === normEmail) matchedSignals.push('EMAIL');
      if (normPhone && c.normalizedPhone === normPhone) matchedSignals.push('PHONE');
      return {
        vendorId: c.id,
        vendorNumber: c.vendorNumber,
        vendorName: c.vendorName,
        status: c.status,
        matchedSignals,
      };
    });
  }

  async create(dto: CreateVendorDTO, actor = 'system', correlationId?: string) {
    if (dto.vendorType && !(VENDOR_TYPE_VALUES as readonly string[]).includes(dto.vendorType)) {
      throw new VendorValidationError('VALIDATION_ERROR', `Unsupported vendor type: ${dto.vendorType}`);
    }

    const normalizedVendorName = normalizeVendorName(dto.vendorName);
    const normalizedEmail = normalizeEmail(dto.email);
    const normalizedPhone = normalizePhone(dto.phone);

    // Hard block: same tenant + same normalized vendor code.
    if (dto.vendorNumber) {
      const normNumber = normalizeVendorNumber(dto.vendorNumber);
      const exists = await this.prisma.vendor.findFirst({
        where: { tenantId: dto.tenantId, normalizedVendorNumber: normNumber },
      });
      if (exists) {
        throw new VendorConflictError('VENDOR_CODE_ALREADY_EXISTS', `Vendor code '${dto.vendorNumber}' already exists`);
      }
    }

    // Candidate (warning-level) duplicate signals.
    const candidates = await this.checkDuplicates({
      tenantId: dto.tenantId,
      vendorName: dto.vendorName,
      email: dto.email,
      phone: dto.phone,
      zip: dto.zip,
    });

    if (candidates.length > 0 && !dto.override) {
      throw new DuplicateVendorAcknowledgementRequiredError(candidates);
    }

    const vendor = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, dto.tenantId); // CE-07 discovery: interactive $transaction runs on its own connection, separate from the base client's RLS middleware — see rls-middleware.ts.
      const vendorNumber = dto.vendorNumber
        ? normalizeVendorNumber(dto.vendorNumber)
        : await this._nextVendorNumber(tx, dto.tenantId);

      const v = await tx.vendor.create({
        data: {
          tenantId: dto.tenantId,
          vendorNumber,
          normalizedVendorNumber: normalizeVendorNumber(vendorNumber),
          vendorName: dto.vendorName,
          normalizedVendorName,
          vendorType: dto.vendorType ?? 'OTHER',
          dba: dto.dba ?? null,
          contactName: dto.contactName ?? null,
          phone: dto.phone ?? null,
          normalizedPhone,
          fax: dto.fax ?? null,
          email: dto.email ?? null,
          normalizedEmail,
          address1: dto.address1 ?? null,
          address2: dto.address2 ?? null,
          city: dto.city ?? null,
          state: dto.state ?? null,
          zip: dto.zip ?? null,
          // taxId intentionally omitted — create is disabled (S036A: no
          // approved encrypted-field mechanism; see final report).
          is1099Misc: dto.is1099Misc ?? false,
          is1099Nec: dto.is1099Nec ?? false,
          income1099Type: dto.income1099Type ?? null,
          w9OnFile: dto.w9OnFile ?? false,
          w9ReceivedDate: dto.w9ReceivedDate ?? null,
          paymentTerms: dto.paymentTerms ?? 'Net30',
          defaultGlAccount: dto.defaultGlAccount ?? null,
          paymentMethod: dto.paymentMethod ?? 'Check',
          discountPercent: dto.discountPercent !== undefined ? String(dto.discountPercent) : undefined,
          discountDays: dto.discountDays,
          separateCheck: dto.separateCheck ?? false,
          holdPayments: dto.holdPayments ?? false,
          defaultExpenseAccount: dto.defaultExpenseAccount ?? null,
          notes: dto.notes ?? null,
          status: 'ACTIVE',
          isActive: true,
          version: 1,
        },
      });

      await this._audit(dto.tenantId, 'Vendor', v.id, 'CREATED', null, redactForAudit(v), actor, tx, correlationId);

      if (candidates.length > 0 && dto.override) {
        await tx.apVendorDuplicateAcknowledgement.create({
          data: {
            tenantId: dto.tenantId,
            vendorId: v.id,
            matchedSignals: candidates as any,
            reason: dto.override.reason,
            actor,
            correlationId: correlationId ?? null,
          },
        });
        await this._audit(dto.tenantId, 'Vendor', v.id, 'DUPLICATE_WARNING_ACKNOWLEDGED', null, {
          candidateIds: candidates.map(c => c.vendorId),
          reason: dto.override.reason,
        }, actor, tx, correlationId);
      }

      return v;
    });

    await this._writeOutbox(dto.tenantId, 'VENDOR_CREATED', vendor.id, { vendorNumber: vendor.vendorNumber, vendorName: vendor.vendorName });

    return toSafeVendor(vendor);
  }

  async update(tenantId: string, id: string, dto: UpdateVendorDTO, actor = 'system', correlationId?: string) {
    const current = await this.prisma.vendor.findFirst({ where: { id, tenantId, status: { not: 'DELETED' } } });
    if (!current) throw new VendorNotFoundError(id);

    if (current.version !== dto.version) {
      throw new VendorConflictError('VERSION_CONFLICT', `Version conflict: expected ${dto.version}, current is ${current.version}`);
    }
    if (current.status === 'INACTIVE') {
      throw new VendorValidationError('VENDOR_INACTIVE', 'Cannot edit an inactive vendor — reactivate it first');
    }
    if (dto.vendorType && !(VENDOR_TYPE_VALUES as readonly string[]).includes(dto.vendorType)) {
      throw new VendorValidationError('VALIDATION_ERROR', `Unsupported vendor type: ${dto.vendorType}`);
    }

    const data: any = { version: current.version + 1 };
    if (dto.vendorName !== undefined) { data.vendorName = dto.vendorName; data.normalizedVendorName = normalizeVendorName(dto.vendorName); }
    if (dto.vendorType !== undefined) data.vendorType = dto.vendorType;
    if (dto.dba !== undefined) data.dba = dto.dba;
    if (dto.contactName !== undefined) data.contactName = dto.contactName;
    if (dto.phone !== undefined) { data.phone = dto.phone; data.normalizedPhone = normalizePhone(dto.phone); }
    if (dto.fax !== undefined) data.fax = dto.fax;
    if (dto.email !== undefined) { data.email = dto.email; data.normalizedEmail = normalizeEmail(dto.email); }
    if (dto.address1 !== undefined) data.address1 = dto.address1;
    if (dto.address2 !== undefined) data.address2 = dto.address2;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.state !== undefined) data.state = dto.state;
    if (dto.zip !== undefined) data.zip = dto.zip;
    if (dto.is1099Misc !== undefined) data.is1099Misc = dto.is1099Misc;
    if (dto.is1099Nec !== undefined) data.is1099Nec = dto.is1099Nec;
    if (dto.income1099Type !== undefined) data.income1099Type = dto.income1099Type;
    if (dto.w9OnFile !== undefined) data.w9OnFile = dto.w9OnFile;
    if (dto.w9ReceivedDate !== undefined) data.w9ReceivedDate = dto.w9ReceivedDate;
    if (dto.paymentTerms !== undefined) data.paymentTerms = dto.paymentTerms;
    if (dto.defaultGlAccount !== undefined) data.defaultGlAccount = dto.defaultGlAccount;
    if (dto.paymentMethod !== undefined) data.paymentMethod = dto.paymentMethod;
    if (dto.discountPercent !== undefined) data.discountPercent = String(dto.discountPercent);
    if (dto.discountDays !== undefined) data.discountDays = dto.discountDays;
    if (dto.separateCheck !== undefined) data.separateCheck = dto.separateCheck;
    if (dto.holdPayments !== undefined) data.holdPayments = dto.holdPayments;
    if (dto.defaultExpenseAccount !== undefined) data.defaultExpenseAccount = dto.defaultExpenseAccount;
    if (dto.notes !== undefined) data.notes = dto.notes;
    // taxId, bankName/bankRoutingNumber/bankAccountNumber/bankAccountType are
    // never read from dto — UpdateVendorDTO has no such fields (S036A: no
    // new plaintext tax-ID writes; banking edit is out of scope).

    const vendor = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId); // CE-07 discovery: interactive $transaction runs on its own connection, separate from the base client's RLS middleware — see rls-middleware.ts.
      const v = await tx.vendor.update({ where: { id }, data });
      await this._audit(tenantId, 'Vendor', id, 'UPDATED', redactForAudit(current), redactForAudit(v), actor, tx, correlationId);
      return v;
    });

    await this._writeOutbox(tenantId, 'VENDOR_UPDATED', id, { changes: Object.keys(data).filter(k => k !== 'version') });

    return toSafeVendor(vendor);
  }

  async inactivate(tenantId: string, id: string, dto: InactivateVendorDTO, actor = 'system', correlationId?: string) {
    const current = await this.prisma.vendor.findFirst({ where: { id, tenantId, status: { not: 'DELETED' } } });
    if (!current) throw new VendorNotFoundError(id);
    if (!dto.reason?.trim()) throw new VendorValidationError('REASON_REQUIRED', 'A reason is required to inactivate a vendor');
    if (current.status === 'INACTIVE') throw new VendorValidationError('ALREADY_INACTIVE', 'Vendor is already inactive');
    if (current.version !== dto.version) {
      throw new VendorConflictError('VERSION_CONFLICT', `Version conflict: expected ${dto.version}, current is ${current.version}`);
    }

    const vendor = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId); // CE-07 discovery: interactive $transaction runs on its own connection, separate from the base client's RLS middleware — see rls-middleware.ts.
      const v = await tx.vendor.update({
        where: { id },
        data: {
          status: 'INACTIVE',
          isActive: false,
          version: current.version + 1,
          inactiveReason: dto.reason,
          inactivatedAt: new Date(),
          inactivatedBy: actor,
        },
      });
      await this._audit(tenantId, 'Vendor', id, 'INACTIVATED', redactForAudit(current), redactForAudit(v), actor, tx, correlationId);
      return v;
    });

    await this._writeOutbox(tenantId, 'VENDOR_INACTIVATED', id, { reason: dto.reason, actor });
    return toSafeVendor(vendor);
  }

  async reactivate(tenantId: string, id: string, dto: ReactivateVendorDTO, actor = 'system', correlationId?: string) {
    const current = await this.prisma.vendor.findFirst({ where: { id, tenantId, status: { not: 'DELETED' } } });
    if (!current) throw new VendorNotFoundError(id);
    if (current.status === 'ACTIVE') throw new VendorValidationError('ALREADY_ACTIVE', 'Vendor is already active');
    if (current.version !== dto.version) {
      throw new VendorConflictError('VERSION_CONFLICT', `Version conflict: expected ${dto.version}, current is ${current.version}`);
    }

    const vendor = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId); // CE-07 discovery: interactive $transaction runs on its own connection, separate from the base client's RLS middleware — see rls-middleware.ts.
      const v = await tx.vendor.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          isActive: true,
          version: current.version + 1,
          reactivatedAt: new Date(),
          reactivatedBy: actor,
        },
      });
      await this._audit(tenantId, 'Vendor', id, 'REACTIVATED', redactForAudit(current), redactForAudit(v), actor, tx, correlationId);
      return v;
    });

    await this._writeOutbox(tenantId, 'VENDOR_REACTIVATED', id, { actor });
    return toSafeVendor(vendor);
  }

  /**
   * Guarded logical delete (BR-AP-001: never a physical row delete).
   * Reference guard: PurchaseOrder.vendorId (reliable FK-style reference)
   * OR ApEntry.vendorName matching this vendor's current name (best-effort —
   * ap_entries links vendors by name, not id; a rename could theoretically
   * miss an old invoice under the prior name. This errs toward OVER-blocking,
   * never under-blocking: it can occasionally refuse to delete a vendor that
   * shares its current name with an unrelated invoice, but it will never let
   * a truly referenced vendor be deleted). Documented as a known limitation,
   * not claimed as a fully FK-reliable guard.
   */
  async delete(tenantId: string, id: string, dto: DeleteVendorDTO, actor = 'system', correlationId?: string) {
    const current = await this.prisma.vendor.findFirst({ where: { id, tenantId, status: { not: 'DELETED' } } });
    if (!current) throw new VendorNotFoundError(id);
    if (current.version !== dto.version) {
      throw new VendorConflictError('VERSION_CONFLICT', `Version conflict: expected ${dto.version}, current is ${current.version}`);
    }

    const [poCount, apCount] = await Promise.all([
      this.prisma.purchaseOrder.count({ where: { tenantId, vendorId: id } }),
      this.prisma.aPEntry.count({ where: { tenantId, vendorName: current.vendorName } }),
    ]);

    if (poCount > 0 || apCount > 0) {
      await this._audit(tenantId, 'Vendor', id, 'DELETE_REJECTED', null, { purchaseOrders: poCount, apEntries: apCount }, actor, this.prisma, correlationId);
      await this._writeOutbox(tenantId, 'VENDOR_DELETE_REJECTED', id, { purchaseOrders: poCount, apEntries: apCount });
      throw new VendorHasReferencesError({ purchaseOrders: poCount, apEntries: apCount });
    }

    const vendor = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId); // CE-07 discovery: interactive $transaction runs on its own connection, separate from the base client's RLS middleware — see rls-middleware.ts.
      const v = await tx.vendor.update({
        where: { id },
        data: {
          status: 'DELETED',
          isActive: false,
          version: current.version + 1,
          deletedAt: new Date(),
          deletedBy: actor,
          deleteReason: dto.reason ?? null,
        },
      });
      await this._audit(tenantId, 'Vendor', id, 'DELETED', redactForAudit(current), redactForAudit(v), actor, tx, correlationId);
      return v;
    });

    await this._writeOutbox(tenantId, 'VENDOR_DELETED', id, { reason: dto.reason ?? null, actor });
    return toSafeVendor(vendor);
  }

  /** Invoice-creation eligibility: ACTIVE only. Denials are audited (S036A
   * required audit event AP_VENDOR_ELIGIBILITY_DENIED). */
  async eligibility(tenantId: string, id: string, actor = 'system', correlationId?: string) {
    const vendor = await this.prisma.vendor.findFirst({ where: { id, tenantId } });
    if (!vendor || vendor.status === 'DELETED') throw new VendorNotFoundError(id);

    if (vendor.status === 'ACTIVE') {
      return { eligible: true, status: vendor.status, reason: null };
    }

    const reason = vendor.status === 'INACTIVE'
      ? 'Vendor is inactive — new invoices are not permitted'
      : 'Vendor is deleted — new invoices are not permitted';
    await this._audit(tenantId, 'Vendor', id, 'ELIGIBILITY_DENIED', null, { status: vendor.status, reason }, actor, this.prisma, correlationId);
    return { eligible: false, status: vendor.status, reason };
  }

  /** Records a SENSITIVE_FIELD_VIEWED audit event. S036A never actually
   * reveals the unmasked value (see maskTaxId) — this exists so a future
   * encrypted-field-backed reveal endpoint has an audit trail ready, and so
   * the permission's existence is exercised/testable now. */
  async recordSensitiveFieldViewed(tenantId: string, id: string, field: string, actor = 'system', correlationId?: string) {
    await this._audit(tenantId, 'Vendor', id, 'SENSITIVE_FIELD_VIEWED', null, { field }, actor, this.prisma, correlationId);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async _nextVendorNumber(tx: any, tenantId: string): Promise<string> {
    await tx.apVendorNumberCounter.upsert({
      where: { tenantId },
      create: { tenantId, nextNumber: 2 },
      update: { nextNumber: { increment: 1 } },
    });
    // Read-after-write within the same transaction: Postgres row-lock on the
    // upsert above serializes concurrent callers, so this read always sees
    // the value this call just reserved (upsert's own connection/transaction).
    const row = await tx.apVendorNumberCounter.findUnique({ where: { tenantId } });
    const assigned = row.nextNumber - 1;
    return String(assigned).padStart(6, '0');
  }

  private async _audit(
    tenantId: string, docType: string, docId: string, action: string,
    before: unknown, after: unknown, actor: string,
    tx: any = this.prisma,
    correlationId?: string,
  ): Promise<void> {
    await tx.auditOutboxEvent.create({
      data: {
        tenantId, docType, docId, action,
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
