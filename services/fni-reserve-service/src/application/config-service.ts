// SAFE_CONFIGURATION management: LenderProgramConfig (S091 flat-% rate),
// ProviderProgramConfig (S093 pro-rata table), DeferralModeConfig (S094
// mode + earning pattern), FniScheduleMapping (schedule-service lookup
// wiring). No accounting math lives here — entered parameters only.
import { injectable, inject } from 'tsyringe';
import type { PrismaClient } from '.prisma/fni-reserve-client';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { audit } from '../infrastructure/audit';

export class ConfigNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigNotFoundError';
  }
}
export class ConfigValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

export interface LenderProgramConfigInput {
  lenderProgramCode: string;
  lenderProgramName: string;
  chargebackReservePercent: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export interface ProviderProgramConfigInput {
  providerCode: string;
  productType: string;
  proRataTable: Array<{ monthsElapsed: number; refundPercent: string }>;
  termMonths: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

/// Roles this service reads the schedule-service linkage for.
/// RESERVE_RECEIVABLE (schedule 93) and PRODUCT_REMIT_LIABILITY (schedule
/// 94) are owned/created by deal-accounting-service — this service only
/// relieves them. CHARGEBACK_RESERVE_LIABILITY (schedule 95) and
/// DEFERRED_INCOME_LIABILITY (schedule 96) are CE-12 gap-closure additions —
/// this service's OWN new items, both originated and relieved here.
export type FniScheduleMappingRole =
  | 'RESERVE_RECEIVABLE'
  | 'PRODUCT_REMIT_LIABILITY'
  | 'CHARGEBACK_RESERVE_LIABILITY'
  | 'DEFERRED_INCOME_LIABILITY';

export interface DeferralModeConfigInput {
  productType: string;
  mode: 'AGENT' | 'OBLIGOR';
  earningPatternType: 'STRAIGHT_LINE_MONTHS';
  earningPatternMonths?: number | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

@injectable()
export class ConfigService {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  // ── S091 lender program config ──────────────────────────────────────────
  async createLenderProgramConfig(tenantId: string, dto: LenderProgramConfigInput, actor: string) {
    const pct = Number(dto.chargebackReservePercent);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw new ConfigValidationError('INVALID_PERCENT', 'chargebackReservePercent must be between 0 and 100.');
    }
    const created = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const row = await tx.lenderProgramConfig.create({
        data: {
          tenantId,
          lenderProgramCode: dto.lenderProgramCode,
          lenderProgramName: dto.lenderProgramName,
          chargebackReservePercent: dto.chargebackReservePercent,
          effectiveFrom: new Date(dto.effectiveFrom),
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
          createdBy: actor,
        },
      });
      await audit(tx, tenantId, 'LENDER_PROGRAM_CONFIG', row.id, 'CREATED', actor, null, row);
      return row;
    });
    return created;
  }

  async listLenderProgramConfigs(tenantId: string) {
    return this.prisma.lenderProgramConfig.findMany({ where: { tenantId }, orderBy: [{ lenderProgramCode: 'asc' }, { effectiveFrom: 'desc' }] });
  }

  /** Resolve the config effective as of a given date for a lender program (latest row with effectiveFrom <= asOf and (effectiveTo is null or >= asOf)). */
  async resolveLenderProgramConfig(tenantId: string, lenderProgramCode: string, asOfDate: Date) {
    const rows = await this.prisma.lenderProgramConfig.findMany({
      where: { tenantId, lenderProgramCode, active: true, effectiveFrom: { lte: asOfDate } },
      orderBy: { effectiveFrom: 'desc' },
    });
    const match = rows.find((r: any) => !r.effectiveTo || r.effectiveTo >= asOfDate);
    if (!match) throw new ConfigNotFoundError(`No active LenderProgramConfig for lenderProgramCode=${lenderProgramCode} effective as of ${asOfDate.toISOString()}.`);
    return match;
  }

  // ── S093 provider program config ────────────────────────────────────────
  async createProviderProgramConfig(tenantId: string, dto: ProviderProgramConfigInput, actor: string) {
    if (!Array.isArray(dto.proRataTable) || dto.proRataTable.length === 0) {
      throw new ConfigValidationError('INVALID_TABLE', 'proRataTable must be a non-empty array.');
    }
    const created = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const row = await tx.providerProgramConfig.create({
        data: {
          tenantId,
          providerCode: dto.providerCode,
          productType: dto.productType,
          proRataTable: dto.proRataTable as any,
          termMonths: dto.termMonths,
          effectiveFrom: new Date(dto.effectiveFrom),
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
          createdBy: actor,
        },
      });
      await audit(tx, tenantId, 'PROVIDER_PROGRAM_CONFIG', row.id, 'CREATED', actor, null, row);
      return row;
    });
    return created;
  }

  async listProviderProgramConfigs(tenantId: string) {
    return this.prisma.providerProgramConfig.findMany({ where: { tenantId }, orderBy: [{ providerCode: 'asc' }, { effectiveFrom: 'desc' }] });
  }

  async resolveProviderProgramConfig(tenantId: string, providerCode: string, productType: string, asOfDate: Date) {
    const rows = await this.prisma.providerProgramConfig.findMany({
      where: { tenantId, providerCode, productType, active: true, effectiveFrom: { lte: asOfDate } },
      orderBy: { effectiveFrom: 'desc' },
    });
    const match = rows.find((r: any) => !r.effectiveTo || r.effectiveTo >= asOfDate);
    if (!match) return null;
    return match;
  }

  // ── S094 deferral mode config ────────────────────────────────────────────
  async createDeferralModeConfig(tenantId: string, dto: DeferralModeConfigInput, actor: string) {
    if (dto.mode !== 'AGENT' && dto.mode !== 'OBLIGOR') {
      throw new ConfigValidationError('INVALID_MODE', 'mode must be AGENT or OBLIGOR.');
    }
    if (dto.earningPatternType !== 'STRAIGHT_LINE_MONTHS') {
      throw new ConfigValidationError('UNSUPPORTED_PATTERN', `Unsupported earningPatternType: ${dto.earningPatternType}`);
    }
    if (dto.mode === 'OBLIGOR' && (!dto.earningPatternMonths || dto.earningPatternMonths <= 0)) {
      throw new ConfigValidationError('INVALID_PATTERN_MONTHS', 'earningPatternMonths must be a positive integer for OBLIGOR mode.');
    }
    const created = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const row = await tx.deferralModeConfig.create({
        data: {
          tenantId,
          productType: dto.productType,
          mode: dto.mode,
          earningPatternType: dto.earningPatternType,
          earningPatternMonths: dto.earningPatternMonths ?? null,
          effectiveFrom: new Date(dto.effectiveFrom),
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
          createdBy: actor,
        },
      });
      await audit(tx, tenantId, 'DEFERRAL_MODE_CONFIG', row.id, 'CREATED', actor, null, row);
      return row;
    });
    return created;
  }

  async listDeferralModeConfigs(tenantId: string) {
    return this.prisma.deferralModeConfig.findMany({ where: { tenantId }, orderBy: [{ productType: 'asc' }, { effectiveFrom: 'desc' }] });
  }

  /**
   * S094 cross-service contract resolver — the exact function backing
   * GET /api/v1/fni-reserve/deferral-mode. Defaults to AGENT (immediate
   * recognition, the S092 default) when no config row is effective —
   * missing config is never an error, just the documented default.
   */
  async resolveDeferralMode(tenantId: string, productType: string, asOfDate: Date) {
    const rows = await this.prisma.deferralModeConfig.findMany({
      where: { tenantId, productType, effectiveFrom: { lte: asOfDate } },
      orderBy: { effectiveFrom: 'desc' },
    });
    const match = rows.find((r: any) => !r.effectiveTo || r.effectiveTo >= asOfDate);
    if (!match) {
      return { mode: 'AGENT' as const, configId: null, effectiveFrom: null, earningPatternType: null, earningPatternMonths: null };
    }
    return {
      mode: match.mode as 'AGENT' | 'OBLIGOR',
      configId: match.id,
      effectiveFrom: match.effectiveFrom.toISOString(),
      earningPatternType: match.earningPatternType,
      earningPatternMonths: match.earningPatternMonths,
    };
  }

  // ── FniScheduleMapping ───────────────────────────────────────────────────
  async setScheduleMapping(tenantId: string, role: FniScheduleMappingRole, scheduleNumber: string, glAccountNumber: string, actor: string) {
    return this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const row = await tx.fniScheduleMapping.upsert({
        where: { tenantId_role: { tenantId, role } },
        create: { tenantId, role, scheduleNumber, glAccountNumber, createdBy: actor },
        update: { scheduleNumber, glAccountNumber },
      });
      await audit(tx, tenantId, 'FNI_SCHEDULE_MAPPING', row.id, 'UPSERTED', actor, null, row);
      return row;
    });
  }

  async getScheduleMapping(tenantId: string, role: FniScheduleMappingRole) {
    return this.prisma.fniScheduleMapping.findUnique({ where: { tenantId_role: { tenantId, role } } });
  }

  async listScheduleMappings(tenantId: string) {
    return this.prisma.fniScheduleMapping.findMany({ where: { tenantId } });
  }
}
