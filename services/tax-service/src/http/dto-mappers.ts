// CE-10 HTTP-layer DTO mappers. The domain/application layer (see
// src/application/*) uses precise internal field names (jurisdictionRef,
// exemptionTypeCode, ratePercent, active, engineType, etc.) that mirror the
// Prisma schema exactly. The apps/web tax screens were built in parallel
// against a slightly different field-naming convention (jurisdictionRefId,
// exemptionType, rate, isActive, engine, etc.) taken from the CE10 Fable
// package's prose rather than this service's schema. Rather than rename the
// domain layer to match a UI naming guess (or the UI to match internal
// column names), this module is the single reconciliation seam: it accepts
// either input shape on writes and always emits both aliases on reads, so
// neither side needs to change again if a future consumer prefers one name
// over the other.
//
// This module also derives the two purely-presentational rules the backend
// domain layer intentionally does NOT compute: exemption certificate status
// (ACTIVE/EXPIRING/EXPIRED, derived from effectiveTo — REVOKED is the one
// genuine stored lifecycle value) and adapter-config isActive (derived from
// effective dates), plus a queueDepth rollup for the adapter status card.

const EXPIRING_WINDOW_DAYS = 30;

export function deriveExemptionStatus(row: { status?: string | null; effectiveTo: Date | string | null }): string {
  if (row.status === 'REVOKED') return 'REVOKED';
  if (!row.effectiveTo) return 'ACTIVE';
  const effectiveTo = new Date(row.effectiveTo);
  const now = new Date();
  if (effectiveTo.getTime() < now.getTime()) return 'EXPIRED';
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + EXPIRING_WINDOW_DAYS);
  if (effectiveTo.getTime() <= cutoff.getTime()) return 'EXPIRING';
  return 'ACTIVE';
}

export function normalizeJurisdictionInput(body: any, headerLegalEntityId?: string) {
  return {
    ...body,
    legalEntityId: body?.legalEntityId ?? headerLegalEntityId,
    jurisdictionRef: body?.jurisdictionRef ?? body?.jurisdictionRefId,
  };
}

export function toJurisdictionResponse(row: any) {
  if (!row) return row;
  return {
    ...row,
    jurisdictionRefId: row.jurisdictionRef,
    jurisdictionLabel: row.jurisdictionRef,
    isActive: row.active,
  };
}

export function normalizeExemptionInput(body: any, headerLegalEntityId?: string) {
  return {
    ...body,
    legalEntityId: body?.legalEntityId ?? headerLegalEntityId,
    partyRef: body?.partyRef ?? body?.partyId ?? body?.partyName,
    exemptionTypeCode: body?.exemptionTypeCode ?? body?.exemptionType,
    certificateDocumentMetadata: body?.certificateDocumentMetadata ?? body?.documentMetadata,
  };
}

export function toExemptionResponse(row: any) {
  if (!row) return row;
  return {
    ...row,
    partyId: row.partyRef,
    partyName: row.partyRef,
    jurisdictionScope: row.jurisdictionScope,
    exemptionType: row.exemptionTypeCode,
    documentMetadata: row.certificateDocumentMetadata,
    status: deriveExemptionStatus(row),
  };
}

export function normalizeFeeInput(body: any, headerLegalEntityId?: string) {
  return {
    ...body,
    legalEntityId: body?.legalEntityId ?? headerLegalEntityId,
    jurisdictionRef: body?.jurisdictionRef ?? body?.jurisdictionRefId,
    ratePercent: body?.ratePercent ?? body?.rate,
  };
}

export function toFeeResponse(row: any) {
  if (!row) return row;
  return {
    ...row,
    rate: row.ratePercent,
    isActive: row.active,
    jurisdictionRefId: row.jurisdictionRef,
    jurisdictionLabel: row.jurisdictionRef,
  };
}

export function normalizeAdapterConfigInput(body: any, headerLegalEntityId?: string) {
  return {
    ...body,
    legalEntityId: body?.legalEntityId ?? headerLegalEntityId,
    engineType: body?.engineType ?? body?.engine,
  };
}

export function toAdapterConfigResponse(row: any) {
  if (!row) return row;
  const now = Date.now();
  const from = new Date(row.effectiveFrom).getTime();
  const to = row.effectiveTo ? new Date(row.effectiveTo).getTime() : null;
  const isActive = from <= now && (to === null || to >= now);
  return { ...row, engine: row.engineType, isActive };
}

export function toAdapterStatusResponse(raw: any, queueDepth: number) {
  return {
    status: raw.configured ? 'CONFIGURED' : 'NOT_CONFIGURED',
    engine: raw.engineType ?? null,
    engineVersion: raw.engineVersion ?? null,
    contentVersion: raw.contentVersion ?? null,
    lastSuccessfulCallAt: raw.lastSuccessfulCallAt ?? null,
    effectiveConfigId: raw.effectiveConfigId ?? null,
    queueDepth,
  };
}

// Frontend TaxException shape wants `documentRef`/`parkedAt` and an
// `{ items, total }` envelope; the domain exception row carries
// `documentType`/`documentId`/`createdAt`. Map, never rename in the domain.
export function toExceptionResponse(row: any) {
  if (!row) return row;
  return {
    ...row,
    documentRef: `${row.documentType}:${row.documentId}`,
    parkedAt: row.createdAt,
  };
}

export function toExceptionListResponse(rows: any) {
  const items = Array.isArray(rows) ? rows : (rows?.items ?? []);
  const mapped = items.map(toExceptionResponse);
  return { items: mapped, total: mapped.length };
}

// Frontend TaxReconciliationResult wants `entityId`/`rows`/`jurisdiction`;
// the domain ThreeWayTieReport carries `legalEntityId`/`ties`/`jurisdictionId`.
export function toReconciliationResponse(report: any) {
  if (!report) return report;
  return {
    period: report.period,
    entityId: report.legalEntityId,
    glMovementSourceIsPending: report.glMovementSourceIsPending,
    rows: (report.ties ?? []).map((t: any) => ({
      jurisdiction: t.jurisdictionId,
      engineSum: t.engineSum,
      postedSum: t.postedSum,
      glMovement: t.glMovement,
      variance: t.variance,
      balanced: t.balanced,
    })),
  };
}

// Frontend result-search filters use documentRef/entityId/jurisdiction;
// the domain search() filter uses documentId/legalEntityId/jurisdictionId.
export function normalizeResultSearchFilters(query: any) {
  return {
    legalEntityId: query?.entityId,
    documentId: query?.documentRef,
    jurisdictionId: query?.jurisdiction,
    status: query?.status,
  };
}

export function toResultSummaryResponse(row: any) {
  if (!row) return row;
  return {
    id: row.id,
    documentRef: `${row.documentType}:${row.documentId}`,
    documentDate: row.businessDate,
    legalEntityId: row.legalEntityId,
    jurisdictions: Array.from(new Set((row.lines ?? []).map((l: any) => l.jurisdictionId))),
    status: row.status,
  };
}

export function toResultListResponse(rows: any[]) {
  const mapped = rows.map(toResultSummaryResponse);
  return { items: mapped, total: mapped.length };
}

export function toResultDetailResponse(row: any) {
  if (!row) return row;
  return {
    ...toResultSummaryResponse(row),
    requestSnapshot: row.requestSnapshot,
    lines: (row.lines ?? []).map((l: any) => ({
      lineId: l.lineId,
      jurisdictionId: l.jurisdictionId,
      jurisdictionLevel: l.jurisdictionLevel,
      taxType: l.taxType,
      rateAsReturned: l.rate,
      taxableBase: l.taxableBase,
      taxAmount: l.taxAmount,
      engineResultId: l.engineResultLineId,
    })),
    engineVersion: row.engineVersion,
    contentVersion: row.contentVersion,
    calculatedAt: row.calculatedAt,
    // Posted-journal linkage is CE-07's governed posting boundary — not yet
    // wired (PENDING_UPSTREAM_TECHNICAL_RECONCILIATION); never invented here.
    linkedJournalId: null,
  };
}
