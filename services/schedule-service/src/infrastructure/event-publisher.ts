import { IEventPublisher } from '@amacc/shared-kernel';
import { DomainEvent } from '@amacc/shared-kernel';
import * as amqplib from 'amqplib';

export interface RabbitMQConfig {
  url: string;
}

export class RabbitMQEventPublisher implements IEventPublisher {
  private connection: amqplib.Connection | null = null;
  private channel: amqplib.Channel | null = null;
  private handlers = new Map<string, ((event: DomainEvent) => Promise<void>)[]>();
  private readonly url: string;

  constructor(config: string | RabbitMQConfig) {
    this.url = typeof config === 'string' ? config : config.url;
  }

  async connect(): Promise<void> {
    try {
      this.connection = await amqplib.connect(this.url) as unknown as amqplib.Connection;
      this.channel = await (this.connection as any).createChannel();
      await this.channel!.assertExchange('amacc.events', 'topic', { durable: true });
      await this.channel!.assertExchange('amacc.events.dlx', 'topic', { durable: true });
      // Subscribe to inbound events (JOURNAL_ENTRY_POSTED)
      const q = await this.channel!.assertQueue('schedule-service.journal-entry-posted', {
        durable: true,
        deadLetterExchange: 'amacc.events.dlx',
      });
      await this.channel!.bindQueue(q.queue, 'amacc.events', 'JOURNAL_ENTRY_POSTED');
    } catch {
      console.warn('RabbitMQ unavailable — falling back to in-memory event bus');
    }
  }

  async publish(eventType: string, payload: Record<string, unknown>): Promise<void>;
  async publish(event: DomainEvent): Promise<void>;
  async publish(
    eventOrType: string | DomainEvent,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    const event: DomainEvent =
      typeof eventOrType === 'string'
        ? { type: eventOrType as any, payload: payload ?? {}, tenantId: '', occurredAt: new Date(), correlationId: '' }
        : eventOrType;
    const message = Buffer.from(JSON.stringify(event));
    if (this.channel) {
      this.channel.publish('amacc.events', event.type, message, {
        persistent: true,
        contentType: 'application/json',
      });
    }
    const handlers = this.handlers.get(event.type) ?? [];
    await Promise.allSettled(handlers.map((h) => h(event)));
  }

  subscribe(eventType: string, handler: (event: DomainEvent) => Promise<void>): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);

    // Wire up RabbitMQ consumer when channel is available
    if (this.channel) {
      this.channel.consume('schedule-service.journal-entry-posted', async (msg) => {
        if (!msg) return;
        try {
          const parsed: DomainEvent = JSON.parse(msg.content.toString());
          const hs = this.handlers.get(parsed.type) ?? [];
          const results = await Promise.allSettled(hs.map((h) => h(parsed)));
          const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
          if (failures.length > 0) {
            // CE-07 — a handler rejection was previously silently ACKed
            // (Promise.allSettled never rejects, and ack() ran
            // unconditionally afterward), permanently discarding the
            // message as if it had succeeded — with no log, no retry, no
            // dead-letter evidence. Never fabricate success: log the real
            // reason and nack to the already-configured dead-letter
            // exchange (deadLetterExchange: 'amacc.events.dlx' on this
            // queue, set up above but previously never actually reached).
            for (const f of failures) {
              console.error({ eventType: parsed.type, err: f.reason }, '[schedule-service] JOURNAL_ENTRY_POSTED handler failed — nacking to DLX, not silently discarding');
            }
            this.channel!.nack(msg, false, false);
            return;
          }
          this.channel!.ack(msg);
        } catch (err) {
          console.error({ err }, '[schedule-service] failed to parse/dispatch JOURNAL_ENTRY_POSTED message — nacking to DLX');
          this.channel!.nack(msg, false, false);
        }
      });
    }
  }

  async disconnect(): Promise<void> {
    await this.channel?.close();
    await (this.connection as any)?.close();
  }
}
