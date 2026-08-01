import { injectable, inject } from 'tsyringe';
import { resolveEffectiveOne } from '../domain/effective-dating';
import { NotFoundError, OptimisticConcurrencyError, TaxServiceValidationError } from '../domain/errors';
import { assertLegalEntityMatch } from '../domain/legal-entity-scope';
import { appendAuditReference } from '../infrastructure/audit';

export interface ExemptionCertificateDTO {
  legalEntityId: string;
  partyRef: string;
  jurisdictionScope: string;
  exemptionTypeCode: string;
  certificateDocumentMetadata?: Record<string, unknown> | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

/**
 * S124 — Exemption certificate registry: configuration + evidence, NOT tax
 * law. This service never decides exemption applicability locally — it
 * only stores/serves the certificate record; the calculate() request
 * passes the exemption ref and the ENGINE decides EXEMPT_APPLIED.
 */
@injectable()
export class ExemptionCertificateService {
  constructor(@inject('PrismaClient') private readonly prisma: any) {}

  async list(tenantId: string, legalEntityId?: string, partyRef?: string, status?: string) {
    return this.prisma.exemptionCertificate.findMany({
      where: { tenantId, ...(legalEntityId ? { legalEntityId } : {}), ...(partyRef ? { partyRef } : {}), ...(status ? { status } : {}) },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async getById(tenantId: string, legalEntityId: string, id: string) {
    const row = await this.prisma.exemptionCertificate.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundError('ExemptionCertificate', id);
    assertLegalEntityMatch('ExemptionCertificate', id, legalEntityId, row.legalEntityId);
    return row;
  }

  /** Expiring-certificate queue: effectiveTo within N days (default 30). */
  async expiring(tenantId: string, legalEntityId: string | undefined, withinDays = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + withinDays);
    return this.prisma.exemptionCertificate.findMany({
      where: {
        tenantId,
        ...(legalEntityId ? { legalEntityId } : {}),
        status: { not: 'REVOKED' },
        effectiveTo: { not: null, lte: cutoff },
      },
      orderBy: { effectiveTo: 'asc' },
    });
  }

  /** Resolves the certificate (if any) effective at businessDate for a
   * party+scope — used by callers assembling a TaxCalculationRequest's
   * exemptionRef. Expired/absent -> null, with the caller responsible for
   * recording why the request goes without exemption. */
  async resolveEffectiveCertificate(tenantId: string, legalEntityId: string, partyRef: string, jurisdictionScope: string, businessDate: string) {
    const rows = await this.prisma.exemptionCertificate.findMany({
      where: { tenantId, legalEntityId, partyRef, jurisdictionScope, status: { not: 'REVOKED' } },
    });
    return resolveEffectiveOne(rows, businessDate);
  }

  async create(tenantId: string, dto: ExemptionCertificateDTO, actor: string) {
    if (!dto.partyRef?.trim()) throw new TaxServiceValidationError('PARTY_REF_REQUIRED', 'partyRef is required');
    if (!dto.exemptionTypeCode?.trim()) throw new TaxServiceValidationError('EXEMPTION_TYPE_REQUIRED', 'exemptionTypeCode is required');

    const created = await this.prisma.exemptionCertificate.create({
      data: {
        tenantId,
        legalEntityId: dto.legalEntityId,
        partyRef: dto.partyRef,
        jurisdictionScope: dto.jurisdictionScope,
        exemptionTypeCode: dto.exemptionTypeCode,
        certificateDocumentMetadata: (dto.certificateDocumentMetadata ?? null) as any,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        createdBy: actor,
      },
    });
    await appendAuditReference(this.prisma, {
      tenantId, entityType: 'ExemptionCertificate', entityId: created.id,
      eventType: 'tax.exemption.created', actor, after: created,
    });
    return created;
  }

  async update(tenantId: string, legalEntityId: string, id: string, dto: Partial<ExemptionCertificateDTO> & { status?: string }, expectedVersion: number, actor: string) {
    const row = await this.getById(tenantId, legalEntityId, id);
    if (row.version !== expectedVersion) throw new OptimisticConcurrencyError('ExemptionCertificate', id);

    const updated = await this.prisma.exemptionCertificate.update({
      where: { id },
      data: {
        partyRef: dto.partyRef ?? row.partyRef,
        jurisdictionScope: dto.jurisdictionScope ?? row.jurisdictionScope,
        exemptionTypeCode: dto.exemptionTypeCode ?? row.exemptionTypeCode,
        certificateDocumentMetadata: dto.certificateDocumentMetadata !== undefined ? (dto.certificateDocumentMetadata as any) : row.certificateDocumentMetadata,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : row.effectiveFrom,
        effectiveTo: dto.effectiveTo !== undefined ? (dto.effectiveTo ? new Date(dto.effectiveTo) : null) : row.effectiveTo,
        status: dto.status ?? row.status,
        version: { increment: 1 },
      },
    });
    await appendAuditReference(this.prisma, {
      tenantId, entityType: 'ExemptionCertificate', entityId: id,
      eventType: 'tax.exemption.updated', actor, before: row, after: updated,
    });
    return updated;
  }
}
