// S019/S020 — Canonical source-event envelope. Pure types + hashing; no I/O.
//
// The envelope carries BUSINESS FACTS (what happened), never GL write
// instructions — the rule pack, not the event, decides how those facts
// become debits/credits. Idempotency identity is tenantId+eventId (BR
// S020-6): same tenantId+eventId with the same canonical hash is an exact
// duplicate (no-op); a different hash under the same identity is an
// EVENT_IDENTITY_CONFLICT.

import crypto from 'crypto';
import { canonicalStringify } from './strict-json';

export interface SourceEventEnvelope {
  eventId: string;
  tenantId: string;
  // CE-07 legal-entity isolation defect (found live in CE-11 certification):
  // candidate rule-pack selection in submitEvent/simulateEvent previously
  // filtered by tenantId + eventType only, never by legal entity, so a
  // second entity in the same tenant with an ACTIVE pack for the same event
  // type could be silently selected for the wrong entity's event. The
  // envelope must carry the authoritative legal entity itself — never
  // inferred from the rule pack that happens to match. Matches the naming
  // apar-service's own envelope builders (ap-invoice-envelope.ts,
  // ap-payment-envelope.ts) already use.
  legalEntityId: string;
  eventType: string;
  eventSchemaVersion: string;
  occurredAt: string; // ISO 8601 — set by the source system, not resolved here
  publishedAt: string; // ISO 8601
  sourceSystem: string;
  sourceEntityType: string;
  sourceEntityId: string;
  correlationId: string;
  causationId?: string | null;
  businessDate: string; // YYYY-MM-DD
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
}

export const REQUIRED_ENVELOPE_FIELDS = [
  'eventId', 'tenantId', 'legalEntityId', 'eventType', 'eventSchemaVersion', 'occurredAt', 'publishedAt',
  'sourceSystem', 'sourceEntityType', 'sourceEntityId', 'correlationId', 'businessDate', 'payload',
] as const;

export class EnvelopeShapeError extends Error {
  constructor(readonly missingFields: string[]) {
    super(`Event envelope missing required field(s): ${missingFields.join(', ')}`);
    this.name = 'EnvelopeShapeError';
  }
}

/** Structural validation only — does not check tenant authorization (caller's job). */
export function assertEnvelopeShape(candidate: unknown): SourceEventEnvelope {
  if (typeof candidate !== 'object' || candidate === null) {
    throw new EnvelopeShapeError(['(entire envelope)']);
  }
  const obj = candidate as Record<string, unknown>;
  const missing = REQUIRED_ENVELOPE_FIELDS.filter((f) => obj[f] === undefined || obj[f] === null || obj[f] === '');
  if (missing.length > 0) throw new EnvelopeShapeError(missing);
  if (typeof obj['payload'] !== 'object' || Array.isArray(obj['payload'])) {
    throw new EnvelopeShapeError(['payload (must be an object)']);
  }
  return {
    eventId: String(obj['eventId']),
    tenantId: String(obj['tenantId']),
    legalEntityId: String(obj['legalEntityId']),
    eventType: String(obj['eventType']),
    eventSchemaVersion: String(obj['eventSchemaVersion']),
    occurredAt: String(obj['occurredAt']),
    publishedAt: String(obj['publishedAt']),
    sourceSystem: String(obj['sourceSystem']),
    sourceEntityType: String(obj['sourceEntityType']),
    sourceEntityId: String(obj['sourceEntityId']),
    correlationId: String(obj['correlationId']),
    causationId: obj['causationId'] != null ? String(obj['causationId']) : null,
    businessDate: String(obj['businessDate']),
    payload: obj['payload'] as Record<string, unknown>,
    metadata: (obj['metadata'] as Record<string, unknown> | undefined) ?? null,
  };
}

/**
 * Deterministic canonical hash of the parts of the envelope that define its
 * business-fact IDENTITY. `publishedAt` is deliberately excluded — the same
 * logical event re-published (e.g. after a broker redelivery) must hash
 * identically, not look like a content change.
 */
export function hashEnvelope(envelope: SourceEventEnvelope): string {
  const identityView = {
    eventId: envelope.eventId,
    tenantId: envelope.tenantId,
    legalEntityId: envelope.legalEntityId,
    eventType: envelope.eventType,
    eventSchemaVersion: envelope.eventSchemaVersion,
    occurredAt: envelope.occurredAt,
    sourceSystem: envelope.sourceSystem,
    sourceEntityType: envelope.sourceEntityType,
    sourceEntityId: envelope.sourceEntityId,
    correlationId: envelope.correlationId,
    causationId: envelope.causationId ?? null,
    businessDate: envelope.businessDate,
    payload: envelope.payload,
    metadata: envelope.metadata ?? null,
  };
  return crypto.createHash('sha256').update(canonicalStringify(identityView)).digest('hex');
}

/** Read-only path resolution into the envelope for condition/amount evaluation. Dot-separated, no wildcards. */
export function resolveEnvelopePath(envelope: SourceEventEnvelope, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = envelope;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}
