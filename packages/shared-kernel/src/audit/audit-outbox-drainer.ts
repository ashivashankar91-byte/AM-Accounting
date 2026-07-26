import type { AuditClient } from './audit-client';

/**
 * R0 Stabilization Phase 4: drains a service's local `audit_outbox` table
 * (tenant-service, auth-service, coa-service all share the identical shape:
 * id/tenantId/docType/docId/action/before/after/actor/publishedAt/
 * retryCount/lastError/createdAt) into the real S007 audit-service.
 *
 * Why a poller and not the existing RabbitMQEventPublisher.subscribe(): that
 * subscribe() only registers in-process callbacks invoked by the SAME
 * process's own publish() call — there is no real cross-process delivery
 * today (see docs/accounting-modernization/repository-verification/
 * AUTHORIZATION_AND_AUDIT_VERIFICATION.md). A poller reading each service's
 * own outbox table and forwarding over HTTP works regardless of that gap,
 * and is exactly the pattern the outbox tables' own retryCount/lastError/
 * publishedAt columns were already shaped for.
 *
 * Failure handling: never deletes a row, never marks publishedAt on
 * failure — a failed delivery stays visible (retryCount incremented,
 * lastError recorded) until it succeeds or is deliberately triaged, so a
 * failure can never be silently lost the way a fire-and-forget publish
 * would be.
 */

export interface AuditOutboxRow {
  id: string;
  tenantId: string;
  docType: string;
  docId: string;
  action: string;
  before: unknown;
  after: unknown;
  actor: string;
  retryCount: number;
}

/** Adapter over a Prisma client exposing the shared audit_outbox shape. */
export interface AuditOutboxStore {
  findUnpublished(limit: number): Promise<AuditOutboxRow[]>;
  markPublished(id: string): Promise<void>;
  markFailed(id: string, retryCount: number, error: string): Promise<void>;
}

export interface AuditOutboxDrainerOptions {
  serviceName: string;
  maxRetries?: number;
  onDelivered?: (row: AuditOutboxRow, result: { id: string; idempotent: boolean }) => void;
  onFailed?: (row: AuditOutboxRow, err: unknown, willRetry: boolean) => void;
}

/** Minimal shape every service's generated Prisma client satisfies for its
 * `auditOutboxEvent` delegate — tenant-service, auth-service and coa-service
 * all define the identical audit_outbox table shape. */
export interface PrismaAuditOutboxDelegate {
  findMany(args: any): Promise<any[]>;
  update(args: any): Promise<any>;
}

export function makePrismaAuditOutboxStore(delegate: PrismaAuditOutboxDelegate): AuditOutboxStore {
  return {
    async findUnpublished(limit: number): Promise<AuditOutboxRow[]> {
      const rows = await delegate.findMany({
        where: { publishedAt: null },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });
      return rows.map((r: any) => ({
        id: r.id, tenantId: r.tenantId, docType: r.docType, docId: r.docId,
        action: r.action, before: r.before, after: r.after, actor: r.actor,
        retryCount: r.retryCount ?? 0,
      }));
    },
    async markPublished(id: string): Promise<void> {
      await delegate.update({ where: { id }, data: { publishedAt: new Date() } });
    },
    async markFailed(id: string, retryCount: number, error: string): Promise<void> {
      await delegate.update({ where: { id }, data: { retryCount, lastError: error.slice(0, 2000) } });
    },
  };
}

/** Adapter for the OTHER outbox shape used in this codebase — a generic
 * domain-event outbox (eventType/aggregateId/payload/publishedAt/retryCount/
 * lastError), e.g. auth-service's authz_outbox_events (iam.authz.denied) or
 * tenant/coa-service's tenant_outbox_events/coa_outbox_events. Unlike
 * audit_outbox, these carry no explicit docType/action/before/actor —
 * derived from eventType and the payload's own conventions instead. Used to
 * route authorization-denial events (a compliance-critical audit trail on
 * their own) into the same drainer/sink as the docType-shaped audit_outbox. */
export interface PrismaGenericEventOutboxDelegate {
  findMany(args: any): Promise<any[]>;
  update(args: any): Promise<any>;
}

export function makePrismaGenericEventOutboxStore(
  delegate: PrismaGenericEventOutboxDelegate,
  toDocType: (eventType: string) => string = (t) => t,
): AuditOutboxStore {
  return {
    async findUnpublished(limit: number): Promise<AuditOutboxRow[]> {
      const rows = await delegate.findMany({
        where: { publishedAt: null },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });
      return rows.map((r: any) => ({
        id: r.id,
        tenantId: r.tenantId,
        docType: toDocType(r.eventType),
        docId: r.aggregateId,
        action: r.eventType,
        before: null,
        after: r.payload,
        actor: (r.payload?.userId as string | undefined) ?? (r.payload?.actor as string | undefined) ?? 'system',
        retryCount: r.retryCount ?? 0,
      }));
    },
    async markPublished(id: string): Promise<void> {
      await delegate.update({ where: { id }, data: { publishedAt: new Date() } });
    },
    async markFailed(id: string, retryCount: number, error: string): Promise<void> {
      await delegate.update({ where: { id }, data: { retryCount, lastError: error.slice(0, 2000) } });
    },
  };
}

export class AuditOutboxDrainer {
  private readonly maxRetries: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly store: AuditOutboxStore,
    private readonly client: AuditClient,
    private readonly options: AuditOutboxDrainerOptions,
  ) {
    this.maxRetries = options.maxRetries ?? 8;
  }

  /** Drain up to `limit` unpublished rows once. Returns counts — never throws. */
  async drainOnce(limit = 25): Promise<{ delivered: number; failed: number; permanentlyFailed: number }> {
    const rows = await this.store.findUnpublished(limit);
    let delivered = 0;
    let failed = 0;
    let permanentlyFailed = 0;

    for (const row of rows) {
      try {
        const result = await this.client.log({
          tenantId: row.tenantId,
          eventType: `${row.docType}.${row.action}`.toLowerCase(),
          entityType: row.docType,
          entityId: row.docId,
          actorType: 'USER',
          actorId: row.actor,
          actorName: row.actor,
          action: row.action,
          previousState: row.before ?? undefined,
          newState: row.after ?? undefined,
          sourceEventId: `${this.options.serviceName}:${row.id}`,
        });
        await this.store.markPublished(row.id);
        delivered += 1;
        this.options.onDelivered?.(row, result);
      } catch (err) {
        failed += 1;
        const nextRetryCount = row.retryCount + 1;
        const willRetry = nextRetryCount < this.maxRetries;
        await this.store.markFailed(row.id, nextRetryCount, err instanceof Error ? err.message : String(err));
        if (!willRetry) permanentlyFailed += 1;
        this.options.onFailed?.(row, err, willRetry);
      }
    }
    return { delivered, failed, permanentlyFailed };
  }

  /** Runs drainOnce on an interval. Returns a stop function. */
  start(intervalMs = 5000, limit = 25): () => void {
    if (this.timer) throw new Error('AuditOutboxDrainer already started');
    this.timer = setInterval(() => {
      this.drainOnce(limit).catch((err) => this.options.onFailed?.({} as AuditOutboxRow, err, false));
    }, intervalMs);
    return () => {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    };
  }
}
