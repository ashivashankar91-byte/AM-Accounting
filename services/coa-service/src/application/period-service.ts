import { inject, injectable } from 'tsyringe';
import { IEventPublisher, setTenantContextOnConnection, setActorContextOnConnection } from '@amacc/shared-kernel';
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

/** Illegal status transition → 422 (S008: full 6-pair allowlist; the DB
 * trigger enforce_period_transition() is the real backstop this mirrors). */
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

/** S008 — a mandatory reason was not supplied for a close/lock/reopen action → 400. */
export class PeriodReasonRequiredError extends Error {
  readonly code = 'PERIOD_REASON_REQUIRED';
  constructor(action: string) {
    super(`A reason is required to ${action}`);
    this.name = 'PeriodReasonRequiredError';
  }
}

/** S008 — an irreversible action (LOCK) was attempted without explicit confirm=true → 422. */
export class PeriodConfirmationRequiredError extends Error {
  readonly code = 'CONFIRMATION_REQUIRED';
  constructor(message: string) {
    super(message);
    this.name = 'PeriodConfirmationRequiredError';
  }
}

/** S008 — the DB trigger rejected the transition because the period is LOCKED (terminal). */
export class PeriodLockedTerminalError extends Error {
  readonly code = 'PERIOD_LOCKED_TERMINAL';
  constructor(periodId: string) {
    super(`Period ${periodId} is LOCKED — permanently terminal in S008 v1, no transition permitted`);
    this.name = 'PeriodLockedTerminalError';
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

/** S008 — common shape for soft-close/hard-close/reopen/reopen-hard-closed/lock. */
export interface PeriodTransitionDTO {
  tenantId: string;
  periodId: string;
  actor: string;
  reason?: string | null;
  confirm?: boolean;
}

export interface PeriodTransitionResult {
  transitioned: boolean;
  status: PeriodStatus;
  requiresConfirmation?: boolean;
  message?: string;
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
    // S007 BR7-1/BR7-4 — period-open + audit event are one atomic
    // transaction; an audit-write failure rolls back the period open.
    // S008 — the enforce_period_transition() trigger now fires on every
    // fiscal_period status UPDATE (including this pre-existing FUTURE->OPEN
    // path) and requires app.current_actor; set both context GUCs as the
    // first statements on this transaction's own connection (same
    // interactive-transaction pinning as draft-service.ts/reversal-service.ts).
    const updated = await this.prisma.$transaction(async (tx) => {
      await setTenantContextOnConnection(tx, dto.tenantId);
      await setActorContextOnConnection(tx, dto.actor);
      const u = await tx.fiscalPeriod.update({
        where: { id: period.id },
        data: { status: 'OPEN', openedBy: dto.actor, openedAt: new Date() },
      });
      await this.audit(dto.tenantId, period.id, dto.actor, before, {
        status: 'OPEN',
        openedBy: dto.actor,
        openedAt: u.openedAt,
      }, tx);
      return u;
    });

    await this.emitOpened(dto.tenantId, period.entityId, period.code, dto.actor);

    return {
      opened: true,
      status: 'OPEN',
      skippedPeriods: skipped.length > 0 ? skipped : undefined,
      period: updated,
    };
  }

  // ── S008 — soft-close (OPEN -> SOFT_CLOSED) ─────────────────────────────────

  async softClose(dto: PeriodTransitionDTO): Promise<PeriodTransitionResult> {
    const period = await this.getPeriod(dto.tenantId, dto.periodId);
    const from = period.status as PeriodStatus;
    if (from === 'SOFT_CLOSED') {
      return { transitioned: true, status: 'SOFT_CLOSED', period }; // idempotent CAS no-op
    }
    if (period.status === 'LOCKED') throw new PeriodLockedTerminalError(period.id);
    if (!canTransition(from, 'SOFT_CLOSED')) throw new InvalidTransitionError(from, 'SOFT_CLOSED');
    if (!dto.reason?.trim()) throw new PeriodReasonRequiredError('soft-close a period');

    return this.applyTransition(dto, from, 'SOFT_CLOSED', 'SOFT_CLOSE');
  }

  // ── S008 — hard-close (SOFT_CLOSED -> HARD_CLOSED) ──────────────────────────

  async hardClose(dto: PeriodTransitionDTO): Promise<PeriodTransitionResult> {
    const period = await this.getPeriod(dto.tenantId, dto.periodId);
    const from = period.status as PeriodStatus;
    if (from === 'HARD_CLOSED') {
      return { transitioned: true, status: 'HARD_CLOSED', period };
    }
    if (period.status === 'LOCKED') throw new PeriodLockedTerminalError(period.id);
    if (!canTransition(from, 'HARD_CLOSED')) throw new InvalidTransitionError(from, 'HARD_CLOSED');
    if (!dto.reason?.trim()) throw new PeriodReasonRequiredError('hard-close a period');

    return this.applyTransition(dto, from, 'HARD_CLOSED', 'HARD_CLOSE');
  }

  // ── S008 — reopen (SOFT_CLOSED -> OPEN). Gated by fiscal.period.reopen ──────
  // at the route layer; this method additionally enforces (defense in depth)
  // that it is only ever invoked from SOFT_CLOSED, never HARD_CLOSED — that
  // path is reopenHardClosed() below, gated by a distinct, higher permission.

  async reopen(dto: PeriodTransitionDTO): Promise<PeriodTransitionResult> {
    const period = await this.getPeriod(dto.tenantId, dto.periodId);
    const from = period.status as PeriodStatus;
    if (from === 'OPEN') {
      return { transitioned: true, status: 'OPEN', period };
    }
    if (period.status === 'LOCKED') throw new PeriodLockedTerminalError(period.id);
    if (from !== 'SOFT_CLOSED') {
      // HARD_CLOSED->OPEN is legal in the domain allowlist but requires the
      // distinct fiscal.period.reopen_hard_closed permission/route — reject
      // here so this permission tier cannot be used to reopen a hard-closed period.
      throw new InvalidTransitionError(from, 'OPEN (use reopen-hard-closed for a HARD_CLOSED period)');
    }
    if (!dto.reason?.trim()) throw new PeriodReasonRequiredError('reopen a period');

    return this.applyTransition(dto, from, 'OPEN', 'REOPEN');
  }

  // ── S008 — reopen-hard-closed (HARD_CLOSED -> OPEN). Gated by the ──────────
  // separate fiscal.period.reopen_hard_closed permission; mandatory reason +
  // explicit confirm=true (PO decision: dual approval NOT required in v1);
  // emits a high-severity PERIOD_REOPENED_FROM_HARD_CLOSE audit event.

  async reopenHardClosed(dto: PeriodTransitionDTO): Promise<PeriodTransitionResult> {
    const period = await this.getPeriod(dto.tenantId, dto.periodId);
    const from = period.status as PeriodStatus;
    if (from === 'OPEN') {
      return { transitioned: true, status: 'OPEN', period };
    }
    if (period.status === 'LOCKED') throw new PeriodLockedTerminalError(period.id);
    if (from !== 'HARD_CLOSED') {
      throw new InvalidTransitionError(from, 'OPEN (reopen-hard-closed only applies to a HARD_CLOSED period)');
    }
    if (!dto.reason?.trim()) throw new PeriodReasonRequiredError('reopen a hard-closed period');
    if (!dto.confirm) {
      return {
        transitioned: false,
        status: from,
        requiresConfirmation: true,
        message: 'Reopening a HARD_CLOSED period is a high-severity action. Re-submit with confirm=true and a reason.',
      };
    }

    return this.applyTransition(dto, from, 'OPEN', 'PERIOD_REOPENED_FROM_HARD_CLOSE');
  }

  // ── S008 — lock (HARD_CLOSED -> LOCKED). Terminal: no unlock path exists ────
  // in S008 v1 (PO decision: no normal API, break-glass endpoint, or supported
  // manual DB correction may unlock a LOCKED period). Mandatory reason +
  // explicit irreversible-action confirm=true.

  async lock(dto: PeriodTransitionDTO): Promise<PeriodTransitionResult> {
    const period = await this.getPeriod(dto.tenantId, dto.periodId);
    const from = period.status as PeriodStatus;
    if (from === 'LOCKED') {
      return { transitioned: true, status: 'LOCKED', period }; // idempotent CAS no-op
    }
    if (!canTransition(from, 'LOCKED')) throw new InvalidTransitionError(from, 'LOCKED');
    if (!dto.reason?.trim()) throw new PeriodReasonRequiredError('lock a period');
    if (!dto.confirm) {
      return {
        transitioned: false,
        status: from,
        requiresConfirmation: true,
        message: 'Locking a period is PERMANENT and IRREVERSIBLE in S008 v1 — no unlock path exists. Re-submit with confirm=true and a reason.',
      };
    }

    return this.applyTransition(dto, from, 'LOCKED', 'LOCK');
  }

  // ── Shared transition executor ──────────────────────────────────────────────
  // CAS-style: the DB trigger only fires on an actual UPDATE (a genuine
  // status change), so this WHERE-guarded update is naturally idempotent —
  // a retry that finds the period already in the target status (handled by
  // each public method's early-return above) never re-enters here, and a
  // genuine one-time transition produces exactly one fiscal_period_transition
  // row and one S007 audit event (S008 Story Contract §Idempotency).
  private async applyTransition(
    dto: PeriodTransitionDTO,
    from: PeriodStatus,
    to: PeriodStatus,
    auditAction: string,
  ): Promise<PeriodTransitionResult> {
    const before = { status: from };
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        await setTenantContextOnConnection(tx, dto.tenantId);
        await setActorContextOnConnection(tx, dto.actor);
        const u = await tx.fiscalPeriod.updateMany({
          where: { id: dto.periodId, tenantId: dto.tenantId, status: from },
          data: { status: to },
        });
        if (u.count === 0) {
          // Lost a genuine concurrent race against another transition (not the
          // already-in-target-status idempotent case, already handled by the
          // caller) — surface as an illegal transition from whatever the
          // period's status actually is now.
          const fresh = await tx.fiscalPeriod.findUnique({ where: { id: dto.periodId } });
          throw new InvalidTransitionError(fresh?.status ?? from, to);
        }
        const fresh = await tx.fiscalPeriod.findUnique({ where: { id: dto.periodId } });
        await this.audit(dto.tenantId, dto.periodId, dto.actor, before, { status: to, reason: dto.reason }, tx, auditAction);
        return fresh;
      });

      return { transitioned: true, status: to, period: updated };
    } catch (err) {
      throw this.mapDbTransitionError(err, from, to);
    }
  }

  /**
   * S008 Story Contract §Stable Error Contract — translate the DB trigger's
   * custom SQLSTATEs (AMPR0..AMPR6, see 20260728010000_s008_period_close_control)
   * to the same domain error classes the rest of this service throws, so the
   * route layer's error mapping is uniform regardless of whether the CAS
   * guard above or the trigger itself caught the condition.
   *
   * Disclosed uncertainty (not silently assumed): Prisma's Rust query engine
   * does not guarantee every unrecognized/custom Postgres SQLSTATE is exposed
   * as a stable `.code`/`.meta.code` on the JS error object the way well-known
   * codes (P2002, 23505) are — this is verified empirically against a real
   * Postgres instance in the S008 live-db test suite, not assumed from
   * Prisma's documentation alone. The message-text fallback below exists
   * specifically because that verification is required, not optional.
   */
  private mapDbTransitionError(err: unknown, from: PeriodStatus, to: PeriodStatus): Error {
    const anyErr = err as any;
    const sqlState: string | undefined = anyErr?.meta?.code ?? anyErr?.code;
    const message: string = anyErr?.message ?? '';
    if (sqlState === 'AMPR4' || /app\.current_actor.*required/i.test(message)) {
      const e: any = new Error('Actor context was not supplied to the database transition');
      e.code = 'DB_ACTOR_CONTEXT_REQUIRED';
      return e;
    }
    if (sqlState === 'AMPR5' || /is LOCKED — terminal/i.test(message)) {
      return new PeriodLockedTerminalError(anyErr?.meta?.periodId ?? '');
    }
    if (sqlState === 'AMPR0' || /illegal fiscal_period transition/i.test(message)) {
      return new InvalidTransitionError(from, to);
    }
    return err as Error;
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
    tx: Pick<PrismaClient, 'auditOutboxEvent'> = this.prisma,
    action = 'OPEN',
  ): Promise<void> {
    await tx.auditOutboxEvent.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        docType: 'fiscal_period',
        docId,
        action,
        before: (before ?? undefined) as any,
        after: (after ?? undefined) as any,
        actor,
      },
    });
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
