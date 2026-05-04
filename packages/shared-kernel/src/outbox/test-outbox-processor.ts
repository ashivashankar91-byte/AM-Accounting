/**
 * Integration tests for OutboxProcessor.
 * Requires: real Postgres (DATABASE_URL) + real RabbitMQ (RABBITMQ_URL).
 * Run: docker compose up -d postgres rabbitmq && npx vitest run src/outbox/test-outbox-processor.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as amqplib from 'amqplib';
import { Pool } from 'pg';
import { OutboxProcessor, OutboxRecord } from './index';
import { IEventPublisher } from '../interfaces';
import { DomainEvent } from '../events';

// ── In-memory store helpers ──────────���────────────────────────────────

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://amacc:amacc_dev@localhost:5433/amacc';
const RABBITMQ_URL = process.env['RABBITMQ_URL'] ?? 'amqp://guest:guest@localhost:5672';
const TEST_EXCHANGE = 'amacc.events';
const TEST_QUEUE = 'outbox-test-queue';

// ── Real RabbitMQ publisher ──────────────��────────────────────────────

class TestEventPublisher implements IEventPublisher {
  constructor(private channel: amqplib.Channel) {}

  async publish(event: DomainEvent): Promise<void> {
    this.channel.publish(
      TEST_EXCHANGE,
      event.type,
      Buffer.from(JSON.stringify(event)),
      { persistent: true, contentType: 'application/json' },
    );
  }

  subscribe(_eventType: string, _handler: (event: DomainEvent) => Promise<void>): void {
    // not needed for outbox tests
  }
}

// ── Consume one message from test queue ───────────────��──────────────

async function consumeOne(channel: amqplib.Channel): Promise<DomainEvent> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for message')), 5000);
    channel.consume(TEST_QUEUE, (msg) => {
      if (!msg) return;
      clearTimeout(timeout);
      channel.ack(msg);
      resolve(JSON.parse(msg.content.toString()) as DomainEvent);
    }, { noAck: false });
  });
}

// ── Test setup ─────────────────────────────────────────────��─────────

let pool: Pool;
let connection: amqplib.Connection;
let publishChannel: amqplib.Channel;
let consumeChannel: amqplib.Channel;

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL });

  // Ensure outbox_events table exists (uses gl-service migration)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS outbox_events (
      id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      event_type    TEXT NOT NULL,
      tenant_id     TEXT NOT NULL,
      payload       JSONB NOT NULL DEFAULT '{}',
      correlation_id TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      published_at  TIMESTAMPTZ,
      retry_count   INT NOT NULL DEFAULT 0,
      last_error    TEXT
    )
  `);

  connection = await (amqplib as any).connect(RABBITMQ_URL);
  publishChannel = await (connection as any).createChannel();
  consumeChannel = await (connection as any).createChannel();

  await publishChannel.assertExchange(TEST_EXCHANGE, 'topic', { durable: true });
  await consumeChannel.assertExchange(TEST_EXCHANGE, 'topic', { durable: true });

  const q = await consumeChannel.assertQueue(TEST_QUEUE, { durable: false, autoDelete: true });
  await consumeChannel.bindQueue(q.queue, TEST_EXCHANGE, '#');
});

afterAll(async () => {
  await pool.query('DROP TABLE IF EXISTS outbox_events_test_only');
  await pool.end();
  await publishChannel.close();
  await consumeChannel.close();
  await (connection as any).close();
});

beforeEach(async () => {
  await pool.query('DELETE FROM outbox_events');
  // Drain any leftover messages
  await consumeChannel.purgeQueue(TEST_QUEUE);
});

// ── Callback factories ────────────────────────────────────────────────

function makeCallbacks(pg: Pool) {
  const findUnpublished = async (): Promise<OutboxRecord[]> => {
    const result = await pg.query<{
      id: string; event_type: string; tenant_id: string; payload: Record<string, unknown>;
      correlation_id: string | null; published_at: Date | null; retry_count: number; last_error: string | null;
    }>(
      `SELECT id, event_type, tenant_id, payload, correlation_id, published_at, retry_count, last_error
       FROM outbox_events
       WHERE published_at IS NULL AND retry_count < 10
       ORDER BY created_at ASC
       LIMIT 50`,
    );
    return result.rows.map((r) => ({
      id: r.id,
      eventType: r.event_type,
      tenantId: r.tenant_id,
      payload: r.payload,
      correlationId: r.correlation_id,
      publishedAt: r.published_at,
      retryCount: r.retry_count,
      lastError: r.last_error,
    }));
  };

  const markPublished = async (id: string): Promise<void> => {
    await pg.query('UPDATE outbox_events SET published_at = NOW() WHERE id = $1', [id]);
  };

  const incrementRetry = async (id: string, error?: string): Promise<void> => {
    await pg.query(
      'UPDATE outbox_events SET retry_count = retry_count + 1, last_error = $2 WHERE id = $1',
      [id, error ?? null],
    );
  };

  return { findUnpublished, markPublished, incrementRetry };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('OutboxProcessor', () => {
  it('publishes unpublished events to RabbitMQ', async () => {
    await pool.query(
      `INSERT INTO outbox_events (id, event_type, tenant_id, payload)
       VALUES ('evt-1', 'TEST_EVENT', 'test-tenant', '{"foo":"bar"}')`,
    );

    const publisher = new TestEventPublisher(publishChannel);
    const { findUnpublished, markPublished, incrementRetry } = makeCallbacks(pool);
    const processor = new OutboxProcessor(publisher, findUnpublished, markPublished, incrementRetry);

    const msgPromise = consumeOne(consumeChannel);
    await processor.processNextBatch();

    const event = await msgPromise;
    expect(event.payload).toMatchObject({ foo: 'bar' });

    const row = await pool.query('SELECT published_at FROM outbox_events WHERE id = $1', ['evt-1']);
    expect(row.rows[0].published_at).not.toBeNull();
  });

  it('retries on RabbitMQ failure and records lastError', async () => {
    await pool.query(
      `INSERT INTO outbox_events (id, event_type, tenant_id, payload)
       VALUES ('evt-2', 'TEST_EVENT', 'test-tenant', '{"x":1}')`,
    );

    // Publisher that always throws
    const failingPublisher: IEventPublisher = {
      publish: async () => { throw new Error('AMQP down'); },
      subscribe: () => {},
    };
    const { findUnpublished, markPublished, incrementRetry } = makeCallbacks(pool);
    const processor = new OutboxProcessor(failingPublisher, findUnpublished, markPublished, incrementRetry);

    await processor.processNextBatch();

    const row = await pool.query(
      'SELECT retry_count, last_error, published_at FROM outbox_events WHERE id = $1',
      ['evt-2'],
    );
    expect(row.rows[0].retry_count).toBe(1);
    expect(row.rows[0].last_error).toBe('AMQP down');
    expect(row.rows[0].published_at).toBeNull();
  });

  it('stops retrying after maxRetries (retryCount >= 10)', async () => {
    await pool.query(
      `INSERT INTO outbox_events (id, event_type, tenant_id, payload, retry_count)
       VALUES ('evt-3', 'TEST_EVENT', 'test-tenant', '{}', 10)`,
    );

    let publishCalled = false;
    const publisher: IEventPublisher = {
      publish: async () => { publishCalled = true; },
      subscribe: () => {},
    };
    const { findUnpublished, markPublished, incrementRetry } = makeCallbacks(pool);
    const processor = new OutboxProcessor(publisher, findUnpublished, markPublished, incrementRetry);

    await processor.processNextBatch();

    expect(publishCalled).toBe(false);
    const row = await pool.query('SELECT published_at FROM outbox_events WHERE id = $1', ['evt-3']);
    expect(row.rows[0].published_at).toBeNull();
  });

  it('processes events in FIFO order', async () => {
    await pool.query(`
      INSERT INTO outbox_events (id, event_type, tenant_id, payload, created_at) VALUES
      ('evt-first',  'ORD_EVENT', 'test-tenant', '{"seq":1}', NOW() - INTERVAL '3 seconds'),
      ('evt-second', 'ORD_EVENT', 'test-tenant', '{"seq":2}', NOW() - INTERVAL '2 seconds'),
      ('evt-third',  'ORD_EVENT', 'test-tenant', '{"seq":3}', NOW() - INTERVAL '1 second')
    `);

    const received: number[] = [];
    const publisher: IEventPublisher = {
      publish: async (event) => { received.push((event.payload as any).seq as number); },
      subscribe: () => {},
    };
    const { findUnpublished, markPublished, incrementRetry } = makeCallbacks(pool);
    const processor = new OutboxProcessor(publisher, findUnpublished, markPublished, incrementRetry);

    await processor.processNextBatch();

    expect(received).toEqual([1, 2, 3]);
  });

  it('does not double-publish when processNextBatch runs concurrently', async () => {
    await pool.query(
      `INSERT INTO outbox_events (id, event_type, tenant_id, payload)
       VALUES ('evt-concurrent', 'CONCURRENT_EVENT', 'test-tenant', '{}')`,
    );

    let publishCount = 0;
    const publisher: IEventPublisher = {
      publish: async () => { publishCount++; },
      subscribe: () => {},
    };
    const { findUnpublished, markPublished, incrementRetry } = makeCallbacks(pool);
    const processor = new OutboxProcessor(publisher, findUnpublished, markPublished, incrementRetry);

    // Run two batches concurrently
    await Promise.all([processor.processNextBatch(), processor.processNextBatch()]);

    // At most one publish (second batch may find the event already marked published)
    expect(publishCount).toBeLessThanOrEqual(1);
    const row = await pool.query(
      'SELECT published_at FROM outbox_events WHERE id = $1',
      ['evt-concurrent'],
    );
    expect(row.rows[0].published_at).not.toBeNull();
  });
});
