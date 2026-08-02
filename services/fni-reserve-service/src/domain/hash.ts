// Byte-identical copy of services/posting-recovery-service/src/domain/hash.ts
// — canonical (key-sorted) JSON SHA-256, so a payloadHash computed here for
// posting-recovery-service's dead-letter intake matches what that service
// independently re-computes and compares (event.payloadHash === computed).
import crypto from 'crypto';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, canonicalize(v)] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries);
  }
  return value;
}

export function hashPayload(payload: unknown): string {
  const canonical = JSON.stringify(canonicalize(payload));
  return crypto.createHash('sha256').update(canonical).digest('hex');
}
