/**
 * Idempotency identity. The property under test is that a key describes *what*
 * an act is rather than *when* it was requested — so a replay of the same
 * request produces the same key, and the database's UNIQUE constraint turns
 * the replay into a no-op rather than a second posting.
 */

import { describe, it, expect } from 'vitest';
import {
  automationIdempotencyKey, executionIdempotencyKey, reversalIdempotencyKey, sha256, IdempotencyParts,
} from '../../src/domain/idempotency';

const PARTS: IdempotencyParts = {
  tenantId: 'tenant-a',
  legalEntityId: 'LE-1',
  capabilityCode: 'S103B_INCENTIVE_ACCRUAL',
  subjectRef: 'program-77:2026-03',
  action: 'EXECUTE',
  version: 'rules-2.1',
};

describe('automation idempotency keys', () => {
  it('is stable across calls and independent of wall-clock time', () => {
    const a = automationIdempotencyKey(PARTS);
    const b = automationIdempotencyKey({ ...PARTS });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('separates tenants, so the same subject in two tenants never collides', () => {
    expect(automationIdempotencyKey(PARTS)).not.toBe(
      automationIdempotencyKey({ ...PARTS, tenantId: 'tenant-b' }),
    );
  });

  it('separates legal entities', () => {
    expect(automationIdempotencyKey(PARTS)).not.toBe(
      automationIdempotencyKey({ ...PARTS, legalEntityId: 'LE-2' }),
    );
  });

  it('separates capabilities', () => {
    expect(automationIdempotencyKey(PARTS)).not.toBe(
      automationIdempotencyKey({ ...PARTS, capabilityCode: 'S095_PORTFOLIO_RESERVE' }),
    );
  });

  it('separates actions, so recommending and executing the same subject are distinct acts', () => {
    expect(automationIdempotencyKey({ ...PARTS, action: 'RECOMMEND' })).not.toBe(
      automationIdempotencyKey({ ...PARTS, action: 'EXECUTE' }),
    );
  });

  it('separates subjects', () => {
    expect(automationIdempotencyKey(PARTS)).not.toBe(
      automationIdempotencyKey({ ...PARTS, subjectRef: 'program-78:2026-03' }),
    );
  });

  it('treats a re-run under a new rule version as a new act', () => {
    expect(automationIdempotencyKey(PARTS)).not.toBe(
      automationIdempotencyKey({ ...PARTS, version: 'rules-2.2' }),
    );
  });

  it('treats an absent version consistently rather than randomly', () => {
    const a = automationIdempotencyKey({ ...PARTS, version: null });
    const b = automationIdempotencyKey({ ...PARTS, version: undefined });
    expect(a).toBe(b);
    expect(a).not.toBe(automationIdempotencyKey(PARTS));
  });

  it('does not collide when field boundaries shift, because the parts are delimited', () => {
    const a = automationIdempotencyKey({ ...PARTS, capabilityCode: 'AB', subjectRef: 'CD' });
    const b = automationIdempotencyKey({ ...PARTS, capabilityCode: 'A', subjectRef: 'BCD' });
    expect(a).not.toBe(b);
  });
});

describe('execution and reversal keys', () => {
  it('derives an execution key from the item key so the pair is traceable', () => {
    const itemKey = automationIdempotencyKey(PARTS);
    const execKey = executionIdempotencyKey(itemKey, 'attempt-1');
    expect(execKey).toMatch(/^[0-9a-f]{64}$/);
    expect(execKey).not.toBe(itemKey);
    expect(executionIdempotencyKey(itemKey, 'attempt-1')).toBe(execKey);
  });

  it('gives each retry attempt its own key, so a retry is a new execution record', () => {
    const itemKey = automationIdempotencyKey(PARTS);
    expect(executionIdempotencyKey(itemKey, 'attempt-1')).not.toBe(executionIdempotencyKey(itemKey, 'attempt-2'));
  });

  it('makes a reversal a distinct act rather than a mutation of the original', () => {
    const execKey = executionIdempotencyKey(automationIdempotencyKey(PARTS), 'attempt-1');
    const revKey = reversalIdempotencyKey(execKey);
    expect(revKey).not.toBe(execKey);
    expect(reversalIdempotencyKey(execKey)).toBe(revKey);
    // Reversing a reversal is different again — no accidental round-trip.
    expect(reversalIdempotencyKey(revKey)).not.toBe(execKey);
  });

  it('hashes deterministically', () => {
    expect(sha256('a')).toBe(sha256('a'));
    expect(sha256('a')).not.toBe(sha256('b'));
    expect(sha256('')).toMatch(/^[0-9a-f]{64}$/);
  });
});
