import { describe, it, expect } from 'vitest';
import { computeRenderedHash, verifySnapshotIntegrity } from '../../src/domain/snapshot-ceremony';

describe('snapshot-ceremony', () => {
  it('computes sha256 hash', () => {
    const hash = computeRenderedHash('hello world');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  it('same content produces same hash', () => {
    expect(computeRenderedHash('test')).toBe(computeRenderedHash('test'));
  });

  it('different content produces different hash', () => {
    expect(computeRenderedHash('test1')).not.toBe(computeRenderedHash('test2'));
  });

  it('verifySnapshotIntegrity returns true for matching hashes', () => {
    const content = 'statement content';
    const hash = computeRenderedHash(content);
    const result = verifySnapshotIntegrity(
      { sourceTbHash: 'tbhash123', renderedHash: hash },
      { sourceTbHash: 'tbhash123', renderedContent: content }
    );
    expect(result).toBe(true);
  });

  it('verifySnapshotIntegrity returns false for tampered content', () => {
    const result = verifySnapshotIntegrity(
      { sourceTbHash: 'tbhash123', renderedHash: 'oldhash' },
      { sourceTbHash: 'tbhash123', renderedContent: 'tampered content' }
    );
    expect(result).toBe(false);
  });
});
