/**
 * CE-17 — Idempotency identity.
 *
 * Every execution carries a key derived from what it *is*, not from when it
 * was asked for. Two requests describing the same act produce the same key and
 * the database's UNIQUE constraint — not application etiquette — makes the
 * second one a no-op that returns the first one's result.
 */

import { createHash } from 'crypto';

export interface IdempotencyParts {
  tenantId: string;
  legalEntityId: string;
  capabilityCode: string;
  /** Stable identity of the thing being acted on (invoice id, line id, …). */
  subjectRef: string;
  /** Discriminates recommend vs execute vs reverse for the same subject. */
  action: string;
  /** Rule/model version, so a re-run under a new version is a new act. */
  version?: string | null;
}

export function automationIdempotencyKey(parts: IdempotencyParts): string {
  const canonical = [
    'ce17',
    parts.tenantId,
    parts.legalEntityId,
    parts.capabilityCode,
    parts.action,
    parts.subjectRef,
    parts.version ?? 'unversioned',
  ].join(':');
  return createHash('sha256').update(canonical).digest('hex');
}

/** The execution key is derived from the item's key so the pair is traceable. */
export function executionIdempotencyKey(itemIdempotencyKey: string, attemptScope: string): string {
  return createHash('sha256').update(`ce17.exec:${itemIdempotencyKey}:${attemptScope}`).digest('hex');
}

/** A reversal is a distinct act with its own key, never a mutation of the original. */
export function reversalIdempotencyKey(originalExecutionKey: string): string {
  return createHash('sha256').update(`ce17.reverse:${originalExecutionKey}`).digest('hex');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
