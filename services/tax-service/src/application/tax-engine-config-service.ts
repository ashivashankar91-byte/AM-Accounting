import { injectable, inject } from 'tsyringe';
import { assertNoOverlap, resolveEffectiveOne } from '../domain/effective-dating';
import { EngineRegistry } from '../domain/engines/engine-registry';
import { NotFoundError, OptimisticConcurrencyError, OverlappingEffectiveDateError, TaxServiceValidationError } from '../domain/errors';
import { appendAuditReference } from '../infrastructure/audit';

export interface TaxEngineConfigDTO {
  legalEntityId: string;
  engineType: string;
  engineVersion?: string | null;
  contentVersion?: string | null;
  connectionConfig?: Record<string, unknown> | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

/**
 * S124 — Tax Vendor / Adapter Status + effective-dated engine connection
 * config CRUD. testConnection is audited (per the epic's API list).
 */
@injectable()
export class TaxEngineConfigService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('EngineRegistry') private readonly engines: EngineRegistry,
  ) {}

  async list(tenantId: string, legalEntityId?: string) {
    return this.prisma.taxEngineConfig.findMany({
      where: { tenantId, ...(legalEntityId ? { legalEntityId } : {}) },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async getStatus(tenantId: string, legalEntityId: string, businessDate?: string) {
    const configs = await this.prisma.taxEngineConfig.findMany({ where: { tenantId, legalEntityId } });
    const effective = resolveEffectiveOne<any>(configs, businessDate ?? new Date().toISOString().slice(0, 10));
    const engine = this.engines.resolve(effective?.engineType);
    const status = await engine.getStatus();
    return { ...status, effectiveConfigId: effective?.id ?? null };
  }

  async testConnection(tenantId: string, legalEntityId: string, actor: string, businessDate?: string) {
    const configs = await this.prisma.taxEngineConfig.findMany({ where: { tenantId, legalEntityId } });
    const effective = resolveEffectiveOne<any>(configs, businessDate ?? new Date().toISOString().slice(0, 10));
    const engine = this.engines.resolve(effective?.engineType);
    const result = await engine.testConnection();
    await appendAuditReference(this.prisma, {
      tenantId, entityType: 'TaxEngineConfig', entityId: effective?.id ?? null,
      eventType: 'tax.adapter.test_connection', actor, after: result,
    });
    return result;
  }

  async browseReferenceData(tenantId: string, legalEntityId: string, kind: 'JURISDICTION' | 'TAX_TYPE' | 'EXEMPTION_TYPE', search?: string, businessDate?: string) {
    const configs = await this.prisma.taxEngineConfig.findMany({ where: { tenantId, legalEntityId } });
    const effective = resolveEffectiveOne<any>(configs, businessDate ?? new Date().toISOString().slice(0, 10));
    const engine = this.engines.resolve(effective?.engineType);
    return engine.browseReferenceData({ kind, search });
  }

  async create(tenantId: string, dto: TaxEngineConfigDTO, actor: string) {
    if (!dto.engineType?.trim()) throw new TaxServiceValidationError('ENGINE_TYPE_REQUIRED', 'engineType is required');
    const existing = await this.prisma.taxEngineConfig.findMany({ where: { tenantId, legalEntityId: dto.legalEntityId } });
    const conflict = assertNoOverlap(existing, { effectiveFrom: dto.effectiveFrom, effectiveTo: dto.effectiveTo ?? null });
    if (conflict) throw new OverlappingEffectiveDateError(`engine-config:${dto.legalEntityId}`, conflict.id);

    const created = await this.prisma.taxEngineConfig.create({
      data: {
        tenantId,
        legalEntityId: dto.legalEntityId,
        engineType: dto.engineType,
        engineVersion: dto.engineVersion ?? null,
        contentVersion: dto.contentVersion ?? null,
        connectionConfig: (dto.connectionConfig ?? null) as any,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        createdBy: actor,
      },
    });
    await appendAuditReference(this.prisma, {
      tenantId, entityType: 'TaxEngineConfig', entityId: created.id,
      eventType: 'tax.adapter.config_created', actor, after: created,
    });
    return created;
  }

  async update(tenantId: string, id: string, dto: Partial<TaxEngineConfigDTO>, expectedVersion: number, actor: string) {
    const row = await this.prisma.taxEngineConfig.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundError('TaxEngineConfig', id);
    if (row.version !== expectedVersion) throw new OptimisticConcurrencyError('TaxEngineConfig', id);

    const effectiveFrom = dto.effectiveFrom ?? row.effectiveFrom;
    const effectiveTo = dto.effectiveTo !== undefined ? dto.effectiveTo : row.effectiveTo;
    const siblings = await this.prisma.taxEngineConfig.findMany({ where: { tenantId, legalEntityId: row.legalEntityId } });
    const conflict = assertNoOverlap(siblings, { effectiveFrom, effectiveTo }, id);
    if (conflict) throw new OverlappingEffectiveDateError(`engine-config:${row.legalEntityId}`, conflict.id);

    const updated = await this.prisma.taxEngineConfig.update({
      where: { id },
      data: {
        engineType: dto.engineType ?? row.engineType,
        engineVersion: dto.engineVersion ?? row.engineVersion,
        contentVersion: dto.contentVersion ?? row.contentVersion,
        connectionConfig: dto.connectionConfig !== undefined ? (dto.connectionConfig as any) : row.connectionConfig,
        effectiveFrom: new Date(effectiveFrom),
        effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
        version: { increment: 1 },
      },
    });
    await appendAuditReference(this.prisma, {
      tenantId, entityType: 'TaxEngineConfig', entityId: id,
      eventType: 'tax.adapter.config_updated', actor, before: row, after: updated,
    });
    return updated;
  }
}
