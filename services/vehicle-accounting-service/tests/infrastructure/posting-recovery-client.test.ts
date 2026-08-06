import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpPostingRecoveryClient } from '../../src/infrastructure/posting-recovery-client';
import { hashPayload } from '../../src/domain/hash';
import { buildEnvelope, postingIdempotencyKey } from '../../src/domain/event-envelope';

const originalFetch = global.fetch;

describe('HttpPostingRecoveryClient', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('POSTs to /posting-recovery/v1/dead-letters with a payloadHash that matches posting-recovery-service\'s own DeadLetterIntakeService recomputation (hashPayload(payload))', async () => {
    let capturedUrl = '';
    let capturedBody: any = null;
    let capturedHeaders: any = null;
    global.fetch = vi.fn(async (url: any, init: any) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(init.body);
      capturedHeaders = init.headers;
      return new Response(JSON.stringify({ deadLetterId: 'dl-1', created: true }), { status: 201 });
    }) as any;

    const client = new HttpPostingRecoveryClient('test-secret', 'http://posting-recovery-service:3049');
    const env = buildEnvelope({
      eventId: 'evt-1', tenantId: 'tenant-1', eventType: 'vehicle.stocked.v1',
      occurredAt: '2026-01-01T00:00:00.000Z', businessDate: '2026-01-01',
      sourceEntityType: 'VEHICLE_UNIT', sourceEntityId: 'STK-1', correlationId: 'corr-1',
      payload: { stockNumber: 'STK-1', invoiceCost: '100.00' },
    });

    const result = await client.reportFailure({
      envelope: env, storeId: 'store-1', sourceTransactionId: 'STK-1',
      failureCategory: 'ACCOUNTING_MAPPING_UNRESOLVED', failureCode: 'ACCOUNT_MAPPING_VALUES_PENDING',
      failureStage: 'MAPPING', failureMessage: 'Account ... could not be resolved',
    });

    expect(result).toEqual({ deadLetterId: 'dl-1', created: true });
    expect(capturedUrl).toBe('http://posting-recovery-service:3049/posting-recovery/v1/dead-letters');
    expect(capturedHeaders['x-tenant-id']).toBe('tenant-1');
    expect(capturedHeaders['Authorization']).toMatch(/^Bearer /);

    const sentEvent = capturedBody.envelope.event;
    expect(sentEvent.payloadHash).toBe(hashPayload(env.payload));
    expect(sentEvent.postingIdempotencyKey).toBe(postingIdempotencyKey('tenant-1', 'evt-1'));
    expect(sentEvent.eventId).toBe('evt-1');
    expect(sentEvent.tenantId).toBe('tenant-1');
    expect(sentEvent.sourceTransactionId).toBe('STK-1');
    expect(sentEvent.storeId).toBe('store-1');

    const sentFailure = capturedBody.envelope.failure;
    expect(sentFailure.failureCategory).toBe('ACCOUNTING_MAPPING_UNRESOLVED');
    expect(sentFailure.failureStage).toBe('MAPPING');
    expect(typeof sentFailure.occurredAt).toBe('string');
  });

  it('throws PostingRecoveryUnavailableError when the HTTP call fails', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as any;
    const client = new HttpPostingRecoveryClient('test-secret', 'http://posting-recovery-service:3049');
    const env = buildEnvelope({
      eventId: 'evt-2', tenantId: 'tenant-1', eventType: 'vehicle.stocked.v1',
      occurredAt: '2026-01-01T00:00:00.000Z', businessDate: '2026-01-01',
      sourceEntityType: 'VEHICLE_UNIT', sourceEntityId: 'STK-2', correlationId: 'corr-2', payload: {},
    });
    await expect(client.reportFailure({
      envelope: env, failureCategory: 'UNKNOWN_FAILURE', failureCode: 'X', failureStage: 'UNKNOWN', failureMessage: 'x',
    })).rejects.toThrow(/unreachable/);
  });
});
