import { inject, injectable } from 'tsyringe';
import { IEventPublisher } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/coa-client';
import crypto from 'crypto';
import {
  RESERVED_SOURCES,
  SourceClass,
  SourceFlags,
  isValidClass,
  isValidCode,
  isValidName,
  normalizeFlags,
} from '../domain/journal-source';

// ── Errors ───────────────────────────────────────────────────────────────────

export class SourceValidationError extends Error {
  readonly status = 422;
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'SourceValidationError';
  }
}

export class DuplicateSourceError extends Error {
  readonly status = 409;
  readonly code = 'DUPLICATE_SOURCE_CODE';
  constructor(sourceCode: string) {
    super(`Journal source "${sourceCode}" already exists`);
    this.name = 'DuplicateSourceError';
  }
}

/** BR212-2 — tenants may add MANUAL sources only; SYSTEM/reserved come from bootstrap. */
export class SystemSourceCreationError extends Error {
  readonly status = 422;
  readonly code = 'CANNOT_CREATE_SYSTEM_SOURCE';
  constructor() {
    super('Tenants may only create MANUAL journal sources; SYSTEM/reserved sources are system-defined');
    this.name = 'SystemSourceCreationError';
  }
}

/** BR212-2 — reserved codes are immutable. */
export class ReservedImmutableError extends Error {
  readonly status = 422;
  readonly code = 'RESERVED_SOURCE_IMMUTABLE';
  constructor(sourceCode: string) {
    super(`Journal source "${sourceCode}" is reserved and cannot be modified`);
    this.name = 'ReservedImmutableError';
  }
}

/** BR212-1 — SYSTEM sources are not usable by the manual JE path. */
export class SystemSourceNotManualError extends Error {
  readonly status = 422;
  readonly code = 'SYSTEM_SOURCE_NOT_MANUAL';
  constructor(sourceCode: string) {
    super(`Journal source "${sourceCode}" is a SYSTEM source and cannot be used for manual journal entry`);
    this.name = 'SystemSourceNotManualError';
  }
}

export class SourceNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'SOURCE_NOT_FOUND';
  constructor(sourceCode: string) {
    super(`Journal source "${sourceCode}" not found`);
    this.name = 'SourceNotFoundError';
  }
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface CreateSourceDTO {
  tenantId: string;
  code: string;
  name: string;
  sourceClass?: SourceClass; // MANUAL enforced for tenant creation
  numericAlias?: number | null;
  flags?: Partial<SourceFlags>;
  actor: string;
}

export interface UpdateSourceDTO {
  tenantId: string;
  code: string;
  name?: string;
  flags?: Partial<SourceFlags>;
  actor: string;
}

type EventType = 'coa.source.created' | 'coa.source.updated' | 'coa.source.deactivated';

@injectable()
export class SourceService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
  ) {}

  /** BR212-2 — create a tenant MANUAL source (SYSTEM creation rejected). */
  async create(dto: CreateSourceDTO) {
    const code = typeof dto.code === 'string' ? dto.code.trim().toUpperCase() : dto.code;
    if (!isValidCode(code)) {
      throw new SourceValidationError('INVALID_CODE', 'code must be 2-6 uppercase alphanumerics');
    }
    if (!isValidName(dto.name)) {
      throw new SourceValidationError('INVALID_NAME', 'name must be 1-120 characters');
    }
    if (dto.sourceClass !== undefined && !isValidClass(dto.sourceClass)) {
      throw new SourceValidationError('INVALID_CLASS', 'class must be MANUAL or SYSTEM');
    }
    if (dto.sourceClass === 'SYSTEM') throw new SystemSourceCreationError();

    const existing = await this.prisma.journalSource.findUnique({
      where: { tenantId_code: { tenantId: dto.tenantId, code } },
    });
    if (existing) throw new DuplicateSourceError(code);

    const flags = normalizeFlags(dto.flags);
    // S007 BR7-1/BR7-4 — create + audit event are one atomic transaction.
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.journalSource.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: dto.tenantId,
          code,
          numericAlias: dto.numericAlias ?? null,
          name: dto.name.trim(),
          sourceClass: 'MANUAL',
          reserved: false,
          autoPost: flags.autoPost,
          yearEndOnly: flags.yearEndOnly,
          thirteenthOnly: flags.thirteenthOnly,
          status: 'ACTIVE',
          version: 1,
        },
      });
      await this.audit(dto.tenantId, code, dto.actor, 'CREATE', null, this.snapshot(r), tx);
      return r;
    });
    await this.emit('coa.source.created', dto.tenantId, row, dto.actor);
    return row;
  }

  async list(tenantId: string, filter?: { sourceClass?: SourceClass; status?: string }) {
    return this.prisma.journalSource.findMany({
      where: {
        tenantId,
        ...(filter?.sourceClass ? { sourceClass: filter.sourceClass } : {}),
        ...(filter?.status ? { status: filter.status } : {}),
      },
      orderBy: { code: 'asc' },
    });
  }

  async get(tenantId: string, code: string) {
    const row = await this.load(tenantId, code);
    return row;
  }

  /** BR212-2 — reserved sources are immutable; MANUAL custom sources are editable. */
  async update(dto: UpdateSourceDTO) {
    const row = await this.load(dto.tenantId, dto.code);
    if (row.reserved) throw new ReservedImmutableError(row.code);

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      if (!isValidName(dto.name)) throw new SourceValidationError('INVALID_NAME', 'name must be 1-120 characters');
      data['name'] = dto.name.trim();
    }
    if (dto.flags !== undefined) {
      const flags = normalizeFlags({ ...this.currentFlags(row), ...dto.flags });
      data['autoPost'] = flags.autoPost;
      data['yearEndOnly'] = flags.yearEndOnly;
      data['thirteenthOnly'] = flags.thirteenthOnly;
    }
    if (Object.keys(data).length === 0) return row;

    const before = this.snapshot(row);
    // S007 BR7-1/BR7-4 — update + audit event are one atomic transaction.
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.journalSource.update({
        where: { id: row.id },
        data: { ...data, version: { increment: 1 } },
      });
      await this.audit(dto.tenantId, row.code, dto.actor, 'UPDATE', before, this.snapshot(u), tx);
      return u;
    });
    await this.emit('coa.source.updated', dto.tenantId, updated, dto.actor);
    return updated;
  }

  /** BR212-3 — deactivation blocks new journals only; reserved sources are immutable. */
  async deactivate(tenantId: string, code: string, actor: string) {
    const row = await this.load(tenantId, code);
    if (row.reserved) throw new ReservedImmutableError(row.code);
    if (row.status === 'INACTIVE') return row;

    const before = this.snapshot(row);
    // S007 BR7-1/BR7-4 — deactivate + audit event are one atomic transaction.
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.journalSource.update({
        where: { id: row.id },
        data: { status: 'INACTIVE', version: { increment: 1 } },
      });
      await this.audit(tenantId, row.code, actor, 'DEACTIVATE', before, this.snapshot(u), tx);
      return u;
    });
    await this.emit('coa.source.deactivated', tenantId, updated, actor);
    return updated;
  }

  /** BR212-1 — guard reused by the manual JE path (S214): SYSTEM source → 422. */
  async assertUsableByManual(tenantId: string, code: string) {
    const row = await this.load(tenantId, code);
    if (row.sourceClass === 'SYSTEM') throw new SystemSourceNotManualError(row.code);
    if (row.status !== 'ACTIVE') throw new SourceValidationError('SOURCE_INACTIVE', `Journal source "${row.code}" is inactive`);
    return row;
  }

  /** Idempotent bootstrap of the reserved system-defined source set (merge-by-code). */
  async bootstrapReserved(tenantId: string, actor: string) {
    const existing = await this.prisma.journalSource.findMany({ where: { tenantId } });
    const byCode = new Map(existing.map((s) => [s.code, s]));
    const toCreate = RESERVED_SOURCES.filter((r) => !byCode.has(r.code));
    const merged = RESERVED_SOURCES.length - toCreate.length;

    // S007 BR7-1/BR7-4 — every reserved-source row created plus the
    // summary audit event are one atomic transaction: a failure partway
    // through never leaves a partially-bootstrapped, unaudited set.
    const createdRows = await this.prisma.$transaction(async (tx) => {
      const rows = [];
      for (const r of toCreate) {
        const row = await tx.journalSource.create({
          data: {
            id: crypto.randomUUID(),
            tenantId,
            code: r.code,
            numericAlias: r.numericAlias,
            name: r.name,
            sourceClass: r.sourceClass,
            reserved: true,
            autoPost: r.flags.autoPost,
            yearEndOnly: r.flags.yearEndOnly,
            thirteenthOnly: r.flags.thirteenthOnly,
            status: 'ACTIVE',
            version: 1,
          },
        });
        rows.push(row);
      }
      await this.audit(tenantId, '*reserved*', actor, 'BOOTSTRAP', null, { created: rows.length, merged }, tx);
      return rows;
    });

    for (const row of createdRows) {
      await this.emit('coa.source.created', tenantId, row, actor);
    }
    return { created: createdRows.length, merged };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async load(tenantId: string, rawCode: string) {
    const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : rawCode;
    const row = await this.prisma.journalSource.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
    if (!row) throw new SourceNotFoundError(code);
    return row;
  }

  private currentFlags(row: any): SourceFlags {
    return { autoPost: row.autoPost, yearEndOnly: row.yearEndOnly, thirteenthOnly: row.thirteenthOnly };
  }

  private snapshot(row: any) {
    return {
      code: row.code,
      name: row.name,
      numericAlias: row.numericAlias,
      class: row.sourceClass,
      reserved: row.reserved,
      flags: this.currentFlags(row),
      status: row.status,
      version: row.version,
    };
  }

  private async audit(
    tenantId: string,
    code: string,
    actor: string,
    action: string,
    before: unknown,
    after: unknown,
    tx: Pick<PrismaClient, 'auditOutboxEvent'> = this.prisma,
  ) {
    await tx.auditOutboxEvent.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        docType: 'journal_source',
        docId: code,
        action,
        before: (before ?? undefined) as any,
        after: (after ?? undefined) as any,
        actor,
      },
    });
  }

  private async emit(type: EventType, tenantId: string, row: any, actor: string) {
    const eventId = crypto.randomUUID();
    const payload = {
      eventId,
      code: row.code,
      class: row.sourceClass,
      flags: this.currentFlags(row),
      actor,
      ts: new Date().toISOString(),
      schemaV: 1,
    };
    try {
      await this.prisma.coaOutboxEvent.create({
        data: { id: crypto.randomUUID(), tenantId, eventType: type, aggregateId: row.code, payload: payload as any },
      });
    } catch {
      /* non-fatal */
    }
    try {
      await this.events.publish({
        type,
        tenantId,
        payload,
        occurredAt: new Date(),
        correlationId: eventId,
      } as any);
    } catch {
      /* best-effort */
    }
  }
}
