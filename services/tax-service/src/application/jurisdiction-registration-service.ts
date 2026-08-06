import { injectable, inject } from 'tsyringe';
import { assertNoOverlap } from '../domain/effective-dating';
import { NotFoundError, OptimisticConcurrencyError, OverlappingEffectiveDateError, TaxServiceValidationError } from '../domain/errors';
import { assertLegalEntityMatch } from '../domain/legal-entity-scope';
import { appendAuditReference } from '../infrastructure/audit';

export interface JurisdictionRegistrationDTO {
  legalEntityId: string;
  jurisdictionRef: string;
  jurisdictionLevel?: string | null;
  registrationNumber?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

/**
 * S124 — Jurisdiction Administration. jurisdictionRef is browsed from the
 * engine's own reference data (see AdapterStatusService.browseReferenceData)
 * — never free-typed law. Overlap prevention per jurisdiction, enforced at
 * save time (never at runtime).
 */
@injectable()
export class JurisdictionRegistrationService {
  constructor(@inject('PrismaClient') private readonly prisma: any) {}

  async list(tenantId: string, legalEntityId?: string) {
    return this.prisma.jurisdictionRegistration.findMany({
      where: { tenantId, ...(legalEntityId ? { legalEntityId } : {}) },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async getById(tenantId: string, legalEntityId: string, id: string) {
    const row = await this.prisma.jurisdictionRegistration.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundError('JurisdictionRegistration', id);
    assertLegalEntityMatch('JurisdictionRegistration', id, legalEntityId, row.legalEntityId);
    return row;
  }

  async create(tenantId: string, dto: JurisdictionRegistrationDTO, actor: string) {
    if (!dto.jurisdictionRef?.trim()) throw new TaxServiceValidationError('JURISDICTION_REF_REQUIRED', 'jurisdictionRef is required');
    const existing = await this.prisma.jurisdictionRegistration.findMany({
      where: { tenantId, legalEntityId: dto.legalEntityId, jurisdictionRef: dto.jurisdictionRef },
    });
    const conflict = assertNoOverlap(existing, { effectiveFrom: dto.effectiveFrom, effectiveTo: dto.effectiveTo ?? null });
    if (conflict) throw new OverlappingEffectiveDateError(dto.jurisdictionRef, conflict.id);

    const created = await this.prisma.jurisdictionRegistration.create({
      data: {
        tenantId,
        legalEntityId: dto.legalEntityId,
        jurisdictionRef: dto.jurisdictionRef,
        jurisdictionLevel: dto.jurisdictionLevel ?? null,
        registrationNumber: dto.registrationNumber ?? null,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        createdBy: actor,
      },
    });
    await appendAuditReference(this.prisma, {
      tenantId, entityType: 'JurisdictionRegistration', entityId: created.id,
      eventType: 'tax.jurisdiction.created', actor, after: created,
    });
    return created;
  }

  async update(tenantId: string, legalEntityId: string, id: string, dto: Partial<JurisdictionRegistrationDTO>, expectedVersion: number, actor: string) {
    const row = await this.getById(tenantId, legalEntityId, id);
    if (row.version !== expectedVersion) throw new OptimisticConcurrencyError('JurisdictionRegistration', id);

    const effectiveFrom = dto.effectiveFrom ?? row.effectiveFrom;
    const effectiveTo = dto.effectiveTo !== undefined ? dto.effectiveTo : row.effectiveTo;
    const jurisdictionRef = dto.jurisdictionRef ?? row.jurisdictionRef;

    const siblings = await this.prisma.jurisdictionRegistration.findMany({
      where: { tenantId, legalEntityId: row.legalEntityId, jurisdictionRef },
    });
    const conflict = assertNoOverlap(siblings, { effectiveFrom, effectiveTo }, id);
    if (conflict) throw new OverlappingEffectiveDateError(jurisdictionRef, conflict.id);

    const updated = await this.prisma.jurisdictionRegistration.update({
      where: { id },
      data: {
        jurisdictionRef,
        jurisdictionLevel: dto.jurisdictionLevel ?? row.jurisdictionLevel,
        registrationNumber: dto.registrationNumber ?? row.registrationNumber,
        effectiveFrom: new Date(effectiveFrom),
        effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
        version: { increment: 1 },
      },
    });
    await appendAuditReference(this.prisma, {
      tenantId, entityType: 'JurisdictionRegistration', entityId: id,
      eventType: 'tax.jurisdiction.updated', actor, before: row, after: updated,
    });
    return updated;
  }

  /** Deactivate (never delete) — mirrors FeeTableService.deactivate's
   * never-hard-delete convention. Requires a reason, audited before/after. */
  async deactivate(tenantId: string, legalEntityId: string, id: string, expectedVersion: number, reason: string, actor: string) {
    if (!reason?.trim()) throw new TaxServiceValidationError('REASON_REQUIRED', 'A reason is required to deactivate a jurisdiction registration');
    const row = await this.getById(tenantId, legalEntityId, id);
    if (row.version !== expectedVersion) throw new OptimisticConcurrencyError('JurisdictionRegistration', id);

    const updated = await this.prisma.jurisdictionRegistration.update({
      where: { id },
      data: { active: false, version: { increment: 1 } },
    });
    await appendAuditReference(this.prisma, {
      tenantId, entityType: 'JurisdictionRegistration', entityId: id,
      eventType: 'tax.jurisdiction.deactivated', actor, before: row, after: { ...updated, reason },
    });
    return updated;
  }
}
