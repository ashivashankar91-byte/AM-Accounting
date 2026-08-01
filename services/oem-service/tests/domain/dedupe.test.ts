import { describe, it, expect } from 'vitest';
import { computeDocumentIdentity, computeContentHash } from '../../src/domain/dedupe';

describe('S098 dedupe helpers', () => {
  it('documentIdentity is deterministic and content-independent', () => {
    const a = computeDocumentIdentity('tenant-1', 'ford', 'REMITTANCE', 'FS-2026-07-001:F12345');
    const b = computeDocumentIdentity('tenant-1', 'FORD', 'REMITTANCE', 'fs-2026-07-001:f12345');
    expect(a).toBe(b); // case-insensitive on make + natural key
  });

  it('documentIdentity differs across tenants for the same natural document', () => {
    const a = computeDocumentIdentity('tenant-1', 'FORD', 'REMITTANCE', 'FS-2026-07-001');
    const b = computeDocumentIdentity('tenant-2', 'FORD', 'REMITTANCE', 'FS-2026-07-001');
    expect(a).not.toBe(b);
  });

  it('contentHash changes when raw content changes (drives the diff-alert path)', () => {
    const h1 = computeContentHash('HEADER|FORD|REMITTANCE|FS-1|2.1|F1\nREMIT|C-1|100.00|x');
    const h2 = computeContentHash('HEADER|FORD|REMITTANCE|FS-1|2.2|F1\nREMIT|C-1|125.00|x');
    expect(h1).not.toBe(h2);
  });

  it('contentHash is identical for byte-identical content (drives the dedupe path)', () => {
    const content = 'HEADER|FORD|REMITTANCE|FS-1|2.1|F1\nREMIT|C-1|100.00|x';
    expect(computeContentHash(content)).toBe(computeContentHash(content));
  });
});
