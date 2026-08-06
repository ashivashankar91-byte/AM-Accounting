import crypto from 'crypto';

// Mirrors services/posting-recovery-service/src/domain/hash.ts exactly —
// canonical (key-sorted) JSON so posting-recovery-service's DeadLetterIntake
// Service.intake() computed hash (which hashes the SAME payload the same
// way) always matches this service's payloadHash.
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
