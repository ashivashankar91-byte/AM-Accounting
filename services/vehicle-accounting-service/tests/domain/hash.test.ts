import crypto from 'crypto';
import { describe, it, expect } from 'vitest';
import { hashPayload } from '../../src/domain/hash';

describe('hashPayload', () => {
  it('is a 64-char lowercase hex sha256 digest', () => {
    const h = hashPayload({ a: 1 });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is key-order independent (canonical JSON) — same eventId/payload dedup must not depend on client key ordering', () => {
    const a = hashPayload({ stockNumber: 'STK-1', invoiceCost: '25000.00' });
    const b = hashPayload({ invoiceCost: '25000.00', stockNumber: 'STK-1' });
    expect(a).toBe(b);
  });

  it('is deep/nested key-order independent', () => {
    const a = hashPayload({ outer: { z: 1, a: 2 }, list: [{ b: 1, a: 2 }] });
    const b = hashPayload({ list: [{ a: 2, b: 1 }], outer: { a: 2, z: 1 } });
    expect(a).toBe(b);
  });

  it('changes when a value changes (not just keys)', () => {
    const a = hashPayload({ amount: '100.00' });
    const b = hashPayload({ amount: '100.01' });
    expect(a).not.toBe(b);
  });

  it('matches independently re-derived canonical-JSON sha256 for a known payload (cross-check against posting-recovery-service\'s hashPayload algorithm, reproduced here without importing across service boundaries)', () => {
    const payload = { b: 2, a: 1, nested: { y: 2, x: 1 } };
    // Manually canonicalize + hash the same way, independently, to prove
    // hash.ts's algorithm (not just its own self-consistency) is exactly
    // "sort every object's keys recursively, then sha256 the JSON string".
    function canonicalize(v: unknown): unknown {
      if (Array.isArray(v)) return v.map(canonicalize);
      if (v && typeof v === 'object') {
        const entries: Array<[string, unknown]> = Object.entries(v as Record<string, unknown>).map(([k, vv]) => [k, canonicalize(vv)]);
        entries.sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
        return Object.fromEntries(entries);
      }
      return v;
    }
    const expected = crypto.createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex');
    expect(hashPayload(payload)).toBe(expected);
  });
});
