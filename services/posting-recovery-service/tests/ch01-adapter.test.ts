import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpCH01PostingExecutionPort, PostingFailureEnvelope } from '../src/domain/ch01-adapter';

function envelope(overrides: Partial<PostingFailureEnvelope['event']> = {}): PostingFailureEnvelope {
  return {
    event: {
      eventId: 'evt-1',
      tenantId: 'tenant-a',
      eventType: 'DEAL_POSTED',
      eventSchemaVersion: '1.0',
      sourceSystem: 'deal-service',
      sourceEntityType: 'DEAL',
      sourceEntityId: 'deal-123',
      correlationId: 'corr-1',
      occurredAt: '2026-07-01T00:00:00.000Z',
      publishedAt: '2026-07-01T00:00:01.000Z',
      businessDate: '2026-07-01',
      postingIdempotencyKey: 'idem-1',
      payload: { dealNumber: 'D-1', amount: '100.00' },
      payloadHash: 'irrelevant-for-these-tests',
      ...overrides,
    },
    failure: {
      failureCategory: 'RULE_NOT_FOUND',
      failureCode: 'RULE_PACK_NOT_FOUND',
      failureStage: 'RULE_RESOLUTION',
      failureMessage: 'No rule pack matched',
      occurredAt: '2026-07-01T00:05:00.000Z',
    },
  };
}

describe('HttpCH01PostingExecutionPort', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('POSTs to /api/v1/coa/posting-engine/events with a signed service token and x-tenant-id', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'POSTED', idempotent: false, journalNumber: 'JE-1' }), { status: 201 }));
    global.fetch = fetchMock as any;

    const port = new HttpCH01PostingExecutionPort('test-secret', 'http://coa-service:3016');
    const result = await port.replay(envelope());

    expect(result.outcome).toBe('POSTED');
    expect(result.journalReference).toBe('JE-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://coa-service:3016/api/v1/coa/posting-engine/events');
    expect(init.method).toBe('POST');
    expect(init.headers['x-tenant-id']).toBe('tenant-a');
    expect(init.headers['Authorization']).toMatch(/^Bearer .+\..+\..+$/); // header.payload.signature
    const body = JSON.parse(init.body);
    expect(body.eventId).toBe('evt-1');
    expect(body.eventSchemaVersion).toBe('1.0');
    expect(body.sourceEntityId).toBe('deal-123');
  });

  it('maps idempotent POSTED (idempotent:true) to NOOP_ALREADY_POSTED with idempotentPassthrough', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ status: 'POSTED', idempotent: true, journalNumber: 'JE-9' }), { status: 200 })) as any;
    const port = new HttpCH01PostingExecutionPort('test-secret', 'http://coa-service:3016');
    const result = await port.replay(envelope());
    expect(result.outcome).toBe('NOOP_ALREADY_POSTED');
    expect(result.idempotentPassthrough).toBe(true);
    expect(result.journalReference).toBe('JE-9');
  });

  it('maps REJECTED / NO_RULE_MATCH statuses to REJECTED outcome', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ status: 'NO_RULE_MATCH', idempotent: false, failureReason: 'no rule' }), { status: 200 })) as any;
    const port = new HttpCH01PostingExecutionPort('test-secret', 'http://coa-service:3016');
    const result = await port.replay(envelope());
    expect(result.outcome).toBe('REJECTED');
    expect(result.message).toBe('no rule');
  });

  it('maps HTTP 409 EVENT_IDENTITY_CONFLICT to a FAILED outcome with a clear, non-silent message', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'EVENT_IDENTITY_CONFLICT', executionId: 'exec-1', eventId: 'evt-1' }), { status: 409 })) as any;
    const port = new HttpCH01PostingExecutionPort('test-secret', 'http://coa-service:3016');
    const result = await port.replay(envelope());
    expect(result.outcome).toBe('FAILED');
    expect(result.message).toContain('EVENT_IDENTITY_CONFLICT');
    expect(result.message).toContain('exec-1');
  });

  it('maps a network failure (fetch throws) to a FAILED outcome instead of throwing', async () => {
    global.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as any;
    const port = new HttpCH01PostingExecutionPort('test-secret', 'http://coa-service:3016');
    const result = await port.replay(envelope());
    expect(result.outcome).toBe('FAILED');
    expect(result.message).toContain('ECONNREFUSED');
  });

  it('maps an unexpected non-2xx status to a FAILED outcome', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ message: 'internal error' }), { status: 500 })) as any;
    const port = new HttpCH01PostingExecutionPort('test-secret', 'http://coa-service:3016');
    const result = await port.replay(envelope());
    expect(result.outcome).toBe('FAILED');
    expect(result.message).toContain('internal error');
  });
});
