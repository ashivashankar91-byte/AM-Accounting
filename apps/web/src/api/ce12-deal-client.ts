// CE-12 Workstream D — deal-accounting-service client (S084-S088 UI, plus
// the gap-closure-pass wholesale/CIT list, deal lineage, and due-bill/
// we-owe endpoints).
//
// Verified directly against services/deal-accounting-service/src/http/
// routes.ts and services/audit-service/src/http/routes.ts before writing a
// single path here — no guessed endpoints. Every mutating call requires the
// exact fields the backend's zod schemas require (reason strings, real
// idempotency keys). This service NEVER computes a dollar figure — every
// amount rendered by the pages that use this client comes straight through
// from one of these responses.
//
// Gap-closure pass: GET /review/queue now performs the dealNumber/dealType/
// vin/stockNumber join server-side (DealReviewCase below carries those
// fields directly) — the previous platform gap requiring pages to
// cross-reference listDeals() locally by id no longer exists.
import { apiFetch } from './client';

const BASE = '/api/v1/deal-accounting';

export type DealType = 'RETAIL' | 'LEASE' | 'WHOLESALE' | 'DEALER_TRADE';

export interface DealRecapProductLine {
  productCode: string;
  providerRef: string;
  customerPriceAmount: string;
  providerCostAmount: string;
}

export interface DealRecapPayload {
  dealNumber: string;
  recapVersion: number;
  dealType: DealType;
  vin?: string | null;
  stockNumber: string;
  legalEntityId: string;
  storeId: string;
  businessDate: string;
  saleAmount?: string | null;
  dealerTradeAmount?: string | null;
  wholesaleAmount?: string | null;
  leaseCapitalizedCostAmount?: string | null;
  leaseResidualAmount?: string | null;
  unitCostAmount: string;
  hasTradeIn: boolean;
  tradeVin?: string | null;
  tradeAllowanceAmount?: string | null;
  tradeAcvAmount?: string | null;
  tradePayoffAmount?: string | null;
  tradeLienholderRef?: string | null;
  financedAmount?: string | null;
  reserveIncomeAmount?: string | null;
  reserveTermsRef?: string | null;
  products?: DealRecapProductLine[];
  feesAmount?: string | null;
  taxResultId?: string | null;
  rebateReceivableAmount?: string | null;
  downPaymentRef?: string | null;
  commissionBasisSnapshot?: Record<string, unknown> | null;
}

export interface Deal {
  id: string;
  tenantId: string;
  dealNumber: string;
  dealType: DealType;
  vin: string | null;
  stockNumber: string | null;
  legalEntityId: string;
  storeId: string;
  status: string; // DESKED | FINALIZED | POSTED | UNWOUND | RECONTRACTED
  currentRecapVersion: number;
  finalizedByActor: string | null;
  fundedFlag: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DealRecap {
  id: string;
  tenantId: string;
  dealId: string;
  recapVersion: number;
  dealType: DealType;
  payload: DealRecapPayload;
  structureHash: string;
  taxResultId: string | null;
  taxAmount: string | null;
  hasTradeIn: boolean;
  tradeAllowanceAmount: string | null;
  tradeAcvAmount: string | null;
  rebateReceivableAmount: string | null;
  createdAt: string;
  createdBy: string;
}

export interface DealReviewCase {
  id: string;
  tenantId: string;
  dealId: string;
  recapVersion: number;
  status: 'PENDING_REVIEW' | 'HELD' | 'RELEASED' | 'RETURNED';
  autoPosted: boolean;
  heldReason: string | null;
  heldBy: string | null;
  heldAt: string | null;
  returnedReason: string | null;
  returnedBy: string | null;
  returnedAt: string | null;
  releasedBy: string | null;
  releasedAt: string | null;
  previewBlueprintHash: string | null;
  createdAt: string;
  // Gap-closure pass: GET /review/queue now joins these directly server-side.
  dealNumber: string | null;
  dealType: DealType | null;
  vin: string | null;
  stockNumber: string | null;
  legalEntityId: string | null;
  storeId: string | null;
}

export interface DealPostingRecord {
  id: string;
  tenantId: string;
  dealId: string;
  recapVersion: number | null;
  segmentType: 'CORE' | 'PRODUCT' | 'RECONTRACT_DELTA' | 'REVERSAL' | 'CIT_SHORT_FUND_FEE' | 'PAYOFF_ISSUANCE' | 'PAYOFF_VARIANCE' | 'WHOLESALE_DISPOSITION' | 'ARBITRATION';
  productIndex: number | null;
  eventId: string;
  eventType: string;
  correlationId: string;
  coaStatus: 'POSTED' | 'NO_RULE_MATCH' | 'REJECTED' | 'FAILED';
  coaExecutionId: string | null;
  rulePackVersionId: string | null;
  ruleId: string | null;
  journalEntryId: string | null;
  journalNumber: string | null;
  blueprintHash: string | null;
  failureReason: string | null;
  reversalOfPostingRecordId: string | null;
  reversalJournalEntryId: string | null;
  reversalJournalNumber: string | null;
  reversedAt: string | null;
  amountsJson: unknown;
  createdAt: string;
  createdBy: string;
}

export interface DealOpenItem {
  id: string;
  tenantId: string;
  dealId: string;
  itemType: 'CIT' | 'RESERVE' | 'PRODUCT_REMIT' | 'PAYOFF' | 'WHOLESALE_AR';
  itemNumber: string;
  productIndex: number | null;
  originalAmount: string;
  appliedAmount: string;
  remainingBalance: string;
  status: 'OPEN' | 'CLOSED';
  openedByPostingRecordId: string | null;
  createdAt: string;
  closedAt: string | null;
  ageDays?: number;
}

export interface DealDetail {
  deal: Deal;
  recaps: DealRecap[];
  postingRecords: DealPostingRecord[];
  reviewCases: DealReviewCase[];
  openItems: DealOpenItem[];
}

export interface BlueprintLine {
  accountNumber: string;
  storeId: string;
  deptCode?: string | null;
  dr: number;
  cr: number;
  memo?: string | null;
  controlNumber?: string | null;
  applyNumber?: string | null;
}

export interface PreviewSegment {
  tag: string;
  eventType: string;
  status: 'BLUEPRINT_GENERATED' | 'NO_RULE_MATCH' | 'REJECTED';
  blueprintHash?: string | null;
  lines?: BlueprintLine[];
  failureReason?: string | null;
}

export interface PreviewResult {
  segments: PreviewSegment[];
  combinedBlueprintHash: string;
}

export interface SegmentOutcome {
  tag: string;
  eventType: string;
  eventId: string;
  coaStatus: 'POSTED' | 'NO_RULE_MATCH' | 'REJECTED' | 'FAILED';
  journalEntryId?: string | null;
  journalNumber?: string | null;
  postingRecordId: string;
  deadLetterFiled: boolean;
}

export interface ReleaseResult {
  reviewCase: DealReviewCase;
  postResult: { outcomes: SegmentOutcome[]; allPosted: boolean };
}

export interface CitFundingReceipt {
  id: string;
  tenantId: string;
  dealId: string;
  amount: string;
  lenderRef: string;
  receivedAt: string;
  citOriginalAmount: string;
  shortfallAmount: string;
  status: 'MATCHED' | 'SHORT_FUNDED_PENDING_DISPOSITION' | 'SHORT_FUNDED_FEE_WITHHELD' | 'SHORT_FUNDED_RETURNED_TO_BILLER';
  dispositionType: 'FEE_WITHHELD' | 'CONTRACT_ISSUE' | null;
  dispositionReason: string | null;
  dispositionedBy: string | null;
  dispositionedAt: string | null;
  feePostingRecordId: string | null;
  idempotencyKey: string;
  createdAt: string;
  createdBy: string;
}

export interface PayoffIssuance {
  id: string;
  tenantId: string;
  dealId: string;
  recapPayoffAmount: string;
  actualAmount: string;
  varianceAmount: string;
  varianceDisposition: 'ADDITIONAL_PAYMENT' | 'REFUND_RECEIVABLE' | 'NONE' | null;
  varianceReason: string | null;
  postingRecordId: string | null;
  idempotencyKey: string;
  issuedAt: string;
  issuedBy: string;
}

export interface DealUnwind {
  id: string;
  tenantId: string;
  dealId: string;
  recapVersion: number;
  status: 'COMPLETED' | 'REFUSED';
  reason: string;
  refusalCode: string | null;
  refusalDetail: string | null;
  reversalPostingRecordIds: string[] | null;
  idempotencyKey: string;
  executedAt: string;
  executedBy: string;
}

export interface DealRecontract {
  id: string;
  tenantId: string;
  dealId: string;
  fromRecapVersion: number;
  toRecapVersion: number;
  mode: 'DELTA' | 'REVERSE_REPOST';
  structureHashFrom: string;
  structureHashTo: string;
  deltaPostingRecordId: string | null;
  reversalPostingRecordId: string | null;
  repostPostingRecordId: string | null;
  idempotencyKey: string;
  createdAt: string;
  createdBy: string;
}

export interface DealLineage {
  deal: { dealNumber: string; dealType: DealType; status: string; currentRecapVersion: number };
  chain: Array<{
    id: string; recapVersion: number | null; segmentType: string; eventType: string; eventId: string;
    coaStatus: 'POSTED' | 'NO_RULE_MATCH' | 'REJECTED' | 'FAILED';
    journalEntryId: string | null; journalNumber: string | null;
    reversalJournalEntryId: string | null; reversalJournalNumber: string | null; reversedAt: string | null;
    createdAt: string;
  }>;
  recontracts: Array<{
    id: string; fromRecapVersion: number; toRecapVersion: number; mode: 'DELTA' | 'REVERSE_REPOST';
    deltaPostingRecordId: string | null; reversalPostingRecordId: string | null; repostPostingRecordId: string | null;
    createdAt: string;
  }>;
  unwinds: Array<{
    id: string; recapVersion: number; status: 'COMPLETED' | 'REFUSED'; reason: string;
    refusalCode: string | null; reversalPostingRecordIds: string[] | null; executedAt: string;
  }>;
}

export interface DueBill {
  id: string;
  tenantId: string;
  dealId: string;
  itemDescription: string;
  amount: string;
  reason: string;
  status: 'OPEN' | 'FULFILLED';
  postingRecordId: string | null;
  eventId: string;
  coaStatus: 'POSTED' | 'NO_RULE_MATCH' | 'REJECTED' | 'FAILED';
  journalEntryId: string | null;
  journalNumber: string | null;
  fulfilledAt: string | null;
  fulfilledBy: string | null;
  idempotencyKey: string;
  createdAt: string;
  createdBy: string;
}

export interface AuditEvent {
  id: string;
  entityType?: string;
  entityId?: string;
  docType?: string;
  docId?: string;
  action: string;
  previousState?: unknown;
  newState?: unknown;
  before?: unknown;
  after?: unknown;
  actorName?: string;
  actor?: string;
  occurredAt?: string;
  createdAt?: string;
  reason?: string;
}

export const ce12DealApi = {
  // ── S084 — deals ──────────────────────────────────────────────────────
  listDeals: () => apiFetch<{ items: Deal[] }>(`${BASE}/deals`),
  getDeal: (dealNumber: string) => apiFetch<DealDetail>(`${BASE}/deals/${encodeURIComponent(dealNumber)}`),

  // ── S085 — biller review workbench ───────────────────────────────────
  getReviewQueue: (status?: string) =>
    apiFetch<{ items: DealReviewCase[] }>(`${BASE}/review/queue${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  getPreview: (dealNumber: string, version: number) =>
    apiFetch<PreviewResult>(`${BASE}/deals/${encodeURIComponent(dealNumber)}/recap/${version}/preview`),
  holdReview: (dealNumber: string, version: number, reason: string) =>
    apiFetch<DealReviewCase>(`${BASE}/deals/${encodeURIComponent(dealNumber)}/recap/${version}/hold`, {
      method: 'POST', body: JSON.stringify({ reason }),
    }),
  returnReview: (dealNumber: string, version: number, reason: string) =>
    apiFetch<DealReviewCase>(`${BASE}/deals/${encodeURIComponent(dealNumber)}/recap/${version}/return`, {
      method: 'POST', body: JSON.stringify({ reason }),
    }),
  releaseReview: (dealNumber: string, version: number) =>
    apiFetch<ReleaseResult>(`${BASE}/deals/${encodeURIComponent(dealNumber)}/recap/${version}/release`, {
      method: 'POST', body: JSON.stringify({}),
    }),

  // ── S086 — unwind ─────────────────────────────────────────────────────
  unwindDeal: (dealNumber: string, reason: string, recapVersion?: number) =>
    apiFetch<DealUnwind>(`${BASE}/deals/${encodeURIComponent(dealNumber)}/unwind`, {
      method: 'POST', body: JSON.stringify({ reason, ...(recapVersion != null ? { recapVersion } : {}) }),
    }),

  // ── S087 — recontract ─────────────────────────────────────────────────
  recontractDeal: (dealNumber: string, newRecap: DealRecapPayload) =>
    apiFetch<DealRecontract>(`${BASE}/deals/${encodeURIComponent(dealNumber)}/recontract`, {
      method: 'POST', body: JSON.stringify({ newRecap }),
    }),

  // ── S088 — CIT funding match ──────────────────────────────────────────
  recordCitFunding: (data: { dealNumber: string; amount: string; lenderRef: string; receivedAt: string; idempotencyKey: string }) =>
    apiFetch<CitFundingReceipt>(`${BASE}/cit/funding-receipts`, { method: 'POST', body: JSON.stringify(data) }),
  dispositionCitShortfall: (id: string, dispositionType: 'FEE_WITHHELD' | 'CONTRACT_ISSUE', reason: string) =>
    apiFetch<CitFundingReceipt>(`${BASE}/cit/funding-receipts/${encodeURIComponent(id)}/disposition`, {
      method: 'POST', body: JSON.stringify({ dispositionType, reason }),
    }),
  getCitAging: (thresholdDays?: number) =>
    apiFetch<{ items: DealOpenItem[] }>(`${BASE}/cit/aging${thresholdDays != null ? `?thresholdDays=${thresholdDays}` : ''}`),

  // ── S089 — payoff (read-only cross-link from Deal Detail) ──────────────
  getPayoff: (dealNumber: string) => apiFetch<{ issuance: PayoffIssuance | null }>(`${BASE}/payoffs/${encodeURIComponent(dealNumber)}`),

  // ── Gap-closure — CIT funding receipts list + sold-not-funded aging ────
  listCitFundingReceipts: (params?: { dealNumber?: string; status?: string; page?: number; pageSize?: number }) => {
    const qs = new URLSearchParams();
    if (params?.dealNumber) qs.set('dealNumber', params.dealNumber);
    if (params?.status) qs.set('status', params.status);
    if (params?.page != null) qs.set('page', String(params.page));
    if (params?.pageSize != null) qs.set('pageSize', String(params.pageSize));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<{ items: CitFundingReceipt[]; total: number; page: number; pageSize: number }>(`${BASE}/cit/funding-receipts${suffix}`);
  },
  getSoldNotFunded: (thresholdDays?: number) =>
    apiFetch<{ items: Array<DealOpenItem & { deal: Deal }> }>(`${BASE}/cit/sold-not-funded${thresholdDays != null ? `?thresholdDays=${thresholdDays}` : ''}`).then((r) => r.items),

  // ── Gap-closure — full deal lineage (posting/recontract/unwind chain) ──
  getDealLineage: (dealNumber: string) => apiFetch<DealLineage>(`${BASE}/deals/${encodeURIComponent(dealNumber)}/lineage`),

  // ── Gap-closure — due-bill / we-owe ceremony (new, no prior UI) ────────
  createDueBill: (data: { dealNumber: string; itemDescription: string; amount: string; reason: string; idempotencyKey: string }) =>
    apiFetch<DueBill>(`${BASE}/due-bills`, { method: 'POST', body: JSON.stringify(data) }),
  listDueBills: (params?: { dealNumber?: string; status?: string; page?: number; pageSize?: number }) => {
    const qs = new URLSearchParams();
    if (params?.dealNumber) qs.set('dealNumber', params.dealNumber);
    if (params?.status) qs.set('status', params.status);
    if (params?.page != null) qs.set('page', String(params.page));
    if (params?.pageSize != null) qs.set('pageSize', String(params.pageSize));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<{ items: DueBill[]; total: number; page: number; pageSize: number }>(`${BASE}/due-bills${suffix}`);
  },
  getDueBill: (id: string) => apiFetch<DueBill>(`${BASE}/due-bills/${encodeURIComponent(id)}`),
  fulfillDueBill: (id: string) => apiFetch<DueBill>(`${BASE}/due-bills/${encodeURIComponent(id)}/fulfill`, { method: 'POST' }),

  // ── Audit trail (real S007 audit-service, drained from this service's
  // own deal_audit_reference outbox — docId is the Deal.id UUID, not the
  // human dealNumber, for docType 'DEAL'). ─────────────────────────────
  getAuditTrail: (docType: string, docId: string) =>
    apiFetch<{ docType: string; docId: string; events: AuditEvent[] }>(`/api/v1/audit/documents/${encodeURIComponent(docType)}/${encodeURIComponent(docId)}`),
};
