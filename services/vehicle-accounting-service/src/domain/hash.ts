// Canonical payload hashing — byte-for-byte identical algorithm to
// posting-recovery-service's src/domain/hash.ts (hashPayload), because
// posting-recovery-client.ts's dead-letter intake body must carry a
// payloadHash that DeadLetterIntakeService.intake() recomputes and compares
// (`event.payloadHash !== computedHash` -> EVENT_CONTRACT_INVALID). Copied
// verbatim rather than imported across service boundaries (services in this
// repo do not import each other's src directly).
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
