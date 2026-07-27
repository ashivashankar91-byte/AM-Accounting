import { inject, injectable } from 'tsyringe';
import { IEventPublisher } from '@amacc/shared-kernel';
import { PrismaClient, Prisma } from '.prisma/tenant-client';
import crypto from 'crypto';

// ── Canonical 01-12 seed list ─────────────────────────────────────────────────
// ACCOUNTING_SME_VALIDATION_PENDING — No authoritative list found in Fable v1.1,
// AMACC legacy code, or archaeology JSONs. This is the R0 baseline derived from
// the Fable hint ("New, Used, Service, Parts, Body...") and the gl-service deptMap.
// Names are editable; codes are immutable.
export const CANONICAL_DEPARTMENTS: ReadonlyArray<{ code: string; name: string }> = [
  { code: '01', name: 'New Vehicles' },
  { code: '02', name: 'Used Vehicles' },
  { code: '03', name: 'Service' },
  { code: '04', name: 'Parts' },
  { code: '05', name: 'Body Shop' },
  { code: '06', name: 'Finance & Insurance' },
  { code: '07', name: 'Detail / Reconditioning' },
  { code: '08', name: 'Sublet' },
  { code: '09', name: 'Fleet / Leasing' },
  { code: '10', name: 'Administration' },
  { code: '11', name: 'Other' },
  { code: '12', name: 'Wholesale' },
] as const;

// ── Code validation ───────────────────────────────────────────────────────────

/** Returns 'CANONICAL' | 'CUSTOM' | 'CANONICAL_CODE_RESERVED' | 'INVALID_CODE_RANGE' */
export function classifyCode(code: string): 'CANONICAL' | 'CUSTOM' | 'CANONICAL_CODE_RESERVED' | 'INVALID_CODE_RANGE' {
  if (!/^\d{2}$/.test(code)) return 'INVALID_CODE_RANGE';
  const n = parseInt(code, 10);
  if (n >= 1 && n <= 12)  return 'CANONICAL_CODE_RESERVED';
  if (n >= 20 && n <= 89) return 'CUSTOM';
  return 'INVALID_CODE_RANGE'; // covers 00, 13-19, 90-99
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface CreateDepartmentDTO {
  tenantId:  string;
  entityId:  string;
  code:      string;
  name:      string;
}

export interface UpdateDepartmentDTO {
  version: number;
  name?:   string;
}

export interface DeactivateDepartmentDTO {
  version:        number;
  reason:         string;
  deactivatedBy:  string;
}

export interface DepartmentListQuery {
  tenantId:  string;
  entityId:  string;
  search?:   string;
  status?:   string;
  page?:     number;
  pageSize?: number;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class DepartmentNotFoundError extends Error {
  constructor(id: string) {
    super(`Department not found: ${id}`);
    this.name = 'DepartmentNotFoundError';
  }
}

export class DepartmentConflictError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'DepartmentConflictError';
  }
}

export class DepartmentValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'DepartmentValidationError';
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

@injectable()
export class DepartmentService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly _eventPublisher: IEventPublisher,
  ) {}

  // ── list ────────────────────────────────────────────────────────────────────

  async list(query: DepartmentListQuery) {
    const { tenantId, entityId, search, status, page = 1, pageSize = 50 } = query;

    const where: any = { tenantId, entityId };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.department.findMany({
        where,
        orderBy: [{ code: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.department.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  // ── getById ─────────────────────────────────────────────────────────────────

  async getById(tenantId: string, entityId: string, id: string) {
    const dept = await this.prisma.department.findFirst({ where: { id, tenantId, entityId } });
    if (!dept) throw new DepartmentNotFoundError(id);
    return dept;
  }

  // ── seedCanonical ────────────────────────────────────────────────────────────

  async seedCanonical(tenantId: string, entityId: string, actor = 'system-seed') {
    for (const { code, name } of CANONICAL_DEPARTMENTS) {
      const existing = await this.prisma.department.findFirst({
        where: { entityId, code },
      });
      if (existing) continue; // idempotent — skip if already seeded

      // S007 BR7-1/BR7-4 — department create + audit event are one atomic
      // transaction (this was a real gap: previously only the best-effort
      // domain-event outbox write below was emitted, with no audit trail —
      // see S007_WRITE_PATH_COVERAGE_CENSUS.md §5).
      const dept = await this.prisma.$transaction(async (tx) => {
        const d = await tx.department.create({
          data: {
            id:        crypto.randomUUID(),
            tenantId,
            entityId,
            code,
            name,
            canonical: true,
            status:    'ACTIVE',
            version:   1,
          },
        });
        await this._audit(tenantId, 'Department', d.id, 'CREATE', null, d, actor, tx);
        return d;
      });

      await this._writeOutbox(tenantId, 'org.dept.created', dept.id, {
        entityId,
        deptCode: code,
        changes: { name, canonical: true, status: 'ACTIVE' },
        actor,
        schemaV: 1,
      });
    }
  }

  // ── create ──────────────────────────────────────────────────────────────────

  async create(dto: CreateDepartmentDTO, actor = 'system') {
    // Validate entity belongs to tenant
    const entity = await this.prisma.legalEntity.findFirst({
      where: { id: dto.entityId, tenantId: dto.tenantId },
    });
    if (!entity) {
      throw new DepartmentValidationError('ORPHAN_DEPARTMENT', 'Entity not found or does not belong to this tenant');
    }

    // Validate code range
    const codeClass = classifyCode(dto.code);
    if (codeClass === 'CANONICAL_CODE_RESERVED') {
      throw new DepartmentValidationError('CANONICAL_CODE_RESERVED', 'Codes 01-12 are reserved for canonical departments');
    }
    if (codeClass === 'INVALID_CODE_RANGE') {
      throw new DepartmentValidationError('INVALID_CODE_RANGE', 'Custom department codes must be in range 20-89');
    }

    // Check duplicate code
    const existingCode = await this.prisma.department.findFirst({
      where: { entityId: dto.entityId, code: dto.code },
    });
    if (existingCode) {
      throw new DepartmentConflictError('DUPLICATE_DEPT_CODE', `Department code ${dto.code} already exists for this entity`);
    }

    // Check duplicate name
    const existingName = await this.prisma.department.findFirst({
      where: { entityId: dto.entityId, name: dto.name },
    });
    if (existingName) {
      throw new DepartmentConflictError('DUPLICATE_DEPARTMENT_NAME', `Department name "${dto.name}" already exists for this entity`);
    }

    // S007 BR7-1/BR7-4 — department create + audit event are one atomic
    // transaction. The tenantOutboxEvent domain-event write is a distinct,
    // best-effort eventual-consistency mechanism and stays outside it.
    const dept = await this.prisma.$transaction(async (tx) => {
      const d = await tx.department.create({
        data: {
          id:        crypto.randomUUID(),
          tenantId:  dto.tenantId,
          entityId:  dto.entityId,
          code:      dto.code,
          name:      dto.name,
          canonical: false,
          status:    'ACTIVE',
          version:   1,
        },
      });
      await this._audit(dto.tenantId, 'Department', d.id, 'CREATE', null, d, actor, tx);
      return d;
    });

    await this._writeOutbox(dto.tenantId, 'org.dept.created', dept.id, {
      entityId:  dto.entityId,
      deptCode:  dto.code,
      changes:   { name: dto.name, status: 'ACTIVE' },
      actor:     'user',
      schemaV:   1,
    });

    return dept;
  }

  // ── update ──────────────────────────────────────────────────────────────────

  async update(tenantId: string, entityId: string, id: string, dto: UpdateDepartmentDTO, actor = 'system') {
    const current = await this.prisma.department.findFirst({ where: { id, tenantId, entityId } });
    if (!current) throw new DepartmentNotFoundError(id);

    if (current.version !== dto.version) {
      throw new DepartmentConflictError(
        'VERSION_CONFLICT',
        `Version conflict: expected ${dto.version}, current is ${current.version}`,
      );
    }

    if (current.status === 'INACTIVE') {
      throw new DepartmentValidationError('DEPT_INACTIVE', 'Cannot edit an inactive department');
    }

    const data: any = { version: current.version + 1 };

    if (dto.name !== undefined) {
      // Check duplicate name (exclude self)
      const existingName = await this.prisma.department.findFirst({
        where: { entityId, name: dto.name, id: { not: id } },
      });
      if (existingName) {
        throw new DepartmentConflictError('DUPLICATE_DEPARTMENT_NAME', `Department name "${dto.name}" already exists for this entity`);
      }
      data.name = dto.name;
    }

    const dept = await this.prisma.$transaction(async (tx) => {
      const d = await tx.department.update({ where: { id }, data });
      await this._audit(tenantId, 'Department', id, 'UPDATE', current, d, actor, tx);
      return d;
    });

    await this._writeOutbox(tenantId, 'org.dept.updated', id, {
      deptCode: dept.code,
      changes:  Object.keys(data).filter(k => k !== 'version'),
      schemaV:  1,
    });

    return dept;
  }

  // ── deactivate ───────────────────────────────────────────────────────────────

  async deactivate(tenantId: string, entityId: string, id: string, dto: DeactivateDepartmentDTO) {
    const current = await this.prisma.department.findFirst({ where: { id, tenantId, entityId } });
    if (!current) throw new DepartmentNotFoundError(id);

    if (current.status === 'INACTIVE') {
      throw new DepartmentValidationError('ALREADY_INACTIVE', 'Department is already inactive');
    }

    if (current.version !== dto.version) {
      throw new DepartmentConflictError(
        'VERSION_CONFLICT',
        `Version conflict: expected ${dto.version}, current is ${current.version}`,
      );
    }

    const dept = await this.prisma.$transaction(async (tx) => {
      const d = await tx.department.update({
        where: { id },
        data: {
          status:             'INACTIVE',
          version:            current.version + 1,
          deactivatedAt:      new Date(),
          deactivatedBy:      dto.deactivatedBy,
          deactivationReason: dto.reason,
        },
      });
      await this._audit(tenantId, 'Department', id, 'DEACTIVATE', current, d, dto.deactivatedBy, tx);
      return d;
    });

    await this._writeOutbox(tenantId, 'org.dept.deactivated', id, {
      deptCode:      dept.code,
      reason:        dto.reason,
      deactivatedBy: dto.deactivatedBy,
      schemaV:       1,
    });

    return dept;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

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

  private async _writeOutbox(
    tenantId:    string,
    eventType:   string,
    aggregateId: string,
    payload:     Prisma.InputJsonValue,
  ) {
    try {
      await this.prisma.tenantOutboxEvent.create({
        data: { id: crypto.randomUUID(), tenantId, eventType, aggregateId, payload },
      });
    } catch {
      // Non-fatal: outbox write failure must not fail the business operation
    }
  }
}
