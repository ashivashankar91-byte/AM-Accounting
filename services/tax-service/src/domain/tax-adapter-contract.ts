// CE-10 / S124 — Certified Tax Engine Adapter contract.
//
// This is a NEW cross-service adapter contract owned by tax-service. It is
// intentionally NOT a matrix-row/GL-posting envelope (that is CE-07's
// SourceEventEnvelope/MatrixRowEnvelope pattern, mirrored in
// src/domain/tax-attachment.ts for the OUTPUT this service hands back to a
// consuming transaction) — this file is the vendor-agnostic
// request/response shape between tax-service and whichever engine
// (NullEngine / TestFixtureEngine / a future certified vendor) answers "what
// tax applies".
//
// Tax calculation is owned by the external/configured engine: no rates, no
// nexus, no taxability rules are computed in this file or anywhere in this
// service.

export interface TaxCalculationRequestLine {
  lineId: string;
  itemClassCode: string;
  amount: string; // decimal string — never a float
  quantity: number;
  jurisdictionInputs: Record<string, string>; // ship-from/ship-to/situs fields, as the engine requires
  exemptionRef?: string | null;
}

export interface TaxCalculationRequest {
  tenantId: string;
  legalEntityId: string;
  storeId?: string | null;
  documentType: string;
  documentId: string;
  documentVersion: number;
  lines: TaxCalculationRequestLine[];
  currency: string;
  partyRef?: string | null;
  correlationId: string;
  /** documentId + version, per the epic's idempotency identity. */
  idempotencyKey: string;
  businessDate: string; // YYYY-MM-DD — configuration resolves effective at THIS date, never "today"
}

export type TaxCalculationStatus =
  | 'CALCULATED'
  | 'EXEMPT_APPLIED'
  | 'ENGINE_UNAVAILABLE'
  | 'ENGINE_REJECTED'
  | 'NOT_CONFIGURED';

/** Only these two statuses allow the consuming transaction to proceed to
 * posting with tax (S124 AC1/AC7 — the governing safety principle). */
export const STATUSES_ALLOWING_PROCEED: ReadonlySet<TaxCalculationStatus> = new Set(['CALCULATED', 'EXEMPT_APPLIED']);

export interface TaxCalculationResultLine {
  lineId: string;
  jurisdictionId: string;
  jurisdictionLevel?: string | null;
  taxType: string;
  /** Rate AS RETURNED by the engine — never computed locally. */
  rate?: string | null;
  taxableBase: string;
  taxAmount: string;
  engineResultLineId?: string | null;
}

export interface TaxCalculationResult {
  status: TaxCalculationStatus;
  engineType: string;
  engineVersion?: string | null;
  contentVersion?: string | null;
  engineResultId?: string | null;
  engineRejectReason?: string | null;
  currency: string;
  totalTaxableBase: string;
  totalTax: string;
  lines: TaxCalculationResultLine[];
  calculatedAt: string; // ISO 8601
}

export interface AdapterStatus {
  engineType: string;
  engineVersion?: string | null;
  contentVersion?: string | null;
  configured: boolean;
  lastSuccessfulCallAt?: string | null;
}

export interface ReferenceDataQuery {
  kind: 'JURISDICTION' | 'TAX_TYPE' | 'EXEMPTION_TYPE';
  search?: string;
}

export interface ReferenceDataEntry {
  ref: string;
  label: string;
  level?: string | null;
}

/**
 * Vendor-agnostic engine interface. Every implementation is deterministic
 * about failure: it either returns a TaxCalculationResult with one of the
 * five statuses, or throws EngineTransientError (retryable) — it never
 * fabricates a rate or estimates.
 */
export interface TaxEngineAdapter {
  readonly engineType: string;
  calculate(request: TaxCalculationRequest): Promise<TaxCalculationResult>;
  getStatus(): Promise<AdapterStatus>;
  browseReferenceData(query: ReferenceDataQuery): Promise<ReferenceDataEntry[]>;
  testConnection(): Promise<{ ok: boolean; detail?: string }>;
}

/** Thrown by an adapter implementation for a transient failure the retry
 * helper should retry (network blip, timeout) — never thrown for a durable
 * rejection (that becomes ENGINE_REJECTED in the result, not an exception). */
export class EngineTransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineTransientError';
  }
}
