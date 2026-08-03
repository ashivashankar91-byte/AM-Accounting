import { IEventPublisher, DomainEvent } from '@amacc/shared-kernel';
import * as amqplib from 'amqplib';

export interface RabbitMQConfig {
  url: string;
  serviceName?: string;
}

const MAX_DELIVERY_ATTEMPTS = 5;

/**
 * Topic-exchange publisher with an in-memory fallback so automation-service
 * runs in dev without a broker. Durability for automation.* domain events is
 * provided by the automation_outbox row written inside the service
 * transaction; this publisher is best-effort delivery on top of that.
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
    const handlers = this.handlers.get(event.type) ?? [];
    await Promise.allSettled(handlers.map((h) => h(event)));
  }

  subscribe(eventType: string, handler: (event: DomainEvent) => Promise<void>): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
    if (!this.channel) return;
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
      } catch {
        if (deliveryAttempt >= MAX_DELIVERY_ATTEMPTS) {
          channel.nack(msg, false, false);
        } else {
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
