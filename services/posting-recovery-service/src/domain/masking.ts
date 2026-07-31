// S021 — payload masking. Field-name-based (not value-based): a key whose
// name matches SENSITIVE_KEY_PATTERN is masked in the response unless the
// caller holds posting-recovery.payload.read-sensitive. The original row in
// the database is never altered — masking happens only in the read path.

const SENSITIVE_KEY_PATTERN =
  /(ssn|social_security|tax_id|taxid|account_number|accountnumber|routing_number|routingnumber|card_number|cardnumber|cvv|password|secret|api_key|apikey|token|bank_account|dob|date_of_birth|dateofbirth)/i;

function maskScalar(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const s = String(value);
  if (s.length <= 4) return '***';
  return `***${s.slice(-4)}`;
}

function walk(value: unknown, mask: boolean): unknown {
  if (Array.isArray(value)) return value.map((v) => walk(v, mask));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const keyIsSensitive = SENSITIVE_KEY_PATTERN.test(key);
      if (keyIsSensitive) {
        out[key] = mask ? maskScalar(v) : v;
      } else {
        out[key] = walk(v, mask);
      }
    }
    return out;
  }
  return value;
}

/** Returns a masked copy of `payload` unless `revealSensitive` is true. */
export function maskPayload<T extends Record<string, unknown>>(payload: T, revealSensitive: boolean): T {
  return walk(payload, !revealSensitive) as T;
}

/** True if `payload` contains any field name matching the sensitive pattern. */
export function payloadContainsSensitiveData(payload: unknown): boolean {
  if (Array.isArray(payload)) return payload.some(payloadContainsSensitiveData);
  if (payload && typeof payload === 'object') {
    return Object.entries(payload as Record<string, unknown>).some(
      ([key, v]) => SENSITIVE_KEY_PATTERN.test(key) || payloadContainsSensitiveData(v),
    );
  }
  return false;
}

/** Masks an idempotency-identity-style string down to its last 4 characters. */
export function maskIdentity(value: string, revealSensitive: boolean): string {
  if (revealSensitive) return value;
  if (value.length <= 4) return '***';
  return `***${value.slice(-4)}`;
}
