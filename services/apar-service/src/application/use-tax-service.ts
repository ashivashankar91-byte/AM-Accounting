import { inject, injectable } from 'tsyringe';
import { IEventPublisher } from '@amacc/shared-kernel';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface AssessUseTaxDTO {
  jurisdiction: string;
  taxableAmount: number;
  /** Explicit manual rate — only used/required when no ApUseTaxRateConfig row
   * exists for (tenantId, jurisdiction). */
  manualRate?: number;
  attestationBasis?: string;
}

export interface UseTaxRegisterQuery {
  period: string; // YYYY-MM
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class InvoiceNotFoundForUseTaxError extends Error {
  constructor(id: string) {
    super(`Vendor invoice not found: ${id}`);
    this.name = 'InvoiceNotFoundForUseTaxError';
  }
}

export class UseTaxAssessmentValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'UseTaxAssessmentValidationError';
  }
}

export class UseTaxAssessmentAlreadyExistsError extends Error {
  constructor(invoiceId: string, assessmentType: string) {
    super(`Invoice ${invoiceId} already has a '${assessmentType}' assessment — never double-assessed on replay`);
    this.name = 'UseTaxAssessmentAlreadyExistsError';
  }
}

export class UseTaxAssessmentNotFoundError extends Error {
  constructor(id: string) {
    super(`Use-tax assessment not found: ${id}`);
    this.name = 'UseTaxAssessmentNotFoundError';
  }
}

/**
 * S042 — Use-Tax Self-Assessment. When a taxable AP invoice lacks
 * vendor-charged tax per jurisdiction rules, a clerk flags it for use-tax
 * self-assessment: this posts a standalone, self-balancing accrual journal
 * (Dr use-tax expense / Cr use-tax payable) via the same cross-service
 * gl-service HTTP posting pattern as S041/S043A, using tenant-configured
 * "matrix row" GL accounts (ap_use_tax_gl_account_configs — blank/nullable
 * until Accounting configures them, per the S023
 * ACCOUNT_MAPPING_VALUES_PENDING convention).
 *
 * Tax rate/jurisdiction determination is a CE-10 boundary — S042 consumes a
 * rate source (ApUseTaxRateConfig) if one is configured for the tenant's
 * jurisdiction; if none exists, the clerk must supply a manual rate with an
 * attestation (who/when/basis), recorded with rateSource =
 * ADAPTER_BOUNDARY_MANUAL_RATE — never a fabricated/guessed rate.
 *
 * Idempotency: the unique index on (tenantId, invoiceId, assessmentType)
 * is the sole guard against double-assessment on event replay — a second
 * attempt against an invoice that already has an ASSESSED row for the same
 * assessmentType is rejected (UseTaxAssessmentAlreadyExistsError), not
 * silently re-posted.
 */
@injectable()
export class UseTaxService {
  private glServiceUrl = process.env['GL_SERVICE_URL'] ?? 'http://gl-service:3010';
  private static readonly ASSESSMENT_TYPE = 'USE_TAX';

  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('IEventPublisher') private readonly eventPublisher: IEventPublisher,
  ) {}

  async list(tenantId: string, invoiceId?: string) {
    return this.prisma.apUseTaxAssessment.findMany({
      where: { tenantId, ...(invoiceId ? { invoiceId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(tenantId: string, id: string) {
    const row = await this.prisma.apUseTaxAssessment.findFirst({ where: { id, tenantId } });
    if (!row) throw new UseTaxAssessmentNotFoundError(id);
    return row;
  }

  /** AC: register total = Σ assessed lines for period. */
  async register(tenantId: string, query: UseTaxRegisterQuery) {
    const rows = await this.prisma.apUseTaxAssessment.findMany({
      where: { tenantId, period: query.period, status: 'ASSESSED' },
      orderBy: { createdAt: 'asc' },
    });
    const totalAssessed = rows.reduce((sum: number, r: any) => sum + Number(r.assessedAmount), 0);
    return {
      period: query.period,
      assessmentCount: rows.length,
      totalAssessed: Math.round(totalAssessed * 100) / 100,
      assessments: rows,
    };
  }

  async assess(tenantId: string, invoiceId: string, dto: AssessUseTaxDTO, actor = 'system', serviceToken?: string, correlationId?: string) {
    if (!dto.jurisdiction?.trim()) throw new UseTaxAssessmentValidationError('JURISDICTION_REQUIRED', 'A jurisdiction is required to assess use tax');
    if (!(dto.taxableAmount > 0)) throw new UseTaxAssessmentValidationError('INVALID_TAXABLE_AMOUNT', 'taxableAmount must be greater than zero');

    const invoice = await this.prisma.vendorInvoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!invoice) throw new InvoiceNotFoundForUseTaxError(invoiceId);
    if (invoice.status === 'VOID') throw new UseTaxAssessmentValidationError('INVOICE_VOID', 'Cannot assess use tax on a voided invoice');

    // Idempotency pre-check (the unique index is the actual guard under
    // concurrency — this is just a fast, friendly rejection path).
    const existing = await this.prisma.apUseTaxAssessment.findFirst({
      where: { tenantId, invoiceId, assessmentType: UseTaxService.ASSESSMENT_TYPE, status: 'ASSESSED' },
    });
    if (existing) throw new UseTaxAssessmentAlreadyExistsError(invoiceId, UseTaxService.ASSESSMENT_TYPE);

    const rateConfig = await this.prisma.apUseTaxRateConfig.findFirst({ where: { tenantId, jurisdiction: dto.jurisdiction } });

    let rate: number;
    let rateSource: string;
    let attestedBy: string | null = null;
    let attestedAt: Date | null = null;
    let attestationBasis: string | null = null;

    if (rateConfig) {
      rate = Number(rateConfig.rate);
      rateSource = 'RATE_SOURCE_CONFIGURED';
    } else {
      // CE-10 boundary — no rate source configured for this jurisdiction.
      if (dto.manualRate === undefined || dto.manualRate === null) {
        throw new UseTaxAssessmentValidationError(
          'MANUAL_RATE_REQUIRED',
          `No configured rate source for jurisdiction '${dto.jurisdiction}' — a manual rate + attestation is required [ADAPTER_BOUNDARY_MANUAL_RATE]`,
        );
      }
      if (!(dto.manualRate >= 0)) throw new UseTaxAssessmentValidationError('INVALID_MANUAL_RATE', 'manualRate must be zero or greater');
      if (!dto.attestationBasis?.trim()) {
        throw new UseTaxAssessmentValidationError('ATTESTATION_REQUIRED', 'attestationBasis is required when entering a manual use-tax rate');
      }
      rate = dto.manualRate;
      rateSource = 'ADAPTER_BOUNDARY_MANUAL_RATE';
      attestedBy = actor;
      attestedAt = new Date();
      attestationBasis = dto.attestationBasis;
    }

    const assessedAmount = Math.round(dto.taxableAmount * rate * 100) / 100;
    const period = new Date(invoice.invoiceDate).toISOString().slice(0, 7);

    let assessment: any;
    try {
      assessment = await this.prisma.$transaction(async (tx: any) => {
        const created = await tx.apUseTaxAssessment.create({
          data: {
            tenantId, invoiceId, assessmentType: UseTaxService.ASSESSMENT_TYPE, jurisdiction: dto.jurisdiction,
            taxableAmount: String(dto.taxableAmount), rateSource, rate: String(rate), assessedAmount: String(assessedAmount),
            period, attestedBy, attestedAt, attestationBasis, status: 'ASSESSED', createdBy: actor,
          },
        });
        await tx.auditOutboxEvent.create({
          data: { tenantId, docType: 'ApUseTaxAssessment', docId: created.id, action: 'CREATED', before: null, after: created, actor, correlationId: correlationId ?? null },
        });
        return created;
      });
    } catch (err: any) {
      // Unique-constraint race: two concurrent replays of the same event
      // both passed the pre-check — the DB constraint is the real guard.
      if (err?.code === 'P2002') throw new UseTaxAssessmentAlreadyExistsError(invoiceId, UseTaxService.ASSESSMENT_TYPE);
      throw err;
    }

    await this._writeOutbox(tenantId, 'AP_USE_TAX_ASSESSED', assessment.id, { invoiceId, jurisdiction: dto.jurisdiction, assessedAmount, actor });

    const glEntryId = await this._postAccrual(tenantId, invoice, assessment, actor, serviceToken);
    if (glEntryId) {
      await this.prisma.apUseTaxAssessment.update({ where: { id: assessment.id }, data: { glEntryId } });
      assessment = await this.prisma.apUseTaxAssessment.findFirst({ where: { id: assessment.id, tenantId } });
    }
    return assessment;
  }

  private async _postAccrual(tenantId: string, invoice: any, assessment: any, actor: string, serviceToken?: string): Promise<string | null> {
    const glConfig = await this.prisma.apUseTaxGlAccountConfig.findFirst({ where: { tenantId } });
    if (!glConfig?.useTaxExpenseGlAccountId || !glConfig?.useTaxPayableGlAccountId) {
      await this._recordGlFailure(tenantId, assessment.id, 'Use-tax expense/payable GL accounts are not configured for this tenant (ACCOUNT_MAPPING_VALUES_PENDING)');
      return null;
    }
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
      if (serviceToken) headers['authorization'] = `Bearer ${serviceToken}`;

      const amount = Number(assessment.assessedAmount);
      const jeResp = await fetch(`${this.glServiceUrl}/api/v1/gl/journal-entries`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          entryDate: new Date().toISOString(),
          description: `Use-tax self-assessment — invoice ${invoice.invoiceNumber} (${assessment.jurisdiction})`,
          source: 'AP',
          sourceRef: invoice.invoiceNumber.slice(0, 8),
          lines: [
            { glAccountId: glConfig.useTaxExpenseGlAccountId, debit: amount, credit: 0, memo: `Use-tax expense — invoice ${invoice.invoiceNumber}`, controlNumber: invoice.invoiceNumber },
            { glAccountId: glConfig.useTaxPayableGlAccountId, debit: 0, credit: amount, memo: `Use-tax payable — invoice ${invoice.invoiceNumber}`, controlNumber: invoice.invoiceNumber },
          ],
        }),
      });
      if (!jeResp.ok) {
        const errText = await jeResp.text().catch(() => '');
        await this._recordGlFailure(tenantId, assessment.id, `gl-service create failed: HTTP ${jeResp.status} ${errText}`);
        return null;
      }
      const je = await jeResp.json() as { id: string };
      await fetch(`${this.glServiceUrl}/api/v1/gl/journal-entries/${je.id}/post`, { method: 'POST', headers }).catch(() => null);
      return je.id;
    } catch (err: any) {
      await this._recordGlFailure(tenantId, assessment.id, err?.message ?? 'Unknown error');
      return null;
    }
  }

  private async _recordGlFailure(tenantId: string, assessmentId: string, message: string) {
    try {
      await this.prisma.apUseTaxAssessment.update({ where: { id: assessmentId }, data: { glPostingError: message } });
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
