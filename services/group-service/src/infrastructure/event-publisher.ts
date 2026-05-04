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
      });
    }
    const handlers = this.handlers.get(event.type) ?? [];
    await Promise.allSettled(handlers.map((h) => h(event)));
  }

  subscribe(eventType: string, handler: (event: DomainEvent) => Promise<void>): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  async disconnect(): Promise<void> {
    await this.channel?.close();
    await (this.connection as any)?.close();
  }
}
