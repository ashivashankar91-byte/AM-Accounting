import { IEventPublisher, DomainEvent } from '@amacc/shared-kernel';
import * as amqplib from 'amqplib';

// Copied verbatim (Reuse After Refactoring) from services/schedule-service/
// src/infrastructure/event-publisher.ts's RabbitMQEventPublisher — this
// service is a producer only (no JOURNAL_ENTRY_POSTED-style inbound
// subscription needed), so the queue-bind/consume half is omitted.

export interface RabbitMQConfig {
  url: string;
}

export class RabbitMQEventPublisher implements IEventPublisher {
  private connection: amqplib.Connection | null = null;
  private channel: amqplib.Channel | null = null;
  private readonly url: string;

  constructor(config: string | RabbitMQConfig) {
    this.url = typeof config === 'string' ? config : config.url;
  }

  async connect(): Promise<void> {
    try {
      this.connection = (await amqplib.connect(this.url)) as unknown as amqplib.Connection;
      this.channel = await (this.connection as any).createChannel();
      await this.channel!.assertExchange('amacc.events', 'topic', { durable: true });
      await this.channel!.assertExchange('amacc.events.dlx', 'topic', { durable: true });
    } catch {
      console.warn('[deal-accounting-service] RabbitMQ unavailable — outbox rows remain durable, broker publish best-effort only');
    }
  }

  async publish(eventType: string, payload: Record<string, unknown>): Promise<void>;
  async publish(event: DomainEvent): Promise<void>;
  async publish(eventOrType: string | DomainEvent, payload?: Record<string, unknown>): Promise<void> {
    const event: DomainEvent =
      typeof eventOrType === 'string'
        ? { type: eventOrType as any, payload: payload ?? {}, tenantId: '', occurredAt: new Date(), correlationId: '' }
        : eventOrType;
    const message = Buffer.from(JSON.stringify(event));
    if (this.channel) {
      this.channel.publish('amacc.events', event.type, message, { persistent: true, contentType: 'application/json' });
    }
  }

  subscribe(): void {
    // This service does not consume broker events.
  }

  async disconnect(): Promise<void> {
    await this.channel?.close();
    await (this.connection as any)?.close();
  }
}
