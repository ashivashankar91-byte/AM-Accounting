// CE-07 / S023 — deterministic idempotency-identity derivation.
//
// D-S023-06 amendment (S023_DECISION_REGISTER.md): ap.invoice.accepted is
// the single authoritative event; ap.invoice.posted-request is normalized
// to the SAME canonical event identity and idempotency key. Both event
// "names" must derive the identical idempotencyIdentity for the same
// underlying invoice so the posting engine's existing, unmodified
// tenantId+eventId idempotency mechanism naturally dedups them — no engine
// change required for this rule.

import { createHash } from 'crypto';

/**
 * Deterministic identity for a vendor-invoice liability posting, shared by
 * every event "name" that represents posting the SAME invoice's liability
 * journal (ap.invoice.accepted, ap.invoice.posted-request). Intentionally
 * excludes the raw eventId/eventType of the individual occurrence — only the
 * invoice identity drives this value.
 */
export function apInvoiceLiabilityIdempotencyIdentity(tenantId: string, invoiceId: string): string {
  return createHash('sha256').update(`ap.invoice.liability:${tenantId}:${invoiceId}`).digest('hex');
}

/** CE-07 Requirement C — deterministic identity for a manual vendor payment's AP-relief journal (S043A). One payment, one relief journal — never a second on retry. */
export function apPaymentReliefIdempotencyIdentity(tenantId: string, paymentId: string): string {
  return createHash('sha256').update(`ap.payment.relief:${tenantId}:${paymentId}`).digest('hex');
}
