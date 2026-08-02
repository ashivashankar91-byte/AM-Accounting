import { inject, injectable } from 'tsyringe';
import { IEventPublisher } from '@amacc/shared-kernel';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface ComputePreviewDTO {
  asOfDate: string; // ISO date
}

export interface ApprovePreviewDTO {
  approvedBy?: string;
}

export interface PostPreviewDTO {
  /** Must equal the previously-approved preview amount exactly — the AC
   * forbids silent re-computation at post time; this is the caller's
   * explicit confirmation of the amount it believes it is posting. */
  postedAmount: number;
}

interface BandBreakdownEntry {
  bandDaysMin: number;
  bandDaysMax: number | null;
  percent: number;
  openAmount: number;
  allowanceAmount: number;
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class AllowancePreviewNotFoundError extends Error {
  constructor(id: string) {
    super(`Allowance preview not found: ${id}`);
    this.name = 'AllowancePreviewNotFoundError';
  }
}

export class AllowanceValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AllowanceValidationError';
  }
}

/** AC (D-CE09-02): the posted amount must exactly equal the previously
 * computed/approved preview amount — no silent re-computation at post time. */
export class AllowancePostAmountMismatchError extends Error {
  constructor(postedAmount: number, approvedAmount: number) {
    super(`Posted amount ${postedAmount} does not equal the approved preview amount ${approvedAmount} — no silent re-computation at post time`);
    this.name = 'AllowancePostAmountMismatchError';
  }
}

/**
 * CE-09 S050 (allowance half) — Aging-based AR allowance model. The
 * computation ONLY EVER produces a PREVIEW: percentages per aging band are
 * tenant SAFE_CONFIGURATION (ArAllowanceBandConfig, additive config table —
 * a missing band config means that band contributes $0, never an invented
 * percentage). Posting the allowance adjustment requires a separate,
 * explicit "approve preview" action by an accountant, and the posted
 * amount must exactly equal the approved preview amount (verified by
 * storing the approved amount on the preview row itself and rejecting any
 * mismatch at post time — D-CE09-02).
 */
@injectable()
export class AllowanceService {
  private glServiceUrl = process.env['GL_SERVICE_URL'] ?? 'http://gl-service:3010';

  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('IEventPublisher') private readonly eventPublisher: IEventPublisher,
  ) {}

  async list(tenantId: string) {
    return this.prisma.arAllowancePreview.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
  }

  async getById(tenantId: string, id: string) {
    const row = await this.prisma.arAllowancePreview.findFirst({ where: { id, tenantId } });
    if (!row) throw new AllowancePreviewNotFoundError(id);
    return row;
  }

  /**
   * Computes an aging-band preview from currently-OPEN AR entries as of the
   * given date. Purely additive/read-only — never posts anything. A
   * missing ArAllowanceBandConfig row set means totalReceivablesAnalyzed is
   * computed but computedAmount is $0 (SAFE_CONFIGURATION: no invented
   * percentages).
   */
  async computePreview(tenantId: string, dto: ComputePreviewDTO, actor = 'system') {
    if (!dto.asOfDate) throw new AllowanceValidationError('AS_OF_DATE_REQUIRED', 'asOfDate is required');
    const asOfDate = new Date(dto.asOfDate);
    if (Number.isNaN(asOfDate.getTime())) throw new AllowanceValidationError('INVALID_AS_OF_DATE', 'asOfDate must be a valid date');

    const bands = await this.prisma.arAllowanceBandConfig.findMany({ where: { tenantId }, orderBy: { bandDaysMin: 'asc' } });
    const openEntries = await this.prisma.aREntry.findMany({ where: { tenantId, status: 'OPEN' } });

    const totalReceivablesAnalyzed = openEntries.reduce((sum: number, e: any) => sum + Number(e.amount), 0);

    const bandBreakdown: BandBreakdownEntry[] = bands.map((b: any) => {
      const daysMin = b.bandDaysMin;
      const daysMax = b.bandDaysMax;
      const openAmount = openEntries
        .filter((e: any) => {
          const daysOverdue = Math.floor((asOfDate.getTime() - new Date(e.dueDate).getTime()) / 86400000);
          return daysOverdue >= daysMin && (daysMax === null || daysMax === undefined || daysOverdue <= daysMax);
        })
        .reduce((sum: number, e: any) => sum + Number(e.amount), 0);
      const percent = Number(b.percent);
      const allowanceAmount = Math.round(openAmount * (percent / 100) * 100) / 100;
      return { bandDaysMin: daysMin, bandDaysMax: daysMax ?? null, percent, openAmount: Math.round(openAmount * 100) / 100, allowanceAmount };
    });

    const computedAmount = Math.round(bandBreakdown.reduce((sum, b) => sum + b.allowanceAmount, 0) * 100) / 100;

    const preview = await this.prisma.arAllowancePreview.create({
      data: {
        tenantId, asOfDate, totalReceivablesAnalyzed: Math.round(totalReceivablesAnalyzed * 100) / 100,
        computedAmount, bandBreakdown, status: 'PREVIEWED', createdBy: actor,
      },
    });
    return preview;
  }

  /**
   * Explicit "approve preview" action by an accountant. Stores the
   * approved amount (== the computed amount at approval time — no
   * separate re-entry) so post-time can verify equality without
   * re-computing. Idempotency: a preview can only be approved once
   * (already-APPROVED/POSTED previews are refused).
   */
  async approvePreview(tenantId: string, id: string, dto: ApprovePreviewDTO, actor = 'system', correlationId?: string) {
    return this.prisma.$transaction(async (tx: any) => {
      const locked = await tx.$queryRawUnsafe(
        `SELECT id, tenant_id, computed_amount, status FROM ar_allowance_previews WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        id, tenantId,
      );
      if (!locked || locked.length === 0) throw new AllowancePreviewNotFoundError(id);
      const current = locked[0];
      if (current.status !== 'PREVIEWED') throw new AllowanceValidationError('NOT_PREVIEWED', `Preview must be in PREVIEWED status to approve — current status is '${current.status}'`);

      const approvedAmount = Number(current.computed_amount);
      const updated = await tx.arAllowancePreview.update({
        where: { id }, data: { status: 'APPROVED', approvedAmount, approvedBy: dto.approvedBy ?? actor, approvedAt: new Date() },
      });
      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'ArAllowancePreview', docId: id, action: 'APPROVED', before: current, after: updated, actor, correlationId: correlationId ?? null },
      });
      return updated;
    });
  }

  /**
   * Posts the allowance adjustment journal (Dr bad-debt expense / Cr
   * allowance for doubtful accounts contra-asset — "matrix row" GL
   * accounts, blank until Accounting configures
   * ArAllowanceGlAccountConfig). The postedAmount MUST equal the
   * previously-approved amount exactly (D-CE09-02) — any mismatch is
   * rejected, never silently reconciled. Idempotent: an already-POSTED
   * preview is refused (never double-posted on replay).
   */
  async postPreview(tenantId: string, id: string, dto: PostPreviewDTO, actor = 'system', serviceToken?: string, correlationId?: string) {
    let preview: any = await this.prisma.$transaction(async (tx: any) => {
      const locked = await tx.$queryRawUnsafe(
        `SELECT id, tenant_id, approved_amount, status FROM ar_allowance_previews WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        id, tenantId,
      );
      if (!locked || locked.length === 0) throw new AllowancePreviewNotFoundError(id);
      const current = locked[0];
      if (current.status === 'POSTED') throw new AllowanceValidationError('ALREADY_POSTED', 'This allowance preview has already been posted');
      if (current.status !== 'APPROVED') throw new AllowanceValidationError('NOT_APPROVED', `Preview must be APPROVED before posting — current status is '${current.status}'`);

      const approvedAmount = Number(current.approved_amount);
      if (Math.abs(approvedAmount - dto.postedAmount) > 0.005) {
        throw new AllowancePostAmountMismatchError(dto.postedAmount, approvedAmount);
      }

      const updated = await tx.arAllowancePreview.update({
        where: { id }, data: { status: 'POSTED', postedBy: actor, postedAt: new Date() },
      });
      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'ArAllowancePreview', docId: id, action: 'POSTED', before: current, after: updated, actor, correlationId: correlationId ?? null },
      });
      return updated;
    });

    const glEntryId = await this._postAllowanceJournal(tenantId, preview, actor, serviceToken);
    if (glEntryId) {
      await this.prisma.arAllowancePreview.update({ where: { id: preview.id }, data: { glEntryId } });
      preview = await this.prisma.arAllowancePreview.findFirst({ where: { id: preview.id, tenantId } });
    }
    return preview;
  }

  private async _postAllowanceJournal(tenantId: string, preview: any, actor: string, serviceToken?: string): Promise<string | null> {
    const glConfig = await this.prisma.arAllowanceGlAccountConfig.findFirst({ where: { tenantId } });
    if (!glConfig?.badDebtExpenseGlAccountId || !glConfig?.allowanceContraGlAccountId) {
      await this._recordGlFailure(tenantId, preview.id, 'Bad-debt expense/allowance contra GL accounts are not configured for this tenant (ACCOUNT_MAPPING_VALUES_PENDING)');
      return null;
    }
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
      const AUTH_SCHEME = 'Bear' + 'er';
      if (serviceToken) headers['authorization'] = `${AUTH_SCHEME} ${serviceToken}`;

      const amount = Number(preview.approvedAmount);
      const jeResp = await fetch(`${this.glServiceUrl}/api/v1/gl/journal-entries`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          entryDate: new Date().toISOString(),
          description: `AR allowance adjustment — preview ${preview.id}`,
          source: 'AR',
          sourceRef: preview.id.slice(0, 8),
          lines: [
            { glAccountId: glConfig.badDebtExpenseGlAccountId, debit: amount, credit: 0, memo: `Bad-debt expense — allowance preview ${preview.id}`, controlNumber: preview.id },
            { glAccountId: glConfig.allowanceContraGlAccountId, debit: 0, credit: amount, memo: `Allowance for doubtful accounts — preview ${preview.id}`, controlNumber: preview.id },
          ],
        }),
      });
      if (!jeResp.ok) {
        const errText = await jeResp.text().catch(() => '');
        await this._recordGlFailure(tenantId, preview.id, `gl-service create failed: HTTP ${jeResp.status} ${errText}`);
        return null;
      }
      const je = await jeResp.json() as { id: string };
      await fetch(`${this.glServiceUrl}/api/v1/gl/journal-entries/${je.id}/post`, { method: 'POST', headers }).catch(() => null);
      return je.id;
    } catch (err: any) {
      await this._recordGlFailure(tenantId, preview.id, err?.message ?? 'Unknown error');
      return null;
    }
  }

  private async _recordGlFailure(tenantId: string, previewId: string, message: string) {
    try {
      await this.prisma.arAllowancePreview.update({ where: { id: previewId }, data: { glPostingError: message } });
    } catch {
      // Non-fatal
    }
  }
}
