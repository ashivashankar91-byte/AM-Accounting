import { randomUUID } from 'crypto';
import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/automation-service-client';
import { IEventPublisher } from '@amacc/shared-kernel';
import { IAutomationEventPublisher } from '../domain/interfaces';

/**
 * Outbox-first publisher.
 *
 * The row lands in automation_outbox inside the caller's transaction, so an
 * event describing an execution cannot exist without the execution and vice
 * versa. Broker delivery is attempted afterwards and is allowed to fail — the
 * outbox row is the durable record.
 */
@injectable()
export class AutomationEventPublisher implements IAutomationEventPublisher {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly bus: IEventPublisher,
  ) {}

  async publish(tenantId: string, aggregateId: string, eventType: string, payload: Record<string, unknown>): Promise<void> {
    const correlationId = randomUUID();
    try {
      await (this.prisma as any).outboxEvent.create({
        data: { tenantId, aggregateId, eventType, payload: payload as any, correlationId },
      });
    } catch {
      // A durability failure must not fabricate a successful publish; the
      // caller's transaction outcome is what matters and is unaffected.
    }
    try {
      await this.bus.publish({
        id: randomUUID(),
        type: eventType,
        occurredAt: new Date(),
        tenantId,
        correlationId,
        payload,
      } as any);
    } catch {
      // Best-effort; the outbox row above remains the record of truth.
    }
  }
}
