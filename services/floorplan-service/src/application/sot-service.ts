// S081 — Sold-Out-of-Trust (SOT) Monitor. Composition point: this service
// does NOT call deal-accounting-service synchronously to learn a unit was
// delivered — deal-accounting-service (S084+) is a sibling CE-12 service,
// PENDING_UPSTREAM_TECHNICAL_RECONCILIATION. The exact contract this
// service expects, once deal-accounting-service exists:
//   POST /api/v1/floorplan/v1/delivery-events
//   { vin?, stockNumber?, dealNumber, deliveredAt, idempotencyKey }
//   headers: x-tenant-id, Authorization: Bearer <createServiceToken('deal-accounting-service', ...)>
// (see recordDeliveryEvent below — the same endpoint also accepts a
// MANUAL_FIXTURE-sourced entry via the human-facing
// floorplan.delivery.enter permission, for certification/testing before
// deal-accounting-service exists.)
//
// Read-only dashboard/aging/escalation composition: evaluate() is called on
// every dashboard/aging query (not a background poller) so results are
// always freshly computed from the live join of delivery events vs this
// service's own open floorplan liability items — never a stale cached
// number.
import { injectable, inject } from 'tsyringe';
import { randomUUID } from 'crypto';
import { appendAuditReference } from '../infrastructure/audit';
import { evaluateSot, EscalationState } from '../domain/sot';
import { FloorplanValidationError, FloorplanNotFoundError } from '../domain/errors';

export const DELIVERY_SOURCES = ['WEBHOOK', 'MANUAL_FIXTURE'] as const;
export type DeliverySource = (typeof DELIVERY_SOURCES)[number];

@injectable()
export class SotService {
  constructor(@inject('PrismaClient') private readonly prisma: any) {}

  async recordDeliveryEvent(
    tenantId: string,
    input: { vin?: string | null; stockNumber?: string | null; dealNumber: string; deliveredAt: string; idempotencyKey: string; source: DeliverySource },
    actor: string,
  ) {
    if (!input.vin?.trim() && !input.stockNumber?.trim()) throw new FloorplanValidationError('A delivery event requires a vin or stockNumber.');
    if (!input.dealNumber?.trim()) throw new FloorplanValidationError('dealNumber is required.');
    if (!input.deliveredAt) throw new FloorplanValidationError('deliveredAt is required.');
    if (!input.idempotencyKey?.trim()) throw new FloorplanValidationError('idempotencyKey is required.');
    if (!DELIVERY_SOURCES.includes(input.source)) throw new FloorplanValidationError(`Invalid source: ${input.source}`);

    const existing = await this.prisma.floorplanDeliveryEvent.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } } });
    if (existing) return existing;

    const created = await this.prisma.floorplanDeliveryEvent.create({
      data: {
        id: randomUUID(),
        tenantId,
        vin: input.vin ?? null,
        stockNumber: input.stockNumber ?? null,
        dealNumber: input.dealNumber,
        deliveredAt: new Date(input.deliveredAt),
        source: input.source,
        idempotencyKey: input.idempotencyKey,
      },
    });

    await appendAuditReference(this.prisma, {
      tenantId,
      entityType: 'FLOORPLAN_DELIVERY_EVENT',
      entityId: created.id,
      eventType: 'floorplan.delivery_event.recorded',
      actor,
      after: created,
    });

    return created;
  }

  private async gracePeriodDays(tenantId: string): Promise<number> {
    const config = await this.prisma.floorplanTenantConfig.findUnique({ where: { tenantId } });
    return config?.sotGracePeriodDays ?? 3;
  }

  /** S081 AC: "your SOT list is an exact join of delivered-status ... vs
   * your own open floorplan items" — recomputes every FloorplanSotException
   * row from the live delivery-event / liability-item join, writing an
   * audited FloorplanSotEscalationHistory row only when the computed state
   * differs from what is currently stored. */
  async evaluate(tenantId: string, now: Date = new Date()): Promise<void> {
    const gracePeriodDays = await this.gracePeriodDays(tenantId);
    const deliveryEvents = await this.prisma.floorplanDeliveryEvent.findMany({ where: { tenantId } });

    for (const delivery of deliveryEvents) {
      const applyNumber = delivery.vin?.trim() || delivery.stockNumber?.trim();
      if (!applyNumber) continue;
      const item = await this.prisma.floorplanLiabilityItem.findFirst({ where: { tenantId, applyNumber } });
      // No corresponding liability item at all (unit was never floored, or
      // the item hasn't posted yet — see match-service's POSTED-only ledger
      // note) — nothing to evaluate yet; not an exception.
      if (!item) continue;

      const evaluation = evaluateSot({
        deliveredAt: delivery.deliveredAt,
        now,
        gracePeriodDays,
        itemRelieved: item.status === 'RELIEVED',
      });

      const existing = await this.prisma.floorplanSotException.findUnique({ where: { tenantId_deliveryEventId: { tenantId, deliveryEventId: delivery.id } } });

      if (!existing) {
        const created = await this.prisma.floorplanSotException.create({
          data: {
            id: randomUUID(),
            tenantId,
            deliveryEventId: delivery.id,
            itemId: item.id,
            gracePeriodDays,
            exposureSince: delivery.deliveredAt,
            escalationState: evaluation.state,
            lastEvaluatedAt: now,
          },
        });
        await this.prisma.floorplanSotEscalationHistory.create({
          data: { id: randomUUID(), tenantId, sotExceptionId: created.id, fromState: null, toState: evaluation.state, actor: 'system:sot-evaluation', reason: 'Initial evaluation' },
        });
        continue;
      }

      await this.prisma.floorplanSotException.update({ where: { id: existing.id }, data: { lastEvaluatedAt: now } });
      if (existing.escalationState !== evaluation.state) {
        await this.prisma.floorplanSotException.update({ where: { id: existing.id }, data: { escalationState: evaluation.state } });
        await this.prisma.floorplanSotEscalationHistory.create({
          data: { id: randomUUID(), tenantId, sotExceptionId: existing.id, fromState: existing.escalationState, toState: evaluation.state, actor: 'system:sot-evaluation', reason: `Recomputed: exposureDays=${evaluation.exposureDays}, gracePeriodDays=${gracePeriodDays}` },
        });
      }
    }
  }

  async dashboard(tenantId: string) {
    await this.evaluate(tenantId);
    const exceptions = await this.prisma.floorplanSotException.findMany({ where: { tenantId }, include: { item: true } });
    const tiles = { WATCH: 0, ESCALATED: 0, RESOLVED: 0 };
    for (const e of exceptions) tiles[e.escalationState as EscalationState] = (tiles[e.escalationState as EscalationState] ?? 0) + 1;
    return { tenantId, tiles, totalDelivered: exceptions.length };
  }

  /** Drill-down: every tile above is backed by this real query, filterable
   * by escalationState — never a static/pre-aggregated number. */
  async listExceptions(tenantId: string, filters: { escalationState?: string } = {}) {
    await this.evaluate(tenantId);
    return this.prisma.floorplanSotException.findMany({
      where: { tenantId, ...(filters.escalationState ? { escalationState: filters.escalationState } : {}) },
      include: { item: true },
      orderBy: { exposureSince: 'asc' },
    });
  }

  async aging(tenantId: string) {
    await this.evaluate(tenantId);
    const exceptions = await this.prisma.floorplanSotException.findMany({ where: { tenantId, escalationState: { not: 'RESOLVED' } }, include: { item: true } });
    const now = Date.now();
    return exceptions
      .map((e: any) => ({
        sotExceptionId: e.id,
        vin: e.item.vin,
        stockNumber: e.item.stockNumber,
        applyNumber: e.item.applyNumber,
        exposureSince: e.exposureSince,
        exposureDays: Math.max(0, Math.floor((now - new Date(e.exposureSince).getTime()) / 86_400_000)),
        escalationState: e.escalationState,
        remainingBalance: e.item.remainingBalance.toString(),
      }))
      .sort((a: any, b: any) => b.exposureDays - a.exposureDays);
  }

  async getException(tenantId: string, sotExceptionId: string) {
    const row = await this.prisma.floorplanSotException.findFirst({
      where: { tenantId, id: sotExceptionId },
      include: { item: { include: { applications: true } }, history: { orderBy: { occurredAt: 'asc' } } },
    });
    if (!row) throw new FloorplanNotFoundError(`No SOT exception ${sotExceptionId}.`);
    return row;
  }

  /** Manual escalation-state override — audited, requires
   * floorplan.sot.escalate. Distinct from the automatic recompute in
   * evaluate(): this is for an operator who needs to force RESOLVED (e.g.
   * confirmed the item will never post because the unit was scrapped) or
   * force ESCALATED early ahead of the grace period. */
  async manualTransition(tenantId: string, sotExceptionId: string, toState: EscalationState, reason: string, actor: string) {
    if (!reason?.trim()) throw new FloorplanValidationError('A reason is required for a manual SOT escalation transition.');
    const existing = await this.getException(tenantId, sotExceptionId);
    const updated = await this.prisma.floorplanSotException.update({ where: { id: sotExceptionId }, data: { escalationState: toState } });
    await this.prisma.floorplanSotEscalationHistory.create({
      data: { id: randomUUID(), tenantId, sotExceptionId, fromState: existing.escalationState, toState, actor, reason },
    });
    await appendAuditReference(this.prisma, {
      tenantId,
      entityType: 'FLOORPLAN_SOT_EXCEPTION',
      entityId: sotExceptionId,
      eventType: 'floorplan.sot.manual_transition',
      actor,
      before: { escalationState: existing.escalationState },
      after: { escalationState: toState, reason },
    });
    return updated;
  }
}
