import { describe, it, expect } from 'vitest';
import { buildEnvelope, EVENT_TYPE_PATTERN } from '../../src/domain/envelope';

describe('EVENT_TYPE_PATTERN', () => {
  it('accepts well-formed event types', () => {
    expect(EVENT_TYPE_PATTERN.test('floorplan.advance-matched.v1')).toBe(true);
    expect(EVENT_TYPE_PATTERN.test('floorplan.curtailment-payment.v2')).toBe(true);
  });

  it('rejects malformed event types', () => {
    expect(EVENT_TYPE_PATTERN.test('Floorplan.Advance.v1')).toBe(false);
    expect(EVENT_TYPE_PATTERN.test('floorplan.advance')).toBe(false);
    expect(EVENT_TYPE_PATTERN.test('floorplan.advance.1')).toBe(false);
  });
});

describe('buildEnvelope', () => {
  it('builds a well-formed envelope with sourceSystem floorplan-service', () => {
    const env = buildEnvelope('tenant-1', {
      eventType: 'floorplan.advance-matched.v1',
      sourceEntityType: 'FLOORPLAN_MATCH',
      sourceEntityId: 'match-1',
      correlationId: 'corr-1',
      businessDate: '2026-08-01',
      payload: { amount: '100.00' },
    });
    expect(env.sourceSystem).toBe('floorplan-service');
    expect(env.tenantId).toBe('tenant-1');
    expect(env.eventId).toBeTruthy();
    expect(env.eventSchemaVersion).toBe('1.0');
  });

  it('rejects an eventType that does not match the canonical pattern', () => {
    expect(() =>
      buildEnvelope('tenant-1', {
        eventType: 'Bad.EventType',
        sourceEntityType: 'X',
        sourceEntityId: 'x',
        correlationId: 'c',
        businessDate: '2026-08-01',
        payload: {},
      }),
    ).toThrow();
  });

  it('uses the deterministic eventId when provided, for retry-safe idempotency', () => {
    const env1 = buildEnvelope('tenant-1', {
      eventType: 'floorplan.advance-matched.v1',
      sourceEntityType: 'FLOORPLAN_MATCH',
      sourceEntityId: 'match-1',
      correlationId: 'corr-1',
      businessDate: '2026-08-01',
      payload: {},
      deterministicEventId: 'fixed-id-1',
    });
    const env2 = buildEnvelope('tenant-1', {
      eventType: 'floorplan.advance-matched.v1',
      sourceEntityType: 'FLOORPLAN_MATCH',
      sourceEntityId: 'match-1',
      correlationId: 'corr-1',
      businessDate: '2026-08-01',
      payload: {},
      deterministicEventId: 'fixed-id-1',
    });
    expect(env1.eventId).toBe('fixed-id-1');
    expect(env1.eventId).toBe(env2.eventId);
  });
});
