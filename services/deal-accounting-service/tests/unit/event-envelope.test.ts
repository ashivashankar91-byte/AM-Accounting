import { describe, it, expect } from 'vitest';
import { buildEnvelope, assertValidEventType, SOURCE_SYSTEM } from '../../src/domain/event-envelope';
import { hashPayload } from '../../src/domain/hash';

describe('event envelope construction', () => {
  it('builds a fully-shaped envelope with the fixed sourceSystem', () => {
    const env = buildEnvelope({
      eventId: 'evt-1',
      tenantId: 'tenant-1',
      eventType: 'deal.finalized.v1',
      occurredAt: '2026-08-01T00:00:00.000Z',
      sourceEntityType: 'DEAL',
      sourceEntityId: 'D-1001',
      correlationId: 'corr-1',
      businessDate: '2026-08-01',
      payload: { dealNumber: 'D-1001' },
    });
    expect(env.sourceSystem).toBe(SOURCE_SYSTEM);
    expect(env.eventSchemaVersion).toBe('v1');
    expect(env.causationId).toBeNull();
    expect(env.metadata).toBeNull();
    expect(typeof env.publishedAt).toBe('string');
  });

  it('accepts valid eventType patterns', () => {
    expect(() => assertValidEventType('deal.finalized.v1')).not.toThrow();
    expect(() => assertValidEventType('deal.product-line-finalized.v2')).not.toThrow();
    expect(() => assertValidEventType('deal.recontract-delta.v10')).not.toThrow();
  });

  it('rejects invalid eventType patterns', () => {
    expect(() => assertValidEventType('DealFinalized.v1')).toThrow();
    expect(() => assertValidEventType('deal.finalized')).toThrow();
    expect(() => assertValidEventType('deal..finalized.v1')).toThrow();
    expect(() => assertValidEventType('deal.finalized.1')).toThrow();
  });
});

describe('payload hashing (posting-recovery-service contract)', () => {
  it('is stable regardless of key order', () => {
    const a = hashPayload({ a: 1, b: 2, c: { d: 3, e: 4 } });
    const b = hashPayload({ c: { e: 4, d: 3 }, b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it('changes when a value changes', () => {
    const a = hashPayload({ a: 1 });
    const b = hashPayload({ a: 2 });
    expect(a).not.toBe(b);
  });
});
