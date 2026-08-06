import { injectable, inject } from 'tsyringe';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { appendAudit } from '../infrastructure/audit';
import { OemNotFoundError, OemValidationError } from '../domain/errors';

export interface ChargebackNoticeLineInput {
  originalClaimItemRef: string;
  amount: string;
}

/**
 * S105 — Warranty Audit Chargeback & Reserve. Accepted chargebacks always
 * post via a NEW contra item lineaged to the original S065 claim item —
 * applied history is never mutated (package: "standing conservation
 * boundary"). Reserve never goes debit (guard on draw).
 */
@injectable()
export class OemWarrantyService {
  constructor(@inject('PrismaClient') private readonly prisma: any) {}

  async createNotice(tenantId: string, storeId: string, make: string, sourceDocumentId: string | null, noticeDate: string, lines: ChargebackNoticeLineInput[], actor: string) {
    if (!lines?.length) throw new OemValidationError('LINES_REQUIRED', 'at least one chargeback line is required');
    const notice = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const created = await tx.oemWarrantyChargebackNotice.create({
        data: { tenantId, storeId, make: make.toUpperCase(), sourceDocumentId, noticeDate: new Date(noticeDate), receivedBy: actor },
      });
      await tx.oemWarrantyChargebackLine.createMany({
        data: lines.map((l) => ({ tenantId, noticeId: created.id, originalClaimItemRef: l.originalClaimItemRef, amount: l.amount })),
      });
      await appendAudit(tx, { tenantId, docType: 'OemWarrantyChargebackNotice', docId: created.id, action: 'CHARGEBACK_NOTICE_RECEIVED', actor, after: { noticeId: created.id, lineCount: lines.length } });
      return tx.oemWarrantyChargebackNotice.findFirst({ where: { id: created.id }, include: { lines: true } });
    });
    return notice;
  }

  async getNotice(tenantId: string, id: string) {
    const notice = await this.prisma.oemWarrantyChargebackNotice.findFirst({ where: { tenantId, id }, include: { lines: { include: { evidence: true } } } });
    if (!notice) throw new OemNotFoundError('OemWarrantyChargebackNotice', id);
    return notice;
  }

  async listNotices(tenantId: string, storeId?: string) {
    return this.prisma.oemWarrantyChargebackNotice.findMany({ where: { tenantId, ...(storeId ? { storeId } : {}) }, include: { lines: true }, orderBy: { receivedAt: 'desc' } });
  }

  /**
   * ACCEPT: creates a contra item lineaged to the original claim — never
   * mutates the original applied claim history. DISPUTE: posts nothing;
   * attach evidence via addEvidence.
   */
  async disposeLine(tenantId: string, lineId: string, disposition: 'ACCEPTED' | 'DISPUTED', actor: string) {
    const line = await this.prisma.oemWarrantyChargebackLine.findFirst({ where: { tenantId, id: lineId } });
    if (!line) throw new OemNotFoundError('OemWarrantyChargebackLine', lineId);
    if (line.disposition !== 'PENDING') throw new OemValidationError('ALREADY_DISPOSITIONED', 'line already dispositioned');

    const contraItemRef = disposition === 'ACCEPTED' ? `CONTRA-${lineId}` : null;
    const updated = await this.prisma.oemWarrantyChargebackLine.update({
      where: { id: lineId },
      data: { disposition, contraItemRef, dispositionedAt: new Date(), dispositionedBy: actor },
    });
    await appendAudit(this.prisma, {
      tenantId, docType: 'OemWarrantyChargebackLine', docId: lineId,
      action: disposition === 'ACCEPTED' ? 'CHARGEBACK_ACCEPTED' : 'CHARGEBACK_DISPUTED', actor, before: line, after: updated,
    });
    return updated;
  }

  async addEvidence(tenantId: string, chargebackLineId: string, evidenceRef: string, note: string | null, actor: string) {
    const line = await this.prisma.oemWarrantyChargebackLine.findFirst({ where: { tenantId, id: chargebackLineId } });
    if (!line) throw new OemNotFoundError('OemWarrantyChargebackLine', chargebackLineId);
    const created = await this.prisma.oemWarrantyDisputeEvidence.create({
      data: { tenantId, chargebackLineId, evidenceRef, note, uploadedBy: actor },
    });
    await appendAudit(this.prisma, { tenantId, docType: 'OemWarrantyDisputeEvidence', docId: created.id, action: 'DISPUTE_EVIDENCE_ATTACHED', actor, after: created });
    return created;
  }

  async setReserveConfig(tenantId: string, storeId: string, ratePercent: string, effectiveFrom: string, actor: string) {
    const created = await this.prisma.oemWarrantyReserveConfig.create({
      data: { tenantId, storeId, ratePercent, effectiveFrom: new Date(effectiveFrom), createdBy: actor },
    });
    await appendAudit(this.prisma, { tenantId, docType: 'OemWarrantyReserveConfig', docId: created.id, action: 'RESERVE_CONFIG_SET', actor, after: created });
    return created;
  }

  async getActiveReserveConfig(tenantId: string, storeId: string) {
    return this.prisma.oemWarrantyReserveConfig.findFirst({ where: { tenantId, storeId, active: true }, orderBy: { effectiveFrom: 'desc' } });
  }

  /**
   * paidWarrantyVolume is ENTERED evidence for the period (package: "rate =
   * tenant config from experience; ... no invented actuarial model") — the
   * real CE-11 paid-claim volume feed is PENDING_UPSTREAM_TECHNICAL_
   * RECONCILIATION, so this never silently derives volume from a fixture;
   * the accountant enters the figure they're previewing against.
   */
  async previewReserve(tenantId: string, storeId: string, period: string, paidWarrantyVolume: string, actor: string) {
    const config = await this.getActiveReserveConfig(tenantId, storeId);
    if (!config) throw new OemValidationError('NO_RESERVE_CONFIG', 'no active warranty reserve rate configured for this store');
    const computedAccrual = (Number(paidWarrantyVolume) * Number(config.ratePercent) / 100).toFixed(2);
    const existing = await this.prisma.oemWarrantyReservePreview.findUnique({ where: { tenantId_storeId_period: { tenantId, storeId, period } } });
    const preview = existing
      ? await this.prisma.oemWarrantyReservePreview.update({ where: { id: existing.id }, data: { paidWarrantyVolume, computedAccrual, status: 'PREVIEW' } })
      : await this.prisma.oemWarrantyReservePreview.create({ data: { tenantId, storeId, period, paidWarrantyVolume, computedAccrual, status: 'PREVIEW' } });
    await appendAudit(this.prisma, { tenantId, docType: 'OemWarrantyReservePreview', docId: preview.id, action: 'RESERVE_PREVIEWED', actor, after: preview });
    return preview;
  }

  async approveReservePreview(tenantId: string, previewId: string, actor: string) {
    const preview = await this.prisma.oemWarrantyReservePreview.findFirst({ where: { tenantId, id: previewId } });
    if (!preview) throw new OemNotFoundError('OemWarrantyReservePreview', previewId);
    if (preview.status !== 'PREVIEW') throw new OemValidationError('NOT_PREVIEWABLE', 'preview is not in PREVIEW status');
    const updated = await this.prisma.oemWarrantyReservePreview.update({ where: { id: previewId }, data: { status: 'APPROVED', approvedAt: new Date(), approvedBy: actor } });
    await appendAudit(this.prisma, { tenantId, docType: 'OemWarrantyReservePreview', docId: previewId, action: 'RESERVE_APPROVED', actor, before: preview, after: updated });
    return updated;
  }

  /** Draw guard: reserve balance never goes debit — excess spills to expense. */
  async drawReserve(tenantId: string, storeId: string, chargebackLineId: string, actor: string) {
    const line = await this.prisma.oemWarrantyChargebackLine.findFirst({ where: { tenantId, id: chargebackLineId } });
    if (!line) throw new OemNotFoundError('OemWarrantyChargebackLine', chargebackLineId);
    if (line.disposition !== 'ACCEPTED') throw new OemValidationError('NOT_ACCEPTED', 'can only draw against an accepted chargeback line');

    return this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const rollforward = await this.computeRollforwardTx(tx, tenantId, storeId);
      const lineAmount = Number(line.amount);
      const drawAmount = Math.min(rollforward.balance, lineAmount);
      const excessToExpense = Math.max(0, lineAmount - rollforward.balance);

      const draw = await tx.oemWarrantyReserveDraw.create({
        data: { tenantId, storeId, chargebackLineId, drawAmount: drawAmount.toFixed(2), excessToExpense: excessToExpense.toFixed(2), drawnBy: actor },
      });
      await appendAudit(tx, { tenantId, docType: 'OemWarrantyReserveDraw', docId: draw.id, action: 'RESERVE_DRAWN', actor, after: draw });
      return draw;
    });
  }

  private async computeRollforwardTx(tx: any, tenantId: string, storeId: string) {
    const approved = await tx.oemWarrantyReservePreview.findMany({ where: { tenantId, storeId, status: { in: ['APPROVED', 'POSTED'] } } });
    const draws = await tx.oemWarrantyReserveDraw.findMany({ where: { tenantId, storeId } });
    const totalApproved = approved.reduce((sum: number, p: any) => sum + Number(p.computedAccrual), 0);
    const totalDrawn = draws.reduce((sum: number, d: any) => sum + Number(d.drawAmount), 0);
    const balance = Math.max(0, totalApproved - totalDrawn);
    return { totalApproved, totalDrawn, balance, drawCount: draws.length };
  }

  async reserveRollforward(tenantId: string, storeId: string) {
    return this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      return this.computeRollforwardTx(tx, tenantId, storeId);
    });
  }
}
