// Local copy of coa-service's SourceEventEnvelope shape (services in this
// repo do not import each other's src across boundaries — see
// services/coa-service/src/domain/posting-engine/event-envelope.ts for the
// canonical definition this must stay byte-shape-compatible with).
export interface SourceEventEnvelope {
  eventId: string;
  tenantId: string;
  legalEntityId: string;
  eventType: string;
  eventSchemaVersion: string;
  occurredAt: string;
  publishedAt: string;
  sourceSystem: string;
  sourceEntityType: string;
  sourceEntityId: string;
  correlationId: string;
  causationId?: string | null;
  businessDate: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
}

export const SOURCE_SYSTEM = 'vehicle-accounting-service';

/** Must match coa-service's EVENT_TYPE_PATTERN exactly (validator.ts). */
export const EVENT_TYPE_PATTERN = /^[a-z0-9]+(\.[a-z0-9-]+)*\.v[0-9]+$/;

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

export class InvalidEventTypeError extends Error {
  readonly status = 400;
  readonly code = 'INVALID_EVENT_TYPE';
  constructor(eventType: string) {
    super(`Event type "${eventType}" does not match the canonical pattern ^[a-z0-9]+(\\.[a-z0-9-]+)*\\.v[0-9]+$`);
    this.name = 'InvalidEventTypeError';
  }
}

/** Builds a well-shaped SourceEventEnvelope for submission to coa-service's posting engine. */
export function buildEnvelope(input: BuildEnvelopeInput): SourceEventEnvelope {
  if (!EVENT_TYPE_PATTERN.test(input.eventType)) {
    throw new InvalidEventTypeError(input.eventType);
  }
  return {
    eventId: input.eventId,
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    eventType: input.eventType,
    eventSchemaVersion: input.eventSchemaVersion ?? '1',
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

/** The idempotency key coa-service's PostingService uses internally for every event it accepts (documented convention, this service never invents a second one). */
export function postingIdempotencyKey(tenantId: string, eventId: string): string {
  return `${tenantId}:${eventId}`;
}
