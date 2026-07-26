import { inject, injectable } from 'tsyringe';
import { IEventPublisher } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/coa-client';
import crypto from 'crypto';
import {
  PeriodStatus,
  canTransition,
  eligibility,
  detectSkippedPeriods,
} from '../domain/period-status';
import { ConfigService } from './config-service';

// ── Errors (mapped to HTTP status in the route layer) ────────────────────────

/** Period id not found for the tenant → 404. */
export class PeriodNotFoundError extends Error {
  readonly code = 'PERIOD_NOT_FOUND';
  constructor(periodId: string) {
    super(`Period ${periodId} not found`);
    this.name = 'PeriodNotFoundError';
  }
}

/** Illegal status transition (only FUTURE->OPEN here) → 422 (BR209-1). */
export class InvalidTransitionError extends Error {
  readonly code = 'INVALID_TRANSITION';
  constructor(from: string, to: string) {
    super(`Illegal period transition ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

/** Concurrent-open limit reached → 422 (BR209-2). */
export class MaxOpenReachedError extends Error {
  readonly code = 'MAX_OPEN_REACHED';
  constructor(max: number) {
    super(`Maximum of ${max} concurrently open periods reached for this entity`);
    this.name = 'MaxOpenReachedError';
  }
}

const MAX_OPEN_KEY = 'fiscal.max_open_periods';
const DEFAULT_MAX_OPEN = 2;

export interface OpenPeriodDTO {
  tenantId: string;
  periodId: string;
  actor: string;
  confirm?: boolean;
}

export interface OpenResult {
  opened: boolean;
  status: PeriodStatus;
  requiresConfirmation?: boolean;
  warning?: string;
  skippedPeriods?: string[];
  period?: any;
}

@injectable()
export class PeriodService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
    @inject('ConfigService') private readonly config: ConfigService,
  ) {}

  // ── Board (GET /periods?entity=) ────────────────────────────────────────────

  async board(tenantId: string, entityId: string) {
    const periods = await this.prisma.fiscalPeriod.findMany({
      where: { tenantId, entityId },
      orderBy: [{ fiscalYear: 'asc' }, { periodNumber: 'asc' }],
    });
    return periods.map((p) => ({
      periodId: p.id,
      periodCode: p.code,
      periodNumber: p.periodNumber,
      fiscalYear: p.fiscalYear,
      status: p.status,
      adjustmentsOnly: p.adjustmentsOnly,
      openedBy: p.openedBy,
      openedAt: p.openedAt,
    }));
  }

  // ── Eligibility (GET /periods/{id}/eligibility) ──────────────────────────────

  async eligibility(tenantId: string, periodId: string) {
    const period = await this.getPeriod(tenantId, periodId);
    const e = eligibility(period.status as PeriodStatus);
    return { periodId: period.id, periodCode: period.code, status: period.status, ...e };
  }

  // ── Open (POST /periods/{id}:open) ───────────────────────────────────────────

  /**
   * Transition a period FUTURE->OPEN. Enforces the concurrent-open limit
   * (BR209-2) and warns when earlier periods would be skipped (BR209-3), which
   * requires an explicit confirm. Emits fiscal.period.opened + audit.
   */
  async open(dto: OpenPeriodDTO): Promise<OpenResult> {
    const period = await this.getPeriod(dto.tenantId, dto.periodId);
    const from = period.status as PeriodStatus;

    // Idempotent: opening an already-open period is a no-op success.
    if (from === 'OPEN') {
      return { opened: true, status: 'OPEN', period };
    }
    if (!canTransition(from, 'OPEN')) {
      throw new InvalidTransitionError(from, 'OPEN');
    }

    // BR209-2 — concurrent-open limit (from config fiscal.max_open_periods).
    const max = await this.resolveMaxOpen(dto.tenantId, period.entityId);
    const openCount = await this.prisma.fiscalPeriod.count({
      where: { tenantId: dto.tenantId, entityId: period.entityId, status: 'OPEN' },
    });
    if (openCount >= max) {
      throw new MaxOpenReachedError(max);
    }

    // BR209-3 — skip-open warning requires confirmation.
    const siblings = await this.prisma.fiscalPeriod.findMany({
      where: { tenantId: dto.tenantId, entityId: period.entityId },
    });
    const skipped = detectSkippedPeriods(
      { fiscalYear: period.fiscalYear, periodNumber: period.periodNumber, status: from, adjustmentsOnly: period.adjustmentsOnly },
      siblings.map((s) => ({
        code: s.code,
        fiscalYear: s.fiscalYear,
        periodNumber: s.periodNumber,
        status: s.status as PeriodStatus,
        adjustmentsOnly: s.adjustmentsOnly,
      })),
    );
    if (skipped.length > 0 && !dto.confirm) {
      return {
        opened: false,
        status: from,
        requiresConfirmation: true,
        warning: 'SKIP_OPEN',
        skippedPeriods: skipped,
      };
    }

    const before = { status: from, openedBy: period.openedBy, openedAt: period.openedAt };
    const updated = await this.prisma.fiscalPeriod.update({
      where: { id: period.id },
      data: { status: 'OPEN', openedBy: dto.actor, openedAt: new Date() },
    });

    await this.audit(dto.tenantId, period.id, dto.actor, before, {
      status: 'OPEN',
      openedBy: dto.actor,
      openedAt: updated.openedAt,
    });
    await this.emitOpened(dto.tenantId, period.entityId, period.code, dto.actor);

    return {
      opened: true,
      status: 'OPEN',
      skippedPeriods: skipped.length > 0 ? skipped : undefined,
      period: updated,
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async getPeriod(tenantId: string, periodId: string) {
    const period = await this.prisma.fiscalPeriod.findUnique({ where: { id: periodId } });
    if (!period || period.tenantId !== tenantId) {
      throw new PeriodNotFoundError(periodId);
    }
    return period;
  }

  private async resolveMaxOpen(tenantId: string, entityId: string): Promise<number> {
    try {
      const resolved = await this.config.resolve({ tenantId, key: MAX_OPEN_KEY, entityId });
      const n = parseInt(resolved.value, 10);
      return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_OPEN;
    } catch {
      // Catalog may not carry the key in some envs — fall back to the documented default.
      return DEFAULT_MAX_OPEN;
    }
  }

  private async audit(
    tenantId: string,
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
          docType: 'fiscal_period',
          docId,
          action: 'OPEN',
          before: (before ?? undefined) as any,
          after: (after ?? undefined) as any,
          actor,
        },
      });
    } catch {
      /* AuditPort write is non-fatal */
    }
  }

  private async emitOpened(
    tenantId: string,
    entityId: string,
    periodCode: string,
    actor: string,
  ): Promise<void> {
    const eventId = crypto.randomUUID();
    const payload = {
      eventId,
      entityId,
      periodCode,
      actor,
      ts: new Date().toISOString(),
      schemaV: 1,
    };
    try {
      await this.prisma.coaOutboxEvent.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          eventType: 'fiscal.period.opened',
          aggregateId: periodCode,
          payload: payload as any,
        },
      });
    } catch {
      /* non-fatal */
    }
    try {
      await this.events.publish({
        type: 'fiscal.period.opened',
        tenantId,
        payload,
        occurredAt: new Date(),
        correlationId: eventId,
      } as any);
    } catch {
      /* best-effort; outbox row is the record of truth */
    }
  }
}
