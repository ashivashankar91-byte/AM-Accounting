import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { FordAdapter } from '../../src/domain/adapters/ford-adapter';
import { GmAdapter } from '../../src/domain/adapters/gm-adapter';

const FIXTURES = join(__dirname, '..', '..', 'fixtures');

describe('S099 Ford feed adapter', () => {
  it('parses the fixture feed byte-accountably: every row staged, zero silent loss', () => {
    const raw = readFileSync(join(FIXTURES, 'ford', 'remittance-2026-07-v1.txt'), 'utf-8');
    const doc = new FordAdapter().parse(raw);
    expect(doc.kind).toBe('REMITTANCE');
    expect(doc.specVersion).toBe('2.1');
    expect(doc.rows).toHaveLength(5); // 2 REMIT + 1 INCENTIVE + 1 COOP + 1 unrecognized
    const unparsed = doc.rows.filter((r) => r.parseStatus === 'UNPARSED');
    expect(unparsed).toHaveLength(1);
    expect(unparsed[0]!.rawLine).toContain('XSEGMENT');
    expect(doc.rows.filter((r) => r.parseStatus === 'PARSED')).toHaveLength(4);
  });

  it('a spec-version change on re-delivery is visible in the parsed document (drives S098 diff alert)', () => {
    const v1 = new FordAdapter().parse(readFileSync(join(FIXTURES, 'ford', 'remittance-2026-07-v1.txt'), 'utf-8'));
    const v2 = new FordAdapter().parse(readFileSync(join(FIXTURES, 'ford', 'remittance-2026-07-v2-redelivery.txt'), 'utf-8'));
    expect(v1.naturalKey).toBe(v2.naturalKey); // same statement — re-delivery, not a new document
    expect(v1.specVersion).not.toBe(v2.specVersion);
    expect((v1.rows[0]!.fields as any).amount).not.toBe((v2.rows[0]!.fields as any).amount);
  });

  it('rejects an unrecognized header rather than guessing', () => {
    expect(() => new FordAdapter().parse('NOT_A_HEADER|garbage')).toThrow();
  });
});

describe('S100 GM feed adapter', () => {
  it('parses mixed canonical row types (remittance, chargeback, return credit)', () => {
    const raw = readFileSync(join(FIXTURES, 'gm', 'remittance-2026-07-v1.txt'), 'utf-8');
    const doc = new GmAdapter().parse(raw);
    expect(doc.rows.every((r) => r.parseStatus === 'PARSED')).toBe(true);
    expect(doc.rows.map((r) => r.canonicalType)).toEqual(['RECEIVABLE_REMITTANCE', 'CHARGEBACK_LINE', 'PARTS_RETURN_CREDIT']);
  });
});
