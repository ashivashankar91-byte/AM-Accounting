import { describe, it, expect } from 'vitest';
import { evaluateSot } from '../../src/domain/sot';

describe('evaluateSot', () => {
  it('is RESOLVED once the item is relieved, regardless of elapsed time', () => {
    const result = evaluateSot({
      deliveredAt: new Date('2026-01-01T00:00:00Z'),
      now: new Date('2026-06-01T00:00:00Z'),
      gracePeriodDays: 3,
      itemRelieved: true,
    });
    expect(result.state).toBe('RESOLVED');
  });

  it('is WATCH when unrelieved but within the grace period', () => {
    const result = evaluateSot({
      deliveredAt: new Date('2026-08-01T00:00:00Z'),
      now: new Date('2026-08-02T00:00:00Z'),
      gracePeriodDays: 3,
      itemRelieved: false,
    });
    expect(result.state).toBe('WATCH');
    expect(result.exposureDays).toBe(1);
    expect(result.gracePeriodExceeded).toBe(false);
  });

  it('is ESCALATED once unrelieved exposure exceeds the grace period', () => {
    const result = evaluateSot({
      deliveredAt: new Date('2026-08-01T00:00:00Z'),
      now: new Date('2026-08-06T00:00:00Z'),
      gracePeriodDays: 3,
      itemRelieved: false,
    });
    expect(result.state).toBe('ESCALATED');
    expect(result.exposureDays).toBe(5);
    expect(result.gracePeriodExceeded).toBe(true);
  });

  it('is exactly at the boundary (exposureDays === gracePeriodDays) still WATCH, not ESCALATED', () => {
    const result = evaluateSot({
      deliveredAt: new Date('2026-08-01T00:00:00Z'),
      now: new Date('2026-08-04T00:00:00Z'),
      gracePeriodDays: 3,
      itemRelieved: false,
    });
    expect(result.exposureDays).toBe(3);
    expect(result.state).toBe('WATCH');
  });
});
