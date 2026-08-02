// CE-12 (Workstream R + S090) — API client for the three "Vehicle, Deals &
// F&I Integrations" Accounting UI screens owned by this build:
//   /accounting/deals/reserve   (S091 Finance Reserve & Flat-% Chargeback Reserve)
//   /accounting/deals/products  (S092 Product Income & Remit Accrual, S093
//                                 Product Cancellations, S094 Deferral Mode)
//   /accounting/deals/wholesale (S090 Wholesale Disposition & Arbitration)
//
// Endpoints below are transcribed directly from the real route files —
// never guessed:
//   services/fni-reserve-service/src/http/routes.ts   (prefix /api/v1/fni-reserve)
//   services/deal-accounting-service/src/http/routes.ts (prefix /api/v1/deal-accounting)
//
// Follows scheduleApi's shape/style in ./client.ts. Reuses the shared,
// exported apiFetch helper (auth/tenant/timeout/401-recovery) rather than
// duplicating it.
import { apiFetch } from './client';

// ─────────────────────────────────────────────────────────────────────────
// Types (mirror the real Zod schemas / Prisma models — never invented shapes)
// ─────────────────────────────────────────────────────────────────────────

export interface LenderProgramConfig {
  id: string;
  tenantId: string;
  lenderProgramCode: string;
  lenderProgramName: string;
  chargebackReservePercent: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  active?: boolean;
  createdBy: string;
  createdAt: string;
}

export interface ProviderProgramConfig {
  id: string;
  providerCode: string;
  productType: string;
  proRataTable: Array<{ monthsElapsed: number; refundPercent: string }>;
  termMonths: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface DeferralModeConfig {
  id: string;
  productType: string;
  mode: 'AGENT' | 'OBLIGOR';
  earningPatternType: 'STRAIGHT_LINE_MONTHS';
  earningPatternMonths: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface ResolvedDeferralMode {
  mode: 'AGENT' | 'OBLIGOR';
  configId: string | null;
  effectiveFrom: string | null;
  earningPatternType: string | null;
  earningPatternMonths: number | null;
}

export interface ReserveRemittance {
  id: string;
  tenantId: string;
  dealNumber: string;
  lenderProgramCode: string;
  expectedAmount: string;
  remittedAmount: string;
  shortPayAmount: string;
  cashOriginationLinkageStatus: string;
  accrualId: string | null;
  status: string;
  createdBy: string;
  createdAt: string;
  dispositions?: RemittanceShortPayDisposition[];
}

export interface RemittanceShortPayDisposition {
  id: string;
  remittanceId: string;
  dispositionType: 'WRITE_OFF_TO_EXPENSE' | 'FLAG_FOR_FOLLOWUP';
  amount: string;
  reason: string;
  createdBy: string;
  createdAt: string;
}

export interface ChargebackDrawResult {
  drawId?: string;
  id?: string;
  dealNumber?: string;
  lenderProgramCode?: string;
  chargebackAmount: string;
  drawFromReserveAmount: string;
  excessToExpenseAmount: string;
  reserveBalanceBefore: string;
  reserveBalanceAfter: string;
  postingStatus?: { drawLeg?: string; excessLeg?: string };
}

export interface ChargebackPreviewResult {
  preview: true;
  controlNumber: string;
  chargebackAmount: string;
  reserveBalanceBefore: string;
  drawFromReserveAmount: string;
  excessToExpenseAmount: string;
  reserveBalanceAfter: string;
}

export interface CancellationPreviewResult {
  preview: true;
  quoteTotal: string;
  incomeReversalAmount: string;
  remitAdjustmentAmount: string;
  refundPayableAmount: string;
}

export interface ChargebackReserveAccrual {
  id: string;
  tenantId: string;
  dealNumber: string;
  lenderProgramCode: string;
  reserveIncomeAmount: string;
  accrualPercent: string;
  accrualAmount: string;
  controlNumber: string;
  postingExecutionId: string | null;
  idempotencyKey: string;
  createdBy: string;
  createdAt: string;
}

export interface ChargebackDraw {
  id: string;
  tenantId: string;
  dealNumber: string;
  lenderProgramCode: string;
  controlNumber: string;
  chargebackAmount: string;
  drawFromReserveAmount: string;
  excessToExpenseAmount: string;
  reserveBalanceBefore: string;
  sourceType: 'EARLY_PAYOFF' | 'CANCELLATION';
  sourceCancellationId: string | null;
  postingExecutionId: string | null;
  idempotencyKey: string;
  createdBy: string;
  createdAt: string;
}

export interface ChargebackReserveTieOutLine {
  controlNumber: string;
  accruedTotal: string;
  drawnTotal: string;
  remainingBalance: string;
}

export interface ChargebackReserveTieOut {
  lines: ChargebackReserveTieOutLine[];
  totalAccrued: string;
  totalDrawn: string;
  totalRemainingBalance: string;
}

export interface RemitRunItem {
  id: string;
  dealNumber: string;
  productCode: string;
  amount: string;
  applyControlNumber: string;
  status: string;
}

export interface RemitRun {
  id: string;
  providerCode: string;
  runDate: string;
  totalAmount: string;
  paymentRailLinkageStatus: string;
  createdBy: string;
  createdAt: string;
  items?: RemitRunItem[];
}

export interface RemitLiabilityTieOut {
  openItems: Array<{ dealNumber: string; productCode: string; providerCode: string; remainingAmount: string }>;
  totalOpenAmount: string;
}

export interface ProviderStatementLine {
  id: string;
  reconciliationId: string;
  dealNumber: string;
  productCode: string;
  statementAmount: string;
  ourRemittedAmount: string;
  variance: string;
  status: 'MATCHED' | 'VARIANCE_FLAGGED' | 'REVIEWED';
  reviewedBy: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
}

export interface ProviderStatementReconciliation {
  id: string;
  providerCode: string;
  statementDate: string;
  uploadedBy: string;
  createdAt: string;
  lines?: ProviderStatementLine[];
}

export type RefundBasisInput =
  | { kind: 'PROVIDER_QUOTE_PERCENT'; refundPercent: number }
  | { kind: 'PROVIDER_QUOTE_AMOUNT'; quoteTotalAmount: string }
  | { kind: 'CONFIG_PRORATA'; productType: string; providerCode: string; bookingDate: string };

export interface ProductCancellation {
  id: string;
  dealNumber: string;
  productCode: string;
  cancellationSource: 'CUSTOMER' | 'LENDER';
  refundBasis: 'PROVIDER_QUOTE' | 'CONFIG_PRORATA';
  quoteTotal: string;
  incomeReversalAmount: string;
  remitAdjustmentAmount: string;
  refundPayableAmount: string;
  refundPayableLinkageStatus: string;
  chargebackTriggered: boolean;
  chargebackDrawId: string | null;
  status: 'PROCESSED' | 'POSTING_FAILED' | 'REVERSED';
  createdBy: string;
  createdAt: string;
}

export interface DeferralBooking {
  id: string;
  dealNumber: string;
  productCode: string;
  productType: string;
  originalAmount: string;
  recognizedAmount: string;
  bookingDate: string;
  earningPatternType: string;
  earningPatternMonths: number | null;
  controlNumber: string;
  status: 'OPEN' | 'FULLY_RECOGNIZED';
  createdBy: string;
  createdAt: string;
}

export interface DeferralLiabilityTieOut {
  totalDeferred: string;
  totalRecognized: string;
  totalUnearned: string;
  // Gap-closure — real schedule-service-authoritative tie-out (schedule 96),
  // not a local recompute: present only when a DEFERRED_INCOME_LIABILITY
  // schedule mapping is configured for this tenant.
  scheduleTieOut: { scheduleNumber: string; openItemCount: number; totalRemainingBalance: string; source: 'SCHEDULE_SERVICE' } | null;
}

export interface RecognitionRunLine {
  id: string;
  batchId: string;
  deferralBookingId: string;
  periodStart: string;
  periodEnd: string;
  cumulativeRecognizedBefore: string;
  earnedAmount: string;
  status: 'PENDING' | 'POSTED' | 'FAILED';
  deferralBooking?: DeferralBooking;
}

export interface RecognitionRunBatch {
  id: string;
  asOfDate: string;
  status: 'PREVIEW' | 'APPROVED' | 'POSTED' | 'REJECTED';
  computedTotal: string;
  approvedBy: string | null;
  approvedAt: string | null;
  postedAt: string | null;
  createdBy: string;
  createdAt: string;
  lines?: RecognitionRunLine[];
}

export interface WholesaleDisposition {
  id: string;
  dealId: string;
  unitRef: string;
  titleStatus: string;
  wholesaleAmount: string;
  unitReliefAmount: string;
  auctionFeesAmount: string;
  dispositionOutcome: 'GAIN' | 'LOSS';
  gainLossAmount: string;
  status: 'POSTED' | 'ARBITRATED_ADJUSTED' | 'ARBITRATED_RETURNED';
  idempotencyKey: string;
  createdBy: string;
  createdAt: string;
}

export interface ArbitrationCase {
  id: string;
  dispositionId: string;
  arbitrationType: 'PRICE_ADJUSTMENT' | 'UNIT_RETURN';
  adjustmentAmount: string | null;
  conditionCostAmount: string | null;
  reason: string;
  createdBy: string;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────
// fni-reserve-service — /api/v1/fni-reserve
// ─────────────────────────────────────────────────────────────────────────

const FNI = '/api/v1/fni-reserve';

export const fniReserveApi = {
  // Config
  listLenderProgramConfigs: () => apiFetch<LenderProgramConfig[]>(`${FNI}/config/lender-programs`),
  createLenderProgramConfig: (data: { lenderProgramCode: string; lenderProgramName: string; chargebackReservePercent: string; effectiveFrom: string; effectiveTo?: string | null }) =>
    apiFetch<LenderProgramConfig>(`${FNI}/config/lender-programs`, { method: 'POST', body: JSON.stringify(data) }),

  listProviderProgramConfigs: () => apiFetch<ProviderProgramConfig[]>(`${FNI}/config/provider-programs`),
  createProviderProgramConfig: (data: { providerCode: string; productType: string; proRataTable: Array<{ monthsElapsed: number; refundPercent: string }>; termMonths: number; effectiveFrom: string; effectiveTo?: string | null }) =>
    apiFetch<ProviderProgramConfig>(`${FNI}/config/provider-programs`, { method: 'POST', body: JSON.stringify(data) }),

  listDeferralModeConfigs: () => apiFetch<DeferralModeConfig[]>(`${FNI}/config/deferral-mode`),
  createDeferralModeConfig: (data: { productType: string; mode: 'AGENT' | 'OBLIGOR'; earningPatternType: 'STRAIGHT_LINE_MONTHS'; earningPatternMonths?: number | null; effectiveFrom: string; effectiveTo?: string | null }) =>
    apiFetch<DeferralModeConfig>(`${FNI}/config/deferral-mode`, { method: 'POST', body: JSON.stringify(data) }),

  // S094 cross-service contract — the endpoint deal-accounting-service's
  // rule pack conditions on. productType + asOfDate required.
  getDeferralMode: (productType: string, asOfDate: string) =>
    apiFetch<ResolvedDeferralMode>(`${FNI}/deferral-mode?productType=${encodeURIComponent(productType)}&asOfDate=${encodeURIComponent(asOfDate)}`),

  // S091(a)/(b) — remittances
  processRemittance: (data: { dealNumber: string; lenderProgramCode: string; expectedAmount: string; remittedAmount: string; idempotencyKey: string; correlationId?: string; businessDate?: string }) =>
    apiFetch<ReserveRemittance>(`${FNI}/remittances`, { method: 'POST', body: JSON.stringify(data) }),
  listRemittances: (dealNumber?: string) => apiFetch<ReserveRemittance[]>(`${FNI}/remittances${dealNumber ? `?dealNumber=${encodeURIComponent(dealNumber)}` : ''}`),
  getRemittance: (id: string) => apiFetch<ReserveRemittance>(`${FNI}/remittances/${id}`),
  dispositionShortPay: (id: string, data: { dispositionType: 'WRITE_OFF_TO_EXPENSE' | 'FLAG_FOR_FOLLOWUP'; reason: string; idempotencyKey: string }) =>
    apiFetch<RemittanceShortPayDisposition>(`${FNI}/remittances/${id}/disposition`, { method: 'POST', body: JSON.stringify(data) }),

  // S091(c) — actual chargeback (early payoff notice)
  processChargebackNotice: (data: { dealNumber: string; lenderProgramCode: string; chargebackAmount: string; idempotencyKey: string; correlationId?: string; businessDate?: string }) =>
    apiFetch<ChargebackDrawResult>(`${FNI}/chargebacks`, { method: 'POST', body: JSON.stringify(data) }),
  // Gap-closure — dry-run preview before the real draw (never posts/persists).
  previewChargeback: (data: { dealNumber: string; lenderProgramCode: string; chargebackAmount: string; idempotencyKey: string; correlationId?: string; businessDate?: string }) =>
    apiFetch<ChargebackPreviewResult>(`${FNI}/chargebacks/preview`, { method: 'POST', body: JSON.stringify(data) }),
  getChargebackReserveTieOut: (lenderProgramCode?: string) =>
    apiFetch<ChargebackReserveTieOut>(`${FNI}/chargeback-reserve/tie-out${lenderProgramCode ? `?lenderProgramCode=${encodeURIComponent(lenderProgramCode)}` : ''}`),
  // Gap-closure — real persisted list views (previously the reserve screen
  // could only show the aggregate tie-out, not the individual accrual/draw
  // rows behind it).
  listChargebackReserveAccruals: (params?: { dealNumber?: string; lenderProgramCode?: string; page?: number; pageSize?: number }) => {
    const qs = new URLSearchParams();
    if (params?.dealNumber) qs.set('dealNumber', params.dealNumber);
    if (params?.lenderProgramCode) qs.set('lenderProgramCode', params.lenderProgramCode);
    if (params?.page != null) qs.set('page', String(params.page));
    if (params?.pageSize != null) qs.set('pageSize', String(params.pageSize));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<{ items: ChargebackReserveAccrual[]; total: number; page: number; pageSize: number }>(`${FNI}/chargeback-reserve/accruals${suffix}`);
  },
  listChargebackReserveDraws: (params?: { dealNumber?: string; lenderProgramCode?: string; page?: number; pageSize?: number }) => {
    const qs = new URLSearchParams();
    if (params?.dealNumber) qs.set('dealNumber', params.dealNumber);
    if (params?.lenderProgramCode) qs.set('lenderProgramCode', params.lenderProgramCode);
    if (params?.page != null) qs.set('page', String(params.page));
    if (params?.pageSize != null) qs.set('pageSize', String(params.pageSize));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<{ items: ChargebackDraw[]; total: number; page: number; pageSize: number }>(`${FNI}/chargeback-reserve/draws${suffix}`);
  },

  // S092 — remit liability / remit runs / reconciliation
  registerRemitLiability: (data: { dealNumber: string; productCode: string; providerCode: string; glAccountNumber: string; scheduleNumber: string; originalAmount: string }) =>
    apiFetch<any>(`${FNI}/remit-liability/register`, { method: 'POST', body: JSON.stringify(data) }),
  executeRemitRun: (data: { providerCode: string; runDate: string; items: Array<{ dealNumber: string; productCode: string; amount: string }>; idempotencyKey: string; correlationId?: string }) =>
    apiFetch<RemitRun>(`${FNI}/remit-runs`, { method: 'POST', body: JSON.stringify(data) }),
  listRemitRuns: (providerCode?: string) => apiFetch<RemitRun[]>(`${FNI}/remit-runs${providerCode ? `?providerCode=${encodeURIComponent(providerCode)}` : ''}`),
  getRemitRun: (id: string) => apiFetch<RemitRun>(`${FNI}/remit-runs/${id}`),
  getRemitLiabilityTieOut: (providerCode?: string) => apiFetch<RemitLiabilityTieOut>(`${FNI}/remit-liability/tie-out${providerCode ? `?providerCode=${encodeURIComponent(providerCode)}` : ''}`),

  uploadProviderStatement: (data: { providerCode: string; statementDate: string; lines: Array<{ dealNumber: string; productCode: string; statementAmount: string }> }) =>
    apiFetch<ProviderStatementReconciliation>(`${FNI}/provider-statements`, { method: 'POST', body: JSON.stringify(data) }),
  listReconciliations: (providerCode?: string) => apiFetch<ProviderStatementReconciliation[]>(`${FNI}/provider-statements${providerCode ? `?providerCode=${encodeURIComponent(providerCode)}` : ''}`),
  getReconciliation: (id: string) => apiFetch<ProviderStatementReconciliation>(`${FNI}/provider-statements/${id}`),
  reviewVarianceLine: (lineId: string, data: { reviewNote: string }) =>
    apiFetch<ProviderStatementLine>(`${FNI}/provider-statements/lines/${lineId}/review`, { method: 'POST', body: JSON.stringify(data) }),

  // S093 — product cancellations
  processCancellation: (data: {
    dealNumber: string; productCode: string; cancellationSource: 'CUSTOMER' | 'LENDER';
    originalIncomeAmount: string; originalRemitAmount: string; refundBasis: RefundBasisInput;
    chargebackTriggered?: boolean; lenderProgramCode?: string; chargebackAmount?: string;
    idempotencyKey: string; correlationId?: string; businessDate?: string;
  }) => apiFetch<ProductCancellation>(`${FNI}/cancellations`, { method: 'POST', body: JSON.stringify(data) }),
  // Gap-closure — dry-run preview of the income-reversal/remit-adjustment/
  // refund-payable three-leg breakdown, before the real POST /cancellations.
  previewCancellation: (data: {
    dealNumber: string; productCode: string; cancellationSource: 'CUSTOMER' | 'LENDER';
    originalIncomeAmount: string; originalRemitAmount: string; refundBasis: RefundBasisInput;
    chargebackTriggered?: boolean; lenderProgramCode?: string; chargebackAmount?: string;
    idempotencyKey: string; correlationId?: string; businessDate?: string;
  }) => apiFetch<CancellationPreviewResult>(`${FNI}/cancellations/preview`, { method: 'POST', body: JSON.stringify(data) }),
  listCancellations: (dealNumber?: string) => apiFetch<ProductCancellation[]>(`${FNI}/cancellations${dealNumber ? `?dealNumber=${encodeURIComponent(dealNumber)}` : ''}`),
  getCancellation: (id: string) => apiFetch<ProductCancellation>(`${FNI}/cancellations/${id}`),
  getCancellationLineage: (dealNumber: string, productCode?: string) =>
    apiFetch<ProductCancellation[]>(`${FNI}/cancellations/lineage/${encodeURIComponent(dealNumber)}${productCode ? `?productCode=${encodeURIComponent(productCode)}` : ''}`),

  // S094 — deferral bookings + recognition runs (preview-approve)
  registerDeferralBooking: (data: { dealNumber: string; productCode: string; productType: string; originalAmount: string; bookingDate: string; idempotencyKey: string }) =>
    apiFetch<DeferralBooking>(`${FNI}/deferral-bookings`, { method: 'POST', body: JSON.stringify(data) }),
  listDeferralBookings: (status?: string) => apiFetch<DeferralBooking[]>(`${FNI}/deferral-bookings${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  getDeferralBooking: (id: string) => apiFetch<DeferralBooking>(`${FNI}/deferral-bookings/${id}`),
  getDeferralLiabilityTieOut: () => apiFetch<DeferralLiabilityTieOut>(`${FNI}/deferral-liability/tie-out`),

  computeRecognitionRunPreview: (asOfDate: string) => apiFetch<RecognitionRunBatch>(`${FNI}/recognition-runs/preview`, { method: 'POST', body: JSON.stringify({ asOfDate }) }),
  listRecognitionRuns: (status?: string) => apiFetch<RecognitionRunBatch[]>(`${FNI}/recognition-runs${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  getRecognitionRun: (id: string) => apiFetch<RecognitionRunBatch>(`${FNI}/recognition-runs/${id}`),
  approveRecognitionRun: (id: string) => apiFetch<RecognitionRunBatch>(`${FNI}/recognition-runs/${id}/approve`, { method: 'POST' }),
};

// ─────────────────────────────────────────────────────────────────────────
// deal-accounting-service — /api/v1/deal-accounting (S090 wholesale/arbitration only)
// ─────────────────────────────────────────────────────────────────────────

const DA = '/api/v1/deal-accounting';

export const dealAccountingApi = {
  // Gap-closure — real list view (WholesaleArbitration.tsx previously had
  // no way to browse dispositions other than by drilling into one by id).
  listWholesaleDispositions: (params?: { status?: string; unitRef?: string; page?: number; pageSize?: number }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.unitRef) qs.set('unitRef', params.unitRef);
    if (params?.page != null) qs.set('page', String(params.page));
    if (params?.pageSize != null) qs.set('pageSize', String(params.pageSize));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<{ items: WholesaleDisposition[]; total: number; page: number; pageSize: number }>(`${DA}/wholesale/dispositions${suffix}`);
  },
  disposeWholesale: (data: {
    unitRef: string; titleStatus: string; wholesaleAmount: string; unitReliefAmount: string;
    auctionFeesAmount: string; idempotencyKey: string; dealNumber?: string | null; legalEntityId: string; storeId: string;
  }) => apiFetch<WholesaleDisposition>(`${DA}/wholesale/dispositions`, { method: 'POST', body: JSON.stringify(data) }),
  getWholesaleDisposition: (id: string) =>
    apiFetch<{ disposition: WholesaleDisposition; arbitrationCases: ArbitrationCase[] }>(`${DA}/wholesale/dispositions/${id}`),
  arbitrationPriceAdjustment: (id: string, data: { adjustmentAmount: string; reason: string; idempotencyKey: string }) =>
    apiFetch<ArbitrationCase>(`${DA}/wholesale/dispositions/${id}/arbitration/price-adjustment`, { method: 'POST', body: JSON.stringify(data) }),
  arbitrationUnitReturn: (id: string, data: { conditionCostAmount: string; reason: string; idempotencyKey: string }) =>
    apiFetch<ArbitrationCase>(`${DA}/wholesale/dispositions/${id}/arbitration/unit-return`, { method: 'POST', body: JSON.stringify(data) }),
};
