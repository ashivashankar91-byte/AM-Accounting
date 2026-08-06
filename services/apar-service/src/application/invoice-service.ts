import { inject, injectable } from 'tsyringe';
import { IEventPublisher, setTenantContextOnConnection } from '@amacc/shared-kernel';
import { InvoiceMatchService } from './invoice-match-service';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface InvoiceLineDTO {
  poLineId?: string;
  glAccountId?: string;
  description: string;
  quantity?: number;
  unitPrice: number;
  taxAmount?: number;
}

export interface CreateInvoiceDTO {
  tenantId: string;
  vendorId: string;
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate: Date;
  poId?: string;
  freightAmount?: number;
  notes?: string;
  lines: InvoiceLineDTO[];
  /** Present only when the caller has already been shown the duplicate
   * warning and chosen to proceed. Permission is verified by the route
   * layer before this is passed in. */
  override?: { reason: string };
}

export interface UpdateInvoiceDTO {
  version: number;
  dueDate?: Date;
  notes?: string;
  freightAmount?: number;
  lines?: InvoiceLineDTO[];
}

export interface DuplicateCheckDTO {
  tenantId: string;
  vendorId: string;
  invoiceNumber: string;
  excludeInvoiceId?: string;
}

export interface DuplicateCandidate {
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  totalAmount: number;
}

export interface SubmitInvoiceDTO {
  version: number;
  /** Required when matchStatus is currently EXCEPTION. */
  override?: { reason: string };
}

export interface VoidInvoiceDTO {
  version: number;
  reason: string;
}

export interface InvoiceListQuery {
  tenantId: string;
  vendorId?: string;
  status?: string;
  poId?: string;
  page?: number;
  pageSize?: number;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class InvoiceNotFoundError extends Error {
  constructor(id: string) {
    super(`Vendor invoice not found: ${id}`);
    this.name = 'InvoiceNotFoundError';
  }
}

export class VendorNotFoundForInvoiceError extends Error {
  constructor(vendorId: string) {
    super(`Vendor not found: ${vendorId}`);
    this.name = 'VendorNotFoundForInvoiceError';
  }
}

export class VendorNotEligibleForInvoiceError extends Error {
  constructor(public readonly vendorStatus: string) {
    super(`Vendor is ${vendorStatus} — new invoices are not permitted`);
    this.name = 'VendorNotEligibleForInvoiceError';
  }
}

export class InvoiceValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'InvoiceValidationError';
  }
}

export class InvoiceConflictError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'InvoiceConflictError';
  }
}

export class DuplicateInvoiceAcknowledgementRequiredError extends Error {
  constructor(public readonly candidates: DuplicateCandidate[]) {
    super('A potential duplicate invoice was found for this vendor — acknowledgement with a reason is required to proceed');
    this.name = 'DuplicateInvoiceAcknowledgementRequiredError';
  }
}

export class MatchExceptionOverrideRequiredError extends Error {
  constructor(public readonly variances: unknown[]) {
    super('This invoice has unresolved match exceptions — an override with a reason is required to submit');
    this.name = 'MatchExceptionOverrideRequiredError';
  }
}

// ── Normalization helpers ────────────────────────────────────────────────────

function normalizeInvoiceNumber(v: string): string {
  return v.trim().toUpperCase();
}

function computeLineTotal(l: InvoiceLineDTO): number {
  const qty = l.quantity ?? 1;
  return Math.round((qty * l.unitPrice + (l.taxAmount ?? 0)) * 100) / 100;
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * S039 — AP Invoice Entry & 2/3-Way Match. Lifecycle: DRAFT -> (match) ->
 * SUBMITTED. Approval/posting (PENDING_APPROVAL/APPROVED/POSTED/REJECTED)
 * is explicitly S041's scope — this service never transitions an invoice
 * past SUBMITTED.
 */
@injectable()
export class InvoiceService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('IEventPublisher') private readonly eventPublisher: IEventPublisher,
    @inject(InvoiceMatchService) private readonly matchService: InvoiceMatchService,
  ) {}

  async list(query: InvoiceListQuery) {
    const { tenantId, vendorId, status, poId, page = 1, pageSize = 50 } = query;
    const where: any = { tenantId };
    if (vendorId) where.vendorId = vendorId;
    if (status) where.status = status;
    if (poId) where.poId = poId;

    const [items, total] = await Promise.all([
      this.prisma.vendorInvoice.findMany({
        where, include: { lines: true },
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.prisma.vendorInvoice.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async getById(tenantId: string, id: string) {
    const invoice = await this.prisma.vendorInvoice.findFirst({
      where: { id, tenantId },
      include: { lines: true, matchResults: { orderBy: { matchedAt: 'desc' } } },
    });
    if (!invoice) throw new InvoiceNotFoundError(id);
    return invoice;
  }

  async checkDuplicates(dto: DuplicateCheckDTO): Promise<DuplicateCandidate[]> {
    const normalized = normalizeInvoiceNumber(dto.invoiceNumber);
    const candidates = await this.prisma.vendorInvoice.findMany({
      where: {
        tenantId: dto.tenantId,
        vendorId: dto.vendorId,
        normalizedInvoiceNumber: normalized,
        status: { not: 'VOID' },
        ...(dto.excludeInvoiceId ? { NOT: { id: dto.excludeInvoiceId } } : {}),
      },
      select: { id: true, invoiceNumber: true, status: true, totalAmount: true },
    });
    return candidates.map((c: any) => ({
      invoiceId: c.id, invoiceNumber: c.invoiceNumber, status: c.status, totalAmount: Number(c.totalAmount),
    }));
  }

  private validateLines(lines: InvoiceLineDTO[]) {
    if (!lines?.length) throw new InvoiceValidationError('LINES_REQUIRED', 'At least one invoice line is required');
    for (const l of lines) {
      const hasPoLine = !!l.poLineId;
      const hasGlAccount = !!l.glAccountId;
      if (hasPoLine === hasGlAccount) {
        throw new InvoiceValidationError('LINE_CODING_INVALID', 'Each line must reference exactly one of poLineId or glAccountId');
      }
      if (l.unitPrice === undefined || l.unitPrice === null) {
        throw new InvoiceValidationError('UNIT_PRICE_REQUIRED', 'unitPrice is required on every line');
      }
      if ((l.quantity ?? 1) <= 0) {
        throw new InvoiceValidationError('QUANTITY_MUST_BE_POSITIVE', 'quantity must be greater than zero');
      }
    }
  }

  async create(dto: CreateInvoiceDTO, actor = 'system', correlationId?: string) {
    const vendor = await this.prisma.vendor.findFirst({ where: { id: dto.vendorId, tenantId: dto.tenantId, status: { not: 'DELETED' } } });
    if (!vendor) throw new VendorNotFoundForInvoiceError(dto.vendorId);
    if (vendor.status !== 'ACTIVE') throw new VendorNotEligibleForInvoiceError(vendor.status);

    this.validateLines(dto.lines);

    const candidates = await this.checkDuplicates({ tenantId: dto.tenantId, vendorId: dto.vendorId, invoiceNumber: dto.invoiceNumber });
    if (candidates.length > 0 && !dto.override) {
      throw new DuplicateInvoiceAcknowledgementRequiredError(candidates);
    }

    const lineTotals = dto.lines.map(computeLineTotal);
    const subtotal = dto.lines.reduce((s, l, i) => s + (l.quantity ?? 1) * l.unitPrice, 0);
    const taxAmount = dto.lines.reduce((s, l) => s + (l.taxAmount ?? 0), 0);
    const freightAmount = dto.freightAmount ?? 0;
    const totalAmount = Math.round((lineTotals.reduce((s, t) => s + t, 0) + freightAmount) * 100) / 100;

    const invoice = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, dto.tenantId); // CE-07 discovery: interactive $transaction runs on its own connection, separate from the base client's RLS middleware — see rls-middleware.ts.
      const created = await tx.vendorInvoice.create({
        data: {
          tenantId: dto.tenantId,
          vendorId: dto.vendorId,
          invoiceNumber: dto.invoiceNumber,
          normalizedInvoiceNumber: normalizeInvoiceNumber(dto.invoiceNumber),
          invoiceDate: dto.invoiceDate,
          dueDate: dto.dueDate,
          paymentTerms: vendor.paymentTerms,
          poId: dto.poId ?? null,
          subtotal: String(Math.round(subtotal * 100) / 100),
          taxAmount: String(Math.round(taxAmount * 100) / 100),
          freightAmount: String(freightAmount),
          totalAmount: String(totalAmount),
          notes: dto.notes ?? null,
          createdBy: actor,
          status: 'DRAFT',
          version: 1,
          lines: {
            create: dto.lines.map((l, i) => ({
              lineNumber: i + 1,
              poLineId: l.poLineId ?? null,
              glAccountId: l.glAccountId ?? null,
              description: l.description,
              quantity: String(l.quantity ?? 1),
              unitPrice: String(l.unitPrice),
              taxAmount: String(l.taxAmount ?? 0),
              lineTotal: String(lineTotals[i]),
            })),
          },
        },
        include: { lines: true },
      });

      await tx.auditOutboxEvent.create({
        data: { tenantId: dto.tenantId, docType: 'VendorInvoice', docId: created.id, action: 'CREATED', before: null, after: created, actor, correlationId: correlationId ?? null },
      });

      if (candidates.length > 0 && dto.override) {
        await tx.apInvoiceMatchOverride.create({
          data: {
            tenantId: dto.tenantId, invoiceId: created.id, overrideType: 'DUPLICATE_INVOICE_NUMBER',
            context: candidates as any, reason: dto.override.reason, actor, correlationId: correlationId ?? null,
          },
        });
        await tx.auditOutboxEvent.create({
          data: { tenantId: dto.tenantId, docType: 'VendorInvoice', docId: created.id, action: 'DUPLICATE_WARNING_ACKNOWLEDGED', before: null, after: { candidateIds: candidates.map((c) => c.invoiceId), reason: dto.override.reason }, actor, correlationId: correlationId ?? null },
        });
      }

      return created;
    });

    await this._writeOutbox(dto.tenantId, 'VENDOR_INVOICE_CREATED', invoice.id, { vendorId: dto.vendorId, invoiceNumber: dto.invoiceNumber });
    return invoice;
  }

  async update(tenantId: string, id: string, dto: UpdateInvoiceDTO, actor = 'system', correlationId?: string) {
    const current = await this.prisma.vendorInvoice.findFirst({ where: { id, tenantId }, include: { lines: true } });
    if (!current) throw new InvoiceNotFoundError(id);
    if (current.version !== dto.version) throw new InvoiceConflictError('VERSION_CONFLICT', `Version conflict: expected ${dto.version}, current is ${current.version}`);
    if (current.status !== 'DRAFT') throw new InvoiceValidationError('INVOICE_NOT_EDITABLE', `Cannot edit an invoice in status '${current.status}' — only DRAFT invoices may be edited`);

    if (dto.lines) this.validateLines(dto.lines);

    const invoice = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId); // CE-07 discovery: interactive $transaction runs on its own connection, separate from the base client's RLS middleware — see rls-middleware.ts.
      const data: any = { version: current.version + 1, updatedBy: actor };
      if (dto.dueDate !== undefined) data.dueDate = dto.dueDate;
      if (dto.notes !== undefined) data.notes = dto.notes;
      if (dto.freightAmount !== undefined) data.freightAmount = String(dto.freightAmount);

      if (dto.lines) {
        await tx.vendorInvoiceLine.deleteMany({ where: { invoiceId: id } });
        const lineTotals = dto.lines.map(computeLineTotal);
        const subtotal = dto.lines.reduce((s, l) => s + (l.quantity ?? 1) * l.unitPrice, 0);
        const taxAmount = dto.lines.reduce((s, l) => s + (l.taxAmount ?? 0), 0);
        const freightAmount = dto.freightAmount ?? Number(current.freightAmount);
        data.subtotal = String(Math.round(subtotal * 100) / 100);
        data.taxAmount = String(Math.round(taxAmount * 100) / 100);
        data.totalAmount = String(Math.round((lineTotals.reduce((s, t) => s + t, 0) + freightAmount) * 100) / 100);
        // Editing lines invalidates any prior match result.
        data.matchStatus = 'NOT_RUN';
        data.matchType = 'NONE';
        data.lines = {
          create: dto.lines.map((l, i) => ({
            lineNumber: i + 1,
            poLineId: l.poLineId ?? null,
            glAccountId: l.glAccountId ?? null,
            description: l.description,
            quantity: String(l.quantity ?? 1),
            unitPrice: String(l.unitPrice),
            taxAmount: String(l.taxAmount ?? 0),
            lineTotal: String(lineTotals[i]),
          })),
        };
      }

      const updated = await tx.vendorInvoice.update({ where: { id }, data, include: { lines: true } });
      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'VendorInvoice', docId: id, action: 'UPDATED', before: current, after: updated, actor, correlationId: correlationId ?? null },
      });
      return updated;
    });

    await this._writeOutbox(tenantId, 'VENDOR_INVOICE_UPDATED', id, { actor });
    return invoice;
  }

  /** Runs (or re-runs) the 2/3-way match and persists an append-only result row. */
  async runMatch(tenantId: string, id: string, actor = 'system', correlationId?: string) {
    const current = await this.prisma.vendorInvoice.findFirst({ where: { id, tenantId }, include: { lines: true } });
    if (!current) throw new InvoiceNotFoundError(id);
    if (current.status !== 'DRAFT') throw new InvoiceValidationError('INVOICE_NOT_EDITABLE', `Cannot run match on an invoice in status '${current.status}'`);

    const result = await this.matchService.match({
      tenantId,
      vendorId: current.vendorId,
      poId: current.poId,
      invoiceLines: current.lines.map((l: any) => ({ id: l.id, poLineId: l.poLineId, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })),
    });

    const invoice = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId); // CE-07 discovery: interactive $transaction runs on its own connection, separate from the base client's RLS middleware — see rls-middleware.ts.
      await tx.vendorInvoiceMatchResult.create({
        data: {
          tenantId, invoiceId: id, matchType: result.matchType, status: result.status,
          toleranceAmountUsed: String(result.toleranceAmountUsed), tolerancePercentUsed: String(result.tolerancePercentUsed),
          variances: result.variances as any, matchedBy: actor,
        },
      });
      const updated = await tx.vendorInvoice.update({
        where: { id },
        data: { matchType: result.matchType, matchStatus: result.status, version: current.version + 1 },
        include: { lines: true },
      });
      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'VendorInvoice', docId: id, action: 'MATCH_RUN', before: { matchStatus: current.matchStatus }, after: result, actor, correlationId: correlationId ?? null },
      });
      return updated;
    });

    await this._writeOutbox(tenantId, 'VENDOR_INVOICE_MATCH_RUN', id, { matchType: result.matchType, status: result.status });
    return { invoice, result };
  }

  async submit(tenantId: string, id: string, dto: SubmitInvoiceDTO, actor = 'system', correlationId?: string) {
    const current = await this.prisma.vendorInvoice.findFirst({ where: { id, tenantId }, include: { lines: true, matchResults: { orderBy: { matchedAt: 'desc' }, take: 1 } } });
    if (!current) throw new InvoiceNotFoundError(id);
    if (current.version !== dto.version) throw new InvoiceConflictError('VERSION_CONFLICT', `Version conflict: expected ${dto.version}, current is ${current.version}`);
    if (current.status !== 'DRAFT') throw new InvoiceValidationError('ALREADY_SUBMITTED', `Invoice is already '${current.status}'`);

    if (current.matchStatus === 'EXCEPTION' && !dto.override) {
      const lastResult = current.matchResults[0];
      throw new MatchExceptionOverrideRequiredError(lastResult ? (lastResult.variances as unknown[]) : []);
    }

    const invoice = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId); // CE-07 discovery: interactive $transaction runs on its own connection, separate from the base client's RLS middleware — see rls-middleware.ts.
      const isOverride = current.matchStatus === 'EXCEPTION' && !!dto.override;
      const updated = await tx.vendorInvoice.update({
        where: { id },
        data: {
          status: 'SUBMITTED',
          matchStatus: isOverride ? 'OVERRIDDEN' : current.matchStatus,
          version: current.version + 1,
          submittedAt: new Date(),
          submittedBy: actor,
        },
        include: { lines: true },
      });
      if (isOverride) {
        await tx.apInvoiceMatchOverride.create({
          data: {
            tenantId, invoiceId: id, overrideType: 'MATCH_EXCEPTION',
            context: (current.matchResults[0]?.variances ?? []) as any, reason: dto.override!.reason, actor, correlationId: correlationId ?? null,
          },
        });
      }
      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'VendorInvoice', docId: id, action: 'SUBMITTED', before: current, after: updated, actor, correlationId: correlationId ?? null },
      });
      return updated;
    });

    await this._writeOutbox(tenantId, 'VENDOR_INVOICE_SUBMITTED', id, { actor });
    return invoice;
  }

  async void(tenantId: string, id: string, dto: VoidInvoiceDTO, actor = 'system', correlationId?: string) {
    const current = await this.prisma.vendorInvoice.findFirst({ where: { id, tenantId } });
    if (!current) throw new InvoiceNotFoundError(id);
    if (current.version !== dto.version) throw new InvoiceConflictError('VERSION_CONFLICT', `Version conflict: expected ${dto.version}, current is ${current.version}`);
    if (current.status === 'VOID') throw new InvoiceValidationError('ALREADY_VOID', 'Invoice is already void');
    if (!dto.reason?.trim()) throw new InvoiceValidationError('REASON_REQUIRED', 'A reason is required to void an invoice');

    const invoice = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId); // CE-07 discovery: interactive $transaction runs on its own connection, separate from the base client's RLS middleware — see rls-middleware.ts.
      const updated = await tx.vendorInvoice.update({
        where: { id },
        data: { status: 'VOID', version: current.version + 1, voidedAt: new Date(), voidedBy: actor, voidReason: dto.reason },
      });
      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'VendorInvoice', docId: id, action: 'VOIDED', before: current, after: updated, actor, correlationId: correlationId ?? null },
      });
      return updated;
    });

    await this._writeOutbox(tenantId, 'VENDOR_INVOICE_VOIDED', id, { reason: dto.reason, actor });
    return invoice;
  }

  private async _writeOutbox(tenantId: string, eventType: string, aggregateId: string, payload: Record<string, unknown>) {
    try {
      await this.prisma.outboxEvent.create({ data: { tenantId, eventType, payload: { aggregateId, ...payload } } });
    } catch {
      // Non-fatal
    }
  }
}
