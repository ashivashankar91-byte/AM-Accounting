import { inject, injectable } from 'tsyringe';
import { IEventPublisher } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/tenant-client';
import crypto from 'crypto';

// ── OEM launch set (BR204-1) ───────────────────────────────────────────────────
// Platform-controlled. Persisted in oem_ref (seeded by migration) so dealer-code
// patterns are correctable as data. This constant mirrors the launch set for
// fast in-process validation and to keep unit tests DB-light.
export const LAUNCH_OEMS = ['FORD', 'GM', 'TOYOTA', 'STELLANTIS', 'HONDA', 'NISSAN'] as const;
export type OemCode = (typeof LAUNCH_OEMS)[number];

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface CreateFranchiseDTO {
  tenantId:      string;
  storeId:       string;
  oemCode:       string;
  dealerCode:    string;
  effectiveFrom: string; // ISO date (YYYY-MM-DD)
  actor?:        string;
}

export interface UpdateFranchiseDTO {
  version:      number;
  dealerCode?:  string;
  /// Set to end-date a franchise on a sell event (BR204-3).
  effectiveTo?: string | null;
  actor?:       string;
}

export interface FranchiseListQuery {
  tenantId: string;
  storeId:  string;
  oemCode?: string;
  active?:  boolean; // true → only franchises with effectiveTo = null
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class FranchiseNotFoundError extends Error {
  constructor(id: string) {
    super(`Franchise not found: ${id}`);
    this.name = 'FranchiseNotFoundError';
  }
}

export class StoreNotFoundForFranchiseError extends Error {
  constructor(storeId: string) {
    super(`Store not found or not in tenant: ${storeId}`);
    this.name = 'StoreNotFoundForFranchiseError';
  }
}

export class FranchiseConflictError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'FranchiseConflictError';
  }
}

export class FranchiseValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'FranchiseValidationError';
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

@injectable()
export class FranchiseService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly _eventPublisher: IEventPublisher,
  ) {}

  // ── list ──────────────────────────────────────────────────────────────────
  async list(query: FranchiseListQuery) {
    const { tenantId, storeId, oemCode, active } = query;
    const where: any = { tenantId, storeId };
    if (oemCode) where.oemCode = oemCode;
    if (active) where.effectiveTo = null;

    const items = await this.prisma.franchise.findMany({
      where,
      orderBy: [{ oemCode: 'asc' }, { effectiveFrom: 'asc' }],
    });
    return { items, total: items.length };
  }

  // ── getById ─────────────────────────────────────────────────────────────────
  async getById(tenantId: string, storeId: string, id: string) {
    const franchise = await this.prisma.franchise.findFirst({ where: { id, tenantId, storeId } });
    if (!franchise) throw new FranchiseNotFoundError(id);
    return franchise;
  }

  // ── create ──────────────────────────────────────────────────────────────────
  async create(dto: CreateFranchiseDTO) {
    // BR204-1: franchise requires a store that belongs to this tenant.
    const store = await this.prisma.store.findFirst({
      where: { id: dto.storeId, tenantId: dto.tenantId },
    });
    if (!store) throw new StoreNotFoundForFranchiseError(dto.storeId);

    // BR204-1: OEM must be on the platform-controlled list → 422 unknown-oem.
    const oem = await this.prisma.oemRef.findFirst({
      where: { oemCode: dto.oemCode, active: true },
    });
    if (!oem) {
      throw new FranchiseValidationError(
        'UNKNOWN_OEM',
        `OEM "${dto.oemCode}" is not on the platform-controlled list`,
      );
    }

    // BR204-2: dealer code must match the per-OEM format → 422 dealer-code-format.
    this._assertDealerCodeFormat(oem.oemCode, oem.dealerCodePattern, oem.dealerCodeHint, dto.dealerCode);

    // BR204-3 duplicate-oem-per-store (409): only one ACTIVE franchise per (store, oem).
    const activeDup = await this.prisma.franchise.findFirst({
      where: { storeId: dto.storeId, oemCode: oem.oemCode, effectiveTo: null },
    });
    if (activeDup) {
      throw new FranchiseConflictError(
        'DUPLICATE_OEM_PER_STORE',
        `Store already has an active ${oem.oemCode} franchise`,
      );
    }

    const effectiveFrom = this._parseDate(dto.effectiveFrom, 'effectiveFrom');

    const franchise = await this.prisma.franchise.create({
      data: {
        id:            crypto.randomUUID(),
        tenantId:      dto.tenantId,
        storeId:       dto.storeId,
        oemCode:       oem.oemCode,
        dealerCode:    dto.dealerCode,
        effectiveFrom,
        version:       1,
      },
    });

    await this._writeOutbox(dto.tenantId, 'org.franchise.created', franchise.id, {
      eventId:       crypto.randomUUID(),
      storeId:       franchise.storeId,
      oemCode:       franchise.oemCode,
      dealerCode:    franchise.dealerCode,
      effectiveFrom: this._toIsoDate(franchise.effectiveFrom),
      actor:         dto.actor ?? 'user',
      ts:            new Date().toISOString(),
      schemaV:       1,
    });

    return franchise;
  }

  // ── update ──────────────────────────────────────────────────────────────────
  async update(tenantId: string, storeId: string, id: string, dto: UpdateFranchiseDTO) {
    const current = await this.prisma.franchise.findFirst({ where: { id, tenantId, storeId } });
    if (!current) throw new FranchiseNotFoundError(id);

    if (current.version !== dto.version) {
      throw new FranchiseConflictError(
        'VERSION_CONFLICT',
        `Version conflict: expected ${dto.version}, current is ${current.version}`,
      );
    }

    const data: any = { version: current.version + 1 };

    if (dto.dealerCode !== undefined) {
      const oem = await this.prisma.oemRef.findFirst({ where: { oemCode: current.oemCode } });
      const pattern = oem?.dealerCodePattern ?? '.*';
      const hint = oem?.dealerCodeHint ?? '';
      this._assertDealerCodeFormat(current.oemCode, pattern, hint, dto.dealerCode);
      data.dealerCode = dto.dealerCode;
    }

    if (dto.effectiveTo !== undefined) {
      data.effectiveTo = dto.effectiveTo === null ? null : this._parseDate(dto.effectiveTo, 'effectiveTo');
      if (data.effectiveTo && data.effectiveTo < current.effectiveFrom) {
        throw new FranchiseValidationError(
          'INVALID_EFFECTIVE_RANGE',
          'effectiveTo cannot be before effectiveFrom',
        );
      }
    }

    const franchise = await this.prisma.franchise.update({ where: { id }, data });

    await this._writeOutbox(tenantId, 'org.franchise.updated', id, {
      eventId:       crypto.randomUUID(),
      storeId:       franchise.storeId,
      oemCode:       franchise.oemCode,
      dealerCode:    franchise.dealerCode,
      effectiveFrom: this._toIsoDate(franchise.effectiveFrom),
      effectiveTo:   franchise.effectiveTo ? this._toIsoDate(franchise.effectiveTo) : null,
      actor:         dto.actor ?? 'user',
      ts:            new Date().toISOString(),
      schemaV:       1,
    });

    return franchise;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private _assertDealerCodeFormat(oemCode: string, pattern: string, hint: string, dealerCode: string) {
    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch {
      re = /.*/; // never fail-closed on a malformed stored pattern
    }
    if (!re.test(dealerCode)) {
      throw new FranchiseValidationError(
        'DEALER_CODE_FORMAT',
        `Dealer code "${dealerCode}" is invalid for ${oemCode}${hint ? ` (${hint})` : ''}`,
      );
    }
  }

  private _parseDate(value: string, field: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new FranchiseValidationError('INVALID_DATE', `${field} must be an ISO date (YYYY-MM-DD)`);
    }
    const d = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) {
      throw new FranchiseValidationError('INVALID_DATE', `${field} is not a valid date`);
    }
    return d;
  }

  private _toIsoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private async _writeOutbox(
    tenantId:    string,
    eventType:   string,
    aggregateId: string,
    payload:     Record<string, unknown>,
  ) {
    try {
      await this.prisma.tenantOutboxEvent.create({
        data: { id: crypto.randomUUID(), tenantId, eventType, aggregateId, payload },
      });
    } catch {
      // Non-fatal: outbox write failure must not fail the business operation.
    }
  }
}
