/**
 * Deterministic identity for an exception.
 *
 * Migration principle 5 says a rerun must not double-load. That applies to
 * evidence as much as to data: replaying the same extraction against the same
 * mapping version discovers the same defects, and those defects must resolve
 * to the same queue entries rather than accumulating duplicates a reviewer
 * then has to disposition one by one.
 *
 * The key is derived only from the facts that define the defect, never from a
 * clock or a row insertion order, so it is stable across restarts.
 */

import { createHash } from 'node:crypto';

export interface ExceptionIdentityInput {
  exceptionType: string;
  sourceRowId?: string | null;
  stagingRowId?: string | null;
  sourceField?: string | null;
  sourceValue?: string | null;
  reason: string;
}

export function computeExceptionDedupeKey(input: ExceptionIdentityInput): string {
  const parts = [
    input.exceptionType,
    input.sourceRowId ?? '',
    input.stagingRowId ?? '',
    input.sourceField ?? '',
    input.sourceValue ?? '',
    input.reason,
  ];
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 40);
}
