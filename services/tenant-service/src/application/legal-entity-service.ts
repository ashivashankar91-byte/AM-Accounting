import { inject, injectable } from 'tsyringe';
import { IEventPublisher } from '@amacc/shared-kernel';
import { createEvent } from '@amacc/shared-kernel';

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

    const entity = await this.prisma.legalEntity.create({
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

    // Publish to outbox
    await this._writeOutbox(dto.tenantId, 'LEGAL_ENTITY_CREATED', entity.id, {
      entityCode: entity.entityCode,
      legalName:  entity.legalName,
    });
    await this._audit(dto.tenantId, 'LegalEntity', entity.id, 'CREATE', null, entity, actor);

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

    const entity = await this.prisma.legalEntity.update({ where: { id }, data });

    await this._writeOutbox(tenantId, 'LEGAL_ENTITY_UPDATED', id, {
      entityCode: entity.entityCode,
      changes:    Object.keys(data).filter(k => !['version', 'effectiveDate'].includes(k)),
    });
    await this._audit(tenantId, 'LegalEntity', id, 'UPDATE', current, entity, actor);

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

    const entity = await this.prisma.legalEntity.update({
      where: { id },
      data:  {
        status:            'INACTIVE',
        version:           current.version + 1,
        deactivatedAt:     new Date(),
        deactivatedBy:     dto.deactivatedBy,
        deactivationReason: dto.reason,
      },
    });

    await this._writeOutbox(tenantId, 'LEGAL_ENTITY_DEACTIVATED', id, {
      entityCode:        entity.entityCode,
      reason:            dto.reason,
      deactivatedBy:     dto.deactivatedBy,
    });
    await this._audit(tenantId, 'LegalEntity', id, 'DEACTIVATE', current, entity, dto.deactivatedBy);

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
   * (see src/index.ts). Never fatal to the business operation. */
  private async _audit(
    tenantId: string, docType: string, docId: string, action: string,
    before: unknown, after: unknown, actor?: string,
  ): Promise<void> {
    try {
      await this.prisma.auditOutboxEvent.create({
        data: {
          id: crypto.randomUUID(), tenantId, docType, docId, action,
          before: (before ?? undefined) as any, after: (after ?? undefined) as any,
          actor: actor ?? 'system',
        },
      });
    } catch {
      // Non-fatal: AuditPort write must not fail the business operation.
    }
  }
}
