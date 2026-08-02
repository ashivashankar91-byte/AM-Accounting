// CE-12 — Vehicle, Deals & F&I Integrations. API client for the two
// services backing the 4 mandatory Accounting UI screens owned by this
// workstream: vehicle-accounting-service (S074-S077) and floorplan-service
// (S079-S082). Mirrors scheduleApi's exact shape/style in ./client.ts —
// every call is a thin apiFetch<T> wrapper, no client-side business logic.
// Endpoint paths/payload shapes are verified against the real Fastify route
// registrations (not guessed):
//   services/vehicle-accounting-service/src/http/{unit,demo,lcnrv,dealer-trade,config}-routes.ts
//   services/floorplan-service/src/http/routes.ts
import { apiFetch } from './client';

const VEHICLE_ACCOUNTING_BASE = '/api/v1/vehicle-accounting';
const FLOORPLAN_BASE = '/api/v1/floorplan';

// ─────────────────────────────────────────────────────────────────────────
// vehicle-accounting-service
// ─────────────────────────────────────────────────────────────────────────
export const vehicleAccountingApi = {
  // S074 — Vehicle Unit Ledger & Stock-In
  stockIn: (data: {
    eventId: string;
    correlationId?: string;
    stockNumber: string;
    vin: string;
    entityId: string;
    storeId: string;
    status: 'NEW' | 'USED' | 'DEMO' | 'WHOLESALE';
    acquisitionType: 'PURCHASE' | 'TRADE_IN' | 'DEALER_TRADE_IN' | 'FACTORY_RECEIPT';
    invoiceCost: string;
    transportCost?: string;
    packCost?: string;
    packRole?: 'PACK_INCOME' | 'HOLDBACK_CLEARING';
    equipmentCost?: string;
  }) => apiFetch<any>(`${VEHICLE_ACCOUNTING_BASE}/units/stock-in`, { method: 'POST', body: JSON.stringify(data) }),

  addCostComponent: (
    stockNumber: string,
    data: { eventId: string; correlationId?: string; componentType: 'TRANSPORT' | 'PACK' | 'EQUIPMENT'; amount: string; packRole?: 'PACK_INCOME' | 'HOLDBACK_CLEARING' },
  ) => apiFetch<any>(`${VEHICLE_ACCOUNTING_BASE}/units/${encodeURIComponent(stockNumber)}/cost-components`, { method: 'POST', body: JSON.stringify(data) }),

  addReconCost: (stockNumber: string, data: { eventId: string; correlationId?: string; roNumber: string; amount: string }) =>
    apiFetch<any>(`${VEHICLE_ACCOUNTING_BASE}/units/${encodeURIComponent(stockNumber)}/recon-cost`, { method: 'POST', body: JSON.stringify(data) }),

  listUnits: (params?: string) => apiFetch<{ items: any[] }>(`${VEHICLE_ACCOUNTING_BASE}/units${params ? `?${params}` : ''}`),

  getUnit: (idOrStockNumber: string) => apiFetch<any>(`${VEHICLE_ACCOUNTING_BASE}/units/${encodeURIComponent(idOrStockNumber)}`),

  // S075 — Demo Reclass & Depreciation
  demoReclass: (stockNumber: string, data: { eventId: string; idempotencyKey?: string; correlationId?: string }) =>
    apiFetch<any>(`${VEHICLE_ACCOUNTING_BASE}/units/${encodeURIComponent(stockNumber)}/demo-reclass`, { method: 'POST', body: JSON.stringify(data) }),

  previewDemoValueAdjustment: (stockNumber: string) =>
    apiFetch<any>(`${VEHICLE_ACCOUNTING_BASE}/units/${encodeURIComponent(stockNumber)}/demo-value-adjustment/preview`, { method: 'POST', body: JSON.stringify({}) }),

  approveDemoValueAdjustment: (id: string, data: { approvedAmount: string; eventId: string; idempotencyKey?: string }) =>
    apiFetch<any>(`${VEHICLE_ACCOUNTING_BASE}/demo-value-adjustments/${id}/approve`, { method: 'POST', body: JSON.stringify(data) }),

  rejectDemoValueAdjustment: (id: string, data: { reason: string }) =>
    apiFetch<any>(`${VEHICLE_ACCOUNTING_BASE}/demo-value-adjustments/${id}/reject`, { method: 'POST', body: JSON.stringify(data) }),

  reverseDemoValueAdjustment: (id: string, data: { reason: string }) =>
    apiFetch<any>(`${VEHICLE_ACCOUNTING_BASE}/demo-value-adjustments/${id}/reverse`, { method: 'POST', body: JSON.stringify(data) }),

  listDemoValueAdjustments: (params?: string) => apiFetch<{ items: any[] }>(`${VEHICLE_ACCOUNTING_BASE}/demo-value-adjustments${params ? `?${params}` : ''}`),

  // S076 — Used LCNRV Write-downs
  addLcnrvEvidence: (stockNumber: string, data: { marketValue: string; source: string; reference?: string; note?: string }) =>
    apiFetch<any>(`${VEHICLE_ACCOUNTING_BASE}/units/${encodeURIComponent(stockNumber)}/lcnrv-evidence`, { method: 'POST', body: JSON.stringify(data) }),

  getLcnrvWorklist: (params?: string) => apiFetch<{ items: any[] }>(`${VEHICLE_ACCOUNTING_BASE}/lcnrv/worklist${params ? `?${params}` : ''}`),

  lcnrvWriteDown: (stockNumber: string, data: { evidenceId: string; reason: string; eventId: string; idempotencyKey?: string }) =>
    apiFetch<any>(`${VEHICLE_ACCOUNTING_BASE}/units/${encodeURIComponent(stockNumber)}/lcnrv-writedown`, { method: 'POST', body: JSON.stringify(data) }),

  listLcnrvWriteDowns: (params?: string) => apiFetch<{ items: any[] }>(`${VEHICLE_ACCOUNTING_BASE}/lcnrv/write-downs${params ? `?${params}` : ''}`),

  // S077 — Dealer Trades
  dealerTradeOutbound: (data: { tradeNumber: string; entityId: string; storeId: string; counterpartyDealer: string; stockNumber: string; agreedValue: string; eventId: string; idempotencyKey?: string }) =>
    apiFetch<any>(`${VEHICLE_ACCOUNTING_BASE}/dealer-trades/outbound`, { method: 'POST', body: JSON.stringify(data) }),

  dealerTradeInbound: (data: { tradeNumber: string; entityId: string; storeId: string; counterpartyDealer: string; stockNumber: string; vin: string; status: 'NEW' | 'USED' | 'DEMO' | 'WHOLESALE'; acv: string; eventId: string; idempotencyKey?: string }) =>
    apiFetch<any>(`${VEHICLE_ACCOUNTING_BASE}/dealer-trades/inbound`, { method: 'POST', body: JSON.stringify(data) }),

  dealerTradeSettle: (tradeNumber: string, data: { eventId: string; idempotencyKey?: string; cashDifferenceNote?: string }) =>
    apiFetch<any>(`${VEHICLE_ACCOUNTING_BASE}/dealer-trades/${encodeURIComponent(tradeNumber)}/settle`, { method: 'POST', body: JSON.stringify(data) }),

  listDealerTrades: (params?: string) => apiFetch<{ items: any[] }>(`${VEHICLE_ACCOUNTING_BASE}/dealer-trades${params ? `?${params}` : ''}`),

  getDealerTrade: (tradeNumber: string) => apiFetch<any>(`${VEHICLE_ACCOUNTING_BASE}/dealer-trades/${encodeURIComponent(tradeNumber)}`),

  // SAFE_CONFIGURATION — read-only lookups used to explain ceremony refusals/behavior
  getLcnrvThreshold: (entityId: string) => apiFetch<any>(`${VEHICLE_ACCOUNTING_BASE}/config/lcnrv-threshold?entityId=${encodeURIComponent(entityId)}`),
  getDemoDepreciationBasis: (entityId: string) => apiFetch<any>(`${VEHICLE_ACCOUNTING_BASE}/config/demo-depreciation-basis?entityId=${encodeURIComponent(entityId)}`),
};

// ─────────────────────────────────────────────────────────────────────────
// floorplan-service
// ─────────────────────────────────────────────────────────────────────────
export const floorplanApi = {
  // S079 — Lender profiles / feed status / staged rows
  listLenders: () => apiFetch<{ items: any[] }>(`${FLOORPLAN_BASE}/lenders`),

  getFeedStatus: (lenderCode: string) => apiFetch<any>(`${FLOORPLAN_BASE}/lenders/${encodeURIComponent(lenderCode)}/feed-status`),

  upsertLender: (lenderCode: string, data: { lenderName: string; adapterStatus: 'CONFIGURED' | 'NOT_CONFIGURED'; adapterType: 'FIXTURE_FEED' | 'NOT_CONFIGURED' }) =>
    apiFetch<any>(`${FLOORPLAN_BASE}/lenders/${encodeURIComponent(lenderCode)}`, { method: 'PUT', body: JSON.stringify(data) }),

  importFeedBatch: (lenderCode: string, data: { rows: any[]; fixtureLabel: string }) =>
    apiFetch<any>(`${FLOORPLAN_BASE}/lenders/${encodeURIComponent(lenderCode)}/import/feed`, { method: 'POST', body: JSON.stringify(data) }),

  importManualBatch: (lenderCode: string, data: { rows: any[]; note?: string }) =>
    apiFetch<any>(`${FLOORPLAN_BASE}/lenders/${encodeURIComponent(lenderCode)}/import/manual`, { method: 'POST', body: JSON.stringify(data) }),

  listImportBatches: (lenderCode?: string) => apiFetch<{ items: any[] }>(`${FLOORPLAN_BASE}/import-batches${lenderCode ? `?lenderCode=${encodeURIComponent(lenderCode)}` : ''}`),

  listStagedRows: (params?: string) => apiFetch<{ items: any[] }>(`${FLOORPLAN_BASE}/staged-rows${params ? `?${params}` : ''}`),

  getStagedRow: (id: string) => apiFetch<any>(`${FLOORPLAN_BASE}/staged-rows/${id}`),

  supersedeStagedRow: (id: string, data: { replacement: any; note?: string }) =>
    apiFetch<any>(`${FLOORPLAN_BASE}/staged-rows/${id}/supersede`, { method: 'POST', body: JSON.stringify(data) }),

  // S080 — VIN match, breaks, liability items, tie-out
  matchStagedRow: (id: string) => apiFetch<any>(`${FLOORPLAN_BASE}/staged-rows/${id}/match`, { method: 'POST', body: JSON.stringify({}) }),

  listMatches: (params?: string) => apiFetch<{ items: any[] }>(`${FLOORPLAN_BASE}/matches${params ? `?${params}` : ''}`),

  listLiabilityItems: (params?: string) => apiFetch<{ items: any[] }>(`${FLOORPLAN_BASE}/liability-items${params ? `?${params}` : ''}`),

  getLiabilityItem: (id: string) => apiFetch<any>(`${FLOORPLAN_BASE}/liability-items/${id}`),

  getTieOut: (lenderCode?: string) => apiFetch<any>(`${FLOORPLAN_BASE}/tie-out${lenderCode ? `?lenderCode=${encodeURIComponent(lenderCode)}` : ''}`),

  scanForWeHaveLenderDoesntBreaks: (lenderCode: string) =>
    apiFetch<{ created: number }>(`${FLOORPLAN_BASE}/lenders/${encodeURIComponent(lenderCode)}/breaks/scan`, { method: 'POST', body: JSON.stringify({}) }),

  listBreaks: (params?: string) => apiFetch<{ items: any[] }>(`${FLOORPLAN_BASE}/breaks${params ? `?${params}` : ''}`),

  getBreak: (id: string) => apiFetch<any>(`${FLOORPLAN_BASE}/breaks/${id}`),

  dispositionBreak: (id: string, data: { action: 'ACCEPT_LENDER_FIGURE' | 'ACCEPT_OUR_FIGURE' | 'WRITE_OFF_VARIANCE' | 'ESCALATE' | 'NO_ACTION_DOCUMENTED'; reason: string; idempotencyKey: string; deptCode?: string }) =>
    apiFetch<any>(`${FLOORPLAN_BASE}/breaks/${id}/disposition`, { method: 'POST', body: JSON.stringify(data) }),

  // S081 — SOT monitor / delivery events (READ-ONLY screen; delivery-events
  // POST included for completeness of the client but the SOT Monitor page
  // itself never calls it — per the epic package, that screen is read-only).
  recordDeliveryEvent: (data: { vin?: string; stockNumber?: string; dealNumber: string; deliveredAt: string; idempotencyKey: string; source?: 'WEBHOOK' | 'MANUAL_FIXTURE' }) =>
    apiFetch<any>(`${FLOORPLAN_BASE}/delivery-events`, { method: 'POST', body: JSON.stringify(data) }),

  getSotDashboard: () => apiFetch<{ tenantId: string; tiles: { WATCH: number; ESCALATED: number; RESOLVED: number }; totalDelivered: number }>(`${FLOORPLAN_BASE}/sot/dashboard`),

  listSotExceptions: (params?: string) => apiFetch<{ items: any[] }>(`${FLOORPLAN_BASE}/sot/exceptions${params ? `?${params}` : ''}`),

  getSotAging: () => apiFetch<{ items: any[] }>(`${FLOORPLAN_BASE}/sot/aging`),

  getSotException: (id: string) => apiFetch<any>(`${FLOORPLAN_BASE}/sot/exceptions/${id}`),

  // S082 — Interest statements / accrual / curtailments
  enterInterestStatement: (data: { lenderCode: string; statementDate: string; totalInterestAmount: string; allocationBasis?: 'PER_UNIT_EQUAL' | 'PER_UNIT_BALANCE_WEIGHTED'; idempotencyKey: string }) =>
    apiFetch<any>(`${FLOORPLAN_BASE}/interest/statements`, { method: 'POST', body: JSON.stringify(data) }),

  listInterestStatements: (params?: string) => apiFetch<{ items: any[] }>(`${FLOORPLAN_BASE}/interest/statements${params ? `?${params}` : ''}`),

  getInterestStatement: (id: string) => apiFetch<any>(`${FLOORPLAN_BASE}/interest/statements/${id}`),

  allocateInterestStatement: (id: string) => apiFetch<{ items: any[] }>(`${FLOORPLAN_BASE}/interest/statements/${id}/allocate`, { method: 'POST', body: JSON.stringify({}) }),

  postInterestAccrual: (id: string) => apiFetch<any>(`${FLOORPLAN_BASE}/interest/statements/${id}/post-accrual`, { method: 'POST', body: JSON.stringify({}) }),

  reverseInterestAccrual: (id: string, reason: string) =>
    apiFetch<any>(`${FLOORPLAN_BASE}/interest/statements/${id}/reverse`, { method: 'POST', body: JSON.stringify({ reason }) }),

  configureCurtailmentSchedule: (data: { lenderCode: string; intervalDays: number; curtailmentPercent: string; effectiveFrom: string; effectiveTo?: string }) =>
    apiFetch<any>(`${FLOORPLAN_BASE}/curtailment/schedules`, { method: 'POST', body: JSON.stringify(data) }),

  listCurtailmentSchedules: (lenderCode?: string) => apiFetch<{ items: any[] }>(`${FLOORPLAN_BASE}/curtailment/schedules${lenderCode ? `?lenderCode=${encodeURIComponent(lenderCode)}` : ''}`),

  payCurtailment: (data: { itemId: string; amount: string; paidAt: string; idempotencyKey: string }) =>
    apiFetch<any>(`${FLOORPLAN_BASE}/curtailment/payments`, { method: 'POST', body: JSON.stringify(data) }),

  listCurtailmentPayments: (params?: string) => apiFetch<{ items: any[] }>(`${FLOORPLAN_BASE}/curtailment/payments${params ? `?${params}` : ''}`),

  // SAFE_CONFIGURATION — tenant config (grace period, default allocation basis)
  getFloorplanConfig: () => apiFetch<any>(`${FLOORPLAN_BASE}/config`),
};
