import { injectable, inject } from 'tsyringe';
import { assertNoOverlap } from '../domain/effective-dating';
import { resolveApplicableFees, validateFeeAmountBasis } from '../domain/fee-resolution';
import { NotFoundError, OptimisticConcurrencyError, OverlappingEffectiveDateError, ReferencedRowCannotBeDeactivatedError, TaxServiceValidationError } from '../domain/errors';
import { appendAuditReference } from '../infrastructure/audit';

export interface FeeTableDTO {
  legalEntityId: string;
  jurisdictionRef: string;
  feeCode: string;
  name: string;
  basis: 'FIXED_PER_UNIT' | 'FIXED_PER_DOCUMENT' | 'PERCENT_OF_BASE';
  amount?: string | null;
  ratePercent?: string | null;
  taxabilityFlag?: boolean;
  effectiveFrom: string;
  effectiveTo?: string | null;
  applicabilityTags?: Array<{ itemClassCode?: string | null; documentTypeCode?: string | null }>;
}

/**
 * S125 — Regulatory Fee Tables. Amounts/rates AS ENTERED — never shipped as
 * code defaults. Overlap validation at save (never runtime ambiguity).
 * Deactivate is blocked (409) once referenced by real resolveApplicableFees
 * usage — see fee_table_usage_reference.
 */
@injectable()
export class FeeTableService {
  constructor(@inject('PrismaClient') private readonly prisma: any) {}

  async list(tenantId: string, legalEntityId?: string, active?: boolean) {
    return this.prisma.feeTable.findMany({
      where: { tenantId, ...(legalEntityId ? { legalEntityId } : {}), ...(active !== undefined ? { active } : {}) },
      orderBy: { effectiveFrom: 'desc' },
      include: { applicabilityTags: true },
    });
  }

  async getById(tenantId: string, id: string) {
    const row = await this.prisma.feeTable.findFirst({ where: { id, tenantId }, include: { applicabilityTags: true } });
    if (!row) throw new NotFoundError('FeeTable', id);
    return row;
  }

  async create(tenantId: string, dto: FeeTableDTO, actor: string) {
    if (!dto.feeCode?.trim()) throw new TaxServiceValidationError('FEE_CODE_REQUIRED', 'feeCode is required');
    const basisError = validateFeeAmountBasis(dto.basis, dto.amount ?? null, dto.ratePercent ?? null);
    if (basisError) throw new TaxServiceValidationError('INVALID_BASIS_AMOUNT', basisError);

    const existing = await this.prisma.feeTable.findMany({
      where: { tenantId, legalEntityId: dto.legalEntityId, feeCode: dto.feeCode, jurisdictionRef: dto.jurisdictionRef },
    });
    const conflict = assertNoOverlap(existing, { effectiveFrom: dto.effectiveFrom, effectiveTo: dto.effectiveTo ?? null });
    if (conflict) throw new OverlappingEffectiveDateError(dto.feeCode, conflict.id);

    const created = await this.prisma.feeTable.create({
      data: {
        tenantId,
        legalEntityId: dto.legalEntityId,
        jurisdictionRef: dto.jurisdictionRef,
        feeCode: dto.feeCode,
        name: dto.name,
        basis: dto.basis,
        amount: dto.amount ?? null,
        ratePercent: dto.ratePercent ?? null,
        taxabilityFlag: dto.taxabilityFlag ?? false,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        createdBy: actor,
        applicabilityTags: {
          create: (dto.applicabilityTags ?? []).map((t) => ({
            tenantId,
            itemClassCode: t.itemClassCode ?? null,
            documentTypeCode: t.documentTypeCode ?? null,
          })),
        },
      },
      include: { applicabilityTags: true },
    });
    await appendAuditReference(this.prisma, {
      tenantId, entityType: 'FeeTable', entityId: created.id, eventType: 'tax.fee.created', actor, after: created,
    });
    return created;
  }

  async update(tenantId: string, id: string, dto: Partial<FeeTableDTO>, expectedVersion: number, actor: string) {
    const row = await this.getById(tenantId, id);
    if (row.version !== expectedVersion) throw new OptimisticConcurrencyError('FeeTable', id);

    const basis = dto.basis ?? row.basis;
    const amount = dto.amount !== undefined ? dto.amount : row.amount;
    const ratePercent = dto.ratePercent !== undefined ? dto.ratePercent : row.ratePercent;
    const basisError = validateFeeAmountBasis(basis, amount, ratePercent);
    if (basisError) throw new TaxServiceValidationError('INVALID_BASIS_AMOUNT', basisError);

    const effectiveFrom = dto.effectiveFrom ?? row.effectiveFrom;
    const effectiveTo = dto.effectiveTo !== undefined ? dto.effectiveTo : row.effectiveTo;
    const feeCode = dto.feeCode ?? row.feeCode;
    const siblings = await this.prisma.feeTable.findMany({
      where: { tenantId, legalEntityId: row.legalEntityId, feeCode, jurisdictionRef: dto.jurisdictionRef ?? row.jurisdictionRef },
    });
    const conflict = assertNoOverlap(siblings, { effectiveFrom, effectiveTo }, id);
    if (conflict) throw new OverlappingEffectiveDateError(feeCode, conflict.id);

    const updated = await this.prisma.feeTable.update({
      where: { id },
      data: {
        jurisdictionRef: dto.jurisdictionRef ?? row.jurisdictionRef,
        feeCode,
        name: dto.name ?? row.name,
        basis,
        amount,
        ratePercent,
        taxabilityFlag: dto.taxabilityFlag ?? row.taxabilityFlag,
        effectiveFrom: new Date(effectiveFrom),
        effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
        version: { increment: 1 },
      },
      include: { applicabilityTags: true },
    });
    await appendAuditReference(this.prisma, {
      tenantId, entityType: 'FeeTable', entityId: id, eventType: 'tax.fee.updated', actor, before: row, after: updated,
    });
    return updated;
  }

  /** Deactivate — never hard-delete once referenced. 409 with reference
   * count when fee_table_usage_reference has any rows for this fee table. */
  async deactivate(tenantId: string, id: string, actor: string) {
    const row = await this.getById(tenantId, id);
    const referenceCount = await this.prisma.feeTableUsageReference.count({ where: { tenantId, feeTableId: id } });
    if (referenceCount > 0) throw new ReferencedRowCannotBeDeactivatedError(referenceCount);

    const updated = await this.prisma.feeTable.update({ where: { id }, data: { active: false, version: { increment: 1 } } });
    await appendAuditReference(this.prisma, {
      tenantId, entityType: 'FeeTable', entityId: id, eventType: 'tax.fee.deactivated', actor, before: row, after: updated,
    });
    return updated;
  }

  /** Deterministic resolution across a tenant/entity's fee tables at
   * businessDate. Records a real usage-reference row for non-preview
   * transaction contexts (documentId provided) — backs deactivate's 409. */
  async resolve(tenantId: string, legalEntityId: string, businessDate: string, itemClassCode: string, documentTypeCode: string, documentContext?: { documentType: string; documentId: string }) {
    const feeTables = await this.prisma.feeTable.findMany({
      where: { tenantId, legalEntityId },
      include: { applicabilityTags: true },
    });
    const applicable = resolveApplicableFees(feeTables as any, businessDate, itemClassCode, documentTypeCode);

    if (documentContext) {
      for (const fee of applicable) {
        await this.prisma.feeTableUsageReference.create({
          data: {
            tenantId,
            feeTableId: fee.id,
            documentType: documentContext.documentType,
            documentId: documentContext.documentId,
          },
        });
      }
    }
    return applicable;
  }
}
