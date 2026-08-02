import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/migration-service-client';
import { IEventPublisherPort } from '../domain/interfaces';
import { IEventPublisher } from '@amacc/shared-kernel';

/**
 * CE-16 migration domain events.
 *
 * Every event is written to migration_outbox inside the caller's own database
 * work first (durability), then handed to the broker (delivery). A broker
 * outage therefore loses delivery, never the fact that the event occurred.
 */
export const MIGRATION_EVENTS = {
  RUN_CREATED: 'migration.run.created',
  RUN_STATE_CHANGED: 'migration.run.state_changed',
  STAGING_COMPLETE: 'migration.staging.complete',
  VALIDATION_COMPLETE: 'migration.validation.complete',
  CUTOVER_INITIATED: 'migration.cutover.initiated',
  CUTOVER_COMPLETE: 'migration.cutover.complete',
  ROLLBACK_INITIATED: 'migration.rollback.initiated',
  ROLLBACK_COMPLETE: 'migration.rollback.complete',
} as const;

export type MigrationEventType = (typeof MIGRATION_EVENTS)[keyof typeof MIGRATION_EVENTS];

@injectable()
export class MigrationEventPublisher implements IEventPublisherPort {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly publisher: IEventPublisher,
  ) {}

  async publishMigrationEvent(type: string, tenantId: string, payload: Record<string, unknown>): Promise<void> {
    const correlationId = (payload['correlationId'] as string) ?? `${type}:${Date.now()}`;
    let outboxId: string | null = null;
    try {
      const row = await this.prisma.migrationOutboxEvent.create({
        data: { tenantId, eventType: type, payload: payload as any, correlationId },
      });
      outboxId = row.id;
    } catch {
      // Outbox write failure must not silently swallow the event; delivery is
      // still attempted below and the failure surfaces in service logs.
    }

    try {
      await this.publisher.publish({
        type: type as any,
        tenantId,
        payload,
        occurredAt: new Date(),
        correlationId,
      });
      if (outboxId) {
        await this.prisma.migrationOutboxEvent.update({
          where: { id: outboxId },
          data: { publishedAt: new Date() },
        });
      }
    } catch (err: any) {
      if (outboxId) {
        await this.prisma.migrationOutboxEvent.update({
          where: { id: outboxId },
          data: { retryCount: { increment: 1 }, lastError: String(err?.message ?? err) },
        }).catch(() => undefined);
      }
    }
  }
}
