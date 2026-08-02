// The canonical SourceEventEnvelope this service builds for every call to
// coa-service's posting-engine (submit or simulate) and, in edited form, for
// posting-recovery-service's dead-letter intake. Field-for-field identical
// shape to services/coa-service/src/domain/posting-engine/event-envelope.ts's
// SourceEventEnvelope (the contract coa-service actually parses) plus the
// extra fields posting-recovery-service's intake route requires (see
// services/posting-recovery-service/src/domain/ch01-adapter.ts).

export interface SourceEventEnvelope {
  eventId: string;
  tenantId: string;
  legalEntityId: string;
  eventType: string;
  eventSchemaVersion: string;
  occurredAt: string; // ISO 8601
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

const EVENT_TYPE_RE = /^[a-z0-9]+(\.[a-z0-9-]+)*\.v[0-9]+$/;

export function assertValidEventType(eventType: string): void {
  if (!EVENT_TYPE_RE.test(eventType)) {
    throw new Error(`eventType "${eventType}" does not match the required pattern ^[a-z0-9]+(\\.[a-z0-9-]+)*\\.v[0-9]+$`);
  }
}

export interface BuildEnvelopeInput {
  eventId: string;
  tenantId: string;
  legalEntityId: string;
  eventType: string;
  eventSchemaVersion?: string;
  occurredAt: string;
  sourceEntityType: string;
  sourceEntityId: string;
  correlationId: string;
  causationId?: string | null;
  businessDate: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
}

export const SOURCE_SYSTEM = 'deal-accounting-service';

/** Builds a fully-shaped envelope with the fixed sourceSystem + a fresh publishedAt. */
export function buildEnvelope(input: BuildEnvelopeInput): SourceEventEnvelope {
  assertValidEventType(input.eventType);
  return {
    eventId: input.eventId,
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    eventType: input.eventType,
    eventSchemaVersion: input.eventSchemaVersion ?? 'v1',
    occurredAt: input.occurredAt,
    publishedAt: new Date().toISOString(),
    sourceSystem: SOURCE_SYSTEM,
    sourceEntityType: input.sourceEntityType,
    sourceEntityId: input.sourceEntityId,
    correlationId: input.correlationId,
    causationId: input.causationId ?? null,
    businessDate: input.businessDate,
    payload: input.payload,
    metadata: input.metadata ?? null,
  };
}
