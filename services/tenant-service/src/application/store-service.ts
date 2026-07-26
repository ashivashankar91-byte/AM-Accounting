import { inject, injectable } from 'tsyringe';
import { IEventPublisher } from '@amacc/shared-kernel';

// ── US States + Canadian Provinces (BR201-2: drives tax jurisdiction defaulting) ──

export const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
  'DC',
] as const;

export const CA_PROVINCES = [
  'AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT',
] as const;

export const STATE_PROVINCE_VALUES = [...US_STATES, ...CA_PROVINCES];

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateStoreDTO {
  tenantId: string;
  entityId: string;
  storeCode: string;
  storeName: string;
  stateProvince: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  postalCode?: string;
  dmvId?: string;
}

export interface UpdateStoreDTO {
  /** Optimistic-lock version — must match current row */
  version: number;
  storeName?: string;
  stateProvince?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  postalCode?: string;
  dmvId?: string;
}

export interface DeactivateStoreDTO {
  version: number;
  reason: string;
  deactivatedBy: string;
}

export interface StoreListQuery {
  tenantId: string;
  entityId?: string;
  search?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class StoreNotFoundError extends Error {
  constructor(id: string) {
    super(`Store not found: ${id}`);
    this.name = 'StoreNotFoundError';
  }
}

export class StoreConflictError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'StoreConflictError';
  }
}

export class StoreValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'StoreValidationError';
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

@injectable()
export class StoreService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('IEventPublisher') private readonly eventPublisher: IEventPublisher,
  ) {}

  async list(query: StoreListQuery) {
    const { tenantId, entityId, search, status, page = 1, pageSize = 50 } = query;

    const where: any = { tenantId };
    if (entityId) where.entityId = entityId;
    if (status)   where.status   = status;
    if (search) {
      where.OR = [
        { storeCode: { contains: search, mode: 'insensitive' } },
        { storeName: { contains: search, mode: 'insensitive' } },
        { city:      { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.store.findMany({
        where,
        orderBy: [{ status: 'asc' }, { storeCode: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.store.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async getById(tenantId: string, id: string) {
    const store = await this.prisma.store.findFirst({ where: { id, tenantId } });
    if (!store) throw new StoreNotFoundError(id);
    return store;
  }

  async create(dto: CreateStoreDTO, actor = 'system') {
    // Validate entityId belongs to this tenant (BR201-1: orphan store = 422)
    const entity = await this.prisma.legalEntity.findFirst({
      where: { id: dto.entityId, tenantId: dto.tenantId },
    });
    if (!entity) {
      throw new StoreValidationError(
        'ORPHAN_STORE',
        `Legal entity '${dto.entityId}' not found in this tenant`,
      );
    }

    // Check store code uniqueness within entity (BR201-1)
    const existing = await this.prisma.store.findFirst({
      where: { entityId: dto.entityId, storeCode: dto.storeCode.toUpperCase() },
    });
    if (existing) {
      throw new StoreConflictError(
        'DUPLICATE_STORE_CODE',
        `Store code '${dto.storeCode}' already exists under entity '${dto.entityId}'`,
      );
    }

    const store = await this.prisma.store.create({
      data: {
        tenantId:     dto.tenantId,
        entityId:     dto.entityId,
        storeCode:    dto.storeCode.toUpperCase(),
        storeName:    dto.storeName,
        stateProvince: dto.stateProvince.toUpperCase(),
        addressLine1: dto.addressLine1 ?? null,
        addressLine2: dto.addressLine2 ?? null,
        city:         dto.city ?? null,
        postalCode:   dto.postalCode ?? null,
        dmvId:        dto.dmvId ?? null,
        status:       'ACTIVE',
        version:      1,
      },
    });

    await this._writeOutbox(dto.tenantId, 'STORE_CREATED', store.id, {
      entityId:     store.entityId,
      storeCode:    store.storeCode,
      storeName:    store.storeName,
      stateProvince: store.stateProvince,
    });
    await this._audit(dto.tenantId, 'Store', store.id, 'CREATE', null, store, actor);

    return store;
  }

  async update(tenantId: string, id: string, dto: UpdateStoreDTO, actor = 'system') {
    const current = await this.prisma.store.findFirst({ where: { id, tenantId } });
    if (!current) throw new StoreNotFoundError(id);

    if (current.version !== dto.version) {
      throw new StoreConflictError(
        'VERSION_CONFLICT',
        `Version conflict: expected ${dto.version}, current is ${current.version}`,
      );
    }

    if (current.status === 'INACTIVE') {
      throw new StoreValidationError('STORE_INACTIVE', 'Cannot edit an inactive store');
    }

    const data: any = { version: current.version + 1 };
    if (dto.storeName     !== undefined) data.storeName     = dto.storeName;
    if (dto.stateProvince !== undefined) data.stateProvince = dto.stateProvince.toUpperCase();
    if (dto.addressLine1  !== undefined) data.addressLine1  = dto.addressLine1;
    if (dto.addressLine2  !== undefined) data.addressLine2  = dto.addressLine2;
    if (dto.city          !== undefined) data.city          = dto.city;
    if (dto.postalCode    !== undefined) data.postalCode    = dto.postalCode;
    if (dto.dmvId         !== undefined) data.dmvId         = dto.dmvId;

    const store = await this.prisma.store.update({ where: { id }, data });

    await this._writeOutbox(tenantId, 'STORE_UPDATED', id, {
      storeCode: store.storeCode,
      changes:   Object.keys(data).filter(k => k !== 'version'),
    });
    await this._audit(tenantId, 'Store', id, 'UPDATE', current, store, actor);

    return store;
  }

  async deactivate(tenantId: string, id: string, dto: DeactivateStoreDTO) {
    const current = await this.prisma.store.findFirst({ where: { id, tenantId } });
    if (!current) throw new StoreNotFoundError(id);

    if (current.status === 'INACTIVE') {
      throw new StoreValidationError('ALREADY_INACTIVE', 'Store is already inactive');
    }

    if (current.version !== dto.version) {
      throw new StoreConflictError(
        'VERSION_CONFLICT',
        `Version conflict: expected ${dto.version}, current is ${current.version}`,
      );
    }

    const store = await this.prisma.store.update({
      where: { id },
      data: {
        status:            'INACTIVE',
        version:           current.version + 1,
        deactivatedAt:     new Date(),
        deactivatedBy:     dto.deactivatedBy,
        deactivationReason: dto.reason,
      },
    });

    await this._writeOutbox(tenantId, 'STORE_DEACTIVATED', id, {
      storeCode:     store.storeCode,
      reason:        dto.reason,
      deactivatedBy: dto.deactivatedBy,
    });
    await this._audit(tenantId, 'Store', id, 'DEACTIVATE', current, store, dto.deactivatedBy);

    return store;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

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
}
