import { PrismaClient } from '.prisma/gl-client';

export interface FinancialEvent {
  id: string;
  tenantId: string;
  entityType: string;     // JOURNAL_ENTRY, GL_ACCOUNT
  entityId: string;
  eventType: string;      // CREATED, POSTED, APPROVED, REVERSED, AMENDED
  version: number;
  payload: Record<string, unknown>;
  actorId: string;
  occurredAt: Date;
}

/**
 * Gap 3: Append-only event store for journal entries.
 * Every mutation is captured as an immutable event, enabling
 * full audit history and point-in-time reconstruction.
 */
export class EventStore {
  constructor(private prisma: PrismaClient) {}

  async append(event: Omit<FinancialEvent, 'id' | 'occurredAt'>): Promise<FinancialEvent> {
    // Use OutboxEvent table (already exists) as the event store
    const record = await this.prisma.outboxEvent.create({
      data: {
        eventType: `${event.entityType}.${event.eventType}`,
        tenantId: event.tenantId,
        payload: {
          entityId: event.entityId,
          version: event.version,
          actorId: event.actorId,
          data: event.payload as Record<string, string>,
        } as any,
        correlationId: event.entityId,
      },
    });
    return {
      id: record.id,
      tenantId: record.tenantId,
      entityType: event.entityType,
      entityId: event.entityId,
      eventType: event.eventType,
      version: event.version,
      payload: event.payload,
      actorId: event.actorId,
      occurredAt: record.createdAt,
    };
  }

  async getHistory(tenantId: string, entityId: string): Promise<FinancialEvent[]> {
    const events = await this.prisma.outboxEvent.findMany({
      where: { tenantId, correlationId: entityId },
      orderBy: { createdAt: 'asc' },
    });
    return events.map((e) => {
      const p = e.payload as any;
      return {
        id: e.id,
        tenantId: e.tenantId,
        entityType: e.eventType.split('.')[0] || 'UNKNOWN',
        entityId: p.entityId || entityId,
        eventType: e.eventType.split('.')[1] || e.eventType,
        version: p.version ?? 0,
        payload: p.data ?? p,
        actorId: p.actorId ?? 'system',
        occurredAt: e.createdAt,
      };
    });
  }

  async getEntityVersion(tenantId: string, entityId: string): Promise<number> {
    const count = await this.prisma.outboxEvent.count({
      where: { tenantId, correlationId: entityId },
    });
    return count;
  }

  async reconstruct(tenantId: string, entityId: string, asOfDate?: Date): Promise<Record<string, unknown>> {
    const events = await this.prisma.outboxEvent.findMany({
      where: {
        tenantId,
        correlationId: entityId,
        ...(asOfDate ? { createdAt: { lte: asOfDate } } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
    // Replay events to reconstruct state
    let state: Record<string, unknown> = {};
    for (const event of events) {
      const p = event.payload as any;
      const data = p.data ?? p;
      state = { ...state, ...data, _lastEvent: event.eventType, _version: p.version ?? 0 };
    }
    return state;
  }
}
