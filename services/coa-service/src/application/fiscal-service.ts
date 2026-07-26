import { inject, injectable } from 'tsyringe';
import { IEventPublisher } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/coa-client';
import crypto from 'crypto';
import {
  FiscalStructure,
  generatePeriods,
  periodCountFor,
  resolveDate,
  validateFyStartMonth,
} from '../domain/fiscal-calendar';

// ── Errors (mapped to HTTP status in the route layer) ────────────────────────

/** Invalid input (bad structure/month) → 422. */
export class FiscalValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'FiscalValidationError';
  }
}

/** Structure change once a generated period has postings → 422 (BR208-4). */
export class CalendarLockedError extends Error {
  readonly code = 'CALENDAR_LOCKED';
  constructor(entityId: string) {
    super(`Fiscal calendar for entity ${entityId} is locked by existing postings`);
    this.name = 'CalendarLockedError';
  }
}

/** Regenerating an already-generated fiscal year → 409 (BR208 AC). */
export class FiscalYearOverlapError extends Error {
  readonly code = 'FISCAL_YEAR_OVERLAP';
  constructor(entityId: string, fy: number) {
    super(`Fiscal year ${fy} already generated for entity ${entityId}`);
    this.name = 'FiscalYearOverlapError';
  }
}

/** No calendar defined for the entity yet → 404. */
export class CalendarNotFoundError extends Error {
  readonly code = 'CALENDAR_NOT_FOUND';
  constructor(entityId: string) {
    super(`No fiscal calendar defined for entity ${entityId}`);
    this.name = 'CalendarNotFoundError';
  }
}

/** Date resolves to no generated period → 404 (success metric: zero unresolved). */
export class PeriodNotFoundError extends Error {
  readonly code = 'PERIOD_NOT_FOUND';
  constructor(entityId: string, date: string) {
    super(`No period covers date ${date} for entity ${entityId}`);
    this.name = 'PeriodNotFoundError';
  }
}

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface DefineCalendarDTO {
  tenantId: string;
  entityId: string;
  fyStartMonth: number;
  structure: FiscalStructure;
  actor: string;
}

export interface GenerateYearDTO {
  tenantId: string;
  entityId: string;
  fiscalYear: number;
  actor: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

@injectable()
export class FiscalCalendarService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
  ) {}

  // ── Calendar definition (BR208-1) ─────────────────────────────────────────────

  /**
   * Define or update an entity's fiscal calendar. One calendar per entity: a
   * second call updates the existing row. Structure/start-month may only change
   * while no generated period has postings, else 422 (BR208-4).
   */
  async defineCalendar(dto: DefineCalendarDTO) {
    if (dto.structure !== 'TWELVE' && dto.structure !== 'TWELVE_PLUS_13TH') {
      throw new FiscalValidationError('INVALID_STRUCTURE', `structure must be TWELVE or TWELVE_PLUS_13TH, got ${dto.structure}`);
    }
    const monthReason = validateFyStartMonth(dto.fyStartMonth);
    if (monthReason) {
      throw new FiscalValidationError('INVALID_START_MONTH', monthReason);
    }

    const existing = await this.prisma.fiscalCalendar.findUnique({
      where: { entityId: dto.entityId },
    });

    if (!existing) {
      const created = await this.prisma.fiscalCalendar.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: dto.tenantId,
          entityId: dto.entityId,
          fyStartMonth: dto.fyStartMonth,
          structure: dto.structure,
          status: 'DEFINED',
          actor: dto.actor,
        },
      });
      await this.audit(dto.tenantId, 'CREATE', created.id, dto.actor, null, {
        entityId: dto.entityId,
        fyStartMonth: dto.fyStartMonth,
        structure: dto.structure,
      });
      return { calendar: created, created: true };
    }

    // Update path — blocked once any period has postings (BR208-4).
    const changing =
      existing.fyStartMonth !== dto.fyStartMonth || existing.structure !== dto.structure;
    if (changing) {
      const posted = await this.prisma.fiscalPeriod.count({
        where: { entityId: dto.entityId, hasPostings: true },
      });
      if (posted > 0) {
        throw new CalendarLockedError(dto.entityId);
      }
    }

    const before = { fyStartMonth: existing.fyStartMonth, structure: existing.structure };
    const updated = await this.prisma.fiscalCalendar.update({
      where: { entityId: dto.entityId },
      data: { fyStartMonth: dto.fyStartMonth, structure: dto.structure, actor: dto.actor },
    });
    if (changing) {
      await this.audit(dto.tenantId, 'UPDATE', updated.id, dto.actor, before, {
        fyStartMonth: dto.fyStartMonth,
        structure: dto.structure,
      });
    }
    return { calendar: updated, created: false };
  }

  async getCalendar(tenantId: string, entityId: string) {
    const calendar = await this.prisma.fiscalCalendar.findUnique({
      where: { entityId },
    });
    if (!calendar || calendar.tenantId !== tenantId) {
      throw new CalendarNotFoundError(entityId);
    }
    return calendar;
  }

  // ── Year generation (BR208-2) ─────────────────────────────────────────────────

  /**
   * Generate a fiscal year's periods in FUTURE status. 409 if the year already
   * exists for the entity (overlap). Emits fiscal.year.generated + audit.
   */
  async generateYear(dto: GenerateYearDTO) {
    const calendar = await this.getCalendar(dto.tenantId, dto.entityId);

    const overlap = await this.prisma.fiscalPeriod.count({
      where: { entityId: dto.entityId, fiscalYear: dto.fiscalYear },
    });
    if (overlap > 0) {
      throw new FiscalYearOverlapError(dto.entityId, dto.fiscalYear);
    }

    const generated = generatePeriods(
      dto.fiscalYear,
      calendar.fyStartMonth,
      calendar.structure as FiscalStructure,
    );

    const created = await this.prisma.$transaction(
      generated.map((p) =>
        this.prisma.fiscalPeriod.create({
          data: {
            id: crypto.randomUUID(),
            tenantId: dto.tenantId,
            entityId: dto.entityId,
            calendarId: calendar.id,
            fiscalYear: dto.fiscalYear,
            periodNumber: p.periodNumber,
            code: p.code,
            startDate: new Date(`${p.startDate}T00:00:00.000Z`),
            endDate: new Date(`${p.endDate}T00:00:00.000Z`),
            status: 'FUTURE',
            adjustmentsOnly: p.adjustmentsOnly,
          },
        }),
      ),
    );

    await this.audit(dto.tenantId, 'GENERATE_YEAR', calendar.id, dto.actor, null, {
      entityId: dto.entityId,
      fiscalYear: dto.fiscalYear,
      periodCount: created.length,
    });
    await this.emitYearGenerated(dto, created.length);

    return { periods: created, periodCount: created.length };
  }

  /** Expected period count for the entity's structure (test/AC convenience). */
  async expectedPeriodCount(tenantId: string, entityId: string): Promise<number> {
    const calendar = await this.getCalendar(tenantId, entityId);
    return periodCountFor(calendar.structure as FiscalStructure);
  }

  async listPeriods(tenantId: string, entityId: string, fiscalYear?: number) {
    return this.prisma.fiscalPeriod.findMany({
      where: {
        tenantId,
        entityId,
        ...(fiscalYear !== undefined ? { fiscalYear } : {}),
      },
      orderBy: [{ fiscalYear: 'asc' }, { periodNumber: 'asc' }],
    });
  }

  // ── Date -> period resolution (BR208-5) ────────────────────────────────────────

  /** Resolve a calendar date to exactly one regular period. 404 if unresolved. */
  async resolve(tenantId: string, entityId: string, date: string) {
    const periods = await this.prisma.fiscalPeriod.findMany({
      where: { tenantId, entityId },
    });
    const match = resolveDate(
      date,
      periods.map((p) => ({
        code: p.code,
        startDate: p.startDate.toISOString().slice(0, 10),
        endDate: p.endDate.toISOString().slice(0, 10),
        adjustmentsOnly: p.adjustmentsOnly,
      })),
    );
    if (!match) {
      throw new PeriodNotFoundError(entityId, date);
    }
    const full = periods.find((p) => p.code === match.code)!;
    return full;
  }

  // ── AuditPort (stub) + event emission ─────────────────────────────────────────

  private async audit(
    tenantId: string,
    action: string,
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
          docType: 'fiscal_calendar',
          docId,
          action,
          before: (before ?? undefined) as any,
          after: (after ?? undefined) as any,
          actor,
        },
      });
    } catch {
      // AuditPort write is non-fatal to the business operation.
    }
  }

  private async emitYearGenerated(dto: GenerateYearDTO, periodCount: number): Promise<void> {
    const eventId = crypto.randomUUID();
    const payload = {
      eventId,
      entityId: dto.entityId,
      fy: dto.fiscalYear,
      periodCount,
      actor: dto.actor,
      ts: new Date().toISOString(),
      schemaV: 1,
    };
    try {
      await this.prisma.coaOutboxEvent.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: dto.tenantId,
          eventType: 'fiscal.year.generated',
          aggregateId: dto.entityId,
          payload: payload as any,
        },
      });
    } catch {
      /* non-fatal */
    }
    try {
      await this.events.publish({
        type: 'fiscal.year.generated',
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
