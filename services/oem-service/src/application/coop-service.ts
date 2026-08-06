import { injectable, inject } from 'tsyringe';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { appendAudit } from '../infrastructure/audit';
import { OemNotFoundError, OemValidationError } from '../domain/errors';
import type { ApDocumentSource } from '../domain/upstream-ap-docs';

/**
 * S106 — Co-op Advertising Claims. Claim package totals = selected spend
 * exactly; response entry drives item creation per line; denial write-off
 * conserves; accrual = approved preview. No fabricated response path
 * exists — recordResponse only ever records an ENTERED (externally
 * obtained) response, never synthesizes one.
 */
@injectable()
export class OemCoopService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('ApDocumentSource') private readonly apDocs: ApDocumentSource,
  ) {}

  private async getProfileId(tenantId: string, make: string): Promise<string> {
    const profile = await this.prisma.oemIntegrationProfile.findUnique({ where: { tenantId_make: { tenantId, make: make.toUpperCase() } } });
    if (!profile) throw new OemValidationError('NO_PROFILE', `No OEM profile configured for make ${make.toUpperCase()}`);
    return profile.id;
  }

  async registerProgram(tenantId: string, make: string, programId: string, accrualBasis: 'PERCENT_OF_SALES' | 'ENTERED_TERMS', ratePercent: string | null, termsSummary: string | null, actor: string) {
    const profileId = await this.getProfileId(tenantId, make);
    const created = await this.prisma.oemCoopProgram.create({
      data: { tenantId, profileId, make: make.toUpperCase(), programId, accrualBasis, ratePercent, termsSummary },
    });
    await appendAudit(this.prisma, { tenantId, docType: 'OemCoopProgram', docId: created.id, action: 'COOP_PROGRAM_REGISTERED', actor, after: created });
    return created;
  }

  async listPrograms(tenantId: string) {
    return this.prisma.oemCoopProgram.findMany({ where: { tenantId }, orderBy: { make: 'asc' } });
  }

  async createClaim(tenantId: string, storeId: string, programId: string, actor: string) {
    const program = await this.prisma.oemCoopProgram.findFirst({ where: { tenantId, id: programId } });
    if (!program) throw new OemNotFoundError('OemCoopProgram', programId);
    const created = await this.prisma.oemCoopClaim.create({ data: { tenantId, storeId, programId, status: 'DRAFT', createdBy: actor } });
    await appendAudit(this.prisma, { tenantId, docType: 'OemCoopClaim', docId: created.id, action: 'COOP_CLAIM_CREATED', actor, after: created });
    return created;
  }

  async addClaimLine(tenantId: string, claimId: string, spendItemRef: string, description: string, amount: string, evidenceRef: string, actor: string) {
    const claim = await this.prisma.oemCoopClaim.findFirst({ where: { tenantId, id: claimId } });
    if (!claim) throw new OemNotFoundError('OemCoopClaim', claimId);
    if (claim.status !== 'DRAFT') throw new OemValidationError('CLAIM_NOT_DRAFT', 'can only add lines to a DRAFT claim');
    if (!evidenceRef?.trim()) throw new OemValidationError('EVIDENCE_REQUIRED', 'evidenceRef is required for every co-op claim line');

    // PENDING_UPSTREAM_TECHNICAL_RECONCILIATION — CE-09's AP document
    // linkage is not wired; best-effort enrichment only, never blocks the
    // line (the entered evidenceRef/description/amount is the record of
    // truth either way).
    await this.apDocs.findApDocument(tenantId, spendItemRef);

    return this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const line = await tx.oemCoopClaimLine.create({
        data: { tenantId, claimId, spendItemRef, description, amount, evidenceRef },
      });
      const totalSpend = (Number(claim.totalSpend) + Number(amount)).toFixed(2);
      await tx.oemCoopClaim.update({ where: { id: claimId }, data: { totalSpend } });
      await appendAudit(tx, { tenantId, docType: 'OemCoopClaimLine', docId: line.id, action: 'COOP_CLAIM_LINE_ADDED', actor, after: line });
      return line;
    });
  }

  async getClaim(tenantId: string, id: string) {
    const claim = await this.prisma.oemCoopClaim.findFirst({ where: { tenantId, id }, include: { lines: true } });
    if (!claim) throw new OemNotFoundError('OemCoopClaim', id);
    return claim;
  }

  async listClaims(tenantId: string, storeId?: string) {
    return this.prisma.oemCoopClaim.findMany({ where: { tenantId, ...(storeId ? { storeId } : {}) }, include: { lines: true }, orderBy: { createdAt: 'desc' } });
  }

  async exportClaim(tenantId: string, claimId: string, actor: string) {
    const claim = await this.getClaim(tenantId, claimId);
    if (claim.status !== 'DRAFT') throw new OemValidationError('CLAIM_NOT_DRAFT', 'claim already exported');
    if (claim.lines.length === 0) throw new OemValidationError('NO_LINES', 'cannot export a claim with no spend lines');
    const linesSum = claim.lines.reduce((sum: number, l: any) => sum + Number(l.amount), 0);
    if (Math.abs(linesSum - Number(claim.totalSpend)) > 0.005) {
      throw new OemValidationError('TOTAL_MISMATCH', 'claim totalSpend does not equal the sum of its lines');
    }
    const updated = await this.prisma.oemCoopClaim.update({ where: { id: claimId }, data: { status: 'EXPORTED', exportedAt: new Date(), exportedBy: actor } });
    await appendAudit(this.prisma, { tenantId, docType: 'OemCoopClaim', docId: claimId, action: 'COOP_CLAIM_EXPORTED', actor, before: claim, after: updated });
    return updated;
  }

  /** Records an ENTERED (externally obtained) factory response — never synthesizes one. */
  async recordLineResponse(tenantId: string, claimLineId: string, responseStatus: 'APPROVED' | 'DENIED' | 'PARTIAL', approvedAmount: string | null, actor: string) {
    const line = await this.prisma.oemCoopClaimLine.findFirst({ where: { tenantId, id: claimLineId } });
    if (!line) throw new OemNotFoundError('OemCoopClaimLine', claimLineId);
    if (line.responseStatus !== 'PENDING') throw new OemValidationError('ALREADY_RESPONDED', 'line already has a recorded response');
    if ((responseStatus === 'APPROVED' || responseStatus === 'PARTIAL') && !approvedAmount) {
      throw new OemValidationError('APPROVED_AMOUNT_REQUIRED', 'approvedAmount is required for APPROVED/PARTIAL');
    }

    const finalApproved = responseStatus === 'DENIED' ? '0.00' : approvedAmount!;
    const receivableItemRef = responseStatus === 'DENIED' ? null : `COOP-RECV-${claimLineId}`;

    const updated = await this.prisma.oemCoopClaimLine.update({
      where: { id: claimLineId },
      data: { responseStatus, approvedAmount: finalApproved, receivableItemRef, respondedAt: new Date(), respondedBy: actor },
    });
    await appendAudit(this.prisma, { tenantId, docType: 'OemCoopClaimLine', docId: claimLineId, action: 'COOP_RESPONSE_RECORDED', actor, before: line, after: updated });
    return updated;
  }

  /** Denial write-off — conserves: writeOffAmount = full claimed amount. */
  async writeOffDenied(tenantId: string, claimLineId: string, actor: string) {
    const line = await this.prisma.oemCoopClaimLine.findFirst({ where: { tenantId, id: claimLineId } });
    if (!line) throw new OemNotFoundError('OemCoopClaimLine', claimLineId);
    if (line.responseStatus !== 'DENIED') throw new OemValidationError('NOT_DENIED', 'write-off only applies to a DENIED line');
    if (line.writeOffAmount) throw new OemValidationError('ALREADY_WRITTEN_OFF', 'line already written off');
    const updated = await this.prisma.oemCoopClaimLine.update({ where: { id: claimLineId }, data: { writeOffAmount: line.amount } });
    await appendAudit(this.prisma, { tenantId, docType: 'OemCoopClaimLine', docId: claimLineId, action: 'COOP_DENIAL_WRITTEN_OFF', actor, before: line, after: updated });
    return updated;
  }

  /** periodQualifyingSalesAmount is ENTERED evidence — same "no invented
   * actuarial model" discipline as S105's reserve preview. */
  async previewAccrual(tenantId: string, storeId: string, programId: string, period: string, periodQualifyingSalesAmount: string, actor: string) {
    const program = await this.prisma.oemCoopProgram.findFirst({ where: { tenantId, id: programId } });
    if (!program) throw new OemNotFoundError('OemCoopProgram', programId);
    if (program.accrualBasis !== 'PERCENT_OF_SALES' || !program.ratePercent) {
      throw new OemValidationError('NOT_PERCENT_BASIS', 'accrual preview requires a PERCENT_OF_SALES program with a configured rate');
    }
    const computedAmount = (Number(periodQualifyingSalesAmount) * Number(program.ratePercent) / 100).toFixed(2);
    const existing = await this.prisma.oemCoopAccrualPreview.findUnique({ where: { tenantId_storeId_programId_period: { tenantId, storeId, programId, period } } });
    const preview = existing
      ? await this.prisma.oemCoopAccrualPreview.update({ where: { id: existing.id }, data: { computedAmount, status: 'PREVIEW' } })
      : await this.prisma.oemCoopAccrualPreview.create({ data: { tenantId, storeId, programId, period, computedAmount, status: 'PREVIEW' } });
    await appendAudit(this.prisma, { tenantId, docType: 'OemCoopAccrualPreview', docId: preview.id, action: 'COOP_ACCRUAL_PREVIEWED', actor, after: preview });
    return preview;
  }

  async approveAccrual(tenantId: string, previewId: string, actor: string) {
    const preview = await this.prisma.oemCoopAccrualPreview.findFirst({ where: { tenantId, id: previewId } });
    if (!preview) throw new OemNotFoundError('OemCoopAccrualPreview', previewId);
    if (preview.status !== 'PREVIEW') throw new OemValidationError('NOT_PREVIEWABLE', 'preview is not in PREVIEW status');
    const updated = await this.prisma.oemCoopAccrualPreview.update({ where: { id: previewId }, data: { status: 'APPROVED', approvedAt: new Date(), approvedBy: actor } });
    await appendAudit(this.prisma, { tenantId, docType: 'OemCoopAccrualPreview', docId: previewId, action: 'COOP_ACCRUAL_APPROVED', actor, before: preview, after: updated });
    return updated;
  }
}
