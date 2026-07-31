import crypto from 'crypto';

// Canonical (key-sorted) JSON, so semantically identical payloads with
// different key ordering hash identically — matters for idempotent intake
// dedup (same eventId + same hash => no-op) vs conflict detection (same
// eventId + different hash => IDEMPOTENCY_CONFLICT).
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
