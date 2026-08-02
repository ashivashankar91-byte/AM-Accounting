// CE-11 / Fixed Ops — API client for fixedops-service (S059-S065), mounted
// behind the gateway at /api/v1/fixedops. Self-contained (does not import
// or modify client.ts) — mirrors client.ts's apiFetch auth/tenant/timeout
// behavior exactly so this module behaves identically to every other
// Accounting-app API client.

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const API_TIMEOUT_MS = 10_000;
const BASE = '/api/v1/fixedops';

function clearStaleGoldenPathSessionAndRedirect(): void {
  const loginPath = `${import.meta.env.BASE_URL}login`;
  if (window.location.pathname === loginPath) return;
  ['goldenpath.accessToken', 'goldenpath.sessionToken', 'goldenpath.tenantId', 'goldenpath.user', 'goldenpath.legalEntityId', 'goldenpath.legalEntityLabel']
    .forEach((k) => localStorage.removeItem(k));
  window.location.href = loginPath;
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const goldenPathToken = localStorage.getItem('goldenpath.accessToken');
  const goldenPathTenantId = localStorage.getItem('goldenpath.tenantId');
  const tenantId = goldenPathTenantId || localStorage.getItem('tenantId') || 'tenant-kunes';
  const legalEntityId = localStorage.getItem('goldenpath.legalEntityId');
  const headers: Record<string, string> = {
    'x-tenant-id': tenantId,
    ...(legalEntityId ? { 'x-legal-entity-id': legalEntityId } : {}),
    ...(goldenPathToken ? { Authorization: `Bearer ${goldenPathToken}` } : {}),
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (options.body) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers, signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) {
      if (res.status === 401 && goldenPathToken) clearStaleGoldenPathSessionAndRedirect();
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.message ?? body.error ?? `API error ${res.status}`);
      (err as any).status = res.status;
      (err as any).body = body;
      throw err;
    }
    if (res.status === 204) return undefined as unknown as T;
    return res.json();
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${API_TIMEOUT_MS / 1000}s — ${path}. Check that fixedops-service is running.`);
    }
    throw error;
  }
}

// ── Types (mirror services/fixedops-service prisma schema + application DTOs) ─

export interface RoCloseLine {
  lineId: string; payType: 'C' | 'W' | 'I'; category: 'LABOR' | 'PARTS' | 'SUBLET' | 'MISC' | 'FEE';
  opcode?: string | null; techId?: string | null; partNumber?: string | null;
  saleAmount: string | number; costAmount?: string | number;
}
export interface RoCloseRequest {
  legalEntityId: string; storeId: string; roNumber: string; businessDate: string;
  totalSaleAmount: string | number; lines: RoCloseLine[]; sourceEventId: string; correlationId: string;
}
export interface RoCloseOutcome {
  idempotent: boolean; submissionId: string; status: string; closeVersion: number;
  journalEntryId?: string | null; journalNumber?: string | null; failureReason?: string | null;
}
export interface RoDistributionLine {
  id: string; lineId: string; payType: string; category: string; opcode: string | null;
  techId: string | null; partNumber: string | null; saleAmount: string; costAmount: string;
  taxResultId: string | null; taxAmount: string;
}
export interface RoCloseSubmission {
  id: string; roNumber: string; closeVersion: number; status: string; payTypeMix: string;
  totalSaleAmount: string; totalCostAmount: string; totalTaxAmount: string;
  journalEntryId: string | null; journalNumber: string | null; rulePackVersionId: string | null;
  failureReason: string | null; createdAt: string; lines: RoDistributionLine[];
}
export interface RepairOrderDetail {
  id: string; tenantId: string; roNumber: string; storeId: string; legalEntityId: string;
  status: string; currentCloseVersion: number; wipMode: string | null;
  openedAt: string; closedAt: string | null;
  closeSubmissions: RoCloseSubmission[];
  reversals: RoReversal[];
}
export interface RoReversal {
  id: string; roNumber: string; closeVersionReversed: number; action: 'REOPEN' | 'VOID';
  status: 'COMPLETED' | 'REFUSED'; refusalCode: string | null; reason: string | null;
  originalJournalEntryId: string; reversalJournalEntryId: string | null; createdAt: string;
}
export interface ReversalOutcome {
  idempotent: boolean; reversalId: string; status: 'COMPLETED' | 'REFUSED';
  refusalCode?: string | null; reversalJournalEntryId?: string | null;
}
// S063 gap-closure — approved unapplied-time absorption labor-rate policy.
export interface LaborRateConfig {
  id: string; tenantId: string; legalEntityId: string; scope: 'TECHNICIAN' | 'DEPARTMENT';
  subjectKey: string; burdenedRate: string; effectiveFrom: string; createdAt: string; createdBy: string;
}
export interface TechGuaranteeConfig {
  id: string; tenantId: string; legalEntityId: string; techId: string;
  guaranteedHoursPerPeriod: string; effectiveFrom: string; createdAt: string; createdBy: string | null;
}
export interface TechTimeAbsorption {
  id: string; tenantId: string; legalEntityId: string; techId: string; deptCode: string | null;
  payrollPeriodId: string; clockedHours: string; flaggedAppliedHours: string; unappliedHours: string;
  guaranteedHours: string; shortfallHours: string;
  rateId: string | null; rateSource: 'TECHNICIAN' | 'DEPARTMENT' | null; rateAmount: string | null;
  rateEffectiveFrom: string | null; unappliedAmount: string | null; shortfallAmount: string | null;
  sourceEventId: string; correlationId: string; status: string; journalEntryId: string | null;
  createdAt: string; idempotent?: boolean;
}
export interface TechTimeAbsorptionReversal {
  id: string; tenantId: string; techTimeAbsorptionId: string; techId: string; payrollPeriodId: string;
  originalJournalEntryId: string; reversalJournalEntryId: string | null;
  status: 'COMPLETED' | 'REFUSED'; reason: string | null; actor: string; createdAt: string; idempotent?: boolean;
}

export interface WipModeElection {
  id: string; legalEntityId: string; storeId: string | null; mode: 'WIP_MODE' | 'DIRECT_MODE';
  effectiveFrom: string; approvedBy: string; impactPreview: unknown; createdAt: string;
}
export interface OpenRoRow {
  roNumber: string; storeId: string; status: string; ageDays: number;
  accumulatedValue: number; payTypeMix: string | null; wipMode: string | null;
}
export interface WipTieOut {
  reportTotal: number; glWipBalance: number | null; status: 'BALANCED' | 'VARIANCE' | 'GL_BALANCE_UNAVAILABLE';
}
export interface WarrantyClaimItem {
  id: string; roNumber: string; claimNumber: string; saleAmount: string; remainingAmount: string;
  status: string; factoryAgeBand: string | null; scheduleProjectionPending: boolean;
  submittedAt: string | null; createdAt: string;
  remittances?: any[]; dispositions?: any[];
  ageDays?: number;
}
export interface WarrantyAgingResult {
  rows: (WarrantyClaimItem & { ageDays: number; factoryAgeBand: string })[];
  totalRemaining: number;
}
export interface FixedOpsException {
  id: string; roNumber: string | null; eventFamily: string; reasonCode: string; detail: string | null;
  status: string; correlationId: string; createdAt: string; resolvedAt: string | null; resolvedBy: string | null;
}
export interface AuditEvent {
  id: string; docType: string; docId: string; action: string; actor: string;
  before: any; after: any; reason: string | null; correlationId: string | null; createdAt: string;
}

export const fixedopsApi = {
  closeRo: (data: RoCloseRequest) => apiFetch<RoCloseOutcome>(`${BASE}/ro/close`, { method: 'POST', body: JSON.stringify(data) }),
  getRo: (roNumber: string, storeId: string) => apiFetch<RepairOrderDetail>(`${BASE}/ro/${encodeURIComponent(roNumber)}?storeId=${encodeURIComponent(storeId)}`),
  listPostings: (params?: { storeId?: string; status?: string; payType?: string }) => {
    const qs = new URLSearchParams();
    if (params?.storeId) qs.set('storeId', params.storeId);
    if (params?.status) qs.set('status', params.status);
    if (params?.payType) qs.set('payType', params.payType);
    const suffix = qs.toString() ? `?${qs}` : '';
    return apiFetch<{ items: RoCloseSubmission[] }>(`${BASE}/postings${suffix}`);
  },
  reopenRo: (roNumber: string, data: { legalEntityId: string; storeId: string; reason?: string; sourceEventId: string; correlationId: string }) =>
    apiFetch<ReversalOutcome>(`${BASE}/ro/${encodeURIComponent(roNumber)}/reopen`, { method: 'POST', body: JSON.stringify(data) }),
  voidRo: (roNumber: string, data: { legalEntityId: string; storeId: string; reason?: string; sourceEventId: string; correlationId: string; customerPaymentApplied?: boolean }) =>
    apiFetch<ReversalOutcome>(`${BASE}/ro/${encodeURIComponent(roNumber)}/void`, { method: 'POST', body: JSON.stringify(data) }),

  electWipMode: (data: { legalEntityId: string; storeId?: string | null; mode: 'WIP_MODE' | 'DIRECT_MODE'; effectiveFrom: string; impactPreview?: unknown }) =>
    apiFetch<WipModeElection>(`${BASE}/wip-mode/elect`, { method: 'POST', body: JSON.stringify(data) }),
  wipModeHistory: (legalEntityId: string) => apiFetch<{ items: WipModeElection[] }>(`${BASE}/wip-mode/history?legalEntityId=${encodeURIComponent(legalEntityId)}`),
  wipReport: (params: { storeId?: string; legalEntityId?: string; glWipBalance?: string }) => {
    const qs = new URLSearchParams();
    if (params.storeId) qs.set('storeId', params.storeId);
    if (params.legalEntityId) qs.set('legalEntityId', params.legalEntityId);
    if (params.glWipBalance) qs.set('glWipBalance', params.glWipBalance);
    return apiFetch<{ rows: OpenRoRow[]; tie: WipTieOut }>(`${BASE}/wip?${qs}`);
  },

  createSubletPo: (data: { legalEntityId: string; storeId: string; roNumber: string; poNumber: string; vendorId: string; estimatedCost: string | number }) =>
    apiFetch<any>(`${BASE}/sublet/po`, { method: 'POST', body: JSON.stringify(data) }),
  matchSubletInvoice: (poNumber: string, data: { invoiceId: string; invoiceAmount: string | number; sourceEventId: string; correlationId: string }) =>
    apiFetch<any>(`${BASE}/sublet/po/${encodeURIComponent(poNumber)}/invoice-match`, { method: 'POST', body: JSON.stringify(data) }),

  // S063 gap-closure — approved unapplied-time absorption labor-rate policy.
  // Hours are converted to dollars via a governed, effective-dated BURDENED
  // labor-cost rate (technician-specific, else department-default, no
  // dealership-wide fallback) — never the customer labor selling rate,
  // never client-computed.
  absorbTechTime: (data: { legalEntityId: string; techId: string; deptCode: string; payrollPeriodId: string; clockedHours: string | number; flaggedAppliedHours: string | number; businessDate: string; sourceEventId: string; correlationId: string }) =>
    apiFetch<TechTimeAbsorption>(`${BASE}/tech-time/absorb`, { method: 'POST', body: JSON.stringify(data) }),
  reverseTechTime: (data: { legalEntityId: string; techId: string; payrollPeriodId: string; reason?: string; sourceEventId: string; correlationId: string }) =>
    apiFetch<TechTimeAbsorptionReversal>(`${BASE}/tech-time/reverse`, { method: 'POST', body: JSON.stringify(data) }),
  listTechTimeAbsorptions: (params: { legalEntityId: string; techId?: string }) => {
    const qs = new URLSearchParams();
    qs.set('legalEntityId', params.legalEntityId);
    if (params.techId) qs.set('techId', params.techId);
    return apiFetch<{ items: TechTimeAbsorption[] }>(`${BASE}/tech-time?${qs}`);
  },
  listTechTimeReversals: (techId?: string) =>
    apiFetch<{ items: TechTimeAbsorptionReversal[] }>(`${BASE}/tech-time/reversals${techId ? `?techId=${encodeURIComponent(techId)}` : ''}`),

  setLaborRate: (data: { legalEntityId: string; scope: 'TECHNICIAN' | 'DEPARTMENT'; subjectKey: string; burdenedRate: string | number; effectiveFrom: string }) =>
    apiFetch<LaborRateConfig>(`${BASE}/labor-rate`, { method: 'POST', body: JSON.stringify(data) }),
  listLaborRates: (legalEntityId: string) =>
    apiFetch<{ items: LaborRateConfig[] }>(`${BASE}/labor-rate?legalEntityId=${encodeURIComponent(legalEntityId)}`),

  setTechGuaranteeConfig: (data: { legalEntityId: string; techId: string; guaranteedHoursPerPeriod: string | number; effectiveFrom: string }) =>
    apiFetch<TechGuaranteeConfig>(`${BASE}/tech-guarantee-config`, { method: 'POST', body: JSON.stringify(data) }),
  listTechGuaranteeConfig: (legalEntityId: string) =>
    apiFetch<{ items: TechGuaranteeConfig[] }>(`${BASE}/tech-guarantee-config?legalEntityId=${encodeURIComponent(legalEntityId)}`),

  sellDeferredContract: (data: { legalEntityId: string; storeId: string; contractNumber: string; soldAmount: string | number; expiresAt?: string | null; sourceEventId: string; correlationId: string }) =>
    apiFetch<any>(`${BASE}/deferred-contracts/sell`, { method: 'POST', body: JSON.stringify(data) }),
  redeemDeferredContract: (contractNumber: string, data: { roNumber: string; redeemedAmount: string | number; sourceEventId: string; correlationId: string }) =>
    apiFetch<any>(`${BASE}/deferred-contracts/${encodeURIComponent(contractNumber)}/redeem`, { method: 'POST', body: JSON.stringify(data) }),
  getDeferredContract: (contractNumber: string) => apiFetch<any>(`${BASE}/deferred-contracts/${encodeURIComponent(contractNumber)}`),

  submitWarrantyClaim: (claimNumber: string, correlationId?: string) =>
    apiFetch<WarrantyClaimItem>(`${BASE}/warranty-claims/${encodeURIComponent(claimNumber)}/submit`, { method: 'POST', body: JSON.stringify({ correlationId }) }),
  remitWarrantyClaim: (claimNumber: string, data: { remittedAmount: string | number; sourceReceiptId: string; sourceEventId: string; correlationId: string }) =>
    apiFetch<any>(`${BASE}/warranty-claims/${encodeURIComponent(claimNumber)}/remit`, { method: 'POST', body: JSON.stringify(data) }),
  dispositionWarrantyClaim: (claimNumber: string, data: { type: 'WRITE_DOWN' | 'TRANSFER_TO_CUSTOMER_RESPONSIBILITY' | 'DENIAL' | 'ADJUSTMENT'; amount: string | number; reason: string; sourceEventId: string; correlationId: string }) =>
    apiFetch<any>(`${BASE}/warranty-claims/${encodeURIComponent(claimNumber)}/disposition`, { method: 'POST', body: JSON.stringify(data) }),
  warrantyAging: (storeId?: string) => apiFetch<WarrantyAgingResult>(`${BASE}/warranty-claims/aging${storeId ? `?storeId=${encodeURIComponent(storeId)}` : ''}`),
  listWarrantyClaims: (params?: { storeId?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.storeId) qs.set('storeId', params.storeId);
    if (params?.status) qs.set('status', params.status);
    return apiFetch<{ items: WarrantyClaimItem[] }>(`${BASE}/warranty-claims?${qs}`);
  },

  listAccountMappings: (legalEntityId?: string) => apiFetch<{ items: any[] }>(`${BASE}/account-mapping${legalEntityId ? `?legalEntityId=${encodeURIComponent(legalEntityId)}` : ''}`),

  listExceptions: (params?: { status?: string; reasonCode?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.reasonCode) qs.set('reasonCode', params.reasonCode);
    return apiFetch<{ items: FixedOpsException[] }>(`${BASE}/exceptions?${qs}`);
  },
  resolveException: (id: string) => apiFetch<FixedOpsException>(`${BASE}/exceptions/${encodeURIComponent(id)}/resolve`, { method: 'POST' }),

  auditTrail: (docType: string, docId: string) => apiFetch<{ items: AuditEvent[] }>(`${BASE}/audit/${encodeURIComponent(docType)}/${encodeURIComponent(docId)}`),
  auditGlobal: (params?: { docType?: string; docId?: string; action?: string; correlationId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.docType) qs.set('docType', params.docType);
    if (params?.docId) qs.set('docId', params.docId);
    if (params?.action) qs.set('action', params.action);
    if (params?.correlationId) qs.set('correlationId', params.correlationId);
    return apiFetch<{ items: AuditEvent[] }>(`${BASE}/audit?${qs}`);
  },
};

// Exposed for the cross-service Exception & Recovery Queue screen, which
// merges fixedops-service exceptions with parts-accounting-service
// exceptions without depending on the sibling partsApi.ts module.
export const rawApiFetch = apiFetch;
