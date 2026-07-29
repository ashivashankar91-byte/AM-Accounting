import { inject, injectable } from 'tsyringe';
import { IEventPublisher } from '@amacc/shared-kernel';
import { createEvent } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/tenant-client';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateLegalEntityDTO {
  tenantId: string;
  entityCode: string;
  legalName: string;
  displayName?: string;
  statutoryId?: string;
  functionalCurrency: string;
  country: string;
  fiscalYearEndMonth: number;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  effectiveDate: Date;
}

export interface UpdateLegalEntityDTO {
  /** optimistic-lock version — must match current row */
  version: number;
  effectiveDate: Date;
  legalName?: string;
  displayName?: string;
  /** EIN / statutory ID. Duplicate triggers WARN_DUPLICATE_STATUTORY_ID (409), not hard block. */
  statutoryId?: string;
  /** NOT included: entityCode (immutable), functionalCurrency (immutable after first post) */
  country?: string;
  fiscalYearEndMonth?: number;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}

export interface DeactivateLegalEntityDTO {
  /** optimistic-lock version */
  version: number;
  reason: string;
  deactivatedBy: string;
}

export interface ConfigureEliminationDTO {
  /** optimistic-lock version */
  version: number;
  isElimination: boolean;
  /** Required when the entity has posted journals (BR003-4); optional otherwise. */
  reason?: string;
  actor: string;
}

export interface LegalEntityListQuery {
  tenantId: string;
  search?: string;
  /** ACTIVE | INACTIVE | undefined = all */
  status?: string;
  page?: number;
  pageSize?: number;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class LegalEntityNotFoundError extends Error {
  constructor(id: string) {
    super(`Legal entity not found: ${id}`);
    this.name = 'LegalEntityNotFoundError';
  }
}

export class LegalEntityConflictError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'LegalEntityConflictError';
  }
}

export class LegalEntityValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'LegalEntityValidationError';
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

@injectable()
export class LegalEntityService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('IEventPublisher') private readonly eventPublisher: IEventPublisher,
  ) {}

  async list(query: LegalEntityListQuery) {
    const { tenantId, search, status, page = 1, pageSize = 50 } = query;

    const where: any = { tenantId };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { entityCode: { contains: search, mode: 'insensitive' } },
        { legalName:  { contains: search, mode: 'insensitive' } },
        { displayName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.legalEntity.findMany({
        where,
        orderBy: [{ status: 'asc' }, { entityCode: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.legalEntity.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async getById(tenantId: string, id: string) {
    const entity = await this.prisma.legalEntity.findFirst({ where: { id, tenantId } });
    if (!entity) throw new LegalEntityNotFoundError(id);
    return entity;
  }

  async create(dto: CreateLegalEntityDTO, actor = 'system') {
    // Check entity code uniqueness (DB unique constraint also guards this)
    const existing = await this.prisma.legalEntity.findFirst({
      where: { tenantId: dto.tenantId, entityCode: dto.entityCode },
    });
    if (existing) {
      throw new LegalEntityConflictError(
        'DUPLICATE_ENTITY_CODE',
        `Entity code '${dto.entityCode}' already exists in this tenant`,
      );
    }

    // Warn on duplicate statutory ID (not a hard block — caller decides)
    const dupStatutory = dto.statutoryId
      ? await this.prisma.legalEntity.findFirst({
          where: { tenantId: dto.tenantId, statutoryId: dto.statutoryId },
        })
      : null;

    // S007 BR7-1/BR7-4 — legal-entity create + audit event are one atomic
    // transaction.
    const entity = await this.prisma.$transaction(async (tx: any) => {
      const e = await tx.legalEntity.create({
        data: {
          tenantId:          dto.tenantId,
          entityCode:        dto.entityCode.toUpperCase(),
          legalName:         dto.legalName,
          displayName:       dto.displayName ?? null,
          statutoryId:       dto.statutoryId ?? null,
          functionalCurrency: dto.functionalCurrency.toUpperCase(),
          country:           dto.country.toUpperCase(),
          fiscalYearEndMonth: dto.fiscalYearEndMonth,
          address:           dto.address ?? null,
          city:              dto.city ?? null,
          state:             dto.state ?? null,
          postalCode:        dto.postalCode ?? null,
          effectiveDate:     dto.effectiveDate,
          status:            'ACTIVE',
          version:           1,
        },
      });
      await this._audit(dto.tenantId, 'LegalEntity', e.id, 'CREATE', null, e, actor, tx);
      return e;
    });

    // Publish to outbox
    await this._writeOutbox(dto.tenantId, 'LEGAL_ENTITY_CREATED', entity.id, {
      entityCode: entity.entityCode,
      legalName:  entity.legalName,
    });

    return { entity, warnDuplicateStatutoryId: !!dupStatutory };
  }

  async update(tenantId: string, id: string, dto: UpdateLegalEntityDTO, actor = 'system') {
    const current = await this.prisma.legalEntity.findFirst({ where: { id, tenantId } });
    if (!current) throw new LegalEntityNotFoundError(id);

    // Optimistic concurrency check
    if (current.version !== dto.version) {
      throw new LegalEntityConflictError(
        'VERSION_CONFLICT',
        `Version conflict: expected ${dto.version}, current is ${current.version}`,
      );
    }

    if (current.status === 'INACTIVE') {
      throw new LegalEntityValidationError(
        'ENTITY_INACTIVE',
        'Cannot edit an inactive legal entity',
      );
    }

    // Warn on duplicate statutory ID when changing it
    const warnDuplicateStatutoryId =
      dto.statutoryId &&
      dto.statutoryId !== current.statutoryId &&
      !!(await this.prisma.legalEntity.findFirst({
        where: {
          tenantId,
          statutoryId: dto.statutoryId,
          NOT: { id },
        },
      }));

    const data: any = {
      effectiveDate: dto.effectiveDate,
      version:       current.version + 1,
    };
    if (dto.legalName         !== undefined) data.legalName         = dto.legalName;
    if (dto.displayName       !== undefined) data.displayName       = dto.displayName;
    if (dto.statutoryId       !== undefined) data.statutoryId       = dto.statutoryId;
    if (dto.country           !== undefined) data.country           = dto.country.toUpperCase();
    if (dto.fiscalYearEndMonth !== undefined) data.fiscalYearEndMonth = dto.fiscalYearEndMonth;
    if (dto.address           !== undefined) data.address           = dto.address;
    if (dto.city              !== undefined) data.city              = dto.city;
    if (dto.state             !== undefined) data.state             = dto.state;
    if (dto.postalCode        !== undefined) data.postalCode        = dto.postalCode;

    const entity = await this.prisma.$transaction(async (tx: any) => {
      const e = await tx.legalEntity.update({ where: { id }, data });
      await this._audit(tenantId, 'LegalEntity', id, 'UPDATE', current, e, actor, tx);
      return e;
    });

    await this._writeOutbox(tenantId, 'LEGAL_ENTITY_UPDATED', id, {
      entityCode: entity.entityCode,
      changes:    Object.keys(data).filter(k => !['version', 'effectiveDate'].includes(k)),
    });

    return { entity, warnDuplicateStatutoryId: !!warnDuplicateStatutoryId };
  }

  async deactivate(tenantId: string, id: string, dto: DeactivateLegalEntityDTO) {
    const current = await this.prisma.legalEntity.findFirst({ where: { id, tenantId } });
    if (!current) throw new LegalEntityNotFoundError(id);

    if (current.status === 'INACTIVE') {
      throw new LegalEntityValidationError('ALREADY_INACTIVE', 'Legal entity is already inactive');
    }

    if (current.version !== dto.version) {
      throw new LegalEntityConflictError(
        'VERSION_CONFLICT',
        `Version conflict: expected ${dto.version}, current is ${current.version}`,
      );
    }

    const entity = await this.prisma.$transaction(async (tx: any) => {
      const e = await tx.legalEntity.update({
        where: { id },
        data:  {
          status:            'INACTIVE',
          version:           current.version + 1,
          deactivatedAt:     new Date(),
          deactivatedBy:     dto.deactivatedBy,
          deactivationReason: dto.reason,
        },
      });
      await this._audit(tenantId, 'LegalEntity', id, 'DEACTIVATE', current, e, dto.deactivatedBy, tx);
      return e;
    });

    await this._writeOutbox(tenantId, 'LEGAL_ENTITY_DEACTIVATED', id, {
      entityCode:        entity.entityCode,
      reason:            dto.reason,
      deactivatedBy:     dto.deactivatedBy,
    });

    return entity;
  }

  /**
   * ACC-S003 — configure the elimination-entity flag. Flag-only (no scoped
   * pairing) per R1 scope. Guards (BR003-2): cannot flag an entity that
   * currently owns one or more ACTIVE stores (422 OWNS_STORES). BR003-4:
   * a reason is required for every change to the elimination designation.
   */
  async configureElimination(tenantId: string, id: string, dto: ConfigureEliminationDTO) {
    const current = await this.prisma.legalEntity.findFirst({ where: { id, tenantId } });
    if (!current) throw new LegalEntityNotFoundError(id);

    if (current.version !== dto.version) {
      throw new LegalEntityConflictError(
        'VERSION_CONFLICT',
        `Version conflict: expected ${dto.version}, current is ${current.version}`,
      );
    }

    if (current.isElimination === dto.isElimination) {
      throw new LegalEntityValidationError(
        'NO_CHANGE',
        `Legal entity is already ${dto.isElimination ? '' : 'not '}an elimination entity`,
      );
    }

    if (!dto.reason?.trim()) {
      throw new LegalEntityValidationError(
        'REASON_REQUIRED',
        'A reason is required to change the elimination designation',
      );
    }

    if (dto.isElimination) {
      const ownedStores = await this.prisma.store.findMany({
        where: { tenantId, entityId: id, status: 'ACTIVE' },
        select: { id: true, storeCode: true, storeName: true },
      });
      if (ownedStores.length > 0) {
        const err = new LegalEntityValidationError(
          'OWNS_STORES',
          `Cannot designate this entity as an elimination entity — it owns ${ownedStores.length} active store(s)`,
        );
        (err as any).ownedStores = ownedStores;
        throw err;
      }
    }

    // P1-F1 corrective fix: the pre-checks above (NO_CHANGE, REASON_REQUIRED,
    // OWNS_STORES) read `current` for business validation only. The actual
    // mutation below is NOT conditioned on that stale read — it is an atomic
    // conditional update (`updateMany` scoped by id + tenantId + the exact
    // expected version). Two concurrent requests racing on the same expected
    // version can both pass the pre-checks, but Postgres serializes the two
    // UPDATE statements: only the first to commit matches the WHERE clause
    // (version still equals dto.version) and the second's row-count is 0,
    // which we surface as a genuine 409 VERSION_CONFLICT — never a silent
    // lost update.
    const entity = await this.prisma.$transaction(async (tx: any) => {
      const { count } = await tx.legalEntity.updateMany({
        where: { id, tenantId, version: dto.version },
        data: {
          isElimination:           dto.isElimination,
          version:                 { increment: 1 },
          eliminationChangedAt:    new Date(),
          eliminationChangedBy:    dto.actor,
          eliminationChangeReason: dto.reason ?? null,
        },
      });
      if (count !== 1) {
        throw new LegalEntityConflictError(
          'VERSION_CONFLICT',
          `Version conflict: expected ${dto.version}, entity was updated concurrently`,
        );
      }
      const e = await tx.legalEntity.findFirst({ where: { id, tenantId } });
      await this._audit(tenantId, 'LegalEntity', id, 'ELIMINATION_CHANGED', current, e, dto.actor, tx);
      return e;
    });

    await this._writeOutbox(tenantId, 'LEGAL_ENTITY_ELIMINATION_CHANGED', id, {
      entityCode:    entity.entityCode,
      isElimination: entity.isElimination,
      reason:        dto.reason ?? null,
      actor:         dto.actor,
    });

    return entity;
  }

  /** Mark as having posted journals — called by GL service or internal flag. */
  async markHasPostedJournals(tenantId: string, id: string) {
    await this.prisma.legalEntity.updateMany({
      where: { id, tenantId },
      data:  { hasPostedJournals: true },
    });
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async _writeOutbox(
    tenantId: string,
    eventType: string,
    aggregateId: string,
    payload: Record<string, unknown>,
  ) {
    try {
      await this.prisma.tenantOutboxEvent.create({
        data: { id: crypto.randomUUID(), tenantId, eventType, aggregateId, payload },
      });
    } catch {
      // Non-fatal: log but don't fail the business operation
    }
  }

  /** R0 Stabilization Phase 4: AuditPort outbox — tenant-service had none
   * before this. Drained to the real S007 audit-service by AuditOutboxDrainer
   * (see src/index.ts). S007 BR7-1/BR7-4: coupled transactionally with the
   * domain write by every caller above (no independent swallow here). */
  private async _audit(
    tenantId: string, docType: string, docId: string, action: string,
    before: unknown, after: unknown, actor?: string,
    tx: Pick<PrismaClient, 'auditOutboxEvent'> = this.prisma,
  ): Promise<void> {
    await tx.auditOutboxEvent.create({
      data: {
        id: crypto.randomUUID(), tenantId, docType, docId, action,
        before: (before ?? undefined) as any, after: (after ?? undefined) as any,
        actor: actor ?? 'system',
      },
    });
  }
}
