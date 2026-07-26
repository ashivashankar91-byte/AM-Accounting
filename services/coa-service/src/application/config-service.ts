import { inject, injectable } from 'tsyringe';
import { IEventPublisher } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/coa-client';
import crypto from 'crypto';
import {
  ConfigType,
  ConfigScope,
  ResolvedScope,
  SCOPE_ORDER,
  validateTypedValue,
  validateScope,
} from '../domain/config-catalog';

// ── Errors (mapped to HTTP status in the route layer) ────────────────────────

/** Unknown catalog key → 400 (BR223-4). */
export class ConfigUnknownKeyError extends Error {
  readonly code = 'UNKNOWN_CONFIG_KEY';
  constructor(key: string) {
    super(`Unknown configuration key: ${key}`);
    this.name = 'ConfigUnknownKeyError';
  }
}

/** Type- or scope-invalid value → 422. */
export class ConfigValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface PutConfigDTO {
  tenantId: string;
  key: string;
  scope: ConfigScope;
  entityId?: string | null;
  storeId?: string | null;
  value: string;
  effectiveFrom?: Date;
  actor: string;
}

export interface ResolveQuery {
  tenantId: string;
  key: string;
  entityId?: string | null;
  storeId?: string | null;
  asOf?: Date;
}

export interface ResolvedConfig {
  key: string;
  type: ConfigType;
  value: string;
  resolvedScope: ResolvedScope;
}

interface CacheEntry {
  resolved: ResolvedConfig;
  expiresAt: number;
}

// Propagation target (packet §13): future-dated / changed values observed <=60s.
const CACHE_TTL_MS = 30_000;

// ── Service ───────────────────────────────────────────────────────────────────

@injectable()
export class ConfigService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
  ) {}

  // ── Catalog ─────────────────────────────────────────────────────────────────

  async listCatalog() {
    return this.prisma.configKeyCatalog.findMany({ orderBy: { key: 'asc' } });
  }

  private async requireCatalog(key: string) {
    const entry = await this.prisma.configKeyCatalog.findUnique({ where: { key } });
    if (!entry) throw new ConfigUnknownKeyError(key);
    return entry;
  }

  // ── Read / resolution (BR223-2: STORE -> ENTITY -> TENANT -> default) ─────────

  async resolve(query: ResolveQuery): Promise<ResolvedConfig> {
    const { tenantId, key, entityId, storeId, asOf = new Date() } = query;
    const isNow = !query.asOf;
    const cacheKey = this.cacheKey(tenantId, key, entityId, storeId);

    if (isNow) {
      const hit = this.cache.get(cacheKey);
      if (hit && hit.expiresAt > Date.now()) return hit.resolved;
    }

    const catalog = await this.requireCatalog(key);
    const type = catalog.type as ConfigType;

    // Candidate versions: active as-of `asOf` (SCHEDULED rows whose effectiveFrom
    // has arrived count as effective — this is the effective-date flip, computed
    // at read time so a future-dated change is observed automatically).
    const candidates = await this.prisma.configSetting.findMany({
      where: {
        tenantId,
        key,
        effectiveFrom: { lte: asOf },
        status: { in: ['SCHEDULED', 'EFFECTIVE'] },
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    let resolved: ResolvedConfig = {
      key,
      type,
      value: catalog.defaultValue,
      resolvedScope: 'DEFAULT',
    };

    for (const scope of SCOPE_ORDER) {
      const match = candidates.find((c) => this.matchesScope(c, scope, entityId, storeId));
      if (match) {
        resolved = { key, type, value: match.value, resolvedScope: scope };
        break;
      }
    }

    if (isNow) {
      this.cache.set(cacheKey, { resolved, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    return resolved;
  }

  private matchesScope(
    row: { scope: string; entityId: string | null; storeId: string | null },
    scope: ConfigScope,
    entityId?: string | null,
    storeId?: string | null,
  ): boolean {
    if (row.scope !== scope) return false;
    if (scope === 'STORE') return !!storeId && row.storeId === storeId;
    if (scope === 'ENTITY') return !!entityId && row.entityId === entityId;
    return true; // TENANT
  }

  // ── Write (BR223-1 typed+validated, BR223-3 effective-dated + audited) ────────

  async put(dto: PutConfigDTO) {
    const catalog = await this.requireCatalog(dto.key); // throws 400 if unknown
    const type = catalog.type as ConfigType;

    const scopeErr = validateScope(dto.scope, catalog.allowedScope, dto.entityId, dto.storeId);
    if (scopeErr) throw new ConfigValidationError('INVALID_SCOPE', scopeErr);

    const valueErr = validateTypedValue(type, dto.value, catalog.enumValues);
    if (valueErr) throw new ConfigValidationError('INVALID_VALUE', valueErr);

    const now = new Date();
    const effectiveFrom = dto.effectiveFrom ?? now;
    const status = effectiveFrom.getTime() <= now.getTime() ? 'EFFECTIVE' : 'SCHEDULED';

    // Capture the currently-resolved "before" image at this exact dimension.
    const before = await this.resolve({
      tenantId: dto.tenantId,
      key: dto.key,
      entityId: dto.entityId,
      storeId: dto.storeId,
      asOf: now,
    });

    // Supersede prior versions at the same (key, scope, dimension) that are
    // effective on or before the new row (keeps history, marks them SUPERSEDED).
    await this.prisma.configSetting.updateMany({
      where: {
        tenantId: dto.tenantId,
        key: dto.key,
        scope: dto.scope,
        entityId: dto.entityId ?? null,
        storeId: dto.storeId ?? null,
        effectiveFrom: { lte: effectiveFrom },
        status: { in: ['SCHEDULED', 'EFFECTIVE'] },
      },
      data: { status: 'SUPERSEDED', supersededAt: now },
    });

    const created = await this.prisma.configSetting.create({
      data: {
        id: crypto.randomUUID(),
        tenantId: dto.tenantId,
        key: dto.key,
        type,
        scope: dto.scope,
        entityId: dto.entityId ?? null,
        storeId: dto.storeId ?? null,
        value: dto.value,
        effectiveFrom,
        status,
        actor: dto.actor,
      },
    });

    this.invalidate(dto.tenantId, dto.key);

    const after = { value: dto.value, scope: dto.scope, resolvedScope: dto.scope };
    await this.audit(dto.tenantId, dto.key, created.id, dto.actor, before, after);
    await this.emitChanged(dto, before.value, effectiveFrom);

    return { setting: created, before, after };
  }

  // ── Cache invalidation ────────────────────────────────────────────────────────

  /** Remove every cached resolution for a key within a tenant. */
  invalidate(tenantId: string, key: string): void {
    const prefix = `${tenantId}|${key}|`;
    for (const k of this.cache.keys()) {
      if (k.startsWith(prefix)) this.cache.delete(k);
    }
  }

  /** Full flush (used by the config.changed subscriber as a belt-and-braces fallback). */
  invalidateAll(): void {
    this.cache.clear();
  }

  private cacheKey(tenantId: string, key: string, entityId?: string | null, storeId?: string | null): string {
    return `${tenantId}|${key}|${entityId ?? ''}|${storeId ?? ''}`;
  }

  // ── AuditPort (stub) + event emission ─────────────────────────────────────────

  private async audit(
    tenantId: string,
    key: string,
    docId: string,
    actor: string,
    before: unknown,
    after: unknown,
  ): Promise<void> {
    try {
      await this.prisma.auditOutboxEvent.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          docType: 'config_setting',
          docId,
          action: 'PUT',
          before: (before ?? undefined) as any,
          after: (after ?? undefined) as any,
          actor,
        },
      });
    } catch {
      // AuditPort write is non-fatal to the business operation.
    }
  }

  private async emitChanged(dto: PutConfigDTO, beforeValue: string, effectiveFrom: Date): Promise<void> {
    const eventId = crypto.randomUUID();
    const payload = {
      eventId,
      key: dto.key,
      scope: dto.scope,
      before: beforeValue,
      after: dto.value,
      effectiveFrom: effectiveFrom.toISOString(),
      actor: dto.actor,
      ts: new Date().toISOString(),
      schemaV: 1,
    };
    // Outbox first (reliable), then best-effort broker publish.
    try {
      await this.prisma.coaOutboxEvent.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: dto.tenantId,
          eventType: 'config.changed',
          aggregateId: dto.key,
          payload: payload as any,
        },
      });
    } catch {
      /* non-fatal */
    }
    try {
      await this.events.publish({
        type: 'config.changed',
        tenantId: dto.tenantId,
        payload,
        occurredAt: new Date(),
        correlationId: eventId,
      } as any);
    } catch {
      /* best-effort; outbox row is the record of truth */
    }
  }
}
