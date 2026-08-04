// S102 — Phase-2 OEM Feed Adapters (GM + Ford)
// Canonical ACs: SPI conformance, zero-silent-loss, UNPARSED staging, canonical row types
import { describe, it, expect } from 'vitest';
import { GmAdapter } from '../../src/domain/adapters/gm-adapter';
import { FordAdapter } from '../../src/domain/adapters/ford-adapter';

const GM_VALID_FEED = [
  'HEADER|GM|REMITTANCE|STMT-GM-001|1.0|DEALER-001',
  'REMIT|CLM-001|1000.00|Warranty Remit',
  'CHARGEBACK|CLM-002|200.00|Parts Chargeback',
  'INCENTIVE|CLM-003|500.00|Volume Incentive',
].join('\n');

const FORD_VALID_FEED = [
  'HEADER|FORD|INCENTIVE_STATEMENT|STMT-FORD-001|1.0|DEALER-002',
  'INCENTIVE|CLM-F01|750.00|Ford Incentive',
  'RETURN|CLM-F02|150.00|Parts Return',
].join('\n');

const FEED_WITH_UNKNOWN_TAG = [
  'HEADER|GM|REMITTANCE|STMT-001|1.0|DEALER-001',
  'REMIT|CLM-001|1000.00|Warranty',
  'UNKNOWN_TAG|data1|data2|data3',
].join('\n');

describe('S102 — Phase-2 OEM Feed Adapters', () => {
  it('AC1 — GmAdapter.make equals "GM" and implements the OemFeedAdapter SPI', () => {
    const adapter = new GmAdapter();
    expect(adapter.make).toBe('GM');
    expect(typeof adapter.parse).toBe('function');
  });

  it('AC2 — FordAdapter.make equals "FORD" and implements the OemFeedAdapter SPI', () => {
    const adapter = new FordAdapter();
    expect(adapter.make).toBe('FORD');
    expect(typeof adapter.parse).toBe('function');
  });

  it('AC3 — GM adapter parses REMIT→RECEIVABLE_REMITTANCE, CHARGEBACK→CHARGEBACK_LINE, INCENTIVE→INCENTIVE_LINE', () => {
    const doc = new GmAdapter().parse(GM_VALID_FEED);
    const rows = doc.rows;
    expect(rows.find(r => r.canonicalType === 'RECEIVABLE_REMITTANCE')).toBeTruthy();
    expect(rows.find(r => r.canonicalType === 'CHARGEBACK_LINE')).toBeTruthy();
    expect(rows.find(r => r.canonicalType === 'INCENTIVE_LINE')).toBeTruthy();
    rows.forEach(r => expect(r.parseStatus).toBe('PARSED'));
  });

  it('AC4 — Ford adapter parses INCENTIVE→INCENTIVE_LINE and RETURN→PARTS_RETURN_CREDIT', () => {
    const adapter = new FordAdapter();
    const doc = adapter.parse(FORD_VALID_FEED);
    expect(adapter.make).toBe('FORD');
    const incentive = doc.rows.find(r => r.canonicalType === 'INCENTIVE_LINE');
    const returnRow = doc.rows.find(r => r.canonicalType === 'PARTS_RETURN_CREDIT');
    expect(incentive).toBeTruthy();
    expect(returnRow).toBeTruthy();
  });

  it('AC5 — Zero-silent-loss: unrecognized tags are staged as UNPARSED with rawLine preserved', () => {
    const doc = new GmAdapter().parse(FEED_WITH_UNKNOWN_TAG);
    const unparsed = doc.rows.find(r => r.parseStatus === 'UNPARSED');
    expect(unparsed).toBeTruthy();
    expect(unparsed!.rawLine).toContain('UNKNOWN_TAG');
    expect(unparsed!.canonicalType).toBeNull();
  });

  it('AC6 — Both adapters reject empty feed content (fail-closed)', () => {
    expect(() => new GmAdapter().parse('')).toThrow();
    expect(() => new FordAdapter().parse('')).toThrow();
  });
});
