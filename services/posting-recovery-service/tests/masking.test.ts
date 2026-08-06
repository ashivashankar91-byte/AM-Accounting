import { describe, it, expect } from 'vitest';
import { maskPayload, payloadContainsSensitiveData, maskIdentity } from '../src/domain/masking';

describe('payload masking', () => {
  const payload = {
    dealNumber: 'D-1001',
    customer: {
      name: 'Jane Doe',
      ssn: '123-45-6789',
      accountNumber: '000111222333',
    },
    lines: [{ cardNumber: '4111111111111111', amount: '500.00' }],
  };

  it('masks sensitive fields by default (revealSensitive=false)', () => {
    const masked = maskPayload(payload, false);
    expect(masked.customer.ssn).toBe('***6789');
    expect(masked.customer.accountNumber).toBe('***2333');
    expect(masked.lines[0].cardNumber).toBe('***1111');
  });

  it('leaves non-sensitive fields untouched', () => {
    const masked = maskPayload(payload, false);
    expect(masked.dealNumber).toBe('D-1001');
    expect(masked.customer.name).toBe('Jane Doe');
    expect(masked.lines[0].amount).toBe('500.00');
  });

  it('reveals sensitive fields verbatim when revealSensitive=true', () => {
    const revealed = maskPayload(payload, true);
    expect(revealed.customer.ssn).toBe('123-45-6789');
    expect(revealed.customer.accountNumber).toBe('000111222333');
    expect(revealed.lines[0].cardNumber).toBe('4111111111111111');
  });

  it('never mutates the original payload', () => {
    const original = JSON.stringify(payload);
    maskPayload(payload, false);
    expect(JSON.stringify(payload)).toBe(original);
  });

  it('detects sensitive-field presence for the containsSensitiveData flag', () => {
    expect(payloadContainsSensitiveData(payload)).toBe(true);
    expect(payloadContainsSensitiveData({ dealNumber: 'D-1', amount: '10.00' })).toBe(false);
  });

  it('maskIdentity masks to last 4 chars unless revealSensitive', () => {
    expect(maskIdentity('idem-key-abcdef1234', false)).toBe('***1234');
    expect(maskIdentity('idem-key-abcdef1234', true)).toBe('idem-key-abcdef1234');
    expect(maskIdentity('ab', false)).toBe('***');
  });
});
