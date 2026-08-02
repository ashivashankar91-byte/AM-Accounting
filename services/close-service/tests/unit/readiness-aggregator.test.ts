import { describe, it, expect } from 'vitest';
import { aggregateReadiness } from '../../src/domain/readiness-aggregator';

describe('readiness-aggregator', () => {
  it('returns allReady=true when all signals are READY', () => {
    const result = aggregateReadiness([
      { moduleCode: 'CE-09', signal: 'READY' },
      { moduleCode: 'CE-11', signal: 'READY' },
    ]);
    expect(result.allReady).toBe(true);
    expect(result.hasExceptions).toBe(false);
  });

  it('returns hasExceptions=true when any signal is not READY', () => {
    const result = aggregateReadiness([
      { moduleCode: 'CE-09', signal: 'READY' },
      { moduleCode: 'CE-11', signal: 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION' },
    ]);
    expect(result.allReady).toBe(false);
    expect(result.hasExceptions).toBe(true);
  });

  it('returns empty signals for empty input', () => {
    const result = aggregateReadiness([]);
    expect(result.allReady).toBe(true);
    expect(result.signals).toHaveLength(0);
  });
});
