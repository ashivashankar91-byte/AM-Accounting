import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as amqplib from 'amqplib';
import { RabbitMQEventPublisher } from '../src/infrastructure/event-publisher';

// R0 Stabilization Phase 7 — real durable broker consumption. This service's
// event-publisher.ts is an identical copy of the same class shipped in all
// 16 services touched by this fix (11 standalone + 5 agent-*); recon-service
// is used here as the representative instance since the implementation is
// uniform. Covers: publish/consume happy path, retry-with-incremented-
// attempt-counter, DLX after MAX_DELIVERY_ATTEMPTS, malformed-message
// handling (same failure path as a handler exception), broker-unavailable
// in-memory fallback, and the documented at-least-once (not exactly-once)
// duplicate-delivery contract.

vi.mock('amqplib');

function makeFakeChannel() {
  const consumers = new Map<string, (msg: any) => Promise<void> | void>();
  const published: Array<{ exchange: string; routingKey: string; content: Buffer; options: any }> = [];
  const acked: any[] = [];
  const nacked: Array<{ msg: any; requeue: boolean }> = [];
  const assertedQueues: Array<{ name: string; options: any }> = [];
  const boundQueues: Array<{ queue: string; exchange: string; routingKey: string }> = [];

  const channel = {
    assertExchange: vi.fn(async () => {}),
    assertQueue: vi.fn(async (name: string, options: any) => { assertedQueues.push({ name, options }); }),
    bindQueue: vi.fn(async (queue: string, exchange: string, routingKey: string) => { boundQueues.push({ queue, exchange, routingKey }); }),
    consume: vi.fn(async (queueName: string, cb: (msg: any) => Promise<void> | void) => { consumers.set(queueName, cb); }),
    publish: vi.fn((exchange: string, routingKey: string, content: Buffer, options: any) => { published.push({ exchange, routingKey, content, options }); }),
    ack: vi.fn((msg: any) => { acked.push(msg); }),
    nack: vi.fn((msg: any, allUpTo: boolean, requeue: boolean) => { nacked.push({ msg, requeue }); }),
  };

  return { channel, consumers, published, acked, nacked, assertedQueues, boundQueues };
}

function fakeMessage(event: unknown, deliveryAttempt?: number) {
  return {
    content: Buffer.from(typeof event === 'string' ? event : JSON.stringify(event)),
    properties: { headers: deliveryAttempt ? { 'x-delivery-attempt': deliveryAttempt } : {} },
  };
}

describe('RabbitMQEventPublisher — real durable broker consumption (R0 Stabilization Phase 7)', () => {
  let fake: ReturnType<typeof makeFakeChannel>;

  beforeEach(() => {
    fake = makeFakeChannel();
    (amqplib.connect as any) = vi.fn(async () => ({ createChannel: vi.fn(async () => fake.channel) }));
  });

  it('connect() declares both the topic exchange and the dead-letter exchange, durably', async () => {
    const pub = new RabbitMQEventPublisher({ url: 'amqp://test', serviceName: 'recon-service' });
    await pub.connect();

    expect(fake.channel.assertExchange).toHaveBeenCalledWith('amacc.events', 'topic', { durable: true });
    expect(fake.channel.assertExchange).toHaveBeenCalledWith('amacc.events.dlx', 'topic', { durable: true });
  });

  it('publish() writes to the real exchange with correlation-id header when connected', async () => {
    const pub = new RabbitMQEventPublisher({ url: 'amqp://test', serviceName: 'recon-service' });
    await pub.connect();
    const event = { type: 'RECON_STARTED', tenantId: 't1', correlationId: 'corr-1' } as any;
    await pub.publish(event);

    expect(fake.published).toHaveLength(1);
    expect(fake.published[0]).toMatchObject({
      exchange: 'amacc.events',
      routingKey: 'RECON_STARTED',
      options: { persistent: true, headers: { 'x-correlation-id': 'corr-1' } },
    });
  });

  it('publish() falls back to in-memory same-process delivery when the broker is unavailable (connect() failed)', async () => {
    (amqplib.connect as any) = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const pub = new RabbitMQEventPublisher({ url: 'amqp://unreachable', serviceName: 'recon-service' });
    await pub.connect(); // swallows the error, warns, leaves channel null

    const handler = vi.fn(async () => {});
    pub.subscribe('RECON_STARTED', handler);
    await pub.publish({ type: 'RECON_STARTED', tenantId: 't1', correlationId: 'corr-1' } as any);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(fake.channel.publish).not.toHaveBeenCalled(); // never reached — no channel exists
  });

  it('subscribe() declares a durable, service-scoped queue bound to the exchange, plus a bound DLQ', async () => {
    const pub = new RabbitMQEventPublisher({ url: 'amqp://test', serviceName: 'recon-service' });
    await pub.connect();
    pub.subscribe('RECON_STARTED', async () => {});
    await vi.waitFor(() => expect(fake.consumers.has('recon-service.RECON_STARTED')).toBe(true));

    expect(fake.assertedQueues.map((q) => q.name)).toEqual(
      expect.arrayContaining(['recon-service.RECON_STARTED.dlq', 'recon-service.RECON_STARTED']),
    );
    expect(fake.boundQueues).toEqual(
      expect.arrayContaining([
        { queue: 'recon-service.RECON_STARTED.dlq', exchange: 'amacc.events.dlx', routingKey: 'RECON_STARTED' },
        { queue: 'recon-service.RECON_STARTED', exchange: 'amacc.events', routingKey: 'RECON_STARTED' },
      ]),
    );
    const mainQueueArgs = fake.assertedQueues.find((q) => q.name === 'recon-service.RECON_STARTED')!.options;
    expect(mainQueueArgs.arguments).toMatchObject({
      'x-dead-letter-exchange': 'amacc.events.dlx',
      'x-dead-letter-routing-key': 'RECON_STARTED',
    });
  });

  it('a real broker message is parsed, delivered to the handler, and acked on success', async () => {
    const pub = new RabbitMQEventPublisher({ url: 'amqp://test', serviceName: 'recon-service' });
    await pub.connect();
    const handler = vi.fn(async () => {});
    pub.subscribe('RECON_STARTED', handler);
    await vi.waitFor(() => expect(fake.consumers.has('recon-service.RECON_STARTED')).toBe(true));

    const event = { type: 'RECON_STARTED', tenantId: 't1', correlationId: 'corr-1' };
    const msg = fakeMessage(event);
    await fake.consumers.get('recon-service.RECON_STARTED')!(msg);

    expect(handler).toHaveBeenCalledWith(event);
    expect(fake.acked).toContain(msg);
    expect(fake.nacked).toHaveLength(0);
  });

  it('a handler failure below MAX_DELIVERY_ATTEMPTS acks the original and republishes with an incremented attempt counter (never a silent drop)', async () => {
    const pub = new RabbitMQEventPublisher({ url: 'amqp://test', serviceName: 'recon-service' });
    await pub.connect();
    const handler = vi.fn(async () => { throw new Error('transient downstream failure'); });
    pub.subscribe('RECON_STARTED', handler);
    await vi.waitFor(() => expect(fake.consumers.has('recon-service.RECON_STARTED')).toBe(true));

    const event = { type: 'RECON_STARTED', tenantId: 't1' };
    const msg = fakeMessage(event, 2); // 2nd attempt, still below MAX_DELIVERY_ATTEMPTS=5
    await fake.consumers.get('recon-service.RECON_STARTED')!(msg);

    expect(fake.acked).toContain(msg); // original ack'd (not left redelivering forever)
    expect(fake.nacked).toHaveLength(0);
    expect(fake.published).toHaveLength(1);
    expect(fake.published[0].options.headers['x-delivery-attempt']).toBe(3);
  });

  it('a poison message at MAX_DELIVERY_ATTEMPTS is nacked without requeue, routing it to the DLX (never republished forever)', async () => {
    const pub = new RabbitMQEventPublisher({ url: 'amqp://test', serviceName: 'recon-service' });
    await pub.connect();
    const handler = vi.fn(async () => { throw new Error('permanently broken'); });
    pub.subscribe('RECON_STARTED', handler);
    await vi.waitFor(() => expect(fake.consumers.has('recon-service.RECON_STARTED')).toBe(true));

    const msg = fakeMessage({ type: 'RECON_STARTED', tenantId: 't1' }, 5); // at MAX_DELIVERY_ATTEMPTS
    await fake.consumers.get('recon-service.RECON_STARTED')!(msg);

    expect(fake.nacked).toEqual([{ msg, requeue: false }]);
    expect(fake.acked).toHaveLength(0);
    expect(fake.published).toHaveLength(0); // no infinite republish loop
  });

  it('a malformed (non-JSON) message follows the exact same failure path as a handler exception, not a silent drop or a crash', async () => {
    const pub = new RabbitMQEventPublisher({ url: 'amqp://test', serviceName: 'recon-service' });
    await pub.connect();
    const handler = vi.fn(async () => {});
    pub.subscribe('RECON_STARTED', handler);
    await vi.waitFor(() => expect(fake.consumers.has('recon-service.RECON_STARTED')).toBe(true));

    const malformed = { content: Buffer.from('{not valid json'), properties: { headers: { 'x-delivery-attempt': 1 } } };
    await expect(fake.consumers.get('recon-service.RECON_STARTED')!(malformed)).resolves.not.toThrow();

    expect(handler).not.toHaveBeenCalled(); // JSON.parse threw before the handler ever ran
    expect(fake.acked).toContain(malformed); // treated as attempt 1 of 5 -> requeued via republish
    expect(fake.published).toHaveLength(1);
    expect(fake.published[0].options.headers['x-delivery-attempt']).toBe(2);
  });

  it('duplicate delivery of the identical message invokes the handler again (documented at-least-once, not exactly-once, contract)', async () => {
    const pub = new RabbitMQEventPublisher({ url: 'amqp://test', serviceName: 'recon-service' });
    await pub.connect();
    const handler = vi.fn(async () => {});
    pub.subscribe('RECON_STARTED', handler);
    await vi.waitFor(() => expect(fake.consumers.has('recon-service.RECON_STARTED')).toBe(true));

    const event = { type: 'RECON_STARTED', tenantId: 't1', correlationId: 'corr-dup' };
    const msg1 = fakeMessage(event);
    const msg2 = fakeMessage(event); // simulates the broker redelivering the same logical message
    await fake.consumers.get('recon-service.RECON_STARTED')!(msg1);
    await fake.consumers.get('recon-service.RECON_STARTED')!(msg2);

    // This publisher provides no dedup of its own — downstream handlers own
    // idempotency (e.g. the posting engine's tenantId+eventId key). Both
    // deliveries reach the handler; this test documents that contract
    // rather than assuming a guarantee this class was never meant to give.
    expect(handler).toHaveBeenCalledTimes(2);
    expect(fake.acked).toHaveLength(2);
  });

  it('falls back to an "unscoped" queue name when no serviceName is provided (back-compat for untouched callers)', async () => {
    const pub = new RabbitMQEventPublisher('amqp://test'); // string form, no serviceName
    await pub.connect();
    pub.subscribe('RECON_STARTED', async () => {});
    await vi.waitFor(() => expect(fake.consumers.has('unscoped.RECON_STARTED')).toBe(true));
  });
});
