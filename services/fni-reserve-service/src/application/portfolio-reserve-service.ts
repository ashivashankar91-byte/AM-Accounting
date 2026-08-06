// S095 — Portfolio Reserve Accrual
//
// Manages configurable portfolio-level reserve accruals. Unlike the
// deal-level finance reserve (S091), this service accrues a fraction of the
// total portfolio balance on a per-period basis (e.g. monthly) to build a
// loss-reserve cushion for the portfolio as a whole.
//
// Every accrual is idempotent on (tenantId, idempotencyKey); posting is
// driven through PostingOrchestrator — no direct GL writes.

import Decimal from 'decimal.js';
import { PostingOrchestrator } from './posting-orchestrator';
import { newEnvelope } from '../infrastructure/posting-client';

export class PortfolioReserveConfigNotFoundError extends Error {
  constructor(portfolioCode: string, legalEntityId: string) {
    super(`No active PortfolioReserveConfig for portfolio "${portfolioCode}" on legalEntity "${legalEntityId}".`);
    this.name = 'PortfolioReserveConfigNotFoundError';
  }
}

export class PortfolioReserveDuplicateError extends Error {
  constructor(key: string) {
    super(`Portfolio reserve accrual idempotency key "${key}" already recorded.`);
    this.name = 'PortfolioReserveDuplicateError';
  }
}

export interface CreateConfigDTO {
  legalEntityId: string;
  portfolioCode: string;
  accrualBasisBp: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  createdBy: string;
}

export interface RunAccrualDTO {
  legalEntityId: string;
  portfolioCode: string;
  portfolioBalance: string;
  periodYear: number;
  periodMonth: number;
  idempotencyKey: string;
  actor: string;
}

export class PortfolioReserveService {
  constructor(
    private readonly prisma: any,
    private readonly posting: PostingOrchestrator,
  ) {}

  async createConfig(tenantId: string, dto: CreateConfigDTO) {
    if (dto.accrualBasisBp < 1 || dto.accrualBasisBp > 10000) {
      throw new RangeError(`accrualBasisBp must be 1–10000 (got ${dto.accrualBasisBp}).`);
    }
    return this.prisma.portfolioReserveConfig.create({
      data: {
        tenantId,
        legalEntityId: dto.legalEntityId,
        portfolioCode: dto.portfolioCode,
        accrualBasisBp: dto.accrualBasisBp,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        createdBy: dto.createdBy,
      },
    });
  }

  async listConfigs(tenantId: string, legalEntityId?: string) {
    return this.prisma.portfolioReserveConfig.findMany({
      where: { tenantId, ...(legalEntityId ? { legalEntityId } : {}) },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async runAccrual(tenantId: string, dto: RunAccrualDTO) {
    // Idempotency check — return the existing row without mutation
    const existing = await this.prisma.portfolioReserveAccrual.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: dto.idempotencyKey } },
    });
    if (existing) throw new PortfolioReserveDuplicateError(dto.idempotencyKey);

    // Resolve active config
    const configs = await this.prisma.portfolioReserveConfig.findMany({
      where: {
        tenantId,
        legalEntityId: dto.legalEntityId,
        portfolioCode: dto.portfolioCode,
        effectiveFrom: { lte: new Date() },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
      },
      orderBy: { effectiveFrom: 'desc' },
      take: 1,
    });
    const config = configs[0];
    if (!config) throw new PortfolioReserveConfigNotFoundError(dto.portfolioCode, dto.legalEntityId);

    // Compute accrual: portfolioBalance × (basisBp / 10000)
    const balance = new Decimal(dto.portfolioBalance);
    const accrualAmount = balance.times(config.accrualBasisBp).dividedBy(10000).toDecimalPlaces(2);

    // Post through orchestrator (no direct GL write)
    const envelope = newEnvelope(tenantId, 'portfolio.reserve.accrual.v1', {
      portfolioCode: dto.portfolioCode,
      legalEntityId: dto.legalEntityId,
      periodYear: dto.periodYear,
      periodMonth: dto.periodMonth,
      portfolioBalance: dto.portfolioBalance,
      accrualAmount: accrualAmount.toString(),
      idempotencyKey: dto.idempotencyKey,
      actor: dto.actor,
    });
    const postResult = await this.posting.submit(envelope);

    return this.prisma.portfolioReserveAccrual.create({
      data: {
        tenantId,
        legalEntityId: dto.legalEntityId,
        portfolioCode: dto.portfolioCode,
        configId: config.id,
        periodYear: dto.periodYear,
        periodMonth: dto.periodMonth,
        portfolioBalance: balance.toString(),
        accrualAmount: accrualAmount.toString(),
        idempotencyKey: dto.idempotencyKey,
        postedJournalId: postResult.journalEntryId ?? null,
        actor: dto.actor,
      },
    });
  }

  async listAccruals(tenantId: string, legalEntityId: string, portfolioCode?: string) {
    return this.prisma.portfolioReserveAccrual.findMany({
      where: { tenantId, legalEntityId, ...(portfolioCode ? { portfolioCode } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }
}
