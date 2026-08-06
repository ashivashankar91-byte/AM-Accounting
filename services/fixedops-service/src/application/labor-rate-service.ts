import { injectable, inject } from 'tsyringe';
import { RateGapError } from '../domain/errors';
import { appendAuditEvent } from '../infrastructure/audit';

export const LABOR_RATE_SCOPE = { TECHNICIAN: 'TECHNICIAN', DEPARTMENT: 'DEPARTMENT' } as const;
export type LaborRateScope = (typeof LABOR_RATE_SCOPE)[keyof typeof LABOR_RATE_SCOPE];

export interface ResolvedRate {
  rateId: string;
  rateSource: LaborRateScope;
  rateAmount: number;
  rateEffectiveFrom: string;
}

/** S063 gap-closure — approved unapplied-time absorption policy. A single
 * governed matrix of effective-dated BURDENED labor-cost rates (never the
 * customer labor selling rate, never hardcoded here or anywhere else).
 * Resolution order is strictly technician-specific then department-default
 * — no dealership-wide/global fallback; anything else is a RATE_GAP,
 * raised before any posting attempt. */
@injectable()
export class LaborRateService {
  constructor(@inject('PrismaClient') private readonly prisma: any) {}

  /** Governed ceremony — mirrors AccountMappingService.setAccountNumber's
   * upsert-by-natural-key shape. Every write is audited. */
  async setRate(input: {
    tenantId: string; legalEntityId: string; scope: LaborRateScope; subjectKey: string;
    burdenedRate: number | string; effectiveFrom: string; actor: string;
  }) {
    const row = await this.prisma.laborRateConfig.upsert({
      where: {
        tenantId_legalEntityId_scope_subjectKey_effectiveFrom: {
          tenantId: input.tenantId, legalEntityId: input.legalEntityId,
          scope: input.scope, subjectKey: input.subjectKey, effectiveFrom: new Date(input.effectiveFrom),
        },
      },
      create: {
        tenantId: input.tenantId, legalEntityId: input.legalEntityId, scope: input.scope,
        subjectKey: input.subjectKey, burdenedRate: input.burdenedRate,
        effectiveFrom: new Date(input.effectiveFrom), createdBy: input.actor,
      },
      update: { burdenedRate: input.burdenedRate },
    });
    await appendAuditEvent(this.prisma, {
      tenantId: input.tenantId, docType: 'LABOR_RATE_CONFIG', docId: row.id, action: 'SET',
      actor: input.actor, after: row,
    });
    return row;
  }

  async listForEntity(tenantId: string, legalEntityId: string) {
    return this.prisma.laborRateConfig.findMany({
      where: { tenantId, legalEntityId },
      orderBy: [{ scope: 'asc' }, { subjectKey: 'asc' }, { effectiveFrom: 'desc' }],
    });
  }

  /** Technician-specific first, then department-default. Neither present
   * as of the given date -> RateGapError (RATE_GAP), thrown before any
   * posting-engine call or DB write. Never a dealership-wide/global
   * fallback, never an estimated/zero rate. */
  async resolveRate(tenantId: string, legalEntityId: string, techId: string, deptCode: string, asOfDate: string): Promise<ResolvedRate> {
    const asOf = new Date(asOfDate);

    const technicianRow = await this.prisma.laborRateConfig.findFirst({
      where: { tenantId, legalEntityId, scope: LABOR_RATE_SCOPE.TECHNICIAN, subjectKey: techId, effectiveFrom: { lte: asOf } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (technicianRow) {
      return {
        rateId: technicianRow.id, rateSource: 'TECHNICIAN',
        rateAmount: Number(technicianRow.burdenedRate), rateEffectiveFrom: technicianRow.effectiveFrom.toISOString().slice(0, 10),
      };
    }

    const departmentRow = await this.prisma.laborRateConfig.findFirst({
      where: { tenantId, legalEntityId, scope: LABOR_RATE_SCOPE.DEPARTMENT, subjectKey: deptCode, effectiveFrom: { lte: asOf } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (departmentRow) {
      return {
        rateId: departmentRow.id, rateSource: 'DEPARTMENT',
        rateAmount: Number(departmentRow.burdenedRate), rateEffectiveFrom: departmentRow.effectiveFrom.toISOString().slice(0, 10),
      };
    }

    throw new RateGapError(
      tenantId, legalEntityId, techId, deptCode,
      `No burdened labor-cost rate resolves for technician "${techId}" (department "${deptCode}") as of ${asOfDate} — ` +
      `neither a technician-specific nor a department-default LaborRateConfig row exists. There is no dealership-wide ` +
      `fallback; resolve a rate via the governed labor-rate ceremony before absorbing time for this technician.`,
    );
  }
}
