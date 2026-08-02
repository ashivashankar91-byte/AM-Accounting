// CE-07 / S023 — Canonical SourceEventEnvelope for AP, AR and Cash.
//
// Approved by D-S023-06 (docs/accounting-modernization/S023_EVENT_CONTRACT.md,
// docs/accounting-modernization/S023_DECISION_REGISTER.md). This is the ONE
// envelope shape all S023 producers (S039 vendor invoice, S043A manual
// vendor payment, S052 cash receipt, and any future AR producer) build
// before submitting to the S019/S020 posting engine — replacing the three
// incompatible event/outbox shapes that previously coexisted (coa-service's
// engine-internal SourceEventEnvelope, cash-service's generic
// cashOutboxEvent, apar-service's generic outboxEvent helper).
//
// This module is pure (no I/O, no current-time/random calls) — strict
// runtime validation only. `businessDate` is REQUIRED and is never defaulted
// to the system clock here or anywhere downstream; a producer that cannot
// supply it must fail before calling this validator, not rely on it to
// silently fill one in.

export interface AccountingAmount {
  /** Decimal string or number, dollars — never a pre-rounded float assumption; callers pass the source system's own decimal value. */
  amount: number | string;
  currency: string;
  /** e.g. NET, TAX, GROSS — per D-18's tax boundary (S023 maps received tax lines only, never calculates them). */
  kind: string;
}

export interface AccountingReference {
  /** e.g. 'documentNumber', 'scheduleNumber', 'controlNumber', 'applyNumber', 'referenceNumber' — per the resolved UQ-18 schedule-key model (D-S023-16/17). */
  kind: string;
  value: string;
}

export interface CanonicalSourceEventEnvelope {
  tenantId: string;
  legalEntityId: string;
  eventId: string;
  schemaVersion: string;
  sourceSystem: string;
  sourceEntityType: string;
  sourceEntityId: string;
  /** ISO-8601 date (YYYY-MM-DD). The approved business/document date — see D-S023-06/13. Never derived from the system clock. */
  businessDate: string;
  correlationId: string;
  causationId?: string | null;
  /**
   * Deterministic per source doc + logical financial fact (NOT per raw
   * occurrence). Two different eventIds/eventTypes representing the SAME
   * underlying financial fact (e.g. ap.invoice.accepted and
   * ap.invoice.posted-request for the same invoice) MUST compute the same
   * idempotencyIdentity — this is what the engine's own tenantId+eventId
   * idempotency check dedups on when this value is used as the submitted
   * eventId (see the D-S023-06 amendment in S023_DECISION_REGISTER.md).
   */
  idempotencyIdentity: string;
  accountingAmounts: AccountingAmount[];
  accountingReferences: AccountingReference[];
  eventType: string;
  storeId?: string | null;
  departmentCode?: string | null;
  payload: Record<string, unknown>;
}

export const REQUIRED_CANONICAL_ENVELOPE_FIELDS = [
  'tenantId', 'legalEntityId', 'eventId', 'schemaVersion', 'sourceSystem',
  'sourceEntityType', 'sourceEntityId', 'businessDate', 'correlationId',
  'idempotencyIdentity', 'eventType', 'payload',
] as const;

export class CanonicalEnvelopeShapeError extends Error {
  readonly code = 'ENVELOPE_CONTRACT_VIOLATION';
  constructor(readonly missingFields: string[], readonly detail?: string) {
    super(
      missingFields.length > 0
        ? `Canonical event envelope missing required field(s): ${missingFields.join(', ')}`
        : (detail ?? 'Canonical event envelope failed validation.'),
    );
    this.name = 'CanonicalEnvelopeShapeError';
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Strict runtime validation — deterministic rejection of malformed or
 * incomplete accounting events (Requirement A). Never derives businessDate
 * from `new Date()`; a missing/invalid businessDate is a hard rejection.
 */
export function assertCanonicalEnvelopeShape(candidate: unknown): CanonicalSourceEventEnvelope {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new CanonicalEnvelopeShapeError(['(entire envelope)']);
  }
  const obj = candidate as Record<string, unknown>;

  const missing = REQUIRED_CANONICAL_ENVELOPE_FIELDS.filter((f) => obj[f] === undefined || obj[f] === null || obj[f] === '');
  if (missing.length > 0) throw new CanonicalEnvelopeShapeError(missing);

  if (typeof obj['payload'] !== 'object' || Array.isArray(obj['payload'])) {
    throw new CanonicalEnvelopeShapeError([], 'payload must be an object.');
  }
  if (typeof obj['businessDate'] !== 'string' || !ISO_DATE.test(obj['businessDate'])) {
    throw new CanonicalEnvelopeShapeError([], `businessDate must be an ISO-8601 date (YYYY-MM-DD); received: ${String(obj['businessDate'])}`);
  }

  const accountingAmounts = Array.isArray(obj['accountingAmounts']) ? (obj['accountingAmounts'] as unknown[]) : [];
  for (const [i, a] of accountingAmounts.entries()) {
    if (typeof a !== 'object' || a === null) throw new CanonicalEnvelopeShapeError([], `accountingAmounts[${i}] must be an object.`);
    const amt = a as Record<string, unknown>;
    if (amt['amount'] === undefined || amt['amount'] === null) throw new CanonicalEnvelopeShapeError([], `accountingAmounts[${i}].amount is required.`);
    if (!amt['currency']) throw new CanonicalEnvelopeShapeError([], `accountingAmounts[${i}].currency is required.`);
    if (!amt['kind']) throw new CanonicalEnvelopeShapeError([], `accountingAmounts[${i}].kind is required.`);
  }

  const accountingReferences = Array.isArray(obj['accountingReferences']) ? (obj['accountingReferences'] as unknown[]) : [];
  for (const [i, r] of accountingReferences.entries()) {
    if (typeof r !== 'object' || r === null) throw new CanonicalEnvelopeShapeError([], `accountingReferences[${i}] must be an object.`);
    const ref = r as Record<string, unknown>;
    if (!ref['kind']) throw new CanonicalEnvelopeShapeError([], `accountingReferences[${i}].kind is required.`);
    if (!ref['value']) throw new CanonicalEnvelopeShapeError([], `accountingReferences[${i}].value is required.`);
  }

  return {
    tenantId: String(obj['tenantId']),
    legalEntityId: String(obj['legalEntityId']),
    eventId: String(obj['eventId']),
    schemaVersion: String(obj['schemaVersion']),
    sourceSystem: String(obj['sourceSystem']),
    sourceEntityType: String(obj['sourceEntityType']),
    sourceEntityId: String(obj['sourceEntityId']),
    businessDate: String(obj['businessDate']),
    correlationId: String(obj['correlationId']),
    causationId: obj['causationId'] != null ? String(obj['causationId']) : null,
    idempotencyIdentity: String(obj['idempotencyIdentity']),
    accountingAmounts: accountingAmounts as AccountingAmount[],
    accountingReferences: accountingReferences as AccountingReference[],
    eventType: String(obj['eventType']),
    storeId: obj['storeId'] != null ? String(obj['storeId']) : null,
    departmentCode: obj['departmentCode'] != null ? String(obj['departmentCode']) : null,
    payload: obj['payload'] as Record<string, unknown>,
  };
}
