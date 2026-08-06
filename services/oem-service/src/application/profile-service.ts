import { injectable, inject } from 'tsyringe';
import { appendAudit } from '../infrastructure/audit';
import { OemNotFoundError, OemValidationError } from '../domain/errors';

export interface OemProfileDTO {
  make: string;
  programName?: string | null;
  statementSpecVersion?: string | null;
  notes?: string | null;
}

const VALID_STATUSES = ['NOT_CONFIGURED', 'TEST_ONLY', 'CERTIFICATION_PENDING', 'CERTIFIED'] as const;
type ConnectionStatus = (typeof VALID_STATUSES)[number];

/**
 * S098 — OEM profile CRUD + the truthful connectionStatus enum. Package
 * "THE OEM BOUNDARY": CERTIFIED is settable only with a recorded
 * certification evidence reference — no code path here flips status to
 * CERTIFIED without one, and no path silently drops it either.
 */
@injectable()
export class OemProfileService {
  constructor(@inject('PrismaClient') private readonly prisma: any) {}

  async list(tenantId: string) {
    return this.prisma.oemIntegrationProfile.findMany({
      where: { tenantId },
      include: { dealerCodes: true },
      orderBy: { make: 'asc' },
    });
  }

  async getByMake(tenantId: string, make: string) {
    const profile = await this.prisma.oemIntegrationProfile.findUnique({
      where: { tenantId_make: { tenantId, make: make.toUpperCase() } },
      include: { dealerCodes: true },
    });
    if (!profile) throw new OemNotFoundError('OemIntegrationProfile', make);
    return profile;
  }

  async create(tenantId: string, dto: OemProfileDTO, actor: string) {
    if (!dto.make?.trim()) throw new OemValidationError('MAKE_REQUIRED', 'make is required');
    const created = await this.prisma.oemIntegrationProfile.create({
      data: {
        tenantId,
        make: dto.make.toUpperCase(),
        programName: dto.programName ?? null,
        statementSpecVersion: dto.statementSpecVersion ?? null,
        notes: dto.notes ?? null,
        connectionStatus: 'NOT_CONFIGURED',
      },
    });
    await appendAudit(this.prisma, {
      tenantId, docType: 'OemIntegrationProfile', docId: created.id,
      action: 'PROFILE_CREATED', actor, after: created,
    });
    return created;
  }

  /**
   * Truthful status transition. CERTIFIED requires certificationEvidenceRef
   * (package: "CERTIFIED settable only with recorded certification evidence
   * reference — no code path flips it silently"). Any other status clears
   * the evidence ref, so a downgrade from CERTIFIED never leaves a stale
   * evidence reference implying certification that no longer holds.
   */
  async setConnectionStatus(
    tenantId: string,
    make: string,
    status: ConnectionStatus,
    certificationEvidenceRef: string | null,
    actor: string,
  ) {
    if (!VALID_STATUSES.includes(status)) {
      throw new OemValidationError('INVALID_STATUS', `status must be one of ${VALID_STATUSES.join(', ')}`);
    }
    if (status === 'CERTIFIED' && !certificationEvidenceRef?.trim()) {
      throw new OemValidationError(
        'CERTIFICATION_EVIDENCE_REQUIRED',
        'CERTIFIED status requires a certificationEvidenceRef — no code path may fabricate certification',
      );
    }
    const before = await this.getByMake(tenantId, make);
    const updated = await this.prisma.oemIntegrationProfile.update({
      where: { id: before.id },
      data: {
        connectionStatus: status,
        certificationEvidenceRef: status === 'CERTIFIED' ? certificationEvidenceRef!.trim() : null,
      },
    });
    await appendAudit(this.prisma, {
      tenantId, docType: 'OemIntegrationProfile', docId: before.id,
      action: 'PROFILE_STATUS_CHANGED', actor, before, after: updated,
    });
    return updated;
  }

  async setDealerCode(tenantId: string, make: string, storeId: string, dealerCode: string, actor: string) {
    const profile = await this.getByMake(tenantId, make);
    const existing = await this.prisma.oemDealerCode.findUnique({
      where: { tenantId_profileId_storeId: { tenantId, profileId: profile.id, storeId } },
    });
    const result = existing
      ? await this.prisma.oemDealerCode.update({ where: { id: existing.id }, data: { dealerCode } })
      : await this.prisma.oemDealerCode.create({ data: { tenantId, profileId: profile.id, storeId, dealerCode } });
    await appendAudit(this.prisma, {
      tenantId, docType: 'OemDealerCode', docId: result.id,
      action: existing ? 'DEALER_CODE_UPDATED' : 'DEALER_CODE_CREATED', actor,
      before: existing ?? null, after: result,
    });
    return result;
  }
}
