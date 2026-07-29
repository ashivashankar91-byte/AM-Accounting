import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { IEventPublisher } from '@amacc/shared-kernel';
import { PrismaClient, Prisma } from '.prisma/coa-client';
import { isValidAnalysisCode } from '../domain/analysis-code';

// ── Errors ───────────────────────────────────────────────────────────────────

export class AnalysisCodeNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'ANALYSIS_CODE_NOT_FOUND';
  constructor(kind: 'type' | 'value', id: string) {
    super(`Analysis code ${kind} not found: ${id}`);
    this.name = 'AnalysisCodeNotFoundError';
  }
}

export class AnalysisCodeConflictError extends Error {
  readonly status = 409;
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AnalysisCodeConflictError';
    this.code = code;
  }
}

export class AnalysisCodeValidationError extends Error {
  readonly status = 422;
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AnalysisCodeValidationError';
    this.code = code;
  }
}

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateTypeDTO {
  tenantId: string;
  code: string;
  name: string;
}

export interface UpdateTypeDTO {
  version: number;
  name?: string;
}

export interface DeactivateDTO {
  version: number;
  reason: string;
  deactivatedBy: string;
}

export interface CreateValueDTO {
  tenantId: string;
  typeId: string;
  code: string;
  name: string;
}

export interface UpdateValueDTO {
  version: number;
  name?: string;
}

export interface TypeListQuery {
  tenantId: string;
  status?: string; // ACTIVE | INACTIVE
  search?: string;
}

@injectable()
export class AnalysisCodeService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
  ) {}

  // ── Types ────────────────────────────────────────────────────────────────

  async listTypes(query: TypeListQuery) {
    const { tenantId, status, search } = query;
    const where: any = { tenantId };
    if (status === 'ACTIVE') where.isActive = true;
    if (status === 'INACTIVE') where.isActive = false;
    if (search) {
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }
    const types = await this.prisma.analysisCodeType.findMany({
      where,
      orderBy: [{ code: 'asc' }],
      include: { values: { orderBy: [{ code: 'asc' }] } },
    });
    return { items: types, total: types.length };
  }

  async getType(tenantId: string, id: string) {
    const type = await this.prisma.analysisCodeType.findFirst({
      where: { id, tenantId },
      include: { values: { orderBy: [{ code: 'asc' }] } },
    });
    if (!type) throw new AnalysisCodeNotFoundError('type', id);
    return type;
  }

  async createType(dto: CreateTypeDTO, actor: string) {
    if (!isValidAnalysisCode(dto.code)) {
      throw new AnalysisCodeValidationError('INVALID_CODE', 'Type code must be 1-20 characters.');
    }
    const existing = await this.prisma.analysisCodeType.findFirst({ where: { tenantId: dto.tenantId, code: dto.code } });
    if (existing) {
      throw new AnalysisCodeConflictError('DUPLICATE_TYPE_CODE', `Analysis code type "${dto.code}" already exists for this tenant.`);
    }

    const type = await this.prisma.$transaction(async (tx) => {
      const t = await tx.analysisCodeType.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: dto.tenantId,
          code: dto.code,
          name: dto.name,
          isActive: true,
          version: 1,
        },
      });
      // S007 BR7-1/BR7-4 — the domain create + audit event are one atomic
      // transaction (department-service.ts convention).
      await this._audit(dto.tenantId, 'ANALYSIS_CODE_TYPE', t.id, 'CREATED', null, t, actor, tx);
      return t;
    });

    await this._writeOutbox(dto.tenantId, 'analysis.type.created', type.id, { code: type.code, name: type.name, actor });
    return type;
  }

  async updateType(tenantId: string, id: string, dto: UpdateTypeDTO, actor: string) {
    const current = await this.prisma.analysisCodeType.findFirst({ where: { id, tenantId } });
    if (!current) throw new AnalysisCodeNotFoundError('type', id);
    if (current.version !== dto.version) {
      throw new AnalysisCodeConflictError('VERSION_CONFLICT', `Version conflict: expected ${dto.version}, current is ${current.version}`);
    }
    if (!current.isActive) {
      throw new AnalysisCodeValidationError('TYPE_INACTIVE', 'Cannot edit an inactive analysis code type.');
    }

    const data: any = { version: current.version + 1 };
    if (dto.name !== undefined) data.name = dto.name;

    const type = await this.prisma.$transaction(async (tx) => {
      const t = await tx.analysisCodeType.update({ where: { id }, data });
      await this._audit(tenantId, 'ANALYSIS_CODE_TYPE', id, 'UPDATED', current, t, actor, tx);
      return t;
    });

    await this._writeOutbox(tenantId, 'analysis.type.updated', id, { changes: Object.keys(data).filter((k) => k !== 'version'), actor });
    return type;
  }

  /**
   * BR011 registry convention (matches department-service.ts): deactivate
   * only, never delete. A type with any ACTIVE value cannot be deactivated —
   * deactivate the values first, so a Controller cannot silently orphan an
   * in-use dimension.
   */
  async deactivateType(tenantId: string, id: string, dto: DeactivateDTO) {
    const current = await this.prisma.analysisCodeType.findFirst({ where: { id, tenantId } });
    if (!current) throw new AnalysisCodeNotFoundError('type', id);
    if (!current.isActive) {
      throw new AnalysisCodeValidationError('ALREADY_INACTIVE', 'Analysis code type is already inactive.');
    }
    if (current.version !== dto.version) {
      throw new AnalysisCodeConflictError('VERSION_CONFLICT', `Version conflict: expected ${dto.version}, current is ${current.version}`);
    }
    const activeValueCount = await this.prisma.analysisCodeValue.count({ where: { typeId: id, isActive: true } });
    if (activeValueCount > 0) {
      throw new AnalysisCodeConflictError(
        'TYPE_HAS_ACTIVE_VALUES',
        `Cannot deactivate: ${activeValueCount} active value(s) still reference this type. Deactivate them first.`,
      );
    }

    const type = await this.prisma.$transaction(async (tx) => {
      const t = await tx.analysisCodeType.update({
        where: { id },
        data: {
          isActive: false,
          version: current.version + 1,
          deactivatedAt: new Date(),
          deactivatedBy: dto.deactivatedBy,
          deactivationReason: dto.reason,
        },
      });
      await this._audit(tenantId, 'ANALYSIS_CODE_TYPE', id, 'DEACTIVATED', current, t, dto.deactivatedBy, tx);
      return t;
    });

    await this._writeOutbox(tenantId, 'analysis.type.deactivated', id, { reason: dto.reason, deactivatedBy: dto.deactivatedBy });
    return type;
  }

  // ── Values ───────────────────────────────────────────────────────────────

  async createValue(dto: CreateValueDTO, actor: string) {
    if (!isValidAnalysisCode(dto.code)) {
      throw new AnalysisCodeValidationError('INVALID_CODE', 'Value code must be 1-20 characters.');
    }
    const type = await this.prisma.analysisCodeType.findFirst({ where: { id: dto.typeId, tenantId: dto.tenantId } });
    if (!type) throw new AnalysisCodeNotFoundError('type', dto.typeId);
    if (!type.isActive) {
      throw new AnalysisCodeValidationError('TYPE_INACTIVE', 'Cannot add a value to an inactive analysis code type.');
    }
    const existing = await this.prisma.analysisCodeValue.findFirst({
      where: { tenantId: dto.tenantId, typeId: dto.typeId, code: dto.code },
    });
    if (existing) {
      throw new AnalysisCodeConflictError('DUPLICATE_VALUE_CODE', `Value code "${dto.code}" already exists for this type.`);
    }

    const value = await this.prisma.$transaction(async (tx) => {
      const v = await tx.analysisCodeValue.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: dto.tenantId,
          typeId: dto.typeId,
          code: dto.code,
          name: dto.name,
          isActive: true,
          version: 1,
        },
      });
      await this._audit(dto.tenantId, 'ANALYSIS_CODE_VALUE', v.id, 'CREATED', null, v, actor, tx);
      return v;
    });

    await this._writeOutbox(dto.tenantId, 'analysis.value.created', value.id, { typeId: dto.typeId, code: value.code, name: value.name, actor });
    return value;
  }

  async updateValue(tenantId: string, id: string, dto: UpdateValueDTO, actor: string) {
    const current = await this.prisma.analysisCodeValue.findFirst({ where: { id, tenantId } });
    if (!current) throw new AnalysisCodeNotFoundError('value', id);
    if (current.version !== dto.version) {
      throw new AnalysisCodeConflictError('VERSION_CONFLICT', `Version conflict: expected ${dto.version}, current is ${current.version}`);
    }
    if (!current.isActive) {
      throw new AnalysisCodeValidationError('VALUE_INACTIVE', 'Cannot edit an inactive analysis code value.');
    }

    const data: any = { version: current.version + 1 };
    if (dto.name !== undefined) data.name = dto.name;

    const value = await this.prisma.$transaction(async (tx) => {
      const v = await tx.analysisCodeValue.update({ where: { id }, data });
      await this._audit(tenantId, 'ANALYSIS_CODE_VALUE', id, 'UPDATED', current, v, actor, tx);
      return v;
    });

    await this._writeOutbox(tenantId, 'analysis.value.updated', id, { changes: Object.keys(data).filter((k) => k !== 'version'), actor });
    return value;
  }

  /**
   * BR011-4 — deactivate only; a deactivated value rejects on NEW lines
   * (enforced by domain/analysis-code.ts's validateLineTags at post time)
   * but every already-posted journal_line_analysis_tag row referencing it
   * remains untouched and fully readable (no delete path exists at all).
   */
  async deactivateValue(tenantId: string, id: string, dto: DeactivateDTO) {
    const current = await this.prisma.analysisCodeValue.findFirst({ where: { id, tenantId } });
    if (!current) throw new AnalysisCodeNotFoundError('value', id);
    if (!current.isActive) {
      throw new AnalysisCodeValidationError('ALREADY_INACTIVE', 'Analysis code value is already inactive.');
    }
    if (current.version !== dto.version) {
      throw new AnalysisCodeConflictError('VERSION_CONFLICT', `Version conflict: expected ${dto.version}, current is ${current.version}`);
    }

    const value = await this.prisma.$transaction(async (tx) => {
      const v = await tx.analysisCodeValue.update({
        where: { id },
        data: {
          isActive: false,
          version: current.version + 1,
          deactivatedAt: new Date(),
          deactivatedBy: dto.deactivatedBy,
          deactivationReason: dto.reason,
        },
      });
      await this._audit(tenantId, 'ANALYSIS_CODE_VALUE', id, 'DEACTIVATED', current, v, dto.deactivatedBy, tx);
      return v;
    });

    await this._writeOutbox(tenantId, 'analysis.value.deactivated', id, { reason: dto.reason, deactivatedBy: dto.deactivatedBy });
    return value;
  }

  /**
   * Read helper used by PostingService to build the validation context
   * (domain/analysis-code.ts's AnalysisTagValidationContext) in one query
   * pair rather than N+1 per tag.
   */
  async loadValidationContext(tenantId: string) {
    const [types, values] = await Promise.all([
      this.prisma.analysisCodeType.findMany({ where: { tenantId }, select: { id: true, isActive: true } }),
      this.prisma.analysisCodeValue.findMany({ where: { tenantId }, select: { id: true, typeId: true, isActive: true } }),
    ]);
    return {
      types: new Map(types.map((t) => [t.id, t])),
      values: new Map(values.map((v) => [v.id, v])),
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async _audit(
    tenantId: string,
    docType: string,
    docId: string,
    action: string,
    before: unknown,
    after: unknown,
    actor: string,
    tx: Pick<PrismaClient, 'auditOutboxEvent'> = this.prisma,
  ): Promise<void> {
    await tx.auditOutboxEvent.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        docType,
        docId,
        action,
        before: (before ?? undefined) as any,
        after: (after ?? undefined) as any,
        actor: actor ?? 'system',
      },
    });
  }

  private async _writeOutbox(tenantId: string, eventType: string, aggregateId: string, payload: Prisma.InputJsonValue) {
    try {
      await this.prisma.coaOutboxEvent.create({
        data: { id: crypto.randomUUID(), tenantId, eventType, aggregateId, payload },
      });
      await this.events.publish({ type: eventType, tenantId, payload, occurredAt: new Date().toISOString(), correlationId: aggregateId } as any);
    } catch {
      // Non-fatal: outbox/publish failure must not fail the business operation.
    }
  }
}
