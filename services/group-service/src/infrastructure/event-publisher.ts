import { IEventPublisher, DomainEvent } from '@amacc/shared-kernel';
import * as amqplib from 'amqplib';

export interface RabbitMQConfig {
  url: string;
  /** R0 Stabilization Phase 7: distinguishes this service's own queue per
   * event type, so two different services subscribing to the same event
   * type each get their own copy (fan-out), rather than competing for
   * messages round-robin on a shared queue. Falls back to an unscoped queue
   * name if omitted, preserving prior behavior for any caller that doesn't
   * pass it (out-of-scope services untouched by this package). */
  serviceName?: string;
}

const MAX_DELIVERY_ATTEMPTS = 5;

/**
 * Topic-exchange publisher with an in-memory fallback so the service runs in
 * dev without a broker. Domain-event durability is provided by the outbox table
 * written inside the service transaction; this publisher is best-effort delivery.
 *
 * R0 Stabilization Phase 7: subscribe() previously ONLY registered an
 * in-process callback — it never declared or bound a queue, so a message
 * published to the real 'amacc.events' exchange had nothing consuming it;
 * cross-process delivery never actually happened despite publish() writing
 * to a real, durable exchange. subscribe() now declares a durable queue
 * bound to the exchange with the event type as routing key, configured with
 * a dead-letter-exchange for poison messages, and genuinely consumes from
 * it — real broker consumption, not simulated.
 */
export class RabbitMQEventPublisher implements IEventPublisher {
  private connection: amqplib.Connection | null = null;
  private channel: amqplib.Channel | null = null;
  private handlers = new Map<string, ((event: DomainEvent) => Promise<void>)[]>();
  private readonly url: string;
  private readonly serviceName: string;

  constructor(config: string | RabbitMQConfig) {
    this.url = typeof config === 'string' ? config : config.url;
    this.serviceName = (typeof config === 'string' ? undefined : config.serviceName) ?? 'unscoped';
  }

  async connect(): Promise<void> {
    try {
      this.connection = (await amqplib.connect(this.url)) as unknown as amqplib.Connection;
      this.channel = await (this.connection as any).createChannel();
      await this.channel!.assertExchange('amacc.events', 'topic', { durable: true });
      await this.channel!.assertExchange('amacc.events.dlx', 'topic', { durable: true });
    } catch {
      console.warn('RabbitMQ unavailable — falling back to in-memory event bus');
    }
  }

  async publish(event: DomainEvent): Promise<void> {
    const message = Buffer.from(JSON.stringify(event));
    if (this.channel) {
      this.channel.publish('amacc.events', event.type, message, {
        persistent: true,
        contentType: 'application/json',
        headers: { 'x-correlation-id': event.correlationId, 'x-schema-version': (event as any).schemaV ?? 1 },
      });
    }
    // In-memory fallback / same-process delivery — kept for services that
    // never call connect() successfully (dev without a broker at all).
    const handlers = this.handlers.get(event.type) ?? [];
    await Promise.allSettled(handlers.map((h) => h(event)));
  }

  subscribe(eventType: string, handler: (event: DomainEvent) => Promise<void>): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);

    if (!this.channel) return; // no broker connected — in-memory delivery above is the only path

    // Fire-and-forget setup; consume() below is where real messages arrive.
    void this.bindAndConsume(eventType, handler);
  }

  private async bindAndConsume(eventType: string, handler: (event: DomainEvent) => Promise<void>): Promise<void> {
    const channel = this.channel!;
    const queueName = `${this.serviceName}.${eventType}`;
    const dlQueueName = `${queueName}.dlq`;

    await channel.assertQueue(dlQueueName, { durable: true });
    await channel.bindQueue(dlQueueName, 'amacc.events.dlx', eventType);

    await channel.assertQueue(queueName, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'amacc.events.dlx',
        'x-dead-letter-routing-key': eventType,
      },
    });
    await channel.bindQueue(queueName, 'amacc.events', eventType);

    await channel.consume(queueName, async (msg) => {
      if (!msg) return;
      const deliveryAttempt = (msg.properties.headers?.['x-delivery-attempt'] as number | undefined) ?? 1;
      try {
        const event = JSON.parse(msg.content.toString()) as DomainEvent;
        await handler(event);
        channel.ack(msg);
      } catch (err) {
        if (deliveryAttempt >= MAX_DELIVERY_ATTEMPTS) {
          // Poison message: give up requeuing, route to the dead-letter queue.
          channel.nack(msg, false, false);
        } else {
          // Requeue with an incremented attempt counter (re-published rather
          // than a bare nack-requeue, since plain requeue doesn't let us
          // track/cap the attempt count reliably across brokers).
          channel.ack(msg);
          channel.publish('amacc.events', eventType, msg.content, {
            persistent: true,
            contentType: 'application/json',
            headers: { ...msg.properties.headers, 'x-delivery-attempt': deliveryAttempt + 1 },
          });
        }
      }
    });
  }
}
