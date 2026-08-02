import { inject, injectable } from 'tsyringe';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface SetVendorBoxRuleDTO {
  vendorId: string;
  taxYear: number;
  /** 1099-MISC | 1099-NEC | T4A */
  formType: string;
  boxCode: string;
}

export interface SetThresholdConfigDTO {
  formType: string;
  taxYear: number;
  thresholdAmount: number;
}

export interface PostCorrectionDTO {
  vendorId: string;
  taxYear: number;
  formType: string;
  correctedAmount: number;
  reason: string;
}

const VALID_FORM_TYPES = new Set(['1099-MISC', '1099-NEC', 'T4A']);

// ── Errors ───────────────────────────────────────────────────────────────────

export class Vendor1099ValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'Vendor1099ValidationError';
  }
}

export class Vendor1099VendorNotFoundError extends Error {
  constructor(id: string) {
    super(`Vendor not found: ${id}`);
    this.name = 'Vendor1099VendorNotFoundError';
  }
}

export class Vendor1099BoxRuleNotFoundError extends Error {
  constructor(id: string) {
    super(`1099/T4A vendor box rule not found: ${id}`);
    this.name = 'Vendor1099BoxRuleNotFoundError';
  }
}

/**
 * CE-09 S037 — per-vendor 1099/T4A flag rules (box/class) and a
 * year-preview report that reconciles byte-exactly to posted payments.
 *
 * Design principles (matching every prior CE-09 story's conventions):
 *  - Accumulation is NEVER stored redundantly — the year-preview always
 *    sums ApManualPayment.amount live, at read time, restricted to
 *    status = 'POSTED' rows for the vendor within the calendar tax year
 *    (paymentDate). This makes "preview totals reconcile byte-exactly to
 *    posted payments" (AC) a structural guarantee rather than a value
 *    that could drift from a cached column.
 *  - Corrections (Ap1099Correction) are an explicit, audited, additive
 *    adjustment layered on top of the live-computed total — they never
 *    mutate or replace the underlying ApManualPayment rows. The preview
 *    always shows both the raw computed originalAmount and, if a
 *    correction exists, the correctedAmount plus the reason/actor.
 *  - Thresholds (Ap1099ThresholdConfig) are tenant SAFE_CONFIGURATION —
 *    never hardcoded in code. A vendor/tax-year/form-type with no
 *    threshold configured is reported with thresholdConfigured: false
 *    and belowThreshold: null (truthfully unknown), rather than silently
 *    defaulting to some assumed IRS/CRA figure.
 *  - PUTR: actual e-filing transmission (IRS FIRE / CRA XML submission)
 *    is explicitly EXCLUDED from this story's scope (compliance-vendor
 *    scope, see CE09_FABLE_EPIC_PACKAGE.md S037) — this service only
 *    produces a preview + audited corrections, never transmits anything.
 *    (Note: an earlier, unrelated S6-08 IRS FIRE export route already
 *    exists at POST /1099/export-fire using the legacy
 *    Vendor.is1099Misc/is1099Nec flags — this story does not touch or
 *    extend that export path.)
 */
@injectable()
export class Vendor1099Service {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
  ) {}

  // ── Vendor box rules ─────────────────────────────────────────────────────

  async setVendorBoxRule(tenantId: string, dto: SetVendorBoxRuleDTO, actor = 'system', correlationId?: string) {
    if (!dto.vendorId?.trim()) throw new Vendor1099ValidationError('VENDOR_ID_REQUIRED', 'vendorId is required');
    if (!dto.taxYear || !Number.isInteger(dto.taxYear)) throw new Vendor1099ValidationError('TAX_YEAR_REQUIRED', 'taxYear must be an integer');
    if (!dto.formType || !VALID_FORM_TYPES.has(dto.formType)) {
      throw new Vendor1099ValidationError('INVALID_FORM_TYPE', `formType must be one of: ${Array.from(VALID_FORM_TYPES).join(', ')}`);
    }
    if (!dto.boxCode?.trim()) throw new Vendor1099ValidationError('BOX_CODE_REQUIRED', 'boxCode is required');

    const vendor = await this.prisma.vendor.findFirst({ where: { id: dto.vendorId, tenantId } });
    if (!vendor) throw new Vendor1099VendorNotFoundError(dto.vendorId);

    return this.prisma.$transaction(async (tx: any) => {
      const existing = await tx.ap1099VendorBoxRule.findFirst({
        where: { tenantId, vendorId: dto.vendorId, taxYear: dto.taxYear, formType: dto.formType },
      });

      const rule = existing
        ? await tx.ap1099VendorBoxRule.update({ where: { id: existing.id }, data: { boxCode: dto.boxCode } })
        : await tx.ap1099VendorBoxRule.create({
            data: { tenantId, vendorId: dto.vendorId, taxYear: dto.taxYear, formType: dto.formType, boxCode: dto.boxCode, createdBy: actor },
          });

      await tx.auditOutboxEvent.create({
        data: {
          tenantId, docType: 'Ap1099VendorBoxRule', docId: rule.id,
          action: existing ? 'UPDATED' : 'CREATED', before: existing ?? null, after: rule,
          actor, correlationId: correlationId ?? null,
        },
      });

      return rule;
    });
  }

  async listVendorBoxRules(tenantId: string, vendorId?: string, taxYear?: number) {
    return this.prisma.ap1099VendorBoxRule.findMany({
      where: { tenantId, ...(vendorId ? { vendorId } : {}), ...(taxYear ? { taxYear } : {}) },
      orderBy: [{ taxYear: 'desc' }, { createdAt: 'asc' }],
    });
  }

  // ── Threshold config (tenant SAFE_CONFIGURATION) ────────────────────────

  async setThresholdConfig(tenantId: string, dto: SetThresholdConfigDTO, actor = 'system', correlationId?: string) {
    if (!dto.formType || !VALID_FORM_TYPES.has(dto.formType)) {
      throw new Vendor1099ValidationError('INVALID_FORM_TYPE', `formType must be one of: ${Array.from(VALID_FORM_TYPES).join(', ')}`);
    }
    if (!dto.taxYear || !Number.isInteger(dto.taxYear)) throw new Vendor1099ValidationError('TAX_YEAR_REQUIRED', 'taxYear must be an integer');
    if (dto.thresholdAmount == null || dto.thresholdAmount < 0) {
      throw new Vendor1099ValidationError('THRESHOLD_AMOUNT_INVALID', 'thresholdAmount must be a non-negative number');
    }

    return this.prisma.$transaction(async (tx: any) => {
      const existing = await tx.ap1099ThresholdConfig.findFirst({ where: { tenantId, formType: dto.formType, taxYear: dto.taxYear } });

      const config = existing
        ? await tx.ap1099ThresholdConfig.update({ where: { id: existing.id }, data: { thresholdAmount: dto.thresholdAmount } })
        : await tx.ap1099ThresholdConfig.create({
            data: { tenantId, formType: dto.formType, taxYear: dto.taxYear, thresholdAmount: dto.thresholdAmount },
          });

      await tx.auditOutboxEvent.create({
        data: {
          tenantId, docType: 'Ap1099ThresholdConfig', docId: config.id,
          action: existing ? 'UPDATED' : 'CREATED', before: existing ?? null, after: config,
          actor, correlationId: correlationId ?? null,
        },
      });

      return config;
    });
  }

  async listThresholdConfigs(tenantId: string, taxYear?: number) {
    return this.prisma.ap1099ThresholdConfig.findMany({ where: { tenantId, ...(taxYear ? { taxYear } : {}) } });
  }

  // ── Corrections (audited adjustment, never a silent edit) ───────────────

  async postCorrection(tenantId: string, dto: PostCorrectionDTO, actor = 'system', correlationId?: string) {
    if (!dto.vendorId?.trim()) throw new Vendor1099ValidationError('VENDOR_ID_REQUIRED', 'vendorId is required');
    if (!dto.taxYear || !Number.isInteger(dto.taxYear)) throw new Vendor1099ValidationError('TAX_YEAR_REQUIRED', 'taxYear must be an integer');
    if (!dto.formType || !VALID_FORM_TYPES.has(dto.formType)) {
      throw new Vendor1099ValidationError('INVALID_FORM_TYPE', `formType must be one of: ${Array.from(VALID_FORM_TYPES).join(', ')}`);
    }
    if (dto.correctedAmount == null || dto.correctedAmount < 0) {
      throw new Vendor1099ValidationError('CORRECTED_AMOUNT_INVALID', 'correctedAmount must be a non-negative number');
    }
    if (!dto.reason?.trim()) throw new Vendor1099ValidationError('REASON_REQUIRED', 'reason is required for a 1099/T4A correction');

    const vendor = await this.prisma.vendor.findFirst({ where: { id: dto.vendorId, tenantId } });
    if (!vendor) throw new Vendor1099VendorNotFoundError(dto.vendorId);

    // The correction is always taken relative to the live-computed
    // originalAmount at the moment it is posted — never a caller-supplied
    // "original", so a correction can never misrepresent what the ledger
    // actually showed at correction time.
    const originalAmount = await this._computeAccumulation(tenantId, dto.vendorId, dto.taxYear);

    return this.prisma.$transaction(async (tx: any) => {
      const correction = await tx.ap1099Correction.create({
        data: {
          tenantId, vendorId: dto.vendorId, taxYear: dto.taxYear, formType: dto.formType,
          originalAmount, correctedAmount: dto.correctedAmount, reason: dto.reason, createdBy: actor,
        },
      });

      await tx.auditOutboxEvent.create({
        data: {
          tenantId, docType: 'Ap1099Correction', docId: correction.id, action: 'CREATED',
          before: { originalAmount }, after: correction, actor, correlationId: correlationId ?? null,
        },
      });

      return correction;
    });
  }

  async listCorrections(tenantId: string, vendorId?: string, taxYear?: number) {
    return this.prisma.ap1099Correction.findMany({
      where: { tenantId, ...(vendorId ? { vendorId } : {}), ...(taxYear ? { taxYear } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Year preview ─────────────────────────────────────────────────────────

  /**
   * Computes, for every vendor holding at least one box rule for the
   * given taxYear, the vendor's posted-payment accumulation for that
   * calendar year — always recomputed live from ApManualPayment
   * (status = 'POSTED', paymentDate within [Jan 1, Dec 31] of taxYear) —
   * layered with the most recent correction (if any) and the configured
   * statutory threshold (if any).
   */
  async getYearPreview(tenantId: string, taxYear: number) {
    if (!taxYear || !Number.isInteger(taxYear)) throw new Vendor1099ValidationError('TAX_YEAR_REQUIRED', 'taxYear must be an integer');

    const rules = await this.prisma.ap1099VendorBoxRule.findMany({ where: { tenantId, taxYear } });
    const thresholds = await this.prisma.ap1099ThresholdConfig.findMany({ where: { tenantId, taxYear } });
    const thresholdByForm = new Map<string, number>(thresholds.map((t: any) => [t.formType, Number(t.thresholdAmount)]));

    const lines = [];
    for (const rule of rules) {
      const originalAmount = await this._computeAccumulation(tenantId, rule.vendorId, taxYear);

      const corrections = await this.prisma.ap1099Correction.findMany({
        where: { tenantId, vendorId: rule.vendorId, taxYear, formType: rule.formType },
        orderBy: { createdAt: 'desc' },
      });
      const latestCorrection = corrections[0] ?? null;
      const reportedAmount = latestCorrection ? Number(latestCorrection.correctedAmount) : originalAmount;

      const thresholdAmount = thresholdByForm.has(rule.formType) ? thresholdByForm.get(rule.formType)! : null;
      const belowThreshold = thresholdAmount === null ? null : reportedAmount < thresholdAmount;

      lines.push({
        vendorId: rule.vendorId,
        formType: rule.formType,
        boxCode: rule.boxCode,
        taxYear,
        originalAmount,
        reportedAmount,
        correctionApplied: !!latestCorrection,
        latestCorrection,
        thresholdConfigured: thresholdAmount !== null,
        thresholdAmount,
        belowThreshold,
      });
    }

    const totalReported = lines.reduce((sum, l) => sum + l.reportedAmount, 0);
    return {
      tenantId,
      taxYear,
      lines,
      totalReported,
      // PUTR: e-filing transmission (IRS FIRE / CRA XML submission) is
      // explicitly EXCLUDED from this story — compliance-vendor scope.
      efileTransmissionStatus: 'NOT_IN_SCOPE_COMPLIANCE_VENDOR',
    };
  }

  /** Sums posted ApManualPayment rows for the vendor within the calendar
   * tax year — this is the single source of truth for accumulation; it
   * is never cached in a mutable column, guaranteeing byte-exact
   * reconciliation to the underlying posted payments (AC). */
  private async _computeAccumulation(tenantId: string, vendorId: string, taxYear: number): Promise<number> {
    const yearStart = new Date(Date.UTC(taxYear, 0, 1));
    const yearEnd = new Date(Date.UTC(taxYear + 1, 0, 1));
    const payments = await this.prisma.apManualPayment.findMany({
      where: {
        tenantId, vendorId, status: 'POSTED',
        paymentDate: { gte: yearStart, lt: yearEnd },
      },
    });
    return payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
  }
}
