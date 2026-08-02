import { randomUUID } from 'crypto';
import type { PrismaClient } from '.prisma/deal-accounting-client';
import type { IEventPublisher } from '@amacc/shared-kernel';

// PENDING_UPSTREAM_TECHNICAL_RECONCILIATION events this service emits for
// sibling CE-12 services to eventually consume. Each is written durably to
// deal_outbox_event INSIDE the caller's transaction (so it can never exist
// without the state change that produced it, and never survive a rollback),
// then best-effort broker-published by DomainOutboxDrainer below — same
// two-phase durability shape as coa-service's coa_outbox_event / posting-
// service.ts pattern.
//
// Every contract below is documented precisely (exact fields, exact
// semantics) so the consuming service can implement against it without
// needing this service's code — see the final delivery summary for the
// canonical list.

export const PUTR_EVENT_TYPES = {
  TRADE_IN_RECEIVED: 'deal.trade-in-received.v1', // -> vehicle-accounting-service: create inbound unit at ACV
  WHOLESALE_UNIT_RELIEF: 'deal.wholesale-unit-relief.v1', // -> vehicle-accounting-service: relieve the disposed unit
  TRADE_IN_RECEIPT_REVERSED: 'deal.trade-in-received-reversed.v1', // -> vehicle-accounting-service: symmetric reversal on unwind
  PRODUCT_CANCELLATION_FLAGGED: 'deal.product-cancellation-flagged.v1', // -> fni-reserve-service: S093 cancellation flow
  RESERVE_CHARGEBACK_FLAGGED: 'deal.reserve-chargeback-flagged.v1', // -> fni-reserve-service: S091 reserve reversal/chargeback
} as const;

export type PutrEventType = (typeof PUTR_EVENT_TYPES)[keyof typeof PUTR_EVENT_TYPES];

export async function writePutrOutboxEvent(
  tx: Pick<PrismaClient, 'dealOutboxEvent'>,
  tenantId: string,
  eventType: PutrEventType,
  aggregateId: string,
  payload: Record<string, unknown>,
  correlationId: string,
): Promise<string> {
  const id = randomUUID();
  await tx.dealOutboxEvent.create({
    data: { id, tenantId, eventType, aggregateId, payload: payload as any, correlationId },
  });
  return id;
}

/** Drains deal_outbox_event to the broker — best-effort; the row itself (not broker delivery) is the durability guarantee, matching coa-service's own outbox-first convention. */
export class DomainOutboxDrainer {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaClient, private readonly publisher: IEventPublisher) {}

  async drainOnce(limit = 25): Promise<{ delivered: number; failed: number }> {
    const rows = await (this.prisma as any).dealOutboxEvent.findMany({
      where: { publishedAt: null },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    let delivered = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        await this.publisher.publish({
          type: row.eventType,
          tenantId: row.tenantId,
          payload: { aggregateId: row.aggregateId, correlationId: row.correlationId, ...row.payload },
          occurredAt: row.createdAt,
          correlationId: row.correlationId,
        } as any);
        await (this.prisma as any).dealOutboxEvent.update({ where: { id: row.id }, data: { publishedAt: new Date() } });
        delivered += 1;
      } catch (err: any) {
        failed += 1;
        await (this.prisma as any).dealOutboxEvent.update({
          where: { id: row.id },
          data: { retryCount: (row.retryCount ?? 0) + 1, lastError: String(err?.message ?? err).slice(0, 2000) },
        });
      }
    }
    return { delivered, failed };
  }

  start(intervalMs = 5000, limit = 25): () => void {
    if (this.timer) throw new Error('DomainOutboxDrainer already started');
    this.timer = setInterval(() => {
      this.drainOnce(limit).catch(() => { /* logged per-row above; interval itself never throws */ });
    }, intervalMs);
    return () => {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    };
  }
}
