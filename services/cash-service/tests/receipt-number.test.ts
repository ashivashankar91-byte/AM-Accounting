import { describe, it, expect } from 'vitest';
import { formatReceiptNumber, isValidStoreCode } from '../src/domain/receipt-number';

describe('formatReceiptNumber', () => {
  it('formats CR-{store}-{YYYYMMDD}-{seq:04d}', () => {
    expect(formatReceiptNumber('S01', '2026-07-29', 1)).toBe('CR-S01-20260729-0001');
    expect(formatReceiptNumber('S01', '2026-07-29', 42)).toBe('CR-S01-20260729-0042');
  });
});

describe('isValidStoreCode', () => {
  it('accepts uppercase alphanumeric with dashes', () => {
    expect(isValidStoreCode('S01')).toBe(true);
    expect(isValidStoreCode('STORE-01')).toBe(true);
  });

  it('rejects lowercase or empty', () => {
    expect(isValidStoreCode('s01')).toBe(false);
    expect(isValidStoreCode('')).toBe(false);
  });
});
