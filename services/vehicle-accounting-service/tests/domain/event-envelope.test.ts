import { describe, it, expect } from 'vitest';
import { buildEnvelope, postingIdempotencyKey, InvalidEventTypeError, EVENT_TYPE_PATTERN, SOURCE_SYSTEM } from '../../src/domain/event-envelope';

describe('event-envelope', () => {
  it('builds a well-shaped envelope with sourceSystem fixed to vehicle-accounting-service', () => {
    const env = buildEnvelope({
      eventId: 'evt-1', tenantId: 'tenant-1', eventType: 'vehicle.stocked.v1',
      occurredAt: '2026-01-01T00:00:00.000Z', businessDate: '2026-01-01',
      sourceEntityType: 'VEHICLE_UNIT', sourceEntityId: 'STK-1', correlationId: 'corr-1',
      payload: { stockNumber: 'STK-1' },
    });
    expect(env.sourceSystem).toBe(SOURCE_SYSTEM);
    expect(env.sourceSystem).toBe('vehicle-accounting-service');
    expect(env.eventSchemaVersion).toBe('1');
    expect(env.causationId).toBeNull();
    expect(env.metadata).toBeNull();
    expect(typeof env.publishedAt).toBe('string');
    expect(() => new Date(env.publishedAt).toISOString()).not.toThrow();
  });

  it('rejects an eventType that does not match the canonical posting-engine pattern', () => {
    expect(() => buildEnvelope({
      eventId: 'e', tenantId: 't', eventType: 'vehicle_stocked_v1',
      occurredAt: '2026-01-01T00:00:00.000Z', businessDate: '2026-01-01',
      sourceEntityType: 'X', sourceEntityId: 'Y', correlationId: 'c', payload: {},
    })).toThrow(InvalidEventTypeError);
  });

  it('every event type this service defines matches the pattern coa-service enforces', () => {
    const eventTypes = [
      'vehicle.stocked.v1',
      'vehicle.cost-component-added.v1',
      'vehicle.recon-cost-added.v1',
      'vehicle.demo-reclassed.v1',
      'vehicle.demo-value-adjusted.v1',
      'vehicle.lcnrv-writedown.v1',
      'vehicle.dealer-trade-outbound.v1',
      'vehicle.dealer-trade-inbound.v1',
      'vehicle.dealer-trade-settled.v1',
    ];
    for (const et of eventTypes) {
      expect(EVENT_TYPE_PATTERN.test(et), et).toBe(true);
    }
  });

  it('postingIdempotencyKey matches coa-service PostingEngineService.submitEvent()\'s own idempotencyKey convention', () => {
    expect(postingIdempotencyKey('tenant-1', 'evt-1')).toBe('tenant-1:evt-1');
  });
});
