const API_BASE = import.meta.env.VITE_API_URL ?? '';
const API_TIMEOUT_MS = 10_000;

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const tenantId = localStorage.getItem('tenantId') || 'tenant-kunes';
  if (!localStorage.getItem('tenantId')) localStorage.setItem('tenantId', tenantId);
  const headers: Record<string, string> = {
    'x-tenant-id': tenantId,
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `API error ${res.status}`);
    }
    return res.json();
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${API_TIMEOUT_MS / 1000}s — ${path}. Check that all services are running.`);
    }
    throw error;
  }
}

// Tenant API
export const tenantApi = {
  list: () => apiFetch<any[]>('/api/v1/tenants', { headers: { 'x-admin-api-key': 'amacc-admin-dev-key' } }),
  getById: (id: string) => apiFetch<any>(`/api/v1/tenants/${id}`),
  create: (data: any) => apiFetch<any>('/api/v1/tenants', { method: 'POST', body: JSON.stringify(data), headers: { 'x-admin-api-key': 'amacc-admin-dev-key' } }),
};

// Command Center API — 7 dedicated computed endpoints
export const commandCenterApi = {
  getLiveStats: () => apiFetch<any>('/api/v1/command-center/live-stats'),
  getAlerts: () => apiFetch<any>('/api/v1/command-center/alerts'),
  getGLMonitor: () => apiFetch<any>('/api/v1/command-center/gl-monitor'),
  getKpiTrends: () => apiFetch<any>('/api/v1/command-center/kpi-trends'),
  getCharts: () => apiFetch<any>('/api/v1/command-center/charts'),
  postAction: (alertId: string, actionType: string) => apiFetch<any>('/api/v1/command-center/action', { method: 'POST', body: JSON.stringify({ alertId, actionType }) }),
  askAshley: (question: string) => apiFetch<any>('/api/v1/command-center/ashley', { method: 'POST', body: JSON.stringify({ question }) }),
};

// GL API
export const glApi = {
  getAccounts: () => apiFetch<any[]>('/api/v1/gl/accounts'),
  searchAccounts: (q: string) => apiFetch<any[]>(`/api/v1/gl/accounts?q=${encodeURIComponent(q)}`),
  createAccount: (data: any) => apiFetch<any>('/api/v1/gl/accounts', { method: 'POST', body: JSON.stringify(data) }),
  getAccountInquiry: (code: string, typeCode?: number, params?: string) =>
    apiFetch<any>(`/api/v1/gl/accounts/${encodeURIComponent(code)}/inquiry?typeCode=${typeCode ?? 1}${params ? `&${params}` : ''}`),
  getEntries: (params?: string) => apiFetch<any[]>(`/api/v1/gl/journal-entries${params ? `?${params}` : ''}`),
  createEntry: (data: any) => apiFetch<any>('/api/v1/gl/journal-entries', { method: 'POST', body: JSON.stringify(data) }),
  postEntry: (id: string) => apiFetch<any>(`/api/v1/gl/journal-entries/${id}/post`, { method: 'POST' }),
  approveEntry: (id: string) => apiFetch<any>(`/api/v1/gl/journal-entries/${id}/approve`, { method: 'POST' }),
  // /gl/entries — canonical journal entry management endpoint
  listEntries: (params?: string) => apiFetch<any[]>(`/api/v1/gl/entries${params ? `?${params}` : ''}`),
  createJournalEntry: (data: any) => apiFetch<any>('/api/v1/gl/entries', { method: 'POST', body: JSON.stringify(data) }),
  submitEntry: (id: string) => apiFetch<any>(`/api/v1/gl/entries/${id}/submit`, { method: 'POST' }),
  getTrialBalance: (year: number, month: number) => apiFetch<any>(`/api/v1/gl/trial-balance?year=${year}&month=${month}`),
  getBalanceSheet: (asOfDate?: string) => apiFetch<any>(`/api/v1/gl/balance-sheet${asOfDate ? `?asOfDate=${asOfDate}` : ''}`),
  getIncomeStatement: (year: number, month: number) => apiFetch<any>(`/api/v1/gl/income-statement?year=${year}&month=${month}`),
  getCashFlowStatement: (year: number, month: number) => apiFetch<any>(`/api/v1/gl/cash-flow-statement?year=${year}&month=${month}`),
  getPeriods: () => apiFetch<any[]>('/api/v1/gl/periods'),
};

// Dashboard API
export const dashboardApi = {
  getSummary: () => apiFetch<any>('/api/v1/dashboard/summary'),
};

// EOM API
export const eomApi = {
  list: () => apiFetch<any[]>('/api/v1/eom/'),
  getById: (id: string) => apiFetch<any>(`/api/v1/eom/${id}`),
  initiate: (year: number, month: number) => apiFetch<any>('/api/v1/eom/', { method: 'POST', body: JSON.stringify({ year, month }) }),
  advance: (id: string) => apiFetch<any>(`/api/v1/eom/${id}/advance`, { method: 'POST' }),
  retry: (id: string) => apiFetch<any>(`/api/v1/eom/${id}/retry-step`, { method: 'POST' }),
  getSteps: (id: string) => apiFetch<any[]>(`/api/v1/eom/${id}/steps`),
  getReadiness: () => apiFetch<any>('/api/v1/eom/readiness'),
  // EOM Close Dashboard endpoints
  getPreview: () => apiFetch<any>('/api/v1/eom/preview'),
  close: (year: number, month: number) => apiFetch<any>('/api/v1/eom/close', { method: 'POST', body: JSON.stringify({ year, month }) }),
  getCloseById: (id: string) => apiFetch<any>(`/api/v1/eom/${id}`),
};

// Payroll API
export const payrollApi = {
  getBatches: () => apiFetch<any[]>('/api/v1/payroll/batches'),
  getBatch: (id: string) => apiFetch<any>(`/api/v1/payroll/batches/${id}`),
  submit: (data: any) => apiFetch<any>('/api/v1/payroll/batches', { method: 'POST', body: JSON.stringify(data) }),
  validate: (id: string) => apiFetch<any>(`/api/v1/payroll/batches/${id}/validate`, { method: 'POST' }),
  post: (id: string) => apiFetch<any>(`/api/v1/payroll/batches/${id}/post`, { method: 'POST' }),
  hold: (id: string, reason: string) => apiFetch<any>(`/api/v1/payroll/batches/${id}/hold`, { method: 'POST', body: JSON.stringify({ reason }) }),
  release: (id: string) => apiFetch<any>(`/api/v1/payroll/batches/${id}/release`, { method: 'POST' }),
};

// Recon API
export const reconApi = {
  list: () => apiFetch<any[]>('/api/v1/recon'),
  create: (data: any) => apiFetch<any>('/api/v1/recon', { method: 'POST', body: JSON.stringify(data) }),
  importTxns: (id: string, transactions: any[]) => apiFetch<any>(`/api/v1/recon/${id}/import`, { method: 'POST', body: JSON.stringify({ transactions }) }),
  getUnmatched: (id: string) => apiFetch<any[]>(`/api/v1/recon/${id}/unmatched`),
  matchManual: (id: string, txnId: string, lineId: string) => apiFetch<any>(`/api/v1/recon/${id}/match-manual`, { method: 'POST', body: JSON.stringify({ transactionId: txnId, journalLineId: lineId }) }),
  complete: (id: string) => apiFetch<any>(`/api/v1/recon/${id}/complete`, { method: 'POST' }),
};

// APAR API
export const aparApi = {
  getAR: () => apiFetch<any[]>('/api/v1/apar/ar'),
  createAR: (data: any) => apiFetch<any>('/api/v1/apar/ar', { method: 'POST', body: JSON.stringify(data) }),
  getAP: () => apiFetch<any[]>('/api/v1/apar/ap'),
  createAP: (data: any) => apiFetch<any>('/api/v1/apar/ap', { method: 'POST', body: JSON.stringify(data) }),
};

// Agents API
export const agentApi = {
  getLog: () => apiFetch<any[]>('/api/v1/agents/log'),
  getLogEntry: (id: string) => apiFetch<any>(`/api/v1/agents/log/${id}`),
  resolve: (id: string) => apiFetch<any>(`/api/v1/agents/log/${id}/resolve`, { method: 'POST' }),
};

// COA API
export const coaApi = {
  getStandard: (version = '2026.1') => apiFetch<any>(`/api/v1/coa/standard/${version}`),
  getTenant: (tenantId: string) => apiFetch<any>(`/api/v1/coa/tenant/${tenantId}`),
  getOEMMapping: (tenantId: string, oem: string) => apiFetch<any>(`/api/v1/coa/oem-mapping/${tenantId}/${oem}`),
  getUnmapped: (tenantId: string, oem: string) => apiFetch<any>(`/api/v1/coa/unmapped/${tenantId}/${oem}`),
};

// FS API — Financial Statement data from GL aggregation
// The backend queries GL trial balance, joins with gl_relate mappings,
// and returns aggregated OEM line amounts per company/period/franchise.
export const fsApi = {
  getData: (company: string, period: string, oem: string) =>
    apiFetch<any>(`/api/v2/accounting/companies/${company}/financial-statement/data?period=${period}&oem=${oem}`),
  getSetups: (company: string) =>
    apiFetch<any[]>(`/api/v2/accounting/companies/${company}/financial-statement/setups`),
  getGlRelate: (company: string, fsSetupId: string) =>
    apiFetch<any[]>(`/api/v2/accounting/companies/${company}/financial-statement/gl-relate?fsSetupId=${fsSetupId}`),
  validate: (company: string, period: string, oem: string) =>
    apiFetch<any>(`/api/v2/accounting/companies/${company}/financial-statement/validate?period=${period}&oem=${oem}`),
  submit: (company: string, period: string, oem: string) =>
    apiFetch<any>(`/api/v2/accounting/companies/${company}/financial-statement/submit`, { method: 'POST', body: JSON.stringify({ period, oem }) }),
  getArchive: (company: string, period: string, oem: string) =>
    apiFetch<any>(`/api/v2/accounting/companies/${company}/financial-statement/archive?period=${period}&oem=${oem}`),
};

// Approvals API
export const approvalApi = {
  getPending: (tenantId: string) => apiFetch<any[]>(`/api/v1/approvals/pending/${tenantId}`),
  approve: (id: string) => apiFetch<any>(`/api/v1/approvals/${id}/approve`, { method: 'POST' }),
  reject: (id: string, note?: string) => apiFetch<any>(`/api/v1/approvals/${id}/reject`, { method: 'POST', body: JSON.stringify({ decision: 'REJECT', note }) }),
  getHistory: (tenantId: string) => apiFetch<any[]>(`/api/v1/approvals/history/${tenantId}`),
};

// Onboarding API
export const onboardingApi = {
  start: (data: { dealerName: string; slug: string; oems: string[] }) => apiFetch<any>('/api/v1/onboarding/start', { method: 'POST', body: JSON.stringify(data) }),
  completeStep: (sessionId: string, step: string, data: any) => apiFetch<any>(`/api/v1/onboarding/${sessionId}/step`, { method: 'POST', body: JSON.stringify({ step, data }) }),
  getSession: (sessionId: string) => apiFetch<any>(`/api/v1/onboarding/${sessionId}`),
  list: () => apiFetch<any[]>('/api/v1/onboarding'),
};

// Transactions API
export const transactionApi = {
  list: (params?: string) => apiFetch<any[]>(`/api/v1/transactions${params ? `?${params}` : ''}`),
  getById: (id: string) => apiFetch<any>(`/api/v1/transactions/${id}`),
  create: (data: any) => apiFetch<any>('/api/v1/transactions', { method: 'POST', body: JSON.stringify(data) }),
  post: (id: string) => apiFetch<any>(`/api/v1/transactions/${id}/post`, { method: 'POST' }),
  batchPost: (ids: string[]) => apiFetch<any>('/api/v1/transactions/batch-post', { method: 'POST', body: JSON.stringify({ ids }) }),
  reverse: (id: string) => apiFetch<any>(`/api/v1/transactions/${id}/reverse`, { method: 'POST' }),
};

// Schedules API
export const scheduleApi = {
  list: () => apiFetch<any[]>('/api/v1/schedules'),
  getById: (id: string) => apiFetch<any>(`/api/v1/schedules/${id}`),
  getAging: (params?: string) => apiFetch<any>(`/api/v1/schedules/aging${params ? `?${params}` : ''}`),
  getStatements: (params?: string) => apiFetch<any[]>(`/api/v1/schedules/statements${params ? `?${params}` : ''}`),
};

// Cashflow API
export const cashflowApi = {
  getForecast: () => apiFetch<any>('/api/v1/cashflow/forecast'),
  getActuals: () => apiFetch<any[]>('/api/v1/cashflow/actuals'),
  getLatest: () => apiFetch<any[]>('/api/v1/cashflow/latest'),
};

// Accounts Payable API
export const apApi = {
  getVouchers: (params?: string) => apiFetch<any[]>(`/api/v1/ap/vouchers${params ? `?${params}` : ''}`),
  createVoucher: (data: any) => apiFetch<any>('/api/v1/ap/vouchers', { method: 'POST', body: JSON.stringify(data) }),
  getPayments: () => apiFetch<any[]>('/api/v1/ap/payments'),
  createPayment: (data: any) => apiFetch<any>('/api/v1/ap/payments', { method: 'POST', body: JSON.stringify(data) }),
  getAging: () => apiFetch<any>('/api/v1/ap/aging'),
};

// Cash Receipts API
export const cashReceiptApi = {
  list: () => apiFetch<any[]>('/api/v1/cash-receipts'),
  create: (data: any) => apiFetch<any>('/api/v1/cash-receipts', { method: 'POST', body: JSON.stringify(data) }),
  getDeposits: () => apiFetch<any[]>('/api/v1/cash-receipts/deposits'),
  createDeposit: (data: any) => apiFetch<any>('/api/v1/cash-receipts/deposits', { method: 'POST', body: JSON.stringify(data) }),
};

// Reports API
export const reportApi = {
  generate: (type: string, params: any) => apiFetch<any>('/api/v1/reports/generate', { method: 'POST', body: JSON.stringify({ type, ...params }) }),
  getHistory: () => apiFetch<any[]>('/api/v1/reports/history'),
  schedule: (data: any) => apiFetch<any>('/api/v1/reports/schedule', { method: 'POST', body: JSON.stringify(data) }),
};

// Journal Sources API (company-scoped)
export const journalSourceApi = {
  list: (companyId = '01') => apiFetch<any[]>(`/api/v1/companies/${companyId}/journal-sources`),
  getByCode: (code: string, companyId = '01') => apiFetch<any>(`/api/v1/companies/${companyId}/journal-sources/${code}`),
  create: (data: any, companyId = '01') => apiFetch<any>(`/api/v1/companies/${companyId}/journal-sources`, { method: 'POST', body: JSON.stringify(data) }),
  update: (code: string, data: any, companyId = '01') => apiFetch<any>(`/api/v1/companies/${companyId}/journal-sources/${code}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (code: string, companyId = '01') => apiFetch<any>(`/api/v1/companies/${companyId}/journal-sources/${code}`, { method: 'DELETE' }),
  getPending: (code: string, companyId = '01') => apiFetch<any[]>(`/api/v1/companies/${companyId}/journal-sources/${code}/pending`),
  postAll: (code: string, companyId = '01') => apiFetch<any>(`/api/v1/companies/${companyId}/journal-sources/${code}/post-all`, { method: 'POST' }),
  validate: (companyId = '01') => apiFetch<any[]>(`/api/v1/companies/${companyId}/journal-sources/validate`),
  getStuckTransactions: (companyId = '01') => apiFetch<any[]>(`/api/v1/companies/${companyId}/journal-sources/stuck-transactions`),
  resolveStuck: (transactionId: string, companyId = '01') => apiFetch<any>(`/api/v1/companies/${companyId}/journal-sources/stuck-transactions/${transactionId}/resolve`, { method: 'POST' }),
  getEOMAutoPostSources: (companyId = '01') => apiFetch<any[]>(`/api/v1/companies/${companyId}/journal-sources/eom-auto-post`),
  preflightPermissionCheck: (companyId = '01') => apiFetch<any>(`/api/v1/companies/${companyId}/journal-sources/preflight-permissions`),
};

// Setup API
export const setupApi = {
  getCompany: () => apiFetch<any>('/api/v1/setup/company'),
  updateCompany: (data: any) => apiFetch<any>('/api/v1/setup/company', { method: 'PUT', body: JSON.stringify(data) }),
  getPeriods: (year: number) => apiFetch<any[]>(`/api/v1/setup/periods?year=${year}`),
  getDepartments: () => apiFetch<any[]>('/api/v1/setup/departments'),
  getDefaults: () => apiFetch<any>('/api/v1/setup/defaults'),
  updateDefaults: (data: any) => apiFetch<any>('/api/v1/setup/defaults', { method: 'PUT', body: JSON.stringify(data) }),
};

// Purchase Orders API
export const purchaseOrderApi = {
  list: (params?: string) => apiFetch<any[]>(`/api/v1/purchase-orders${params ? `?${params}` : ''}`),
  create: (data: any) => apiFetch<any>('/api/v1/purchase-orders', { method: 'POST', body: JSON.stringify(data) }),
  receive: (id: string, data: any) => apiFetch<any>(`/api/v1/purchase-orders/${id}/receive`, { method: 'POST', body: JSON.stringify(data) }),
};

// Vendor API
export const vendorApi = {
  list: (params?: string) => apiFetch<any[]>(`/api/v1/vendors${params ? `?${params}` : ''}`),
  getById: (id: string) => apiFetch<any>(`/api/v1/vendors/${id}`),
  create: (data: any) => apiFetch<any>('/api/v1/vendors', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) => apiFetch<any>(`/api/v1/vendors/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
};

// Intercompany API
export const intercompanyApi = {
  list: () => apiFetch<any[]>('/api/v1/intercompany/transfers'),
  create: (data: any) => apiFetch<any>('/api/v1/intercompany/transfers', { method: 'POST', body: JSON.stringify(data) }),
  post: (id: string) => apiFetch<any>(`/api/v1/intercompany/transfers/${id}/post`, { method: 'POST' }),
  getCompanies: () => apiFetch<any[]>('/api/v1/intercompany/companies'),
};

// Warranty / DCS API
export const warrantyApi = {
  getClaims: (params?: string) => apiFetch<any[]>(`/api/v1/warranty/claims${params ? `?${params}` : ''}`),
  submitClaim: (data: any) => apiFetch<any>('/api/v1/warranty/claims', { method: 'POST', body: JSON.stringify(data) }),
  getFactoryStatements: (oem: string, period: string) => apiFetch<any>(`/api/v1/warranty/factory-statements?oem=${oem}&period=${period}`),
};

// Year-End API
export const yearEndApi = {
  getChecklist: (year: number) => apiFetch<any>(`/api/v1/year-end/${year}/checklist`),
  completeStep: (year: number, step: number) => apiFetch<any>(`/api/v1/year-end/${year}/steps/${step}/complete`, { method: 'POST' }),
  validate: (year: number) => apiFetch<any>(`/api/v1/year-end/${year}/validate`),
  close: (year: number, data: any) => apiFetch<any>(`/api/v1/year-end/${year}/close`, { method: 'POST', body: JSON.stringify(data) }),
  getHistory: () => apiFetch<any[]>('/api/v1/year-end/history'),
};

// Utilities API
export const utilityApi = {
  scanOOB: (period: string) => apiFetch<any>('/api/v1/utilities/fix-oob/scan', { method: 'POST', body: JSON.stringify({ period }) }),
  fixOOB: (txnIds: string[], correctionAccount: string) => apiFetch<any>('/api/v1/utilities/fix-oob/fix', { method: 'POST', body: JSON.stringify({ txnIds, correctionAccount }) }),
  recalcBalances: (period: string) => apiFetch<any>('/api/v1/utilities/recalc-balances', { method: 'POST', body: JSON.stringify({ period }) }),
  rebuildIndexes: () => apiFetch<any>('/api/v1/utilities/rebuild-indexes', { method: 'POST' }),
  validateCOA: () => apiFetch<any>('/api/v1/utilities/validate-coa'),
  getLog: () => apiFetch<any[]>('/api/v1/utilities/log'),
};

// Bank Deposits API
export const bankDepositApi = {
  list: () => apiFetch<any[]>('/api/v1/bank-deposits'),
  create: (data: any) => apiFetch<any>('/api/v1/bank-deposits', { method: 'POST', body: JSON.stringify(data) }),
  submit: (id: string) => apiFetch<any>(`/api/v1/bank-deposits/${id}/submit`, { method: 'POST' }),
  getUndeposited: () => apiFetch<any[]>('/api/v1/bank-deposits/undeposited'),
};

// ═══════════════════════════════════════════════════════════════════
// File Maintenance API — Company-scoped endpoints per spec
// ═══════════════════════════════════════════════════════════════════

const co = (companyId: string) => `/api/v1/companies/${encodeURIComponent(companyId)}`;

// Chart of Accounts (GLACC)
export const fileMaintenanceCoaApi = {
  list: (companyId: string, params?: string) => apiFetch<any[]>(`${co(companyId)}/accounts${params ? `?${params}` : ''}`),
  getById: (companyId: string, acctNum: string) => apiFetch<any>(`${co(companyId)}/accounts/${encodeURIComponent(acctNum)}`),
  create: (companyId: string, data: any) => apiFetch<any>(`${co(companyId)}/accounts`, { method: 'POST', body: JSON.stringify(data) }),
  update: (companyId: string, acctNum: string, data: any) => apiFetch<any>(`${co(companyId)}/accounts/${encodeURIComponent(acctNum)}`, { method: 'PUT', body: JSON.stringify(data) }),
  validate: (companyId: string) => apiFetch<any>(`${co(companyId)}/accounts/validate`),
  health: (companyId: string) => apiFetch<any>(`${co(companyId)}/accounts/health`),
};

// Schedule Format File Maintenance (SCHEDPR / SCHDUPKY)
export const fileMaintenanceScheduleApi = {
  list: (companyId: string) => apiFetch<any[]>(`${co(companyId)}/schedules`),
  getById: (companyId: string, schedId: number) => apiFetch<any>(`${co(companyId)}/schedules/${schedId}`),
  update: (companyId: string, schedId: number, data: any) => apiFetch<any>(`${co(companyId)}/schedules/${schedId}`, { method: 'PUT', body: JSON.stringify(data) }),
  crossCheck: (companyId: string) => apiFetch<any>(`${co(companyId)}/schedules/cross-check`),
  reconciliation: (companyId: string, schedId: number) => apiFetch<any>(`${co(companyId)}/schedules/${schedId}/reconciliation`),
};

// Standard Journal Entries (STDJNL)
export const fileMaintenanceSjeApi = {
  list: (companyId: string) => apiFetch<any[]>(`${co(companyId)}/journal-entries`),
  getById: (companyId: string, id: string) => apiFetch<any>(`${co(companyId)}/journal-entries/${encodeURIComponent(id)}`),
  create: (companyId: string, data: any) => apiFetch<any>(`${co(companyId)}/journal-entries`, { method: 'POST', body: JSON.stringify(data) }),
  update: (companyId: string, id: string, data: any) => apiFetch<any>(`${co(companyId)}/journal-entries/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
  post: (companyId: string, ids: string[]) => apiFetch<any>(`${co(companyId)}/journal-entries/post`, { method: 'POST', body: JSON.stringify({ ids }) }),
  reverse: (companyId: string, id: string) => apiFetch<any>(`${co(companyId)}/journal-entries/${encodeURIComponent(id)}/reverse`, { method: 'POST' }),
  importCsv: (companyId: string, data: any) => apiFetch<any>(`${co(companyId)}/journal-entries/import`, { method: 'POST', body: JSON.stringify(data) }),
};

// System Settings — Company Config (SYSUPCHO)
export const companyConfigApi = {
  get: (companyId: string) => apiFetch<any>(`${co(companyId)}/config`),
  update: (companyId: string, data: any) => apiFetch<any>(`${co(companyId)}/config`, { method: 'PUT', body: JSON.stringify(data) }),
  validate: (companyId: string) => apiFetch<any>(`${co(companyId)}/config/validate`, { method: 'POST' }),
};

// System Settings — Warranty Remittance
export const warrantyRemittanceApi = {
  list: (companyId: string) => apiFetch<any[]>(`${co(companyId)}/warranty-remittance`),
  create: (companyId: string, data: any) => apiFetch<any>(`${co(companyId)}/warranty-remittance`, { method: 'POST', body: JSON.stringify(data) }),
  update: (companyId: string, mfrCode: string, data: any) => apiFetch<any>(`${co(companyId)}/warranty-remittance/${encodeURIComponent(mfrCode)}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (companyId: string, mfrCode: string) => apiFetch<any>(`${co(companyId)}/warranty-remittance/${encodeURIComponent(mfrCode)}`, { method: 'DELETE' }),
  getDefaults: (mfrCode: string) => apiFetch<any>(`/api/v1/warranty-remittance/manufacturer-defaults/${encodeURIComponent(mfrCode)}`),
};

// System Settings — Access Control / RBAC
export const accountingRoleApi = {
  list: (companyId: string) => apiFetch<any[]>(`${co(companyId)}/roles`),
  create: (companyId: string, data: any) => apiFetch<any>(`${co(companyId)}/roles`, { method: 'POST', body: JSON.stringify(data) }),
  update: (companyId: string, roleId: string, data: any) => apiFetch<any>(`${co(companyId)}/roles/${encodeURIComponent(roleId)}`, { method: 'PUT', body: JSON.stringify(data) }),
  updatePermissions: (companyId: string, roleId: string, data: any) => apiFetch<any>(`${co(companyId)}/roles/${encodeURIComponent(roleId)}/permissions`, { method: 'PUT', body: JSON.stringify(data) }),
};

// System Settings — Service EOD
export const serviceEodApi = {
  get: (companyId: string) => apiFetch<any>(`${co(companyId)}/service-eod-config`),
  update: (companyId: string, data: any) => apiFetch<any>(`${co(companyId)}/service-eod-config`, { method: 'PUT', body: JSON.stringify(data) }),
};

// System Settings — DealerCONNECT (Stellantis only)
export const dealerConnectApi = {
  get: (companyId: string) => apiFetch<any>(`${co(companyId)}/dealerconnect-config`),
  update: (companyId: string, data: any) => apiFetch<any>(`${co(companyId)}/dealerconnect-config`, { method: 'PUT', body: JSON.stringify(data) }),
};

// Dealer Group (multi-rooftop)
export const dealerGroupApi = {
  getRooftops: (groupId: string) => apiFetch<any[]>(`/api/v1/dealer-groups/${encodeURIComponent(groupId)}/rooftops`),
  getWarrantySummary: (groupId: string) => apiFetch<any>(`/api/v1/dealer-groups/${encodeURIComponent(groupId)}/warranty-remittance/summary`),
};

// Vehicle Inventory (INVACC / SCHDUPKY)
export const fileMaintenanceInventoryApi = {
  list: (companyId: string, params?: string) => apiFetch<any[]>(`${co(companyId)}/inventory${params ? `?${params}` : ''}`),
  getByStock: (companyId: string, stockNumber: string) => apiFetch<any>(`${co(companyId)}/inventory/${encodeURIComponent(stockNumber)}`),
  create: (companyId: string, data: any) => apiFetch<any>(`${co(companyId)}/inventory`, { method: 'POST', body: JSON.stringify(data) }),
  update: (companyId: string, stockNumber: string, data: any) => apiFetch<any>(`${co(companyId)}/inventory/${encodeURIComponent(stockNumber)}`, { method: 'PUT', body: JSON.stringify(data) }),
  reclassify: (companyId: string, stockNumber: string, newStatus: string) => apiFetch<any>(`${co(companyId)}/inventory/${encodeURIComponent(stockNumber)}/reclassify`, { method: 'POST', body: JSON.stringify({ newStatus }) }),
  validateVin: (companyId: string, vin: string) => apiFetch<any>(`${co(companyId)}/inventory/validate-vin?vin=${encodeURIComponent(vin)}`),
};

// ═══════════════════════════════════════════════════════════════════
// New Gap-Filling Service APIs
// ═══════════════════════════════════════════════════════════════════

// User Preferences API (Gap 14)
export const userPreferencesApi = {
  get: () => apiFetch<any>('/api/v1/user/preferences'),
  update: (data: any) => apiFetch<any>('/api/v1/user/preferences', { method: 'PUT', body: JSON.stringify(data) }),
  getDefaults: (role: string) => apiFetch<any>(`/api/v1/user/preferences/defaults/${role}`),
};

// Data Quality API (Gap 15)
export const dataQualityApi = {
  getReport: (period?: string) => apiFetch<any>(`/api/v1/quality/report${period ? `?period=${period}` : ''}`),
  getHistory: () => apiFetch<any[]>('/api/v1/quality/history'),
  getIssues: (period?: string) => apiFetch<any[]>(`/api/v1/quality/issues${period ? `?period=${period}` : ''}`),
};

// ESG API (Gap 12)
export const esgApi = {
  getReport: (period?: string) => apiFetch<any>(`/api/v1/esg/report${period ? `?period=${period}` : ''}`),
  getHistory: (months?: number) => apiFetch<any[]>(`/api/v1/esg/history${months ? `?months=${months}` : ''}`),
  addMetric: (data: any) => apiFetch<any>('/api/v1/esg/metrics', { method: 'POST', body: JSON.stringify(data) }),
};

// Compliance API (Gap 7)
export const complianceApi = {
  getAlerts: () => apiFetch<any[]>('/api/v1/compliance/alerts'),
  getOpenAlerts: () => apiFetch<any[]>('/api/v1/compliance/alerts/open'),
  resolveAlert: (id: string) => apiFetch<any>(`/api/v1/compliance/alerts/${id}/resolve`, { method: 'POST' }),
  getRules: () => apiFetch<any[]>('/api/v1/compliance/rules'),
};

// Revenue Recognition API (Gap 6)
export const revenueApi = {
  getContracts: () => apiFetch<any[]>('/api/v1/revenue/contracts'),
  getContract: (id: string) => apiFetch<any>(`/api/v1/revenue/contracts/${id}`),
  getSchedule: (id: string) => apiFetch<any[]>(`/api/v1/revenue/contracts/${id}/schedule`),
  getDeferredBalance: () => apiFetch<any>('/api/v1/revenue/deferred-balance'),
  createContract: (data: any) => apiFetch<any>('/api/v1/revenue/contracts', { method: 'POST', body: JSON.stringify(data) }),
};

// Query Explorer API (Gap 11)
export const queryApi = {
  ask: (question: string) => apiFetch<any>('/api/v1/query/ask', { method: 'POST', body: JSON.stringify({ question }) }),
  save: (name: string, question: string) => apiFetch<any>('/api/v1/query/save', { method: 'POST', body: JSON.stringify({ name, question }) }),
  getSaved: () => apiFetch<any[]>('/api/v1/query/saved'),
  getHistory: () => apiFetch<any[]>('/api/v1/query/history'),
};

// Analytics Service API (Gap 2)
export const analyticsServiceApi = {
  getPL: (period?: string) => apiFetch<any>(`/api/v1/analytics/pl${period ? `?period=${period}` : ''}`),
  getTechProductivity: (period?: string) => apiFetch<any[]>(`/api/v1/analytics/tech-productivity${period ? `?period=${period}` : ''}`),
  getPartsMargin: (period?: string) => apiFetch<any[]>(`/api/v1/analytics/parts-margin${period ? `?period=${period}` : ''}`),
  getTrend: (months?: number) => apiFetch<any[]>(`/api/v1/analytics/trend${months ? `?months=${months}` : ''}`),
};

// ML Service API (Gap 1)
export const mlApi = {
  detectAnomaly: (data: any) => apiFetch<any>('/api/v1/ml/detect-anomaly', { method: 'POST', body: JSON.stringify(data) }),
  matchConfidence: (data: any) => apiFetch<any>('/api/v1/ml/match-confidence', { method: 'POST', body: JSON.stringify(data) }),
  getModels: () => apiFetch<any[]>('/api/v1/ml/models'),
  getAccuracy: () => apiFetch<any>('/api/v1/ml/accuracy'),
  getPredictions: (limit?: number) => apiFetch<any[]>(`/api/v1/ml/predictions${limit ? `?recent=${limit}` : ''}`),
  getDashboard: () => apiFetch<any>('/api/v1/ml/dashboard'),
  getRevenueForecast: (months?: number, forecastPeriods?: number) => apiFetch<any>(`/api/v1/ml/forecast/revenue?months=${months ?? 12}&forecastPeriods=${forecastPeriods ?? 6}`),
  getCashflowForecast: (weeks?: number) => apiFetch<any>(`/api/v1/ml/forecast/cashflow${weeks ? `?weeks=${weeks}` : ''}`),
  getDealProfitability: () => apiFetch<any>('/api/v1/ml/deals/profitability'),
  scoreDeal: (data: any) => apiFetch<any>('/api/v1/ml/deals/score', { method: 'POST', body: JSON.stringify(data) }),
  getTechProductivity: () => apiFetch<any>('/api/v1/ml/technicians/productivity'),
  getPartsDemand: () => apiFetch<any>('/api/v1/ml/parts/demand-forecast'),
  getWarrantyPredictions: () => apiFetch<any>('/api/v1/ml/warranty/predictions'),
  getHealthScore: () => apiFetch<any>('/api/v1/ml/health-score'),
  scanAnomalies: (entries: any[]) => apiFetch<any>('/api/v1/ml/scan-anomalies', { method: 'POST', body: JSON.stringify({ entries }) }),
};

// Orchestrator API (Gap 13)
export const orchestratorApi = {
  createTask: (data: any) => apiFetch<any>('/api/v1/orchestrator/tasks', { method: 'POST', body: JSON.stringify(data) }),
  getTask: (id: string) => apiFetch<any>(`/api/v1/orchestrator/tasks/${id}`),
  listTasks: () => apiFetch<any[]>('/api/v1/orchestrator/tasks'),
  getSteps: (id: string) => apiFetch<any[]>(`/api/v1/orchestrator/tasks/${id}/steps`),
};

// Developer API Keys (Gap 10)
export const developerApi = {
  getKeys: () => apiFetch<any[]>('/api/v1/developer/keys'),
  createKey: (data: any) => apiFetch<any>('/api/v1/developer/keys', { method: 'POST', body: JSON.stringify(data) }),
  deleteKey: (id: string) => apiFetch<any>(`/api/v1/developer/keys/${id}`, { method: 'DELETE' }),
  getKeyUsage: (id: string) => apiFetch<any[]>(`/api/v1/developer/keys/${id}/usage`),
};
