import { describe, it, expect, vi } from 'vitest';
import { withRetryBackoff } from '../../src/domain/retry';

describe('withRetryBackoff', () => {
  it('returns the result on first success, no retries', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const attempts: any[] = [];
    const outcome = await withRetryBackoff(fn, () => true, (a) => attempts.push(a), { maxAttempts: 3, initialDelayMs: 1, backoffMultiplier: 1 });
    expect('result' in outcome && outcome.result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(attempts).toHaveLength(1);
  });

  it('retries a transient failure up to maxAttempts, then gives up', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('transient'));
    const attempts: any[] = [];
    const outcome = await withRetryBackoff(fn, () => true, (a) => attempts.push(a), { maxAttempts: 3, initialDelayMs: 1, backoffMultiplier: 1 });
    expect('error' in outcome).toBe(true);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(attempts).toHaveLength(3);
  });

  it('does not retry a non-retryable (durable) error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('durable'));
    const outcome = await withRetryBackoff(fn, () => false, () => {}, { maxAttempts: 3, initialDelayMs: 1, backoffMultiplier: 1 });
    expect('error' in outcome).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('logs every attempt via onAttempt, even ones that eventually succeed after failures', async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 2) throw new Error('flaky');
      return 'recovered';
    });
    const attempts: any[] = [];
    const outcome = await withRetryBackoff(fn, () => true, (a) => attempts.push(a), { maxAttempts: 3, initialDelayMs: 1, backoffMultiplier: 1 });
    expect('result' in outcome && outcome.result).toBe('recovered');
    expect(attempts).toHaveLength(2);
  });
});
