// CE-12 — canonical SourceEventEnvelope shape/builder for every financial
// event this service submits to coa-service's posting engine. Mirrors
// services/coa-service/src/domain/posting-engine/event-envelope.ts's
// SourceEventEnvelope contract exactly (field-for-field), plus the
// PostingFailureEnvelope shape posting-recovery-service's intake expects
// (services/posting-recovery-service/src/domain/ch01-adapter.ts).
import { randomUUID } from 'crypto';

export const EVENT_TYPE_PATTERN = /^[a-z0-9]+(\.[a-z0-9-]+)*\.v[0-9]+$/;

export interface SourceEventEnvelope {
  eventId: string;
  tenantId: string;
  eventType: string;
  eventSchemaVersion: string;
  occurredAt: string;
  publishedAt: string;
  sourceSystem: 'floorplan-service';
  sourceEntityType: string;
  sourceEntityId: string;
  correlationId: string;
  causationId?: string | null;
  businessDate: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
}

export interface BuildEnvelopeInput {
  eventType: string;
  eventSchemaVersion?: string;
  sourceEntityType: string;
  sourceEntityId: string;
  correlationId: string;
  causationId?: string | null;
  businessDate: string;
  occurredAt?: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
  /** Deterministic idempotency seed — when provided, eventId is derived
   * deterministically instead of randomly so retried callers (e.g. a
   * duplicate HTTP request) reliably reconstruct the SAME eventId, letting
   * coa-service's own (tenantId, eventId) dedup collapse the retry to a
   * no-op instead of creating a second execution row. */
  deterministicEventId?: string;
}

export function buildEnvelope(tenantId: string, input: BuildEnvelopeInput): SourceEventEnvelope {
  if (!EVENT_TYPE_PATTERN.test(input.eventType)) {
    throw new Error(`eventType "${input.eventType}" does not match ^[a-z0-9]+(\\.[a-z0-9-]+)*\\.v[0-9]+$`);
  }
  const now = new Date().toISOString();
  return {
    eventId: input.deterministicEventId ?? randomUUID(),
    tenantId,
    eventType: input.eventType,
    eventSchemaVersion: input.eventSchemaVersion ?? '1.0',
    occurredAt: input.occurredAt ?? now,
    publishedAt: now,
    sourceSystem: 'floorplan-service',
    sourceEntityType: input.sourceEntityType,
    sourceEntityId: input.sourceEntityId,
    correlationId: input.correlationId,
    causationId: input.causationId ?? null,
    businessDate: input.businessDate,
    payload: input.payload,
    metadata: input.metadata ?? null,
  };
}
