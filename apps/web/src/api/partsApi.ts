// CE-11 / Workstream C+D — Parts accounting API client.
// All calls go through the unified apiFetch helper (auth/tenant headers,
// 401 self-heal) at the parts-accounting-service base path. Real routes
// only — see services/parts-accounting-service/src/http/routes.ts.
import { apiFetch } from './client';

const BASE = '/api/v1/parts-accounting';
const qs = (params?: Record<string, string | undefined>) => {
  if (!params) return '';
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) q.set(k, v); });
  const s = q.toString();
  return s ? `?${s}` : '';
};

export interface PartsValuationConfig {
  id: string; tenantId: string; legalEntityId: string; method: 'REPLACEMENT' | 'AVERAGE';
  landedCostRules: unknown; effectiveFrom: string; ceremonyApprovedBy: string; createdAt: string;
}

export interface PartsMovement {
  id: string; tenantId: string; legalEntityId: string; storeId: string; partNumber: string;
  movementFamily: string; movementId: string; quantity: string; unitValue: string; totalValue: string;
  sourceDocType: string; sourceDocId: string; sourceEventId: string; correlationId: string; businessDate: string;
  status: string; journalEntryId: string | null; journalNumber: string | null; negativeOnHandFlag: boolean; createdAt: string;
}

export interface PartsReconciliationRun {
  id: string; tenantId: string; legalEntityId: string; storeId: string | null; asOfDate: string;
  perpetualTotal: string; glControlTotal: string; varianceAmount: string; status: 'BALANCED' | 'VARIANCE';
  triggeredBy: string; runBy: string | null; createdAt: string;
  varianceLines?: Array<{ id: string; partNumber: string; movementId: string | null; explainedAmount: string; unexplainedAmount: string }>;
}

export const partsApi = {
  // S072 — Valuation config
  createValuationConfig: (data: { legalEntityId: string; method: 'REPLACEMENT' | 'AVERAGE'; landedCostRules?: unknown; effectiveFrom: string; ceremonyApprovedBy: string; revaluationPreviewId?: string }) =>
    apiFetch<PartsValuationConfig>(`${BASE}/valuation-config`, { method: 'POST', body: JSON.stringify(data) }),
  getActiveValuationConfig: (legalEntityId: string, asOfDate?: string) =>
    apiFetch<PartsValuationConfig | null>(`${BASE}/valuation-config/active${qs({ legalEntityId, asOfDate })}`),
  getValuationConfigHistory: (legalEntityId: string) =>
    apiFetch<PartsValuationConfig[]>(`${BASE}/valuation-config/history${qs({ legalEntityId })}`),

  // S066 — Movements & reconciliation
  postMovement: (data: Record<string, unknown>) =>
    apiFetch<{ movement: PartsMovement; idempotent: boolean; postingStatus: string; journalEntryId?: string | null }>(`${BASE}/movements`, { method: 'POST', body: JSON.stringify(data) }),
  listMovements: (params: { legalEntityId?: string; storeId?: string; partNumber?: string; movementFamily?: string; negativeOnHandFlag?: string; businessDateFrom?: string; businessDateTo?: string }) =>
    apiFetch<{ items: PartsMovement[] }>(`${BASE}/movements${qs(params)}`),
  // No glControlTotal — the server resolves the tenant-configured
  // inventory-control account and asks coa-service for its real ending
  // balance; the browser never supplies or computes an authoritative figure.
  runReconciliation: (data: { legalEntityId: string; storeId?: string; asOfDate: string; triggeredBy?: string }) =>
    apiFetch<PartsReconciliationRun>(`${BASE}/reconciliation/run`, { method: 'POST', body: JSON.stringify(data) }),
  listReconciliationRuns: (legalEntityId: string, storeId?: string) =>
    apiFetch<{ items: PartsReconciliationRun[] }>(`${BASE}/reconciliation/runs${qs({ legalEntityId, storeId })}`),
  getReconciliationRun: (id: string, legalEntityId: string) =>
    apiFetch<PartsReconciliationRun>(`${BASE}/reconciliation/runs/${id}${qs({ legalEntityId })}`),

  // S067 — Price tape
  loadPriceTape: (data: { legalEntityId: string; loadBatchId: string; lines: Array<{ partNumber: string; oldValue: string; newValue: string; qtyOnHand: string; effectiveFrom: string }> }) =>
    apiFetch<any>(`${BASE}/price-tape/load`, { method: 'POST', body: JSON.stringify(data) }),
  previewPriceTape: (loadBatchId: string, legalEntityId: string) =>
    apiFetch<any>(`${BASE}/price-tape/${loadBatchId}/preview`, { method: 'POST', body: JSON.stringify({ legalEntityId }) }),
  approvePriceTape: (loadBatchId: string, data: { legalEntityId: string; correlationId: string; businessDate: string }) =>
    apiFetch<any>(`${BASE}/price-tape/${loadBatchId}/approve`, { method: 'POST', body: JSON.stringify(data) }),
  getPriceTape: (loadBatchId: string, legalEntityId: string) => apiFetch<any>(`${BASE}/price-tape/${loadBatchId}${qs({ legalEntityId })}`),
  listPriceTapes: (legalEntityId: string) => apiFetch<{ items: any[] }>(`${BASE}/price-tape${qs({ legalEntityId })}`),

  // S068 — Obsolescence & scrap
  previewObsolescence: (data: { legalEntityId: string; asOfDate: string; bandConfig: unknown; lines: Array<{ partNumber: string; ageBand: string; qty: string; provisionAmount: string }> }) =>
    apiFetch<any>(`${BASE}/obsolescence/preview`, { method: 'POST', body: JSON.stringify(data) }),
  approveObsolescence: (runId: string, data: { legalEntityId: string; correlationId: string; businessDate: string }) =>
    apiFetch<any>(`${BASE}/obsolescence/${runId}/approve`, { method: 'POST', body: JSON.stringify(data) }),
  listObsolescenceRuns: (legalEntityId: string) => apiFetch<{ items: any[] }>(`${BASE}/obsolescence${qs({ legalEntityId })}`),
  postScrap: (data: Record<string, unknown>) => apiFetch<any>(`${BASE}/scrap`, { method: 'POST', body: JSON.stringify(data) }),
  listScrap: (legalEntityId: string) => apiFetch<{ items: any[] }>(`${BASE}/scrap${qs({ legalEntityId })}`),

  // S069 — Physical inventory
  openPhysicalSession: (data: { legalEntityId: string; storeId: string; scopeDescription: string; blindCount?: boolean; varianceThreshold?: string }) =>
    apiFetch<any>(`${BASE}/physical/sessions`, { method: 'POST', body: JSON.stringify(data) }),
  freezePhysicalSession: (id: string, partNumbers: string[], legalEntityId: string) =>
    apiFetch<any>(`${BASE}/physical/sessions/${id}/freeze`, { method: 'POST', body: JSON.stringify({ partNumbers, legalEntityId }) }),
  enterCountLines: (id: string, counts: Array<{ partNumber: string; countedQty: string }>, legalEntityId: string) =>
    apiFetch<any>(`${BASE}/physical/sessions/${id}/count-lines`, { method: 'POST', body: JSON.stringify({ counts, legalEntityId }) }),
  varianceReport: (id: string, legalEntityId: string) => apiFetch<any>(`${BASE}/physical/sessions/${id}/variance-report`, { method: 'POST', body: JSON.stringify({ legalEntityId }) }),
  approvePhysicalSession: (id: string, data: { legalEntityId: string; correlationId: string; businessDate: string }) =>
    apiFetch<any>(`${BASE}/physical/sessions/${id}/approve`, { method: 'POST', body: JSON.stringify(data) }),
  getPhysicalSession: (id: string, legalEntityId: string) => apiFetch<any>(`${BASE}/physical/sessions/${id}${qs({ legalEntityId })}`),
  listPhysicalSessions: (legalEntityId: string) => apiFetch<{ items: any[] }>(`${BASE}/physical/sessions${qs({ legalEntityId })}`),

  // S070 — Deposits & escheat
  createDeposit: (data: Record<string, unknown>) => apiFetch<any>(`${BASE}/deposits`, { method: 'POST', body: JSON.stringify(data) }),
  applyDeposit: (orderNumber: string, data: { legalEntityId: string } & Record<string, unknown>) =>
    apiFetch<any>(`${BASE}/deposits/${orderNumber}/apply`, { method: 'POST', body: JSON.stringify(data) }),
  refundDeposit: (orderNumber: string, data: { legalEntityId: string } & Record<string, unknown>) =>
    apiFetch<any>(`${BASE}/deposits/${orderNumber}/refund`, { method: 'POST', body: JSON.stringify(data) }),
  abandonedDepositQueue: (legalEntityId: string, asOfDate?: string) =>
    apiFetch<any>(`${BASE}/deposits/abandoned-queue${qs({ legalEntityId, asOfDate })}`),
  escheatDeposit: (orderNumber: string, data: { legalEntityId: string } & Record<string, unknown>) =>
    apiFetch<any>(`${BASE}/deposits/${orderNumber}/escheat`, { method: 'POST', body: JSON.stringify(data) }),
  getDeposit: (orderNumber: string, legalEntityId: string) => apiFetch<any>(`${BASE}/deposits/${orderNumber}${qs({ legalEntityId })}`),
  listDeposits: (legalEntityId: string, status?: string) => apiFetch<{ items: any[] }>(`${BASE}/deposits${qs({ legalEntityId, status })}`),

  // S071 — OEM returns
  authorizeOemReturn: (data: Record<string, unknown>) => apiFetch<any>(`${BASE}/oem-returns`, { method: 'POST', body: JSON.stringify(data) }),
  shipOemReturn: (returnAuthNumber: string, data: { legalEntityId: string } & Record<string, unknown>) =>
    apiFetch<any>(`${BASE}/oem-returns/${returnAuthNumber}/ship`, { method: 'POST', body: JSON.stringify(data) }),
  creditOemReturn: (returnAuthNumber: string, data: { legalEntityId: string } & Record<string, unknown>) =>
    apiFetch<any>(`${BASE}/oem-returns/${returnAuthNumber}/credit`, { method: 'POST', body: JSON.stringify(data) }),
  dispositionOemReturn: (returnAuthNumber: string, data: { legalEntityId: string } & Record<string, unknown>) =>
    apiFetch<any>(`${BASE}/oem-returns/${returnAuthNumber}/disposition`, { method: 'POST', body: JSON.stringify(data) }),
  getOemReturn: (returnAuthNumber: string, legalEntityId: string) => apiFetch<any>(`${BASE}/oem-returns/${returnAuthNumber}${qs({ legalEntityId })}`),
  listOemReturns: (legalEntityId: string) => apiFetch<{ items: any[] }>(`${BASE}/oem-returns${qs({ legalEntityId })}`),

  // Account mapping
  listAccountMapping: (legalEntityId: string) => apiFetch<{ items: any[] }>(`${BASE}/account-mapping${qs({ legalEntityId })}`),
  setAccountMapping: (data: { legalEntityId: string; eventFamily: string; role: string; accountNumber: string }) =>
    apiFetch<any>(`${BASE}/account-mapping`, { method: 'POST', body: JSON.stringify(data) }),

  // Exceptions
  listExceptions: (params?: { status?: string; reasonCode?: string }) => apiFetch<{ items: any[] }>(`${BASE}/exceptions${qs(params)}`),
  resolveException: (id: string) => apiFetch<any>(`${BASE}/exceptions/${id}/resolve`, { method: 'POST' }),

  // Audit
  getAuditTrail: (docType: string, docId: string) => apiFetch<{ items: any[] }>(`${BASE}/audit/${docType}/${docId}`),
  getAuditFeed: (params?: { docType?: string; docId?: string; action?: string; correlationId?: string }) =>
    apiFetch<{ items: any[] }>(`${BASE}/audit${qs(params)}`),
};
