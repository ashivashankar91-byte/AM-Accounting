import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/parts-accounting-client';
import { ValidationError, NotFoundError } from '../domain/errors';

const ALLOWED_METHODS = new Set(['REPLACEMENT', 'AVERAGE']);

export interface CreateValuationConfigDTO {
  tenantId: string; legalEntityId: string; method: string;
  landedCostRules?: Record<string, unknown> | null;
  effectiveFrom: string; ceremonyApprovedBy: string; revaluationPreviewId?: string | null;
}

/**
 * S072 — Parts Valuation Config & Landed Cost. Method election is
 * effective-dated and prospective-only; no method beyond the accepted
 * config scope (REPLACEMENT | AVERAGE) is ever accepted.
 */
@injectable()
export class ValuationConfigService {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async create(dto: CreateValuationConfigDTO) {
    if (!ALLOWED_METHODS.has(dto.method)) {
      throw new ValidationError(`Unsupported valuation method "${dto.method}" — only REPLACEMENT or AVERAGE are accepted (no invented methods).`);
    }
    const effectiveFrom = new Date(dto.effectiveFrom);
    const today = new Date();
    if (effectiveFrom < new Date(today.toISOString().slice(0, 10))) {
      throw new ValidationError('Valuation config changes are prospective-only — effectiveFrom cannot be in the past.');
    }
    return this.prisma.partsValuationConfig.create({
      data: {
        tenantId: dto.tenantId, legalEntityId: dto.legalEntityId, method: dto.method,
        landedCostRules: (dto.landedCostRules ?? null) as any,
        effectiveFrom, ceremonyApprovedBy: dto.ceremonyApprovedBy,
        revaluationPreviewId: dto.revaluationPreviewId ?? null,
      },
    });
  }

  /** Returns the config effective as-of a given date (or today), never a future row. */
  async getActive(tenantId: string, legalEntityId: string, asOfDate?: string) {
    const asOf = asOfDate ? new Date(asOfDate) : new Date();
    const row = await this.prisma.partsValuationConfig.findFirst({
      where: { tenantId, legalEntityId, effectiveFrom: { lte: asOf } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!row) throw new NotFoundError(`No PartsValuationConfig configured for legal entity ${legalEntityId} as of ${asOf.toISOString().slice(0, 10)}.`);
    return row;
  }

  async history(tenantId: string, legalEntityId: string) {
    return this.prisma.partsValuationConfig.findMany({ where: { tenantId, legalEntityId }, orderBy: { effectiveFrom: 'desc' } });
  }

  /** Allocates landed-cost components (freight/duty %) across receipt lines per active config — configuration-driven only. */
  allocateLandedCost(baseValueCents: number, landedCostRules: Record<string, unknown> | null | undefined): number {
    if (!landedCostRules) return 0;
    const freightPct = Number((landedCostRules as any).freightPct ?? 0);
    const dutyPct = Number((landedCostRules as any).dutyPct ?? 0);
    return Math.round(baseValueCents * ((freightPct + dutyPct) / 100));
  }
}
