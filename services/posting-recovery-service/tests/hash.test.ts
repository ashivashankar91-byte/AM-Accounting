import { describe, it, expect } from 'vitest';
import { hashPayload } from '../src/domain/hash';

describe('hashPayload', () => {
  it('is stable regardless of key order (canonical JSON)', () => {
    const a = hashPayload({ x: 1, y: { b: 2, a: 1 } });
    const b = hashPayload({ y: { a: 1, b: 2 }, x: 1 });
    expect(a).toBe(b);
  });

  it('differs for semantically different payloads', () => {
    const a = hashPayload({ amount: '100.00' });
    const b = hashPayload({ amount: '100.01' });
    expect(a).not.toBe(b);
  });

  it('is a 64-char hex sha-256 digest', () => {
    const h = hashPayload({ x: 1 });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
