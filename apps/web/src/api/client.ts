const API_BASE = import.meta.env.VITE_API_URL ?? '';
const API_TIMEOUT_MS = 10_000;

// AMACC-CH04 follow-up: isAuthenticated (AuthContext) only checks that a
// goldenpath.accessToken is PRESENT in localStorage, not that it's still
// valid. Every backend service now enforces real JWT auth unconditionally,
// so once that token expires (or belongs to a stale/killed session), every
// authenticated page keeps rendering — it just fails every single API call
// with 401 forever, since nothing ever clears the dead token or sends the
// user back to the single sign-in page (/login). Centralize that recovery
// here so any caller of apiFetch/apiFetchRaw self-heals on the first 401 it
// sees for a token it actually sent, instead of leaving the whole app
// looking "broken".
function clearStaleGoldenPathSessionAndRedirect(): void {
  // window.location.* is basename-unaware (unlike react-router's navigate()),
  // so the app's Vite base path (/amacc/) must be prepended explicitly —
  // a bare '/login' here would 404 since the app is served at /amacc/.
  const loginPath = `${import.meta.env.BASE_URL}login`;
  const isLoginRoute = window.location.pathname === loginPath;
  if (isLoginRoute) return; // avoid a redirect loop while already on the login screen
  ['goldenpath.accessToken', 'goldenpath.sessionToken', 'goldenpath.tenantId', 'goldenpath.user', 'goldenpath.legalEntityId', 'goldenpath.legalEntityLabel']
    .forEach((k) => localStorage.removeItem(k));
  window.location.href = loginPath;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  // FINAL-R0 Step 4: prefer the real Golden Path session (real JWT + real
  // tenantId from a completed login) over the legacy demo 'tenant-kunes'
  // fallback used by the pre-existing prototype pages. This is additive only
  // — pages that never call goldenpath login are unaffected and keep their
  // pre-existing unauthenticated demo behavior.
  const goldenPathToken = localStorage.getItem('goldenpath.accessToken');
  const goldenPathTenantId = localStorage.getItem('goldenpath.tenantId');
  const tenantId = goldenPathTenantId || localStorage.getItem('tenantId') || 'tenant-kunes';
  if (!goldenPathTenantId && !localStorage.getItem('tenantId')) localStorage.setItem('tenantId', tenantId);
  // CE-10: the selected legal entity (set by the ContextBar/entity-selection
  // flow) is sent on every request as x-legal-entity-id so entity-scoped
  // services (tax-service) never require every caller to thread it through
  // query params by hand — falls back gracefully (service treats it as
  // "no entity selected yet") when nothing has been chosen.
  const legalEntityId = localStorage.getItem('goldenpath.legalEntityId');
  const headers: Record<string, string> = {
    'x-tenant-id': tenantId,
    ...(legalEntityId ? { 'x-legal-entity-id': legalEntityId } : {}),
    ...(goldenPathToken ? { Authorization: `Bearer ${goldenPathToken}` } : {}),
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
      // Only a token we actually sent being rejected means it's stale/expired
      // — a 401 with no token attached is the normal "never logged in" case,
      // already handled by GoldenPathProtectedRoute, and shouldn't force a
      // redirect away from legacy demo pages that intentionally call the API
      // unauthenticated.
      if (res.status === 401 && goldenPathToken) {
        clearStaleGoldenPathSessionAndRedirect();
      }
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.message ?? body.error ?? `API error ${res.status}`);
      (err as any).status = res.status;
      // S222: preserve the full parsed error body (e.g. STRUCTURAL_IMBALANCE's
      // drSum/crSum/delta) so callers can render more than just a message string.
      (err as any).body = body;
      throw err;
    }
    // S221: DELETE endpoints (e.g. deleteSavedSearch) return 204 No Content
    // with an empty body -- calling res.json() on that throws a JSON parse
    // error, which callers were catching as a false failure even though the
    // delete had already succeeded server-side.
    if (res.status === 204) {
      return undefined as unknown as T;
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

// S227: CSV export endpoints return text/csv, not JSON — a lightweight
// sibling of apiFetch that shares the same auth/tenant header resolution
// but returns the raw response body instead of calling res.json().
async function apiFetchRaw(path: string): Promise<string> {
  const goldenPathToken = localStorage.getItem('goldenpath.accessToken');
  const goldenPathTenantId = localStorage.getItem('goldenpath.tenantId');
  const tenantId = goldenPathTenantId || localStorage.getItem('tenantId') || 'tenant-kunes';
  const headers: Record<string, string> = {
    'x-tenant-id': tenantId,
    ...(goldenPathToken ? { Authorization: `Bearer ${goldenPathToken}` } : {}),
  };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers, signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) {
      if (res.status === 401 && goldenPathToken) {
        clearStaleGoldenPathSessionAndRedirect();
      }
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.message ?? body.error ?? `API error ${res.status}`);
      (err as any).status = res.status;
      (err as any).body = body;
      throw err;
    }
    return res.text();
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
  // S006 — MFA & Safeguards Evidence
  getMfaPolicy: () => apiFetch<any>('/api/v1/mfa/policy'),
  setMfaPolicy: (data: any) => apiFetch<any>('/api/v1/mfa/policy', { method: 'PUT', body: JSON.stringify(data) }),
  getSafeguardsEvidence: (params?: string) => apiFetch<any>(`/api/v1/mfa/evidence${params ? `?${params}` : ''}`),
  recordMfaEvent: (data: any) => apiFetch<any>('/api/v1/mfa/evidence', { method: 'POST', body: JSON.stringify(data) }),
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
  // S009 — statement-line catalog & effective-dated statement-metadata.
  listStatementLines: () => apiFetch<any[]>('/api/v1/gl/statement-lines'),
  createStatementLine: (data: { code: string; name: string; statement: 'BS' | 'IS'; section: string; sortOrder?: number }) =>
    apiFetch<any>('/api/v1/gl/statement-lines', { method: 'POST', body: JSON.stringify(data) }),
  updateStatementLine: (id: string, data: { name?: string; section?: string; sortOrder?: number; isActive?: boolean }) =>
    apiFetch<any>(`/api/v1/gl/statement-lines/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  setAccountStatementMetadata: (accountId: string, data: {
    statementLineId: string | null; effectiveFrom: string; reason: string; actor?: string; isBootstrap?: boolean;
  }) => apiFetch<any>(`/api/v1/gl/accounts/${accountId}/statement-metadata`, { method: 'PATCH', body: JSON.stringify(data) }),
  bulkSetAccountStatementMetadata: (mappings: Array<{
    glAccountId: string; statementLineId: string | null; effectiveFrom: string; reason: string; actor?: string; isBootstrap?: boolean;
  }>) => apiFetch<any[]>('/api/v1/gl/accounts/statement-metadata/bulk', { method: 'POST', body: JSON.stringify({ mappings }) }),
  // Sales Tax Accrual (Phase 1)
  configureTaxJurisdiction: (data: any) => apiFetch<any>('/api/v1/gl/tax/configure', { method: 'POST', body: JSON.stringify(data) }),
  listTaxRates: (params?: string) => apiFetch<any[]>(`/api/v1/gl/tax/rates${params ? `?${params}` : ''}`),
  accrueTax: (data: any) => apiFetch<any>('/api/v1/gl/tax/accrue', { method: 'POST', body: JSON.stringify(data) }),
  getTaxLiabilityReport: (params?: string) => apiFetch<any>(`/api/v1/gl/tax/liability-report${params ? `?${params}` : ''}`),
  // 1099 Contractor Reports (Phase 1)
  generate1099Forms: (data: any) => apiFetch<any>('/api/v1/ap/1099/generate', { method: 'POST', body: JSON.stringify(data) }),
  list1099Records: (params?: string) => apiFetch<any[]>(`/api/v1/ap/1099/review${params ? `?${params}` : ''}`),
  update1099Record: (id: string, data: any) => apiFetch<any>(`/api/v1/ap/1099/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  export1099Forms: (data: any) => apiFetch<any>('/api/v1/ap/1099/export', { method: 'POST', body: JSON.stringify(data) }),
  get1099PDF: (id: string) => apiFetch<any>(`/api/v1/ap/1099/${id}/pdf`),
  // Journal Sources
  getSources: (params?: string) => apiFetch<any[]>(`/api/v1/gl/admin/journal-sources${params ? `?${params}` : ''}`),
  getSourceByCode: (code: string) => apiFetch<any>(`/api/v1/gl/admin/journal-sources?sourceCode=${encodeURIComponent(code)}`),
  // Journal Templates (S3-02/03)
  getTemplates: (params?: string) => apiFetch<any[]>(`/api/v1/gl/admin/journal-templates${params ? `?${params}` : ''}`),
  getTemplate: (id: string) => apiFetch<any>(`/api/v1/gl/admin/journal-templates/${id}`),
  createTemplate: (data: any) => apiFetch<any>('/api/v1/gl/admin/journal-templates', { method: 'POST', body: JSON.stringify(data) }),
  updateTemplate: (id: string, data: any) => apiFetch<any>(`/api/v1/gl/admin/journal-templates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTemplate: (id: string) => apiFetch<void>(`/api/v1/gl/admin/journal-templates/${id}`, { method: 'DELETE' }),
  // Journal Entry Reverse
  reverseEntry: (id: string, data: any) => apiFetch<any>(`/api/v1/gl/journal-entries/${id}/reverse`, { method: 'POST', body: JSON.stringify(data) }),
  // S219 — Void/Delete Draft Journal Entry
  voidEntry: (id: string, reason: string) => apiFetch<any>(`/api/v1/gl/journal-entries/${id}`, { method: 'DELETE', body: JSON.stringify({ reason }) }),
  // S033 — Allocation Templates
  listAllocationTemplates: () => apiFetch<any[]>('/api/v1/gl/admin/allocation-templates'),
  createAllocationTemplate: (data: any) => apiFetch<any>('/api/v1/gl/admin/allocation-templates', { method: 'POST', body: JSON.stringify(data) }),
  getAllocationTemplate: (id: string) => apiFetch<any>(`/api/v1/gl/admin/allocation-templates/${id}`),
  runAllocation: (id: string, data: any) => apiFetch<any>(`/api/v1/gl/admin/allocation-templates/${id}/run`, { method: 'POST', body: JSON.stringify(data) }),
  // S034 — Intercompany Pairs
  listIntercompanyPairs: () => apiFetch<any[]>('/api/v1/gl/admin/intercompany-pairs'),
  createIntercompanyPair: (data: any) => apiFetch<any>('/api/v1/gl/admin/intercompany-pairs', { method: 'POST', body: JSON.stringify(data) }),
  checkIcNetZero: (year: number, month: number) => apiFetch<any[]>(`/api/v1/gl/admin/intercompany-pairs/net-zero?year=${year}&month=${month}`),
  // S035 — Consolidation Elimination Runs
  listEliminationRuns: (eliminationEntityId?: string) => apiFetch<any[]>(`/api/v1/gl/admin/consolidation/elimination-runs${eliminationEntityId ? `?eliminationEntityId=${eliminationEntityId}` : ''}`),
  runElimination: (data: any) => apiFetch<any>('/api/v1/gl/admin/consolidation/elimination-runs', { method: 'POST', body: JSON.stringify(data) }),
  // Floor Plan Financing (Phase 1)
  registerFloorPlanUnit: (data: any) => apiFetch<any>('/api/v1/gl/floor-plan/units', { method: 'POST', body: JSON.stringify(data) }),
  listFloorPlanUnits: (params?: string) => apiFetch<any>(`/api/v1/gl/floor-plan/units${params ? `?${params}` : ''}`),
  accrueFloorPlanInterest: (data: any) => apiFetch<any>('/api/v1/gl/floor-plan/accrue-interest', { method: 'POST', body: JSON.stringify(data) }),
  payoffFloorPlanUnit: (unitId: string, data: any) => apiFetch<any>(`/api/v1/gl/floor-plan/payoff/${unitId}`, { method: 'POST', body: JSON.stringify(data) }),
  getFloorPlanAgingReport: (params?: string) => apiFetch<any>(`/api/v1/gl/floor-plan/aging-report${params ? `?${params}` : ''}`),
  // S7-01: Vehicle Transfers
  listVehicleTransfers: (params?: string) => apiFetch<any[]>(`/api/v1/gl/vehicle-transfers${params ? `?${params}` : ''}`),
  getVehicleTransfer: (id: string) => apiFetch<any>(`/api/v1/gl/vehicle-transfers/${id}`),
  createVehicleTransfer: (data: any) => apiFetch<any>('/api/v1/gl/vehicle-transfers', { method: 'POST', body: JSON.stringify(data) }),
  reverseVehicleTransfer: (id: string) => apiFetch<any>(`/api/v1/gl/vehicle-transfers/${id}/reverse`, { method: 'POST' }),
  // S7-02: OEM Financial Statement
  getOemMappings: (oem: string, year: number) => apiFetch<any[]>(`/api/v1/gl/fs/oem-mappings?oem=${oem}&year=${year}`),
  bulkImportOemMappings: (data: any) => apiFetch<any>('/api/v1/gl/fs/oem-mappings/bulk', { method: 'POST', body: JSON.stringify(data) }),
  updateOemMapping: (id: string, data: any) => apiFetch<any>(`/api/v1/gl/fs/oem-mappings/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  generateOemStatement: (data: any) => apiFetch<any>('/api/v1/gl/fs/oem-statement/generate', { method: 'POST', body: JSON.stringify(data) }),
  // S7-05: Consolidated financial statements
  getConsolidatedStatement: (params?: string) => apiFetch<any>(`/api/v1/gl/financial-statements/consolidated${params ? `?${params}` : ''}`),
  // NS-005: FS Versions (up to 15 per tenant)
  getFsVersions: () => apiFetch<any[]>('/api/v1/gl/fs/versions'),
  createFsVersion: (data: any) => apiFetch<any>('/api/v1/gl/fs/versions', { method: 'POST', body: JSON.stringify(data) }),
  updateFsVersion: (id: string, data: any) => apiFetch<any>(`/api/v1/gl/fs/versions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  // NS-007: NCM20 upload (GM-specific, gated by ncm20_enabled in gl_system_config)
  getNcm20Status: () => apiFetch<any>('/api/v1/gl/fs/ncm20/status'),
  generateNcm20Upload: (period: string) => apiFetch<any>('/api/v1/gl/fs/ncm20/generate', { method: 'POST', body: JSON.stringify({ period }) }),
  // NS-008: Archived FS Viewer — bypasses journal source security (BR-GL-006/DM-001)
  getArchivedStatements: (params?: string) => apiFetch<any[]>(`/api/v1/gl/fs/archived${params ? `?${params}` : ''}`),
  getArchivedStatement: (id: string) => apiFetch<any>(`/api/v1/gl/fs/archived/${id}`),
  // NS-006: Fiscal year start config
  getSystemConfig: () => apiFetch<any>('/api/v1/gl/admin/system-config'),
  // Sprint B — GL Report endpoints (Programs 23, 24, 27, 28, 29)
  // BR-GL-001/002: GL Trial Balance (Program 24) — 7-col CSV export: COMPNO,GL-ACCTN,GL-TYPE,TOT-PRIOR,TOT-CUR,TOT-YTD-I,CONTNO
  getTrialBalanceDetail: (params?: string) => apiFetch<any>(`/api/v1/gl/reports/trial-balance${params ? `?${params}` : ''}`),
  // BR-GL-009: Annual GL Summary (Program 27) — cleared after first-month close of new fiscal year
  getAnnualGLSummary: (fiscalYear: number, company?: string, fromAccount?: string, toAccount?: string) =>
    apiFetch<any>(`/api/v1/gl/reports/annual-summary?fiscalYear=${fiscalYear}${company ? `&company=${company}` : ''}${fromAccount ? `&fromAccount=${fromAccount}` : ''}${toAccount ? `&toAccount=${toAccount}` : ''}`),
  // BR-GL-003: Detailed GL/P&L (Program 23) — journal source security: show *** ACCESS DENIED *** (not exclude)
  getDetailedGL: (params?: string) => apiFetch<any[]>(`/api/v1/gl/reports/detailed${params ? `?${params}` : ''}`),
  // BR-GL-007/008: Monthly Trans Journals (Program 28) — from/to must be same month; group by batch
  getMonthlyTransJournals: (params?: string) => apiFetch<any[]>(`/api/v1/gl/reports/monthly-journals${params ? `?${params}` : ''}`),
  // BR-GL-010: Autopost Report (Program 29 Option 1) — one-time print for prior dates
  checkAutopostReportLog: (reportDate: string, company?: string) =>
    apiFetch<{ printed: boolean; printedAt?: string; printedBy?: string }>(`/api/v1/gl/reports/autopost/check?date=${reportDate}${company ? `&company=${company}` : ''}`),
  getAutopostReport: (reportDate: string, company?: string) =>
    apiFetch<any[]>(`/api/v1/gl/reports/autopost?date=${reportDate}${company ? `&company=${company}` : ''}`),
  // BR-GL-011: Cross Post Report (Program 29 Option 2) — same base account# on both debit+credit sides
  getCrossPostReport: (params?: string) => apiFetch<any[]>(`/api/v1/gl/reports/cross-post${params ? `?${params}` : ''}`),
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
  // NS-002: ACCT_065 archive progress — polls eom_archive_log every 2s while step is active
  getArchiveLog: (closeId: string) => apiFetch<any[]>(`/api/v1/eom/${closeId}/archive-log`),
};

// Payroll API
export const payrollApi = {
  getBatches: () => apiFetch<any[]>('/api/v1/payroll/batches'),
  getBatch: (id: string) => apiFetch<any>(`/api/v1/payroll/batches/${id}`),
  submit: (data: any) => apiFetch<any>('/api/v1/payroll/batches', { method: 'POST', body: JSON.stringify(data) }),
  validate: (id: string) => apiFetch<any>(`/api/v1/payroll/batches/${id}/validate`, { method: 'POST' }),
  post: (id: string) => apiFetch<any>(`/api/v1/payroll/batches/${id}/post`, { method: 'POST' }),
  hold: (id: string, holdReason: string) => apiFetch<any>(`/api/v1/payroll/batches/${id}/hold`, { method: 'POST', body: JSON.stringify({ holdReason }) }),
  release: (id: string) => apiFetch<any>(`/api/v1/payroll/batches/${id}/release`, { method: 'POST' }),
  // PAY-001: Start new run — backend enforces single-active-run-per-tenant (409 if IN_PROGRESS exists)
  // PAY-002: check_date is immutable after creation
  startRun: (data: { checkDate: string; payPeriodStart: string; payPeriodEnd: string; payFrequency: string }) =>
    apiFetch<any>('/api/v1/payroll/runs', { method: 'POST', body: JSON.stringify(data) }),
  // PAY-005: Load in-process run — returns locked_by/locked_at if another user holds the lock
  loadInProcess: () => apiFetch<any>('/api/v1/payroll/runs/in-process'),
  getRun: (runId: string) => apiFetch<any>(`/api/v1/payroll/runs/${runId}`),
  listRuns: (params?: string) => apiFetch<any[]>(`/api/v1/payroll/runs${params ? `?${params}` : ''}`),
  addChecks: (runId: string, data: any) => apiFetch<any>(`/api/v1/payroll/runs/${runId}/checks`, { method: 'POST', body: JSON.stringify(data) }),
  importTime: (runId: string, data: any) => apiFetch<any>(`/api/v1/payroll/runs/${runId}/import-time`, { method: 'POST', body: JSON.stringify(data) }),
  getCheckData: (runId: string, params?: string) => apiFetch<any[]>(`/api/v1/payroll/runs/${runId}/checks${params ? `?${params}` : ''}`),
  updateCheck: (runId: string, checkId: string, data: any) => apiFetch<any>(`/api/v1/payroll/runs/${runId}/checks/${checkId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  validateRun: (runId: string) => apiFetch<any>(`/api/v1/payroll/runs/${runId}/validate`, { method: 'POST' }),
  getSummary: (runId: string) => apiFetch<any>(`/api/v1/payroll/runs/${runId}/summary`),
  // PAY-004: Finalize button gated on nacha_generated=true
  generateNacha: (runId: string) => apiFetch<any>(`/api/v1/payroll/runs/${runId}/generate-nacha`, { method: 'POST' }),
  finalizeRun: (runId: string, data?: any) => apiFetch<any>(`/api/v1/payroll/runs/${runId}/finalize`, { method: 'POST', body: JSON.stringify(data ?? {}) }),
  // PAY-008/PAY-010: Wage bases breakdown (US_FEDERAL, EEFICA, EE_MEDICARE, STATE, FUTA, SUTA)
  getWageBases: (runId: string) => apiFetch<any[]>(`/api/v1/payroll/runs/${runId}/wage-bases`),
  exportReport: (runId: string, reportType: string) =>
    apiFetch<any>(`/api/v1/payroll/runs/${runId}/export?type=${encodeURIComponent(reportType)}`, { method: 'POST' }),
  // Commission Tracking — S109 full lifecycle (plans/splits/draws/minimum-guarantee/disputes)
  listCommissionPlans: () => apiFetch<any[]>('/api/v1/payroll/commission-plans'),
  createCommissionPlan: (data: any) => apiFetch<any>('/api/v1/payroll/commission-plans', { method: 'POST', body: JSON.stringify(data) }),
  supersedeCommissionPlan: (id: string, data: any) => apiFetch<any>(`/api/v1/payroll/commission-plans/${id}/supersede`, { method: 'POST', body: JSON.stringify(data) }),
  issueCommissionDraw: (planId: string, data: { employeeId: string; amount: number }) =>
    apiFetch<any>(`/api/v1/payroll/commission-plans/${planId}/draws`, { method: 'POST', body: JSON.stringify(data) }),
  calculateCommission: (data: any) => apiFetch<any>('/api/v1/payroll/commissions/calculate', { method: 'POST', body: JSON.stringify(data) }),
  // fix(integration): GET /commissions always responds with the register
  // shape `{ period, commissions, month_total, ytd_total }` (see
  // commission-routes.ts's "Register / YTD queries" section) even when
  // called with no employeeId — Prisma silently drops an `undefined`
  // employeeId filter, so the tenant's full commission list comes back
  // inside `.commissions`. Every caller of this method (CommissionTracking,
  // PayrollCommissionWorkbench's records tab) has always expected a flat
  // array, so unwrap here rather than pushing the register shape onto both.
  listCommissions: (params?: string) =>
    apiFetch<{ commissions: any[] }>(`/api/v1/payroll/commissions${params ? `?${params}` : ''}`).then((res) => res.commissions ?? []),
  // fix(integration) Gap 1.C — commission journal drill-down (record → plan → batch/item → journal → reversal journal)
  getCommissionDetail: (id: string) => apiFetch<any>(`/api/v1/payroll/commissions/${id}`),
  getCommissionReport: (params?: string) => apiFetch<any>(`/api/v1/payroll/commissions/report${params ? `?${params}` : ''}`),
  correctCommission: (id: string, data: { adjustedAmount: number; reason: string }) =>
    apiFetch<any>(`/api/v1/payroll/commissions/${id}/correct`, { method: 'POST', body: JSON.stringify(data) }),
  reverseCommission: (id: string, data: { reason: string }) =>
    apiFetch<any>(`/api/v1/payroll/commissions/${id}/reverse`, { method: 'POST', body: JSON.stringify(data) }),
  markCommissionPaid: (id: string) => apiFetch<any>(`/api/v1/payroll/commissions/${id}/mark-paid`, { method: 'POST' }),
  chargebackCommission: (id: string, data: { clawbackRecordId: string; amount: number }) =>
    apiFetch<any>(`/api/v1/payroll/commissions/${id}/chargeback`, { method: 'POST', body: JSON.stringify(data) }),
  createCommissionDispute: (id: string, data: { reason: string; adjustedAmount?: number }) =>
    apiFetch<any>(`/api/v1/payroll/commissions/${id}/disputes`, { method: 'POST', body: JSON.stringify(data) }),
  listCommissionDisputes: (params?: string) => apiFetch<any[]>(`/api/v1/payroll/commission-disputes${params ? `?${params}` : ''}`),
  resolveCommissionDispute: (id: string, data: { resolution: string }) =>
    apiFetch<any>(`/api/v1/payroll/commission-disputes/${id}/resolve`, { method: 'POST', body: JSON.stringify(data) }),
  // CE-13 — statutory-source boundary config (S108)
  getSourceMode: () => apiFetch<{ payrollSourceMode: string; updatedBy: string | null; updatedAt: string | null }>('/api/v1/payroll/config/source-mode'),
  setSourceMode: (payrollSourceMode: string) =>
    apiFetch<any>('/api/v1/payroll/config/source-mode', { method: 'PUT', body: JSON.stringify({ payrollSourceMode }) }),
  // CE-13 / S025 — rule-pack governance
  createRulePack: (data: { packKey: string; rows: any[] }) => apiFetch<any>('/api/v1/payroll/rule-packs', { method: 'POST', body: JSON.stringify(data) }),
  listRulePacks: (packKey?: string) => apiFetch<any[]>(`/api/v1/payroll/rule-packs${packKey ? `?packKey=${encodeURIComponent(packKey)}` : ''}`),
  simulateRulePack: (id: string) => apiFetch<any>(`/api/v1/payroll/rule-packs/${id}/simulate`),
  validateRulePack: (id: string) => apiFetch<any>(`/api/v1/payroll/rule-packs/${id}/validate`, { method: 'POST' }),
  activateRulePack: (id: string) => apiFetch<any>(`/api/v1/payroll/rule-packs/${id}/activate`, { method: 'POST' }),
  // CE-13 / S110 — clawback / chargeback
  createClawback: (data: any) => apiFetch<any>('/api/v1/payroll/clawbacks', { method: 'POST', body: JSON.stringify(data) }),
  listClawbacks: (params?: string) => apiFetch<any[]>(`/api/v1/payroll/clawbacks${params ? `?${params}` : ''}`),
  resolveClawback: (id: string) => apiFetch<any>(`/api/v1/payroll/clawbacks/${id}/resolve`, { method: 'POST' }),
  // CE-13 / S111 — accruals
  createAccrual: (data: any) => apiFetch<any>('/api/v1/payroll/accruals', { method: 'POST', body: JSON.stringify(data) }),
  listAccruals: (params?: string) => apiFetch<any[]>(`/api/v1/payroll/accruals${params ? `?${params}` : ''}`),
  approveAccrual: (id: string) => apiFetch<any>(`/api/v1/payroll/accruals/${id}/approve`, { method: 'POST' }),
  // CE-13 / S112 — tech flag-hour bridge
  createTechBridge: (data: any) => apiFetch<any>('/api/v1/payroll/tech-bridge', { method: 'POST', body: JSON.stringify(data) }),
  listTechBridge: (params?: string) => apiFetch<any[]>(`/api/v1/payroll/tech-bridge${params ? `?${params}` : ''}`),
  // CE-13 — batch void/reversal + item add with attestation
  addBatchItem: (batchId: string, data: any) => apiFetch<any>(`/api/v1/payroll/batches/${batchId}/items`, { method: 'POST', body: JSON.stringify(data) }),
  approveBatch: (batchId: string) => apiFetch<any>(`/api/v1/payroll/batches/${batchId}/approve`, { method: 'POST' }),
  voidBatch: (batchId: string, voidReason: string) => apiFetch<any>(`/api/v1/payroll/batches/${batchId}/void`, { method: 'POST', body: JSON.stringify({ voidReason }) }),
  getRegister: (batchId: string) => apiFetch<any>(`/api/v1/payroll/batches/${batchId}/register`),
  getEmployeeYTD: (employeeId: string, year: number) => apiFetch<any>(`/api/v1/payroll/employees/${employeeId}/ytd?year=${year}`),
  // fix(integration) Gap 2 — CE-09 payment handoff
  getBatchPaymentHandoff: (batchId: string) => apiFetch<any>(`/api/v1/payroll/batches/${batchId}/payment-handoff`),
  listPaymentHandoffs: (params?: { legalEntityId?: string; status?: string }) => {
    const qs = new URLSearchParams(Object.entries(params ?? {}).filter(([, v]) => !!v) as [string, string][]);
    return apiFetch<any[]>(`/api/v1/payroll/payment-handoffs${qs.toString() ? `?${qs.toString()}` : ''}`);
  },
  getPaymentHandoff: (id: string) => apiFetch<any>(`/api/v1/payroll/payment-handoffs/${id}`),
  transmitPaymentHandoff: (id: string) => apiFetch<any>(`/api/v1/payroll/payment-handoffs/${id}/transmit`, { method: 'POST' }),
  settlePaymentHandoff: (id: string, settlementReference: string) =>
    apiFetch<any>(`/api/v1/payroll/payment-handoffs/${id}/settle`, { method: 'POST', body: JSON.stringify({ settlementReference }) }),
  // fix(integration) Gap 4 — payroll audit inquiry
  getAudit: (params?: { legalEntityId?: string; batchId?: string; employeeId?: string; action?: string; actor?: string; fromDate?: string; toDate?: string }) => {
    const qs = new URLSearchParams(Object.entries(params ?? {}).filter(([, v]) => !!v) as [string, string][]);
    return apiFetch<{ items: any[] }>(`/api/v1/payroll/audit${qs.toString() ? `?${qs.toString()}` : ''}`);
  },
};

// Payroll Reports API (Sprint B — NS-023 through NS-033)
export const payrollReportApi = {
  // NS-023: Workers Comp Report (BR-PAY-006 — up to 18 excludable earning code types)
  getWorkersComp: (params?: string) => apiFetch<any>(`/api/v1/payroll/reports/workers-comp${params ? `?${params}` : ''}`),
  getWorkersCompExclusions: () => apiFetch<any[]>('/api/v1/payroll/workers-comp-exclusions'),
  // NS-024: Employee History
  getEmployeeHistory: (employeeId: string, params?: string) =>
    apiFetch<any[]>(`/api/v1/payroll/reports/employee-history/${employeeId}${params ? `?${params}` : ''}`),
  // NS-025: Earnings/Deductions — BR-PAY-007: XOR (Earnings OR Deductions, not both)
  getEarningsDeductions: (params?: string) => apiFetch<any>(`/api/v1/payroll/reports/earnings-deductions${params ? `?${params}` : ''}`),
  // NS-026: Tax Summary
  getTaxSummary: (runId: string) => apiFetch<any>(`/api/v1/payroll/reports/tax-summary/${runId}`),
  // NS-027: 401k Report
  get401k: (params?: string) => apiFetch<any[]>(`/api/v1/payroll/reports/401k${params ? `?${params}` : ''}`),
  // NS-028: EMPOWER Export (retirement plan provider)
  generateEmpowerExport: (runId: string) => apiFetch<any>(`/api/v1/payroll/reports/empower/${runId}`, { method: 'POST' }),
  // NS-029: Employee/Wage Export (simple + advanced configurable columns)
  getEmployeeWageExport: (runId: string, mode: 'SIMPLE' | 'ADVANCED', columns?: string[]) =>
    apiFetch<any>(`/api/v1/payroll/reports/wage-export/${runId}`, {
      method: 'POST',
      body: JSON.stringify({ mode, columns }),
    }),
  // NS-030: Positive Pay (payroll version — BR-PAY-008: separate from AP Positive Pay)
  generatePayrollPositivePay: (runId: string, bankAccount: string, format: string) =>
    apiFetch<any>(`/api/v1/payroll/reports/positive-pay/${runId}`, {
      method: 'POST',
      body: JSON.stringify({ bankAccount, format }),
    }),
  // NS-031: NACHA Standalone (BR-PAY-008: separate from Step 7 NACHA; for finalized runs only)
  regenerateNacha: (runId: string) => apiFetch<any>(`/api/v1/payroll/runs/${runId}/regenerate-nacha`, { method: 'POST' }),
  // NS-032: Employee Info Report (BR-PAY-009: 3-layer security — permission + dept + SSN mask)
  getEmployeeInfo: (params?: string) => apiFetch<any[]>(`/api/v1/payroll/reports/employee-info${params ? `?${params}` : ''}`),
  // NS-033: Government Wage (Quarterly) Report — Form 941 + SUTA
  getGovernmentWage: (quarter: number, year: number, params?: string) =>
    apiFetch<any>(`/api/v1/payroll/reports/government-wage?quarter=${quarter}&year=${year}${params ? `&${params}` : ''}`),
};

// GL Inquiry API (Sprint C — Program 31: NS-046/047/048)
export const glInquiryApi = {
  // GL Inquiry: account transactions with date range, Open Month = accounting period not calendar
  getGLInquiry: (account: string, params?: string) =>
    apiFetch<any>(`/api/v1/gl/inquiry?account=${encodeURIComponent(account)}${params ? `&${params}` : ''}`),
  // Multi-GL: fetch multiple accounts in one call
  getMultiGLInquiry: (accounts: string[], params?: string) =>
    apiFetch<any>(`/api/v1/gl/inquiry/multi?accounts=${accounts.map(encodeURIComponent).join(',')}${params ? `&${params}` : ''}`),
  // User preferences for GL Inquiry (view mode, pref date, pref sort)
  getInquiryPrefs: () => apiFetch<any>('/api/v1/user/preferences/gl-inquiry'),
  saveInquiryPrefs: (prefs: any) => apiFetch<any>('/api/v1/user/preferences/gl-inquiry', { method: 'PUT', body: JSON.stringify(prefs) }),
  // Schedule Inquiry (NS-046)
  getScheduleInquiry: (scheduleId: string, params?: string) =>
    apiFetch<any>(`/api/v1/gl/inquiry/schedules/${scheduleId}${params ? `?${params}` : ''}`),
  getScheduleGLMapping: (scheduleId: string) =>
    apiFetch<{ glAccounts: { accountNum: string; label: string }[] }>(`/api/v1/gl/inquiry/schedules/${scheduleId}/gl-mapping`),
  getScheduleDetail: (scheduleId: string, controlNum: string, params?: string) =>
    apiFetch<any[]>(`/api/v1/gl/inquiry/schedules/${scheduleId}/detail?controlNum=${controlNum}${params ? `&${params}` : ''}`),
  // Transaction Inquiry (NS-047) — one row per transaction, Account col = ALL touched accounts CSV
  getTransactionInquiry: (params?: string) =>
    apiFetch<any[]>(`/api/v1/gl/inquiry/transactions${params ? `?${params}` : ''}`),
  // Transaction Detail Popup (EU-008) — shared across GL/Schedule/Transaction inquiry
  getTransactionDetail: (transactionId: string) =>
    apiFetch<any>(`/api/v1/gl/inquiry/transactions/${transactionId}/detail`),
};

// DCS / MFG Communications API (NS-034 — Program 30)
export const dcsApi = {
  getStatus: (oem: string) => apiFetch<any>(`/api/v1/dcs/status?oem=${encodeURIComponent(oem)}`),
  getHistory: (params?: string) => apiFetch<any[]>(`/api/v1/dcs/history${params ? `?${params}` : ''}`),
  runCommunication: (oem: string, type: 'Import' | 'Export' | 'Status Check') =>
    apiFetch<any>('/api/v1/dcs/run', { method: 'POST', body: JSON.stringify({ oem, type }) }),
};

// Parts GL Account Mappings API (NS-035 — BR-SGL-003: 15 sale types × franchise + 5 misc)
export const partsGLApi = {
  getMappings: (franchise: string) => apiFetch<any>(`/api/v1/gl/parts-gl-accounts?franchise=${encodeURIComponent(franchise)}`),
  saveMappings: (franchise: string, data: any) =>
    apiFetch<any>('/api/v1/gl/parts-gl-accounts', { method: 'PUT', body: JSON.stringify({ franchise, ...data }) }),
};

// Service GL Account Mappings API (NS-036 — BR-SGL-001/002: GL Group + VIN Prefix × 16 slots)
export const serviceGLApi = {
  getMappings: (glGroup: number, vinPrefix: string) =>
    apiFetch<any>(`/api/v1/gl/service-gl-accounts?glGroup=${glGroup}&vinPrefix=${encodeURIComponent(vinPrefix)}`),
  saveMappings: (glGroup: number, vinPrefix: string, data: any) =>
    apiFetch<any>('/api/v1/gl/service-gl-accounts', { method: 'PUT', body: JSON.stringify({ glGroup, vinPrefix, ...data }) }),
};

// Technician / Service Advisor API (NS-037, NS-038 — Service Program 12)
export const technicianApi = {
  list: (roleType: 'TECH' | 'ADVISOR', params?: string) =>
    apiFetch<any[]>(`/api/v1/service/technicians?role=${roleType}${params ? `&${params}` : ''}`),
  getById: (id: string) => apiFetch<any>(`/api/v1/service/technicians/${id}`),
  create: (data: any) => apiFetch<any>('/api/v1/service/technicians', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) => apiFetch<any>(`/api/v1/service/technicians/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deactivate: (id: string) => apiFetch<any>(`/api/v1/service/technicians/${id}/deactivate`, { method: 'PATCH' }),
  getPayRates: (id: string) => apiFetch<any[]>(`/api/v1/service/technicians/${id}/pay-rates`),
  getManufacturerIds: (id: string) => apiFetch<any[]>(`/api/v1/service/technicians/${id}/manufacturer-ids`),
};

// Service History API (NS-045 — Service Program 8)
export const serviceHistoryApi = {
  search: (params?: string) => apiFetch<any[]>(`/api/v1/service/history${params ? `?${params}` : ''}`),
  getRO: (roNum: string) => apiFetch<any>(`/api/v1/service/history/${encodeURIComponent(roNum)}`),
  getROLines: (roNum: string) => apiFetch<any[]>(`/api/v1/service/history/${encodeURIComponent(roNum)}/lines`),
};

// Report/Mate API (NS-039 through NS-043)
export const reportMateApi = {
  getSavedReports: () => apiFetch<any[]>('/api/v1/reports/custom'),
  saveReport: (data: any) => apiFetch<any>('/api/v1/reports/custom', { method: 'POST', body: JSON.stringify(data) }),
  updateReport: (id: string, data: any) => apiFetch<any>(`/api/v1/reports/custom/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteReport: (id: string) => apiFetch<void>(`/api/v1/reports/custom/${id}`, { method: 'DELETE' }),
  runReport: (id: string, params: any) =>
    apiFetch<any>(`/api/v1/reports/custom/${id}/run`, { method: 'POST', body: JSON.stringify(params) }),
  scheduleReport: (id: string, schedule: any) =>
    apiFetch<any>(`/api/v1/reports/custom/${id}/schedule`, { method: 'POST', body: JSON.stringify(schedule) }),
  exportReport: (id: string, format: 'CSV' | 'XLSX') =>
    apiFetch<any>(`/api/v1/reports/custom/${id}/export?format=${format}`),
};

// DOC/Mate API (NS-044 — BR-GL-005/006: journal source security BYPASSED for archived docs)
export const docMateApi = {
  search: (params?: string) => apiFetch<any[]>(`/api/v1/docmate/documents${params ? `?${params}` : ''}`),
  getDocument: (id: string) => apiFetch<any>(`/api/v1/docmate/documents/${id}`),
  downloadPdf: (id: string) => apiFetch<any>(`/api/v1/docmate/documents/${id}/pdf`),
};

// Service Day-End API (NS-004 / CF-001: day-end is Service Program 6, not Accounting EOM)
export const serviceDayEndApi = {
  getReadiness: () => apiFetch<any>('/api/v1/service/day-end/readiness'),
  close: () => apiFetch<any>('/api/v1/service/day-end/close', { method: 'POST' }),
  getHistory: (params?: string) => apiFetch<any[]>(`/api/v1/service/day-end/history${params ? `?${params}` : ''}`),
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
  getAR: (params?: string) => apiFetch<any[]>(`/api/v1/apar/ar${params ? `?${params}` : ''}`),
  createAR: (data: any) => apiFetch<any>('/api/v1/apar/ar', { method: 'POST', body: JSON.stringify(data) }),
  voidReceipt: (id: string, data: any) => apiFetch<any>(`/api/v1/apar/ar/${id}/void`, { method: 'POST', body: JSON.stringify(data) }),
  postReceipt: (id: string) => apiFetch<any>(`/api/v1/apar/ar/${id}/post`, { method: 'POST' }),
  getAP: () => apiFetch<any[]>('/api/v1/apar/ap'),
  createAP: (data: any) => apiFetch<any>('/api/v1/apar/ap', { method: 'POST', body: JSON.stringify(data) }),
  // Vendor maintenance (S3-07, hardened AMACC-CH04 S036A)
  getVendors: (params?: string) => apiFetch<any>(`/api/v1/apar/vendors${params ? `?${params}` : ''}`),
  getVendor: (id: string) => apiFetch<any>(`/api/v1/apar/vendors/${id}`),
  createVendor: (data: any) => apiFetch<any>('/api/v1/apar/vendors', { method: 'POST', body: JSON.stringify(data) }),
  updateVendor: (id: string, data: any) => apiFetch<any>(`/api/v1/apar/vendors/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  checkVendorDuplicates: (data: { vendorName?: string; email?: string; phone?: string; zip?: string; excludeVendorId?: string }) =>
    apiFetch<{ candidates: any[] }>('/api/v1/apar/vendors/duplicate-check', { method: 'POST', body: JSON.stringify(data) }),
  inactivateVendor: (id: string, data: { version: number; reason: string }) =>
    apiFetch<any>(`/api/v1/apar/vendors/${id}/inactivate`, { method: 'POST', body: JSON.stringify(data) }),
  reactivateVendor: (id: string, data: { version: number }) =>
    apiFetch<any>(`/api/v1/apar/vendors/${id}/reactivate`, { method: 'POST', body: JSON.stringify(data) }),
  deleteVendor: (id: string, data: { version: number; reason?: string }) =>
    apiFetch<any>(`/api/v1/apar/vendors/${id}`, { method: 'DELETE', body: JSON.stringify(data) }),
  getVendorEligibility: (id: string) => apiFetch<{ eligible: boolean; status: string; reason: string | null }>(`/api/v1/apar/vendors/${id}/eligibility`),
  getVendorAuditEvents: (id: string) => apiFetch<any[]>(`/api/v1/apar/vendors/${id}/audit-events`),
  // Vendor compliance adapters (AMACC-CH04 S036B)
  getVendorComplianceChecks: (vendorId: string) => apiFetch<any[]>(`/api/v1/apar/vendors/${vendorId}/compliance-checks`),
  createVendorComplianceCheck: (vendorId: string, data: any) =>
    apiFetch<any>(`/api/v1/apar/vendors/${vendorId}/compliance-checks`, { method: 'POST', body: JSON.stringify(data) }),
  updateVendorComplianceCheck: (vendorId: string, id: string, data: any) =>
    apiFetch<any>(`/api/v1/apar/vendors/${vendorId}/compliance-checks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  runVendorComplianceVerification: (vendorId: string, id: string) =>
    apiFetch<any>(`/api/v1/apar/vendors/${vendorId}/compliance-checks/${id}/run-verification`, { method: 'POST' }),
  reviewVendorComplianceCheck: (vendorId: string, id: string, data: { version: number; decision: 'VERIFIED' | 'REJECTED' | 'EXPIRED'; reason?: string }) =>
    apiFetch<any>(`/api/v1/apar/vendors/${vendorId}/compliance-checks/${id}/review`, { method: 'POST', body: JSON.stringify(data) }),
  // Vendor Insurance Certificates (AMACC-CH04 S038)
  getVendorInsuranceCertificates: (vendorId: string, params?: string) =>
    apiFetch<any>(`/api/v1/apar/vendors/${vendorId}/insurance-certificates${params ? `?${params}` : ''}`),
  getInsuranceCertificate: (id: string) => apiFetch<any>(`/api/v1/apar/insurance-certificates/${id}`),
  createInsuranceCertificate: (vendorId: string, data: any) =>
    apiFetch<any>(`/api/v1/apar/vendors/${vendorId}/insurance-certificates`, { method: 'POST', body: JSON.stringify(data) }),
  updateInsuranceCertificate: (id: string, data: any) =>
    apiFetch<any>(`/api/v1/apar/insurance-certificates/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  renewInsuranceCertificate: (id: string, data: any) =>
    apiFetch<any>(`/api/v1/apar/insurance-certificates/${id}/renew`, { method: 'POST', body: JSON.stringify(data) }),
  revokeInsuranceCertificate: (id: string, data: any) =>
    apiFetch<any>(`/api/v1/apar/insurance-certificates/${id}/revoke`, { method: 'POST', body: JSON.stringify(data) }),
  getInsuranceCertificateAuditEvents: (id: string) => apiFetch<any[]>(`/api/v1/apar/insurance-certificates/${id}/audit-events`),
  getVendorInsuranceSummary: (vendorId: string) => apiFetch<any>(`/api/v1/apar/vendors/${vendorId}/insurance-summary`),
  // AP Payments (S3-08/09)
  getPayments: (params?: string) => apiFetch<any[]>(`/api/v1/apar/ap-payments${params ? `?${params}` : ''}`),
  voidPayment: (id: string, data: any) => apiFetch<any>(`/api/v1/apar/ap-payments/${id}/void`, { method: 'POST', body: JSON.stringify(data) }),
  // Customer Master and Credit Profile (S5-01, hardened S046)
  getCustomers: (params?: string) => apiFetch<any[]>(`/api/v1/apar/customers${params ? `?${params}` : ''}`),
  getCustomer: (id: string) => apiFetch<any>(`/api/v1/apar/customers/${id}`),
  createCustomer: (data: any) => apiFetch<any>('/api/v1/apar/customers', { method: 'POST', body: JSON.stringify(data) }),
  updateCustomer: (id: string, data: any) => apiFetch<any>(`/api/v1/apar/customers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  checkCustomerDuplicates: (data: { customerName?: string; email?: string; phone?: string; zip?: string; excludeCustomerId?: string }) =>
    apiFetch<{ candidates: any[] }>('/api/v1/apar/customers/duplicate-check', { method: 'POST', body: JSON.stringify(data) }),
  inactivateCustomer: (id: string, data: { version: number; reason: string }) =>
    apiFetch<any>(`/api/v1/apar/customers/${id}/inactivate`, { method: 'POST', body: JSON.stringify(data) }),
  reactivateCustomer: (id: string, data: { version: number }) =>
    apiFetch<any>(`/api/v1/apar/customers/${id}/reactivate`, { method: 'POST', body: JSON.stringify(data) }),
  deleteCustomer: (id: string, data: { version: number; reason?: string }) =>
    apiFetch<any>(`/api/v1/apar/customers/${id}`, { method: 'DELETE', body: JSON.stringify(data) }),
  getCustomerEligibility: (id: string) => apiFetch<{ eligible: boolean; status: string; creditHold: boolean; reason: string | null }>(`/api/v1/apar/customers/${id}/eligibility`),
  getCustomerAuditEvents: (id: string) => apiFetch<any[]>(`/api/v1/apar/customers/${id}/audit-events`),
  setCustomerCreditHold: (id: string, data: { version: number; reason: string }) =>
    apiFetch<any>(`/api/v1/apar/customers/${id}/credit-hold`, { method: 'POST', body: JSON.stringify(data) }),
  releaseCustomerCreditHold: (id: string, data: { version: number }) =>
    apiFetch<any>(`/api/v1/apar/customers/${id}/credit-release`, { method: 'POST', body: JSON.stringify(data) }),
  // Deprecated back-compat alias — retained only for callers not yet
  // migrated to inactivateCustomer(); the backend keeps a matching route.
  deactivateCustomer: (id: string) => apiFetch<any>(`/api/v1/apar/customers/${id}/deactivate`, { method: 'PATCH', body: JSON.stringify({}) }),
  // S6-12: AP invoice queries for reports
  getInvoices: (params?: string) => apiFetch<any[]>(`/api/v1/apar/ap${params ? `?${params}` : ''}`),
  // S7-03: ACH / NACHA generation
  generateAch: (data: { bankAccountId: string; paymentIds: string[] }) => apiFetch<any>('/api/v1/ap/payments/generate-ach', { method: 'POST', body: JSON.stringify(data) }),
  // S7-07: Vendor 1099 YTD payments
  getVendorYtdPayments: (vendorId: string) => apiFetch<any>(`/api/v1/apar/vendors/${vendorId}/ytd-payments`),
};

// AMACC-CH04 S039: Vendor Invoice Entry & 2/3-Way Match
export const apInvoiceApi = {
  list: (params?: string) => apiFetch<{ items: any[]; total: number; page: number; pageSize: number }>(`/api/v1/apar/invoices${params ? `?${params}` : ''}`),
  getById: (id: string) => apiFetch<any>(`/api/v1/apar/invoices/${id}`),
  create: (data: any) => apiFetch<any>('/api/v1/apar/invoices', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) => apiFetch<any>(`/api/v1/apar/invoices/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  checkDuplicates: (data: { vendorId: string; invoiceNumber: string; excludeInvoiceId?: string }) =>
    apiFetch<{ candidates: any[] }>('/api/v1/apar/invoices/duplicate-check', { method: 'POST', body: JSON.stringify(data) }),
  runMatch: (id: string) => apiFetch<{ invoice: any; result: any }>(`/api/v1/apar/invoices/${id}/match`, { method: 'POST' }),
  submit: (id: string, data: { version: number; override?: { reason: string } }) =>
    apiFetch<any>(`/api/v1/apar/invoices/${id}/submit`, { method: 'POST', body: JSON.stringify(data) }),
  void: (id: string, data: { version: number; reason: string }) =>
    apiFetch<any>(`/api/v1/apar/invoices/${id}/void`, { method: 'POST', body: JSON.stringify(data) }),
};

// AMACC-CH04 S039: Goods Receipts (3-way match input)
export const goodsReceiptApi = {
  listForPO: (poId: string) => apiFetch<any[]>(`/api/v1/apar/purchase-orders/${poId}/receipts`),
  getById: (id: string) => apiFetch<any>(`/api/v1/apar/goods-receipts/${id}`),
  create: (data: any) => apiFetch<any>('/api/v1/apar/goods-receipts', { method: 'POST', body: JSON.stringify(data) }),
  void: (id: string, data: { reason: string }) => apiFetch<any>(`/api/v1/apar/goods-receipts/${id}/void`, { method: 'POST', body: JSON.stringify(data) }),
};

// AMACC-CH04 S041: Invoice Approval Matrix
export const approvalRuleApi = {
  list: () => apiFetch<any[]>('/api/v1/apar/invoice-approval-rules'),
  create: (data: { thresholdAmount: number; requiredRole: string; sequence: number }) =>
    apiFetch<any>('/api/v1/apar/invoice-approval-rules', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: { thresholdAmount?: number; requiredRole?: string; isActive?: boolean }) =>
    apiFetch<any>(`/api/v1/apar/invoice-approval-rules/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
};

export const invoiceApprovalApi = {
  getInstance: (invoiceId: string) => apiFetch<any>(`/api/v1/apar/invoices/${invoiceId}/approval`),
  start: (invoiceId: string) => apiFetch<any>(`/api/v1/apar/invoices/${invoiceId}/approval/start`, { method: 'POST' }),
  approve: (invoiceId: string, data: { version: number; note?: string }) =>
    apiFetch<any>(`/api/v1/apar/invoices/${invoiceId}/approval/approve`, { method: 'POST', body: JSON.stringify(data) }),
  reject: (invoiceId: string, data: { version: number; reason: string }) =>
    apiFetch<any>(`/api/v1/apar/invoices/${invoiceId}/approval/reject`, { method: 'POST', body: JSON.stringify(data) }),
  retryGlPosting: (invoiceId: string) => apiFetch<{ journalEntryId: string | null }>(`/api/v1/apar/invoices/${invoiceId}/approval/retry-gl-posting`, { method: 'POST' }),
};

// AMACC-CH04 S043A: Manual Single Payment
export const bankAccountApi = {
  list: () => apiFetch<any[]>('/api/v1/apar/bank-accounts'),
  create: (data: { bankName: string; accountNumber: string; routingNumber: string; glAccountId?: string; nextCheckNumber?: number }) =>
    apiFetch<any>('/api/v1/apar/bank-accounts', { method: 'POST', body: JSON.stringify(data) }),
};

export const manualPaymentApi = {
  list: (vendorId?: string) => apiFetch<any[]>(`/api/v1/apar/manual-payments${vendorId ? `?vendorId=${vendorId}` : ''}`),
  getById: (id: string) => apiFetch<any>(`/api/v1/apar/manual-payments/${id}`),
  create: (data: { invoiceId: string; bankAccountId: string; paymentDate?: string }) =>
    apiFetch<any>('/api/v1/apar/manual-payments', { method: 'POST', body: JSON.stringify(data) }),
  void: (id: string, data: { version: number; reason: string }) =>
    apiFetch<any>(`/api/v1/apar/manual-payments/${id}/void`, { method: 'POST', body: JSON.stringify(data) }),
  retryScheduleRelief: (id: string) => apiFetch<any>(`/api/v1/apar/manual-payments/${id}/retry-schedule-relief`, { method: 'POST' }),
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

  // S026 — Schedule Open-Item Core
  getOpenItems: (scheduleId: string, params?: string) =>
    apiFetch<any[]>(`/api/v1/schedules/${scheduleId}/open-items${params ? `?${params}` : ''}`),
  getOpenItem: (scheduleId: string, itemId: string) =>
    apiFetch<any>(`/api/v1/schedules/${scheduleId}/open-items/${itemId}`),
  applyOpenItem: (scheduleId: string, itemId: string, data: { amount: string; idempotencyKey: string; note?: string }) =>
    apiFetch<any>(`/api/v1/schedules/${scheduleId}/open-items/${itemId}/apply`, { method: 'POST', body: JSON.stringify(data) }),
  reverseApplication: (scheduleId: string, applicationId: string, data?: { note?: string }) =>
    apiFetch<any>(`/api/v1/schedules/${scheduleId}/open-items/applications/${applicationId}/reverse`, { method: 'POST', body: JSON.stringify(data ?? {}) }),

  // S026 — nightly GL-to-schedule tie-out
  getTieOuts: (params?: string) => apiFetch<any[]>(`/api/v1/schedules/tie-outs${params ? `?${params}` : ''}`),
  runTieOut: (asOfDate?: string) =>
    apiFetch<any>('/api/v1/schedules/tie-outs/run', { method: 'POST', body: JSON.stringify(asOfDate ? { asOfDate } : {}) }),

  // S027 — Schedule Aging Engine
  getAgingReport: (scheduleId: string | null, params?: string) =>
    apiFetch<any>(`/api/v1/schedules${scheduleId ? `/${scheduleId}` : ''}/aging-report${params ? `?${params}` : ''}`),
  getAgingBucketConfig: () => apiFetch<{ buckets: any[] }>('/api/v1/schedules/aging-bucket-config'),
  setAgingBucketConfig: (buckets: { label: string; upperBoundDays: number | null }[]) =>
    apiFetch<{ buckets: any[] }>('/api/v1/schedules/aging-bucket-config', { method: 'PUT', body: JSON.stringify({ buckets }) }),

  // S028 — auto-application (FIFO sweep on-account)
  autoApply: (data: { scheduleNumber: string; controlNumber: string; amount: string; idempotencyKey: string }) =>
    apiFetch<any>('/api/v1/schedules/open-items/auto-apply', { method: 'POST', body: JSON.stringify(data) }),

  // S029 — Split / Transfer / Write-off ceremonies
  splitOpenItem: (scheduleId: string, itemId: string, data: { parts: string[]; idempotencyKey: string; reason: string }) =>
    apiFetch<any>(`/api/v1/schedules/${scheduleId}/open-items/${itemId}/split`, { method: 'POST', body: JSON.stringify(data) }),
  transferOpenItem: (scheduleId: string, itemId: string, data: { toScheduleNumber: string; toControlNumber: string; toItemNumber: string; idempotencyKey: string; reason: string }) =>
    apiFetch<any>(`/api/v1/schedules/${scheduleId}/open-items/${itemId}/transfer`, { method: 'POST', body: JSON.stringify(data) }),
  writeOffOpenItem: (scheduleId: string, itemId: string, data: { offsetAccountCode: string; idempotencyKey: string; reason: string }) =>
    apiFetch<any>(`/api/v1/schedules/${scheduleId}/open-items/${itemId}/write-off`, { method: 'POST', body: JSON.stringify(data) }),
  getWriteOffConfig: () => apiFetch<{ thresholdAmount: string | null }>('/api/v1/schedules/open-items/write-off-config'),
  setWriteOffConfig: (thresholdAmount: string | null) =>
    apiFetch<{ thresholdAmount: string | null }>('/api/v1/schedules/open-items/write-off-config', { method: 'PUT', body: JSON.stringify({ thresholdAmount }) }),

  // S027 completion — Exception queue
  runExceptionEvaluation: (scheduleNumber?: string) =>
    apiFetch<any>('/api/v1/schedules/exceptions/run', { method: 'POST', body: JSON.stringify(scheduleNumber ? { scheduleNumber } : {}) }),
  getExceptions: (params?: string) => apiFetch<any[]>(`/api/v1/schedules/exceptions${params ? `?${params}` : ''}`),
  dispositionException: (exceptionId: string, note: string) =>
    apiFetch<any>(`/api/v1/schedules/exceptions/${exceptionId}/disposition`, { method: 'POST', body: JSON.stringify({ note }) }),
  getExceptionRuleConfig: () => apiFetch<any>('/api/v1/schedules/exceptions/rule-config'),
  setExceptionRuleConfig: (data: { staleDays: number; controlLimitAmount: string | null; normalBalance: 'DEBIT' | 'CREDIT' }) =>
    apiFetch<any>('/api/v1/schedules/exceptions/rule-config', { method: 'PUT', body: JSON.stringify(data) }),

  // S030 — Statements & Dunning
  generateStatement: (data: { scheduleNumber: string; controlNumber: string; asOfDate?: string }) =>
    apiFetch<any>('/api/v1/schedules/statements/generate', { method: 'POST', body: JSON.stringify(data) }),
  listStatementRuns: (params?: string) => apiFetch<any[]>(`/api/v1/schedules/statements${params ? `?${params}` : ''}`),
  getStatementRun: (statementId: string) => apiFetch<any>(`/api/v1/schedules/statements/${statementId}`),
  generateDunning: (data: { scheduleNumber: string; controlNumber: string }) =>
    apiFetch<any>('/api/v1/schedules/dunning/generate', { method: 'POST', body: JSON.stringify(data) }),
  listDunningRuns: (params?: string) => apiFetch<any[]>(`/api/v1/schedules/dunning${params ? `?${params}` : ''}`),
  getDunningConfig: () => apiFetch<{ levels: any[] }>('/api/v1/schedules/dunning/config'),
  setDunningConfig: (levels: any[]) => apiFetch<{ levels: any[] }>('/api/v1/schedules/dunning/config', { method: 'PUT', body: JSON.stringify({ levels }) }),
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
  list: (params?: string) => apiFetch<any[]>(`/api/v1/cash-receipts${params ? `?${params}` : ''}`),
  create: (data: any) => apiFetch<any>('/api/v1/cash-receipts', { method: 'POST', body: JSON.stringify(data) }),
  void: (id: string, data: any) => apiFetch<any>(`/api/v1/cash-receipts/${id}/void`, { method: 'POST', body: JSON.stringify(data) }),
  getDeposits: (params?: string) => apiFetch<any[]>(`/api/v1/cash-receipts/deposits${params ? `?${params}` : ''}`),
  createDeposit: (data: any) => apiFetch<any>('/api/v1/cash-receipts/deposits', { method: 'POST', body: JSON.stringify(data) }),
  addReceiptsToDeposit: (depositId: string, receiptIds: string[]) => apiFetch<any>(`/api/v1/cash-receipts/deposits/${depositId}/receipts`, { method: 'POST', body: JSON.stringify({ receiptIds }) }),
  allocateDeposit: (depositId: string, glAccountId: string) => apiFetch<any>(`/api/v1/cash-receipts/deposits/${depositId}/allocate`, { method: 'POST', body: JSON.stringify({ glAccountId }) }),
};

// S052 — POS Cash Receipts, Cashier Drawers, Blind Close and Over/Short.
// Consumes the real cash-service (proxied by the gateway at /api/v1/cash),
// a separate service/route prefix from the legacy cashReceiptApi above.
export const cashDrawerApi = {
  openDrawer: (data: {
    storeId: string; storeCode: string; terminalCode: string; entityId: string; businessDate: string;
    currency?: string; openingFloat: number | string; cashierName?: string | null;
  }) => apiFetch<any>('/api/v1/cash/drawers', { method: 'POST', body: JSON.stringify(data) }),
  getActiveDrawer: (params?: { cashierId?: string; storeId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.cashierId) qs.set('cashierId', params.cashierId);
    if (params?.storeId) qs.set('storeId', params.storeId);
    const s = qs.toString();
    return apiFetch<{ drawer: any | null }>(`/api/v1/cash/drawers/active${s ? `?${s}` : ''}`);
  },
  getDrawer: (drawerId: string) => apiFetch<any>(`/api/v1/cash/drawers/${drawerId}`),
  submitBlindClose: (drawerId: string, data: {
    countedCash: number | string; checkCount: number; checkTotal: number | string; retainedFloat: number | string;
    cashierNote?: string | null; checks?: { checkNumber?: string | null; amount: number | string }[];
  }) => apiFetch<any>(`/api/v1/cash/drawers/${drawerId}/blind-close`, { method: 'POST', body: JSON.stringify(data) }),
  getReconciliation: (drawerId: string) => apiFetch<any>(`/api/v1/cash/drawers/${drawerId}/reconciliation`),
  approveVariance: (drawerId: string, reason: string) =>
    apiFetch<any>(`/api/v1/cash/drawers/${drawerId}/variance:approve`, { method: 'POST', body: JSON.stringify({ reason }) }),
  reconcileDrawer: (drawerId: string) => apiFetch<any>(`/api/v1/cash/drawers/${drawerId}/reconcile`, { method: 'POST' }),
};

export const posReceiptApi = {
  createReceipt: (drawerId: string, data: {
    entityId: string; sourceDocType: string; sourceDocId: string; sourceDisplayNumber?: string | null;
    payerReference?: string | null; amountDue?: number | string | null; totalAmount: number | string;
    currency?: string; tenders: Array<{ tenderType: 'CASH' | 'CHECK'; amount: number | string; cashTendered?: number | string | null; checkNumber?: string | null; checkPayer?: string | null }>;
    idempotencyKey: string;
  }) => apiFetch<any>(`/api/v1/cash/drawers/${drawerId}/receipts`, { method: 'POST', body: JSON.stringify(data) }),
  searchReceipts: (params?: { receiptNumber?: string; sourceDocId?: string; cashierId?: string; drawerId?: string; status?: string; storeId?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([k, v]) => { if (v !== undefined && v !== '') qs.set(k, String(v)); });
    const s = qs.toString();
    return apiFetch<{ items: any[]; total: number; limit: number; offset: number }>(`/api/v1/cash/receipts${s ? `?${s}` : ''}`);
  },
  getReceipt: (receiptId: string) => apiFetch<any>(`/api/v1/cash/receipts/${receiptId}`),
  getPrintableReceipt: (receiptId: string) => apiFetch<any>(`/api/v1/cash/receipts/${receiptId}/print`),
  voidReceipt: (receiptId: string, reason: string) =>
    apiFetch<any>(`/api/v1/cash/receipts/${receiptId}/void`, { method: 'POST', body: JSON.stringify({ reason }) }),
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
  list:    (params?: string) => apiFetch<any[]>(`/api/v1/purchase-orders${params ? `?${params}` : ''}`),
  getById: (id: string) => apiFetch<any>(`/api/v1/purchase-orders/${id}`),
  create:  (data: any) => apiFetch<any>('/api/v1/purchase-orders', { method: 'POST', body: JSON.stringify(data) }),
  submit:  (id: string) => apiFetch<any>(`/api/v1/purchase-orders/${id}/submit`, { method: 'POST' }),
  approve: (id: string, data?: any) => apiFetch<any>(`/api/v1/purchase-orders/${id}/approve`, { method: 'POST', body: JSON.stringify(data ?? {}) }),
  close:   (id: string) => apiFetch<any>(`/api/v1/purchase-orders/${id}/close`, { method: 'POST' }),
  // S6-01: Cancel (DRAFT only, no PO# consumed) vs Void (SUBMITTED/APPROVED, PO# consumed)
  cancel:  (id: string, reason?: string) => apiFetch<any>(`/api/v1/purchase-orders/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
  void:    (id: string, reason?: string) => apiFetch<any>(`/api/v1/purchase-orders/${id}/void`,   { method: 'POST', body: JSON.stringify({ reason }) }),
  receive: (id: string, data: any) => apiFetch<any>(`/api/v1/purchase-orders/${id}/receive`, { method: 'POST', body: JSON.stringify(data) }),
  // S6-08: 1099 IRS FIRE format export
  export1099FIRE: (data: any) => apiFetch<any>('/api/v1/ap/1099/export-fire', { method: 'POST', body: JSON.stringify(data) }),
  // S6-09: Positive Pay export
  positivePayExport: (data: any) => apiFetch<any>('/api/v1/ap/payments/positive-pay-export', { method: 'POST', body: JSON.stringify(data) }),
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

// Dealer Groups API — GroupDashboard.tsx previously called these with a raw
// unauthenticated fetch() (no Authorization header), which 401s now that
// every backend service enforces real JWT auth unconditionally. Routed
// through apiFetch like every other resource so the token/tenant headers are
// attached consistently.
export const groupsApi = {
  list: () => apiFetch<any[]>('/api/v1/groups'),
  getDashboard: (groupId: string) => apiFetch<any>(`/api/v1/groups/${groupId}/dashboard`),
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

// ── FINAL-R0 Step 4: Golden Path API ────────────────────────────────────────
// Minimal, dedicated client for the browser Golden Path certification flow:
// login -> select tenant/legal entity -> fiscal calendar -> accounting
// period -> Chart of Accounts -> journal draft -> validate -> post -> view
// -> reverse -> audit history. Talks to the real gateway with real JWT auth
// (see src/auth/AuthContext.tsx) -- no mock data.
export const goldenPathApi = {
  listLegalEntities: () => apiFetch<{ items: any[]; total: number }>('/api/v1/legal-entities'),

  // ACC-S003: elimination-entity configuration ceremony.
  configureElimination: (entityId: string, data: { version: number; isElimination: boolean; reason?: string }) =>
    apiFetch<any>(`/api/v1/legal-entities/${entityId}/elimination`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  getFiscalCalendar: (entityId: string) => apiFetch<any>(`/api/v1/fiscal/entities/${entityId}/fiscal-calendar`),
  defineFiscalCalendar: (entityId: string, fyStartMonth: number) =>
    apiFetch<any>(`/api/v1/fiscal/entities/${entityId}/fiscal-calendar`, {
      method: 'POST',
      body: JSON.stringify({ fyStartMonth, structure: 'TWELVE' }),
    }),
  generateFiscalYear: (entityId: string, fiscalYear: number) =>
    apiFetch<any>(`/api/v1/fiscal/entities/${entityId}/fiscal-calendar/years`, {
      method: 'POST',
      body: JSON.stringify({ fiscalYear }),
    }),

  getPeriodBoard: (entityId: string) => apiFetch<{ board: any[] }>(`/api/v1/fiscal/periods?entity=${entityId}`),
  openPeriod: (periodId: string, confirm = false) =>
    apiFetch<any>(`/api/v1/fiscal/periods/${periodId}/open`, {
      method: 'POST',
      body: JSON.stringify({ confirm }),
    }),

  // S008 — soft-close/hard-close/reopen/reopen-hard-closed/lock. All five
  // share the same {transitioned, status, requiresConfirmation?, message?}
  // response shape as openPeriod() above; reopen-hard-closed and lock are
  // two-step (first call without confirm returns requiresConfirmation).
  softClosePeriod: (periodId: string, reason: string) =>
    apiFetch<any>(`/api/v1/fiscal/periods/${periodId}/soft-close`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  hardClosePeriod: (periodId: string, reason: string) =>
    apiFetch<any>(`/api/v1/fiscal/periods/${periodId}/hard-close`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  reopenPeriod: (periodId: string, reason: string) =>
    apiFetch<any>(`/api/v1/fiscal/periods/${periodId}/reopen`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  reopenHardClosedPeriod: (periodId: string, reason: string, confirm = false) =>
    apiFetch<any>(`/api/v1/fiscal/periods/${periodId}/reopen-hard-closed`, {
      method: 'POST',
      body: JSON.stringify({ reason, confirm }),
    }),
  lockPeriod: (periodId: string, reason: string, confirm = false) =>
    apiFetch<any>(`/api/v1/fiscal/periods/${periodId}/lock`, {
      method: 'POST',
      body: JSON.stringify({ reason, confirm }),
    }),

  listStores: (entityId: string) => apiFetch<{ items: any[] }>(`/api/v1/stores?entityId=${entityId}`),
  listDepartments: (entityId: string) => apiFetch<{ items: any[] }>(`/api/v1/legal-entities/${entityId}/departments`),

  listAccounts: (entityId: string) => apiFetch<{ accounts: any[] }>(`/api/v1/coa/accounts?entity=${entityId}`),
  // Real coa-service GET /journal-sources (source-routes.ts) — used to
  // display the journal's source with its real name instead of a bare code.
  listJournalSources: () => apiFetch<any[]>('/api/v1/coa/journal-sources'),
  createAccount: (data: {
    entityId: string; accountNumber: string; name: string; type: string;
    normalBalance: string; postable: boolean; parentId?: string | null;
  }) => apiFetch<any>('/api/v1/coa/accounts', { method: 'POST', body: JSON.stringify(data) }),

  createDraft: (data: { entityId: string; entryDate: string; sourceCode: string; memo?: string; lines: any[] }) =>
    apiFetch<{ draftId: string; status: string; version: number }>('/api/v1/coa/manual-journals/drafts', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getDraft: (draftId: string) => apiFetch<any>(`/api/v1/coa/manual-journals/drafts/${draftId}`),
  validateDraft: (draftId: string) =>
    apiFetch<{ pass: boolean; errors?: any[] }>(`/api/v1/coa/manual-journals/drafts/${draftId}:validate`, { method: 'POST' }),
  postDraft: (draftId: string) =>
    apiFetch<{ journalId: string; journalNumber: string; idempotent?: boolean }>(
      `/api/v1/coa/manual-journals/drafts/${draftId}:post`, { method: 'POST' },
    ),
  voidDraft: (draftId: string, reason?: string) =>
    apiFetch<any>(`/api/v1/coa/manual-journals/drafts/${draftId}:void`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason ?? null }),
    }),

  getJournal: (journalNumber: string) => apiFetch<any>(`/api/v1/coa/journals/${journalNumber}`),
  reverseJournal: (journalId: string, reason: string) =>
    apiFetch<any>(`/api/v1/coa/journals/${journalId}:reverse`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  getAuditHistory: (entityType: string, entityId: string) =>
    apiFetch<any[]>(`/api/v1/audit/entity/${entityType}/${entityId}`),

  // S222 — Trial Balance Screen: consumes the real S014 gl-service report
  // as-is (no client-side recomputation of dr/cr/ending balances). Note:
  // `entity` here is gl-service's own companyCode slice dimension, which is
  // architecturally separate from the tenant-service legalEntityId used by
  // the rest of the Golden Path (ADR-JL-001 — journal lifecycle lives in
  // coa-service; gl-service is a separate reporting ledger with its own
  // schema and is not yet fed by coa-service's posted journals).
  getTrialBalance: (params: { entity: string; store?: string; dept?: string; asOf: string }) => {
    const qs = new URLSearchParams({ entity: params.entity, asOf: params.asOf });
    if (params.store) qs.set('store', params.store);
    if (params.dept) qs.set('dept', params.dept);
    return apiFetch<{
      scope: { entity: string; store: string | null; dept: string | null; asOf: string };
      accounts: Array<{
        accountId: string; accountCode: string; accountName: string; accountType: string;
        normalBalance: 'DEBIT' | 'CREDIT'; priorBalance: number; currentAmount: number;
        endingBalance: number; debitBalance: number; creditBalance: number;
      }>;
      drSum: number; crSum: number; delta: number;
    }>(`/api/v1/gl/reports/trial-balance?${qs.toString()}`);
  },
  exportTrialBalance: (params: { entity: string; store?: string; dept?: string; asOf: string }) => {
    const qs = new URLSearchParams({ entity: params.entity, asOf: params.asOf });
    if (params.store) qs.set('store', params.store);
    if (params.dept) qs.set('dept', params.dept);
    return apiFetchRaw(`/api/v1/gl/reports/trial-balance/export?${qs.toString()}`);
  },

  // S220 — GL Inquiry: real coa-service account-activity API, consumed by
  // both the standalone GL Inquiry screen and the S222 Trial Balance
  // drill-through (which reuses this same call for whichever coa-service
  // account, in the *current* golden-path legal entity, shares the clicked
  // TB row's human account number — a best-effort cross-service correlation
  // by account number, not a guaranteed foreign-key relationship, because
  // gl-service and coa-service are separate ledgers).
  getAccountActivity: (accountId: string, params?: string) =>
    apiFetch<any>(`/api/v1/coa/inquiry/accounts/${accountId}/activity${params ? `?${params}` : ''}`),
  exportAccountActivity: (accountId: string, params?: string) =>
    apiFetchRaw(`/api/v1/coa/inquiry/accounts/${accountId}/activity:export${params ? `?${params}` : ''}`),

  // S227 — Balance Sheet & Income Statement: consumes the real gl-service
  // FinancialStatementService reports as-is (no client-side recomputation of
  // any classification, contra-account sign, or net-income calculation).
  // Same companyCode-slice caveat as getTrialBalance above (ADR-JL-001).
  getBalanceSheet: (params: { entity: string; store?: string; dept?: string; asOf: string }) => {
    const qs = new URLSearchParams({ entity: params.entity, asOf: params.asOf });
    if (params.store) qs.set('store', params.store);
    if (params.dept) qs.set('dept', params.dept);
    return apiFetch<{
      schemaVersion?: number;
      scope: { entity: string; store: string | null; dept: string | null; asOf: string };
      assets: { rows: Array<{ accountCode: string; accountName: string; accountType: string; amount: number }>; total: number };
      liabilities: { rows: Array<{ accountCode: string; accountName: string; accountType: string; amount: number }>; total: number };
      equity: { rows: Array<{ accountCode: string; accountName: string; accountType: string; amount: number }>; total: number; currentEarnings: number };
      totalLiabilitiesAndEquity: number;
      excludedAccounts: Array<{ accountCode: string; accountType: string; reason: string }>;
      reconciledToTrialBalance: { drSum: number; crSum: number };
    }>(`/api/v1/gl/reports/balance-sheet?${qs.toString()}`);
  },
  exportBalanceSheet: (params: { entity: string; store?: string; dept?: string; asOf: string }) => {
    const qs = new URLSearchParams({ entity: params.entity, asOf: params.asOf });
    if (params.store) qs.set('store', params.store);
    if (params.dept) qs.set('dept', params.dept);
    return apiFetchRaw(`/api/v1/gl/reports/balance-sheet/export?${qs.toString()}`);
  },
  getIncomeStatement: (params: { entity: string; store?: string; dept?: string; asOf: string }) => {
    const qs = new URLSearchParams({ entity: params.entity, asOf: params.asOf });
    if (params.store) qs.set('store', params.store);
    if (params.dept) qs.set('dept', params.dept);
    return apiFetch<{
      schemaVersion?: number;
      scope: { entity: string; store: string | null; dept: string | null; asOf: string };
      revenue: { rows: Array<{ accountCode: string; accountName: string; accountType: string; amount: number }>; total: number };
      // S009/BLK-08 (approved 2026-07-28): new IS section, additive per
      // BLK-11 (schemaVersion 2, no /v2/ route).
      costOfSales: { rows: Array<{ accountCode: string; accountName: string; accountType: string; amount: number }>; total: number };
      grossProfit: number;
      expense: { rows: Array<{ accountCode: string; accountName: string; accountType: string; amount: number }>; total: number };
      netIncome: number;
      excludedAccounts: Array<{ accountCode: string; accountType: string; reason: string }>;
      reconciledToTrialBalance: { drSum: number; crSum: number };
    }>(`/api/v1/gl/reports/income-statement?${qs.toString()}`);
  },
  exportIncomeStatement: (params: { entity: string; store?: string; dept?: string; asOf: string }) => {
    const qs = new URLSearchParams({ entity: params.entity, asOf: params.asOf });
    if (params.store) qs.set('store', params.store);
    if (params.dept) qs.set('dept', params.dept);
    return apiFetchRaw(`/api/v1/gl/reports/income-statement/export?${qs.toString()}`);
  },

  // S202 — Dealer Group Hierarchy: real tenant-service org tree (GROUP ->
  // ENTITY -> STORE -> DEPARTMENT), consumed as-is, no client-side tree
  // reconstruction.
  getOrgTree: () => apiFetch<any>('/api/v1/org/tree'),

  // S004A — Dealership Position Role Templates: list/apply only (the
  // Golden Path browser journey applies an existing template; full
  // create/clone/deactivate CRUD already has live-gateway backend evidence
  // from the S004A certification and is not duplicated in this minimal
  // screen).
  listRoleTemplates: () => apiFetch<{ templates: any[] }>('/api/v1/iam/role-templates'),
  applyRoleTemplate: (data: { templateId: string; userId: string; entityId: string; storeIds?: string[]; allStores?: boolean }) =>
    apiFetch<any>('/api/v1/iam/role-templates:apply', { method: 'POST', body: JSON.stringify(data) }),

  // S221 — GL Search: consumes the real coa-service cross-account ledger
  // search API (frozen S220 ActivityLineView contract, plus
  // accountId/accountNumber, minus runningBalance) as-is. No `account`
  // filter exists on the real SearchQuerySchema -- do not add one client-side.
  searchGL: (params: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') qs.set(k, String(v)); });
    return apiFetch<{
      criteria: Record<string, any>;
      results: Array<{
        journalEntryId: string; journalNumber: string; accountId: string; accountNumber: string;
        entryDate: string; source: string; store: string; dept: string | null;
        controlNumber: string | null; applyNumber: string | null; memo: string | null; dr: number; cr: number;
      }>;
      pagination: { page: number; pageSize: number; totalResults: number; totalPages: number };
    }>(`/api/v1/coa/inquiry/search?${qs.toString()}`);
  },

  // S221 — saved searches (BR221-2). User-scoped within tenant (SavedGlSearch
  // is keyed by createdBy, resolved server-side from the JWT -- no actor
  // field is ever sent from the browser). No update/edit endpoint exists;
  // do not add one client-side.
  saveSearch: (name: string, criteria: Record<string, string | number | undefined>) =>
    apiFetch<{ id: string; name: string; criteria: Record<string, any>; createdAt: string; updatedAt: string }>(
      '/api/v1/coa/inquiry/searches',
      { method: 'POST', body: JSON.stringify({ name, criteria }) },
    ),
  listSavedSearches: () =>
    apiFetch<{ results: Array<{ id: string; name: string; criteria: Record<string, any>; createdAt: string; updatedAt: string }> }>(
      '/api/v1/coa/inquiry/searches',
    ),
  runSavedSearch: (id: string, page?: number, pageSize?: number) => {
    const qs = new URLSearchParams();
    if (page) qs.set('page', String(page));
    if (pageSize) qs.set('pageSize', String(pageSize));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<{
      criteria: Record<string, any>;
      results: Array<{
        journalEntryId: string; journalNumber: string; accountId: string; accountNumber: string;
        entryDate: string; source: string; store: string; dept: string | null;
        controlNumber: string | null; applyNumber: string | null; memo: string | null; dr: number; cr: number;
      }>;
      pagination: { page: number; pageSize: number; totalResults: number; totalPages: number };
    }>(`/api/v1/coa/inquiry/searches/${id}/run${suffix}`);
  },
  deleteSavedSearch: (id: string) =>
    apiFetch<void>(`/api/v1/coa/inquiry/searches/${id}`, { method: 'DELETE' }),

  // S011 — Analysis Codes / Dimensions registry (P01-SCR-04) + line tagging
  // (P01-SCR-05). Registry is a plain type/value CRUD (create/edit/
  // deactivate, no ceremonies) — same coa-service pattern as accounts/depts.
  listAnalysisTypes: (params?: { status?: 'ACTIVE' | 'INACTIVE'; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.search) qs.set('search', params.search);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<{ items: any[]; total: number }>(`/api/v1/coa/analysis/types${suffix}`);
  },
  createAnalysisType: (data: { code: string; name: string }) =>
    apiFetch<any>('/api/v1/coa/analysis/types', { method: 'POST', body: JSON.stringify(data) }),
  updateAnalysisType: (id: string, data: { version: number; name?: string }) =>
    apiFetch<any>(`/api/v1/coa/analysis/types/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deactivateAnalysisType: (id: string, data: { version: number; reason: string }) =>
    apiFetch<any>(`/api/v1/coa/analysis/types/${id}/deactivate`, { method: 'POST', body: JSON.stringify(data) }),
  createAnalysisValue: (typeId: string, data: { code: string; name: string }) =>
    apiFetch<any>(`/api/v1/coa/analysis/types/${typeId}/values`, { method: 'POST', body: JSON.stringify(data) }),
  updateAnalysisValue: (typeId: string, id: string, data: { version: number; name?: string }) =>
    apiFetch<any>(`/api/v1/coa/analysis/types/${typeId}/values/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deactivateAnalysisValue: (typeId: string, id: string, data: { version: number; reason: string }) =>
    apiFetch<any>(`/api/v1/coa/analysis/types/${typeId}/values/${id}/deactivate`, { method: 'POST', body: JSON.stringify(data) }),
};

// S032 — Recurring Journal Templates: real coa-service registry + manual
// generation ceremony (BLK-21 — no scheduler). Generation always creates a
// DRAFT through the certified S214 draft path; posting/reversal-draft
// posting remain manual human actions on the existing draft workflow.
export const recurringTemplateApi = {
  list: (entityId: string, active?: boolean) => {
    const qs = new URLSearchParams({ entity: entityId });
    if (active !== undefined) qs.set('active', String(active));
    return apiFetch<{ templates: any[] }>(`/api/v1/coa/journal-templates?${qs.toString()}`);
  },
  get: (id: string) => apiFetch<any>(`/api/v1/coa/journal-templates/${id}`),
  create: (data: {
    entityId: string; code: string; name: string; description?: string | null;
    autoReverse?: boolean; lines: any[];
  }) => apiFetch<any>('/api/v1/coa/journal-templates', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: { name?: string; description?: string | null; autoReverse?: boolean; lines?: any[] }) =>
    apiFetch<any>(`/api/v1/coa/journal-templates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  activate: (id: string) => apiFetch<any>(`/api/v1/coa/journal-templates/${id}/activate`, { method: 'POST' }),
  deactivate: (id: string) => apiFetch<any>(`/api/v1/coa/journal-templates/${id}/deactivate`, { method: 'POST' }),
  generate: (data: { entityId: string; periodId: string; templateIds?: string[] | 'ALL' }) =>
    apiFetch<{ batchId: string; periodCode: string; results: any[] }>('/api/v1/coa/journal-templates:generate', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// S207 — real permission-check API (auth-service AuthzService.check(), the
// same engine every backend route guard calls). Used client-side ONLY to
// hide/disable UI affordances the server would reject anyway (authorization-
// only UX polish) — the server-side guard remains the sole source of truth;
// a denied action is still rejected server-side even if this check is
// unreachable or stale.
export const authzApi = {
  check: (userId: string, permissionKey: string, tenantId: string, entityId?: string) => {
    const qs = new URLSearchParams({ user: userId, permission: permissionKey, tenant: tenantId });
    if (entityId) qs.set('entity', entityId);
    return apiFetch<{ allow: boolean; reason?: string; matchedRole?: string }>(`/api/v1/authz/check?${qs.toString()}`);
  },
};

// S019/S020 — Posting Engine: DSL rule packs + idempotent posting executions.
export const postingEngineApi = {
  // CE-07 legal-entity isolation defect — entityId is REQUIRED, never
  // optional: the browser must not infer or calculate legal-entity
  // ownership, so every caller supplies the entity scope explicitly (from
  // EntityScopeContext, the app's own first-class, server-validated entity
  // axis — never computed here). The server rejects a missing entityId
  // with 400, matching how x-tenant-id is already enforced.
  listRulePacks: (entityId: string) => apiFetch<{ items: Array<{ pack: any; versions: any[] }> }>(`/api/v1/coa/posting-engine/rule-packs?entityId=${encodeURIComponent(entityId)}`),
  getRulePack: (packKey: string, entityId: string) => apiFetch<{ pack: any; versions: any[] }>(`/api/v1/coa/posting-engine/rule-packs/${encodeURIComponent(packKey)}?entityId=${encodeURIComponent(entityId)}`),
  validateDraft: (sourceText: string) =>
    apiFetch<{ valid: boolean; findings: Array<{ severity: string; code: string; path: string; ruleId?: string; message: string }> }>(
      '/api/v1/coa/posting-engine/rule-packs/validate',
      { method: 'POST', body: JSON.stringify({ sourceText }) },
    ),
  createRulePackVersion: (packKey: string, sourceText: string) =>
    apiFetch<any>('/api/v1/coa/posting-engine/rule-packs', { method: 'POST', body: JSON.stringify({ packKey, sourceText }) }),
  validateVersion: (id: string) =>
    apiFetch<{ version: any; valid: boolean; findings: any[] }>(`/api/v1/coa/posting-engine/rule-pack-versions/${id}/validate`, { method: 'POST' }),
  activateVersion: (id: string) =>
    apiFetch<any>(`/api/v1/coa/posting-engine/rule-pack-versions/${id}/activate`, { method: 'POST' }),

  submitEvent: (envelope: Record<string, unknown>) =>
    apiFetch<{
      executionId: string; eventId: string; status: string; idempotent: boolean;
      rulePackVersionId?: string | null; ruleId?: string | null;
      journalEntryId?: string | null; journalNumber?: string | null; failureReason?: string | null;
    }>('/api/v1/coa/posting-engine/events', { method: 'POST', body: JSON.stringify(envelope) }),

  // D-S023-33 — validation + evaluation only, never posts. Used by the
  // Posting Executions screen's "Simulate" panel to preview the proposed
  // balanced journal a real event would produce before it's ever submitted.
  simulateEvent: (envelope: Record<string, unknown>) =>
    apiFetch<{
      wouldPost: boolean;
      status: 'WOULD_POST' | 'NO_RULE_MATCH' | 'AMBIGUOUS_RULE_PACK_MATCH' | 'WOULD_REJECT';
      rulePackVersionId?: string | null;
      ruleId?: string | null;
      proposedJournal?: {
        entityId: string; date: string; sourceCode: string;
        lines: Array<{ accountNumber: string; storeId: string; deptCode?: string | null; dr: number; cr: number; memo?: string | null }>;
      } | null;
      failureReason?: string | null;
    }>('/api/v1/coa/posting-engine/simulate', { method: 'POST', body: JSON.stringify(envelope) }),

  // CE-07 legal-entity isolation defect — entityId is REQUIRED so an
  // execution search can never span every entity in the tenant by
  // omission; a rule pack/execution belonging to another legal entity must
  // never appear in this tenant's inquiry results.
  searchExecutions: (entityId: string, params: { correlationId?: string; sourceEntityId?: string; status?: string }) => {
    const qs = new URLSearchParams();
    qs.set('entityId', entityId);
    if (params.correlationId) qs.set('correlationId', params.correlationId);
    if (params.sourceEntityId) qs.set('sourceEntityId', params.sourceEntityId);
    if (params.status) qs.set('status', params.status);
    return apiFetch<{ items: any[] }>(`/api/v1/coa/posting-engine/executions?${qs.toString()}`);
  },
  getExecutionById: (id: string) => apiFetch<any>(`/api/v1/coa/posting-engine/executions/${id}`),
  getExecutionByEventId: (eventId: string) => apiFetch<any>(`/api/v1/coa/posting-engine/executions/by-event/${encodeURIComponent(eventId)}`),
  listReplaysForExecution: (id: string) => apiFetch<{ items: Array<{
    id: string; originalRulePackVersionId: string | null; replayRulePackVersionId: string | null;
    replayActor: string; replayReason: string; resultingStatus: string;
    resultingJournalEntryId: string | null; resultingJournalNumber: string | null; createdAt: string;
  }> }>(`/api/v1/coa/posting-engine/executions/${id}/replays`),
  listExceptions: (reasonCode?: string) =>
    apiFetch<{ items: any[] }>(`/api/v1/coa/posting-engine/exceptions${reasonCode ? `?reasonCode=${encodeURIComponent(reasonCode)}` : ''}`),

  // D-S023-25/28 — authorized, governed replay of a NO_RULE_MATCH/REJECTED/
  // FAILED execution once a corrected rule pack is active. Reuses S021's own
  // permission (posting-recovery.replay.execute), not a new S023 string.
  replayExecution: (executionId: string, reason: string) =>
    apiFetch<{
      executionId: string; eventId: string; status: string; idempotent: boolean;
      rulePackVersionId?: string | null; ruleId?: string | null;
      journalEntryId?: string | null; journalNumber?: string | null; failureReason?: string | null;
    }>(`/api/v1/coa/posting-engine/executions/${executionId}/replay`, { method: 'POST', body: JSON.stringify({ reason }) }),
};

// S021 — Posting Recovery (DLQ inspection workbench). Note the literal
// /posting-recovery/v1/* path (not /api/v1/*) — posting-recovery-service is
// proxied directly (see apps/web/vite.config.ts), not through api-gateway.
export const postingRecoveryApi = {
  listQueue: (params?: string) => apiFetch<{
    items: Array<{
      id: string; sourceEventType: string; sourceSystem: string; sourceTransactionId: string | null;
      status: string; latestFailureCategory: string; latestFailureCode: string;
      firstFailureAt: string; latestFailureAt: string; attemptCount: number;
      assignedOwner: string | null; escalationState: string | null;
    }>;
    total: number; page: number; pageSize: number;
  }>(`/posting-recovery/v1/dead-letters${params ? `?${params}` : ''}`),
  getSummary: () => apiFetch<{ byStatus: Record<string, number>; byFailureCategory: Record<string, number> }>(
    '/posting-recovery/v1/dead-letters/summary',
  ),
  getCase: (id: string) => apiFetch<any>(`/posting-recovery/v1/dead-letters/${id}`),
  getAttempts: (id: string) => apiFetch<{ items: any[] }>(`/posting-recovery/v1/dead-letters/${id}/attempts`),
  getCorrections: (id: string) => apiFetch<{ items: any[] }>(`/posting-recovery/v1/dead-letters/${id}/corrections`),
  getLineage: (id: string) => apiFetch<any>(`/posting-recovery/v1/dead-letters/${id}/lineage`),
  getAuditTimeline: (id: string) => apiFetch<{ items: any[] }>(`/posting-recovery/v1/dead-letters/${id}/audit-timeline`),
  // R1 S021-completion — real replay execution.
  replay: (id: string) => apiFetch<{
    deadLetterId: string; attemptNumber: number; outcome: 'POSTED' | 'NOOP_ALREADY_POSTED' | 'REJECTED' | 'FAILED';
    message: string | null; journalReference: string | null; status: string; idempotentPassthrough: boolean;
  }>(`/posting-recovery/v1/dead-letters/${id}/replay`, { method: 'POST' }),
};

// S223 — Configuration Framework: scoped, effective-dated, catalog-controlled
// key/value settings (STORE -> ENTITY -> TENANT -> default resolution).
// Dashboard-rebuild target/threshold keys (dashboard.*) are registered here —
// see services/coa-service/prisma/migrations/20260731090000_seed_dashboard_target_config_keys.
export interface ResolvedConfigValue {
  key: string;
  type: 'BOOL' | 'INT' | 'ENUM' | 'STRING';
  value: string;
  resolvedScope: 'TENANT' | 'ENTITY' | 'STORE' | 'DEFAULT';
}
export const configApi = {
  resolve: (key: string, params: { entityId?: string | null; storeId?: string | null } = {}) => {
    const qs = new URLSearchParams();
    if (params.entityId) qs.set('entity', params.entityId);
    if (params.storeId) qs.set('store', params.storeId);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<ResolvedConfigValue>(`/api/v1/config/${encodeURIComponent(key)}${suffix}`);
  },
  listCatalog: () => apiFetch<{ keys: any[] }>('/api/v1/config/catalog'),
};

// ── CE-10 — Tax (S124 Certified Tax Engine Adapter + S125 Regulatory Fee
// Tables) ────────────────────────────────────────────────────────────────
// Dedicated domain client (mirrors the postingRecoveryApi/configApi
// split-by-domain convention, not the single giant goldenPathApi object) —
// every endpoint lives under the fixed /api/v1/tax prefix specified by the
// CE10 Fable epic package. All list endpoints return { items, total } per
// the listAnalysisTypes convention; all mutating endpoints on existing rows
// require a `version` field (optimistic concurrency), mirroring
// updateAnalysisType/deactivateAnalysisType. No local mock data — every
// screen built on this client calls these methods against the real
// tax-service, never a hardcoded fixture array.
export interface TaxAdapterStatus {
  status: 'CONFIGURED' | 'NOT_CONFIGURED' | 'ENGINE_UNAVAILABLE';
  engine: string | null;
  engineVersion: string | null;
  contentVersion: string | null;
  lastSuccessfulCallAt: string | null;
  queueDepth?: number;
}

export interface TaxAdapterConfig {
  id: string;
  engine: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  version: number;
  [key: string]: unknown;
}

export interface TaxJurisdiction {
  id: string;
  jurisdictionRefId: string;
  jurisdictionLabel: string;
  registrationNumber: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  version: number;
}

export interface TaxExemptionCertificate {
  id: string;
  partyId: string;
  partyName: string;
  jurisdictionScope: string;
  exemptionType: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: 'ACTIVE' | 'EXPIRING' | 'EXPIRED';
  documentMetadata?: Record<string, unknown> | null;
  version: number;
}

export interface TaxResultSummary {
  id: string;
  documentRef: string;
  documentDate: string;
  legalEntityId: string;
  jurisdictions: string[];
  status: 'CALCULATED' | 'EXEMPT_APPLIED' | 'ENGINE_UNAVAILABLE' | 'ENGINE_REJECTED' | 'NOT_CONFIGURED';
}

export interface TaxResultDetail extends TaxResultSummary {
  requestSnapshot: Record<string, unknown>;
  lines: Array<{
    lineId: string;
    jurisdictionId: string;
    jurisdictionLevel: string;
    taxType: string;
    rateAsReturned: string;
    taxableBase: string;
    taxAmount: string;
    engineResultId: string;
  }>;
  engineVersion: string | null;
  contentVersion: string | null;
  calculatedAt: string;
  linkedJournalId: string | null;
  unpostedAging: { days: number } | null;
}

export interface TaxException {
  id: string;
  documentRef: string;
  reasonCode: 'ENGINE_UNAVAILABLE' | 'ENGINE_REJECTED' | 'NOT_CONFIGURED';
  reasonDetail: string | null;
  parkedAt: string;
  status: string;
}

export interface TaxReconciliationRow {
  jurisdiction: string;
  engineSum: string;
  postedSum: string;
  glMovement: string | null;
  variance: string;
  balanced: boolean;
}

export interface TaxReconciliationResult {
  period: string;
  entityId: string;
  glMovementSourceIsPending: boolean;
  rows: TaxReconciliationRow[];
}

export interface TaxFee {
  id: string;
  feeCode: string;
  name: string;
  jurisdictionRefId: string;
  jurisdictionLabel: string;
  basis: 'FIXED_PER_UNIT' | 'FIXED_PER_DOCUMENT' | 'PERCENT_OF_BASE';
  amount: string | null;
  rate: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  version: number;
}

export interface TaxAuditEntry {
  id: string;
  entityType: string;
  entityId: string;
  actor: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

export const taxApi = {
  // Adapter status + test-connection (S124).
  getAdapterStatus: () => apiFetch<TaxAdapterStatus>('/api/v1/tax/adapter/status'),
  testAdapterConnection: () =>
    apiFetch<{ success: boolean; message: string; testedAt: string }>('/api/v1/tax/adapter/test-connection', { method: 'POST' }),

  // Adapter connection config — effective-dated, optimistic concurrency.
  listAdapterConfig: () => apiFetch<{ items: TaxAdapterConfig[]; total: number }>('/api/v1/tax/adapter/config'),
  createAdapterConfig: (data: Record<string, unknown>) =>
    apiFetch<TaxAdapterConfig>('/api/v1/tax/adapter/config', { method: 'POST', body: JSON.stringify(data) }),
  updateAdapterConfig: (id: string, data: { version: number } & Record<string, unknown>) =>
    apiFetch<TaxAdapterConfig>(`/api/v1/tax/adapter/config/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Jurisdiction Administration.
  listJurisdictions: (params?: { status?: 'ACTIVE' | 'INACTIVE'; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.search) qs.set('search', params.search);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<{ items: TaxJurisdiction[]; total: number }>(`/api/v1/tax/jurisdictions${suffix}`);
  },
  createJurisdiction: (data: {
    jurisdictionRefId: string; registrationNumber?: string; effectiveFrom: string; effectiveTo?: string | null;
  }) => apiFetch<TaxJurisdiction>('/api/v1/tax/jurisdictions', { method: 'POST', body: JSON.stringify(data) }),
  updateJurisdiction: (id: string, data: { version: number } & Record<string, unknown>) =>
    apiFetch<TaxJurisdiction>(`/api/v1/tax/jurisdictions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deactivateJurisdiction: (id: string, data: { version: number; reason: string }) =>
    apiFetch<TaxJurisdiction>(`/api/v1/tax/jurisdictions/${id}/deactivate`, { method: 'POST', body: JSON.stringify(data) }),

  // Exemption Configuration & Inquiry.
  listExemptions: (params?: { status?: string; party?: string; jurisdiction?: string; expiring?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.party) qs.set('party', params.party);
    if (params?.jurisdiction) qs.set('jurisdiction', params.jurisdiction);
    if (params?.expiring) qs.set('expiring', 'true');
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<{ items: TaxExemptionCertificate[]; total: number }>(`/api/v1/tax/exemptions${suffix}`);
  },
  createExemption: (data: Record<string, unknown>) =>
    apiFetch<TaxExemptionCertificate>('/api/v1/tax/exemptions', { method: 'POST', body: JSON.stringify(data) }),
  updateExemption: (id: string, data: { version: number } & Record<string, unknown>) =>
    apiFetch<TaxExemptionCertificate>(`/api/v1/tax/exemptions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Calculation / Result Inquiry — read-only, immutable.
  listResults: (params?: { documentRef?: string; entityId?: string; jurisdiction?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.documentRef) qs.set('documentRef', params.documentRef);
    if (params?.entityId) qs.set('entityId', params.entityId);
    if (params?.jurisdiction) qs.set('jurisdiction', params.jurisdiction);
    if (params?.status) qs.set('status', params.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<{ items: TaxResultSummary[]; total: number }>(`/api/v1/tax/results${suffix}`);
  },
  getResult: (id: string) => apiFetch<TaxResultDetail>(`/api/v1/tax/results/${id}`),

  // Exception & Outage Queue.
  listExceptions: () => apiFetch<{ items: TaxException[]; total: number }>('/api/v1/tax/exceptions'),
  reRequestException: (id: string) =>
    apiFetch<TaxException>(`/api/v1/tax/exceptions/${id}/re-request`, { method: 'POST' }),
  bulkReRequestExceptions: (ids: string[]) =>
    apiFetch<{ results: Array<{ id: string; outcome: string }> }>('/api/v1/tax/exceptions/bulk-re-request', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),

  // Tax Liability Reconciliation.
  getReconciliation: (params: { period: string; entityId: string; jurisdiction?: string }) => {
    const qs = new URLSearchParams({ period: params.period, entityId: params.entityId });
    if (params.jurisdiction) qs.set('jurisdiction', params.jurisdiction);
    return apiFetch<TaxReconciliationResult>(`/api/v1/tax/reconciliation?${qs.toString()}`);
  },
  getReconciliationReport: (params: { period: string; entityId: string; jurisdiction?: string }) => {
    const qs = new URLSearchParams({ period: params.period, entityId: params.entityId });
    if (params.jurisdiction) qs.set('jurisdiction', params.jurisdiction);
    return apiFetch<any>(`/api/v1/tax/reconciliation/report?${qs.toString()}`);
  },
  closeReconciliationPeriod: (params: { period: string; entityId: string }) => {
    const qs = new URLSearchParams({ period: params.period, entityId: params.entityId });
    return apiFetch<any>(`/api/v1/tax/reconciliation/close-period?${qs.toString()}`);
  },

  // Regulatory Fee Administration (S125).
  listFees: (params?: { jurisdiction?: string; status?: string; date?: string }) => {
    const qs = new URLSearchParams();
    if (params?.jurisdiction) qs.set('jurisdiction', params.jurisdiction);
    if (params?.status) qs.set('status', params.status);
    if (params?.date) qs.set('date', params.date);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<{ items: TaxFee[]; total: number }>(`/api/v1/tax/fees${suffix}`);
  },
  createFee: (data: Record<string, unknown>) =>
    apiFetch<TaxFee>('/api/v1/tax/fees', { method: 'POST', body: JSON.stringify(data) }),
  updateFee: (id: string, data: { version: number } & Record<string, unknown>) =>
    apiFetch<TaxFee>(`/api/v1/tax/fees/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deactivateFee: (id: string, data: { version: number; reason: string }) =>
    apiFetch<TaxFee>(`/api/v1/tax/fees/${id}/deactivate`, { method: 'POST', body: JSON.stringify(data) }),
  resolveFees: (params: Record<string, string>) => {
    const qs = new URLSearchParams(params);
    return apiFetch<{ items: TaxFee[] }>(`/api/v1/tax/fees/resolve?${qs.toString()}`);
  },

  // Effective-Date History (shared audit trail for every config surface).
  getAuditTrail: (entityType: string, entityId: string) =>
    apiFetch<{ items: TaxAuditEntry[] }>(`/api/v1/tax/audit/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`),
};

// ═══════════════════════════════════════════════════════════════════════
// CE-09 — AP, AR & Cash Operations frontend wiring (24 canonical stories).
// All modules below call the real apar-service (gateway prefix
// /api/v1/apar), cash-service (/api/v1/cash) and recon-service
// (/api/v1/recon) routes as implemented in services/*/src/http/*.ts — no
// mock data, no client-side policy invention.
// ═══════════════════════════════════════════════════════════════════════

// S043A/S045 — Payment Runs (proposal -> approve/reject -> execute -> rail
// artifacts). Mirrors services/apar-service routes.ts CreatePaymentRunProposalSchema.
export const paymentRunApi = {
  list: (params?: string) => apiFetch<any[]>(`/api/v1/apar/payment-runs${params ? `?${params}` : ''}`),
  getById: (id: string) => apiFetch<any>(`/api/v1/apar/payment-runs/${id}`),
  create: (data: { bankAccountId: string; dueDateThrough: string; discountDateThrough?: string; vendorIds?: string[] }) =>
    apiFetch<any>('/api/v1/apar/payment-runs', { method: 'POST', body: JSON.stringify(data) }),
  approve: (id: string, data?: { note?: string }) =>
    apiFetch<any>(`/api/v1/apar/payment-runs/${id}/approve`, { method: 'POST', body: JSON.stringify(data ?? {}) }),
  reject: (id: string, data: { reason: string }) =>
    apiFetch<any>(`/api/v1/apar/payment-runs/${id}/reject`, { method: 'POST', body: JSON.stringify(data) }),
  execute: (id: string) => apiFetch<any>(`/api/v1/apar/payment-runs/${id}/execute`, { method: 'POST' }),
  generateRailArtifact: (id: string, data: { mode: 'CHECK_PRINT' | 'POSITIVE_PAY' | 'ACH_NACHA' }) =>
    apiFetch<any>(`/api/v1/apar/payment-runs/${id}/rail-artifacts`, { method: 'POST', body: JSON.stringify(data) }),
  getRailArtifacts: (id: string) => apiFetch<any[]>(`/api/v1/apar/payment-runs/${id}/rail-artifacts`),
};

// S043A — Manual payment lifecycle: void/stop-payment/reissue/escheat/due-diligence.
// Extends manualPaymentApi above (void/create/retryScheduleRelief already exist there).
export const paymentLifecycleApi = {
  markClearedTestOnly: (id: string, data?: { clearedAt?: string }) =>
    apiFetch<any>(`/api/v1/apar/manual-payments/${id}/mark-cleared-test-only`, { method: 'POST', body: JSON.stringify(data ?? {}) }),
  reissue: (id: string, data: { bankAccountId: string; paymentDate?: string }) =>
    apiFetch<any>(`/api/v1/apar/manual-payments/${id}/reissue`, { method: 'POST', body: JSON.stringify(data) }),
  requestStopPayment: (id: string, data: { reason: string }) =>
    apiFetch<any>(`/api/v1/apar/manual-payments/${id}/stop-payment-requests`, { method: 'POST', body: JSON.stringify(data) }),
  getStopPaymentRequests: (id: string) => apiFetch<any[]>(`/api/v1/apar/manual-payments/${id}/stop-payment-requests`),
  resolveStopPayment: (requestId: string, data: { status: 'ACKNOWLEDGED' | 'FAILED'; bankAck: 'MANUAL' | 'PAYMENT_RAIL_NOT_CONFIGURED'; bankAckNote?: string }) =>
    apiFetch<any>(`/api/v1/apar/stop-payment-requests/${requestId}/resolve`, { method: 'POST', body: JSON.stringify(data) }),
  getEscheatQueue: () => apiFetch<any[]>('/api/v1/apar/escheat/queue'),
  recordDueDiligence: (id: string, data: { method: 'LETTER' | 'PHONE' | 'EMAIL' | 'OTHER'; outcome: string; notes?: string }) =>
    apiFetch<any>(`/api/v1/apar/manual-payments/${id}/due-diligence`, { method: 'POST', body: JSON.stringify(data) }),
  getDueDiligence: (id: string) => apiFetch<any[]>(`/api/v1/apar/manual-payments/${id}/due-diligence`),
  // Server refuses with ESCHEAT_CONFIG_NOT_FOUND (422) when no jurisdiction
  // config exists — the UI must render that as an "informational only, no
  // config" state, never silently compute an escheat amount client-side.
  postEscheatTransfer: (id: string, data: { jurisdiction: string }) =>
    apiFetch<any>(`/api/v1/apar/manual-payments/${id}/escheat-transfer`, { method: 'POST', body: JSON.stringify(data) }),
};

// S044 — Use Tax Assessments/Register
export const useTaxApi = {
  getAssessments: (params?: string) => apiFetch<any[]>(`/api/v1/apar/use-tax/assessments${params ? `?${params}` : ''}`),
  getAssessment: (id: string) => apiFetch<any>(`/api/v1/apar/use-tax/assessments/${id}`),
  getRegister: (params?: string) => apiFetch<any[]>(`/api/v1/apar/use-tax/register${params ? `?${params}` : ''}`),
  assessInvoice: (invoiceId: string, data: any) =>
    apiFetch<any>(`/api/v1/apar/invoices/${invoiceId}/use-tax-assessment`, { method: 'POST', body: JSON.stringify(data) }),
};

// S036A/S039 — Purchase Orders (2/3-way match input, distinct from the
// legacy purchaseOrderApi which targets a different schema/route set).
export const apPurchaseOrderApi = {
  list: (params?: string) => apiFetch<any[]>(`/api/v1/apar/purchase-orders${params ? `?${params}` : ''}`),
  getById: (id: string) => apiFetch<any>(`/api/v1/apar/purchase-orders/${id}`),
  create: (data: any) => apiFetch<any>('/api/v1/apar/purchase-orders', { method: 'POST', body: JSON.stringify(data) }),
  submit: (id: string) => apiFetch<any>(`/api/v1/apar/purchase-orders/${id}/submit`, { method: 'POST' }),
  approve: (id: string) => apiFetch<any>(`/api/v1/apar/purchase-orders/${id}/approve`, { method: 'POST' }),
  cancel: (id: string, data?: { reason?: string }) =>
    apiFetch<any>(`/api/v1/apar/purchase-orders/${id}/cancel`, { method: 'POST', body: JSON.stringify(data ?? {}) }),
  void: (id: string, data?: { reason?: string }) =>
    apiFetch<any>(`/api/v1/apar/purchase-orders/${id}/void`, { method: 'POST', body: JSON.stringify(data ?? {}) }),
  close: (id: string) => apiFetch<any>(`/api/v1/apar/purchase-orders/${id}/close`, { method: 'POST' }),
};

// S047 — Trade Payoff Payments
export const tradePayoffApi = {
  list: (params?: string) => apiFetch<any[]>(`/api/v1/apar/trade-payoff-payments${params ? `?${params}` : ''}`),
  getById: (id: string) => apiFetch<any>(`/api/v1/apar/trade-payoff-payments/${id}`),
  create: (data: { dealReference: string; payeeName: string; payeeRemitAddress: string; payeeReference?: string; amount: number; goodThroughDate: string }) =>
    apiFetch<any>('/api/v1/apar/trade-payoff-payments', { method: 'POST', body: JSON.stringify(data) }),
};

// S048 — Wholesale Vehicle AR & Title Release Gate (mandatory security-
// critical action boundary — release-title requires the item to be paid in
// full; release-title-exception requires a distinct permission + mandatory
// reason and produces an audited ArTitleReleaseException record).
export const wholesaleVehicleApi = {
  list: (params?: string) => apiFetch<any[]>(`/api/v1/apar/wholesale-vehicle-items${params ? `?${params}` : ''}`),
  getById: (id: string) => apiFetch<any>(`/api/v1/apar/wholesale-vehicle-items/${id}`),
  create: (data: { customerId: string; vehicleVin: string; saleAmount: number }) =>
    apiFetch<any>('/api/v1/apar/wholesale-vehicle-items', { method: 'POST', body: JSON.stringify(data) }),
  recordPayment: (id: string, data: { amount: number }) =>
    apiFetch<any>(`/api/v1/apar/wholesale-vehicle-items/${id}/payments`, { method: 'POST', body: JSON.stringify(data) }),
  releaseTitle: (id: string) => apiFetch<any>(`/api/v1/apar/wholesale-vehicle-items/${id}/release-title`, { method: 'POST' }),
  releaseTitleException: (id: string, data: { reason: string }) =>
    apiFetch<any>(`/api/v1/apar/wholesale-vehicle-items/${id}/release-title-exception`, { method: 'POST', body: JSON.stringify(data) }),
  getReleaseExceptions: (id: string) => apiFetch<any[]>(`/api/v1/apar/wholesale-vehicle-items/${id}/release-exceptions`),
};

// S049 — Fleet Billing: parent/unit consolidation links + consolidated invoices
export const fleetBillingApi = {
  linkUnit: (data: { parentCustomerId: string; childCustomerId: string; billingGroupName?: string }) =>
    apiFetch<any>('/api/v1/apar/fleet-billing/unit-links', { method: 'POST', body: JSON.stringify(data) }),
  unlinkUnit: (id: string) => apiFetch<any>(`/api/v1/apar/fleet-billing/unit-links/${id}`, { method: 'DELETE' }),
  getParentUnits: (parentCustomerId: string) => apiFetch<any[]>(`/api/v1/apar/fleet-billing/parents/${parentCustomerId}/units`),
  createConsolidatedInvoice: (data: { parentCustomerId: string; invoiceDate: string; items: Array<{ childCustomerId: string; amount: number; description?: string }> }) =>
    apiFetch<any>('/api/v1/apar/fleet-billing/consolidated-invoices', { method: 'POST', body: JSON.stringify(data) }),
  listConsolidatedInvoices: (params?: string) => apiFetch<any[]>(`/api/v1/apar/fleet-billing/consolidated-invoices${params ? `?${params}` : ''}`),
  getConsolidatedInvoice: (id: string) => apiFetch<any>(`/api/v1/apar/fleet-billing/consolidated-invoices/${id}`),
  getParentStatement: (parentCustomerId: string) => apiFetch<any>(`/api/v1/apar/fleet-billing/parents/${parentCustomerId}/statement`),
};

// S050 — Write-offs (direct write-off + reverse + register)
export const writeOffApi = {
  list: (params?: string) => apiFetch<any[]>(`/api/v1/apar/write-offs${params ? `?${params}` : ''}`),
  getRegister: (params?: string) => apiFetch<any[]>(`/api/v1/apar/write-offs/register${params ? `?${params}` : ''}`),
  getById: (id: string) => apiFetch<any>(`/api/v1/apar/write-offs/${id}`),
  create: (data: { arEntryId: string; amount: number; reason: string; useOverride?: boolean }) =>
    apiFetch<any>('/api/v1/apar/write-offs', { method: 'POST', body: JSON.stringify(data) }),
  reverse: (id: string, data: { reason: string }) =>
    apiFetch<any>(`/api/v1/apar/write-offs/${id}/reverse`, { method: 'POST', body: JSON.stringify(data) }),
};

// S051 — Allowance previews: compute (preview only, never posts) -> approve
// (explicit human step) -> post (must equal the approved amount exactly,
// server refuses ALLOWANCE_POST_AMOUNT_MISMATCH otherwise).
export const allowancePreviewApi = {
  list: () => apiFetch<any[]>('/api/v1/apar/allowance-previews'),
  getById: (id: string) => apiFetch<any>(`/api/v1/apar/allowance-previews/${id}`),
  computePreview: (data: { asOfDate: string }) =>
    apiFetch<any>('/api/v1/apar/allowance-previews', { method: 'POST', body: JSON.stringify(data) }),
  approvePreview: (id: string, data?: { approvedBy?: string }) =>
    apiFetch<any>(`/api/v1/apar/allowance-previews/${id}/approve`, { method: 'POST', body: JSON.stringify(data ?? {}) }),
  post: (id: string, data: { postedAmount: number }) =>
    apiFetch<any>(`/api/v1/apar/allowance-previews/${id}/post`, { method: 'POST', body: JSON.stringify(data) }),
};

// S045 (NSF sub-flow) — NSF Events
export const nsfEventApi = {
  list: (params?: string) => apiFetch<any[]>(`/api/v1/apar/nsf-events${params ? `?${params}` : ''}`),
  getById: (id: string) => apiFetch<any>(`/api/v1/apar/nsf-events/${id}`),
  create: (data: { customerId: string; originalArEntryId: string; amount: number; reason: string; source?: 'MANUAL' | 'BANK_FEED_NOT_CONFIGURED' }) =>
    apiFetch<any>('/api/v1/apar/nsf-events', { method: 'POST', body: JSON.stringify(data) }),
};

// S047 (dependency) — Insurance Claims (short-pay disposition)
export const insuranceClaimApi = {
  list: (params?: string) => apiFetch<any[]>(`/api/v1/apar/insurance-claims${params ? `?${params}` : ''}`),
  getById: (id: string) => apiFetch<any>(`/api/v1/apar/insurance-claims/${id}`),
  create: (data: { customerId: string; insurerName: string; insurerReference?: string; claimNumber: string; roReference?: string; claimAmount: number }) =>
    apiFetch<any>('/api/v1/apar/insurance-claims', { method: 'POST', body: JSON.stringify(data) }),
  postSupplement: (id: string, data: { adjustmentAmount: number; reason: string }) =>
    apiFetch<any>(`/api/v1/apar/insurance-claims/${id}/supplements`, { method: 'POST', body: JSON.stringify(data) }),
  applyPayment: (id: string, data: { amount: number }) =>
    apiFetch<any>(`/api/v1/apar/insurance-claims/${id}/apply-payment`, { method: 'POST', body: JSON.stringify(data) }),
  disposeShortPay: (id: string, data: { dispositionType: 'CUSTOMER_RESPONSIBILITY' | 'WRITE_OFF'; reason: string }) =>
    apiFetch<any>(`/api/v1/apar/insurance-claims/${id}/dispose-short-pay`, { method: 'POST', body: JSON.stringify(data) }),
};

// S036B/S037 — Vendor 1099 admin (box rules, threshold configs,
// corrections, year preview). Distinct from the legacy glApi 1099
// endpoints (/api/v1/ap/1099/*), which target a different report surface.
export const vendor1099AdminApi = {
  setBoxRule: (data: { vendorId: string; taxYear: number; formType: '1099-MISC' | '1099-NEC' | 'T4A'; boxCode: string }) =>
    apiFetch<any>('/api/v1/apar/vendor-1099/box-rules', { method: 'POST', body: JSON.stringify(data) }),
  getBoxRules: (params?: string) => apiFetch<any[]>(`/api/v1/apar/vendor-1099/box-rules${params ? `?${params}` : ''}`),
  setThresholdConfig: (data: { formType: '1099-MISC' | '1099-NEC' | 'T4A'; taxYear: number; thresholdAmount: number }) =>
    apiFetch<any>('/api/v1/apar/vendor-1099/threshold-configs', { method: 'POST', body: JSON.stringify(data) }),
  getThresholdConfigs: (params?: string) => apiFetch<any[]>(`/api/v1/apar/vendor-1099/threshold-configs${params ? `?${params}` : ''}`),
  postCorrection: (data: { vendorId: string; taxYear: number; formType: '1099-MISC' | '1099-NEC' | 'T4A'; correctedAmount: number; reason: string }) =>
    apiFetch<any>('/api/v1/apar/vendor-1099/corrections', { method: 'POST', body: JSON.stringify(data) }),
  getCorrections: (params?: string) => apiFetch<any[]>(`/api/v1/apar/vendor-1099/corrections${params ? `?${params}` : ''}`),
  getYearPreview: (taxYear: number) => apiFetch<any>(`/api/v1/apar/vendor-1099/year-preview/${taxYear}`),
};

// ─── cash-service (proxied at /api/v1/cash by the gateway) ───────────────

// S053 — Deposits (batch creation/slip/status) + bank-feed
export const depositApi = {
  create: (data: { entityId: string; storeId: string; bankAccountCode: string; businessDate: string; receiptIds: string[]; idempotencyKey: string }) =>
    apiFetch<any>('/api/v1/cash/deposits', { method: 'POST', body: JSON.stringify(data) }),
  list: (params?: string) => apiFetch<any[]>(`/api/v1/cash/deposits${params ? `?${params}` : ''}`),
  getById: (id: string) => apiFetch<any>(`/api/v1/cash/deposits/${id}`),
  getSlip: (id: string) => apiFetch<any>(`/api/v1/cash/deposits/${id}/slip`),
  post: (id: string) => apiFetch<any>(`/api/v1/cash/deposits/${id}/post`, { method: 'POST' }),
  void: (id: string, data: { reason: string }) =>
    apiFetch<any>(`/api/v1/cash/deposits/${id}/void`, { method: 'POST', body: JSON.stringify(data) }),
  getBankFeedStatus: () => apiFetch<any>('/api/v1/cash/bank-feed/status'),
  getBankFeedLines: (params?: string) => apiFetch<any[]>(`/api/v1/cash/bank-feed/lines${params ? `?${params}` : ''}`),
  addManualFeedLine: (data: { bankAccountCode: string; externalId?: string | null; amount: number | string; valueDate: string; description?: string | null }) =>
    apiFetch<any>('/api/v1/cash/bank-feed/lines', { method: 'POST', body: JSON.stringify(data) }),
  syncBankFeed: () => apiFetch<any>('/api/v1/cash/bank-feed/sync', { method: 'POST' }),
  matchFeedLine: (feedLineId: string, data: { depositId?: string; receiptId?: string }) =>
    apiFetch<any>(`/api/v1/cash/bank-feed/lines/${feedLineId}/match`, { method: 'POST', body: JSON.stringify(data) }),
};

// S055 — Settlements: merchant batches, chargebacks, worklist
export const settlementApi = {
  getStatus: () => apiFetch<any>('/api/v1/cash/settlements/status'),
  importBatch: (data: { entityId: string; bankAccountCode: string; processorName: string; batchReference: string; settlementDate: string; grossAmount: number | string }) =>
    apiFetch<any>('/api/v1/cash/settlements/batches', { method: 'POST', body: JSON.stringify(data) }),
  listBatches: (params?: string) => apiFetch<any[]>(`/api/v1/cash/settlements/batches${params ? `?${params}` : ''}`),
  getBatch: (id: string) => apiFetch<any>(`/api/v1/cash/settlements/batches/${id}`),
  matchBatch: (id: string, data: { receiptId?: string; depositId?: string; amount: number | string }) =>
    apiFetch<any>(`/api/v1/cash/settlements/batches/${id}/match`, { method: 'POST', body: JSON.stringify(data) }),
  postBatch: (id: string) => apiFetch<any>(`/api/v1/cash/settlements/batches/${id}/post`, { method: 'POST' }),
  getWorklist: (params?: string) => apiFetch<any[]>(`/api/v1/cash/settlements/worklist${params ? `?${params}` : ''}`),
  addWorklistItem: (data: { batchId?: string; bankAccountCode: string; amount: number | string; cardLast4?: string | null; transactionRef?: string | null }) =>
    apiFetch<any>('/api/v1/cash/settlements/worklist', { method: 'POST', body: JSON.stringify(data) }),
  // Backend resolveWorklistItem(tenantId, itemId, actor) takes no request
  // body at all (see services/cash-service/src/http/settlement-routes.ts) —
  // resolution is derived server-side, not client-supplied.
  resolveWorklistItem: (itemId: string) =>
    apiFetch<any>(`/api/v1/cash/settlements/worklist/${itemId}/resolve`, { method: 'POST' }),
  intakeChargeback: (data: { entityId: string; batchId?: string; customerId?: string | null; amount: number | string; reasonCode?: string | null }) =>
    apiFetch<any>('/api/v1/cash/settlements/chargebacks', { method: 'POST', body: JSON.stringify(data) }),
  dispositionChargeback: (chargebackId: string, data: { dispositionAction: 'CUSTOMER_RESPONSIBILITY' | 'MERCHANT_ABSORBED' }) =>
    apiFetch<any>(`/api/v1/cash/settlements/chargebacks/${chargebackId}/disposition`, { method: 'POST', body: JSON.stringify(data) }),
};

// S056 — Sweeps (store->operating account pairs + fp-offset-allocations)
export const sweepApi = {
  configurePair: (data: { entityId: string; storeAccountCode: string; operatingAccountCode: string }) =>
    apiFetch<any>('/api/v1/cash/sweeps/pairs', { method: 'POST', body: JSON.stringify(data) }),
  listPairs: () => apiFetch<any[]>('/api/v1/cash/sweeps/pairs'),
  record: (data: { pairConfigId: string; sweepDate: string; direction: string; amount: number | string; confirmationState?: 'MANUAL_RECORDED' | 'FEED_CONFIRMED'; idempotencyKey: string }) =>
    apiFetch<any>('/api/v1/cash/sweeps', { method: 'POST', body: JSON.stringify(data) }),
  list: (params?: string) => apiFetch<any[]>(`/api/v1/cash/sweeps${params ? `?${params}` : ''}`),
  getById: (id: string) => apiFetch<any>(`/api/v1/cash/sweeps/${id}`),
  post: (id: string) => apiFetch<any>(`/api/v1/cash/sweeps/${id}/post`, { method: 'POST' }),
  void: (id: string, data: { reason: string }) =>
    apiFetch<any>(`/api/v1/cash/sweeps/${id}/void`, { method: 'POST', body: JSON.stringify(data) }),
  createFpOffsetAllocation: (data: { entityId: string; lenderName: string; statementDate: string; statementAmount: number | string; lines: Array<{ floorplanUnitRef: string; amount: number | string }>; idempotencyKey: string }) =>
    apiFetch<any>('/api/v1/cash/fp-offset-allocations', { method: 'POST', body: JSON.stringify(data) }),
  listFpOffsetAllocations: (params?: string) => apiFetch<any[]>(`/api/v1/cash/fp-offset-allocations${params ? `?${params}` : ''}`),
  getFpOffsetAllocation: (id: string) => apiFetch<any>(`/api/v1/cash/fp-offset-allocations/${id}`),
  postFpOffsetAllocation: (id: string) => apiFetch<any>(`/api/v1/cash/fp-offset-allocations/${id}/post`, { method: 'POST' }),
};

// S057 — Cash Position dashboard: server-computed authoritative values only.
export const cashPositionApi = {
  get: (params?: string) => apiFetch<any>(`/api/v1/cash/position${params ? `?${params}` : ''}`),
  exportPosition: (data: any) => apiFetch<any>('/api/v1/cash/position/export', { method: 'POST', body: JSON.stringify(data) }),
  listExports: (params?: string) => apiFetch<any[]>(`/api/v1/cash/position/exports${params ? `?${params}` : ''}`),
};

// ─── recon-service (proxied at /api/v1/recon by the gateway) ────────────
// S054A/S054B — real recon-session model: statement-lines, book-items,
// manual match/unmatch, session lock, out-of-balance completion refusal,
// plus auto-match rules/run/suggestions/confirm/reject. Distinct from the
// legacy reconApi above, which targets an older/simpler recon route set.
export const reconSessionApi = {
  create: (data: { entityId: string; bankAccountCode: string; periodStart: string; periodEnd: string; statementBeginningBalance: number; statementEndingBalance: number }) =>
    apiFetch<any>('/api/v1/recon/sessions', { method: 'POST', body: JSON.stringify(data) }),
  list: (params?: string) => apiFetch<any[]>(`/api/v1/recon/sessions${params ? `?${params}` : ''}`),
  getById: (id: string) => apiFetch<any>(`/api/v1/recon/sessions/${id}`),
  getStatementLines: (id: string) => apiFetch<any[]>(`/api/v1/recon/sessions/${id}/statement-lines`),
  addStatementLine: (id: string, data: { lineDate: string; description: string; amount: number; source: 'MANUAL' | 'IMPORTED'; externalRef?: string | null }) =>
    apiFetch<any>(`/api/v1/recon/sessions/${id}/statement-lines`, { method: 'POST', body: JSON.stringify(data) }),
  importStatementLines: (id: string, lines: Array<{ lineDate: string; description: string; amount: number; externalRef?: string | null }>) =>
    apiFetch<any>(`/api/v1/recon/sessions/${id}/statement-lines/import`, { method: 'POST', body: JSON.stringify({ lines }) }),
  getBookItems: (id: string) => apiFetch<any[]>(`/api/v1/recon/sessions/${id}/book-items`),
  addManualBookItem: (id: string, data: { itemType: 'PAYMENT' | 'DEPOSIT' | 'FEE' | 'NSF' | 'SWEEP'; itemDate: string; description: string; amount: number }) =>
    apiFetch<any>(`/api/v1/recon/sessions/${id}/book-items`, { method: 'POST', body: JSON.stringify(data) }),
  syncBookItems: (id: string) => apiFetch<any>(`/api/v1/recon/sessions/${id}/book-items/sync`, { method: 'POST' }),
  match: (id: string, data: { statementLineId: string; bookItemId: string }) =>
    apiFetch<any>(`/api/v1/recon/sessions/${id}/match`, { method: 'POST', body: JSON.stringify(data) }),
  unmatch: (id: string, data: { statementLineId: string; reason: string }) =>
    apiFetch<any>(`/api/v1/recon/sessions/${id}/unmatch`, { method: 'POST', body: JSON.stringify(data) }),
  // Server refuses completion when out of balance — surface its error as-is,
  // never allow a client-side "force complete".
  complete: (id: string) => apiFetch<any>(`/api/v1/recon/sessions/${id}/complete`, { method: 'POST' }),
};

export const autoMatchApi = {
  createRule: (data: { entityId?: string | null; bankAccountCode?: string | null; ruleType: 'AMOUNT_DATE_WINDOW' | 'REFERENCE_CONTAINS' | 'CHECK_NUMBER' | 'BATCH_TOTAL'; tier: 'EXACT' | 'SUGGESTED'; config: Record<string, any>; priority?: number }) =>
    apiFetch<any>('/api/v1/recon/match-rules', { method: 'POST', body: JSON.stringify(data) }),
  listRules: () => apiFetch<any[]>('/api/v1/recon/match-rules'),
  run: (sessionId: string) => apiFetch<any>(`/api/v1/recon/sessions/${sessionId}/auto-match`, { method: 'POST' }),
  getSuggestions: (sessionId: string) => apiFetch<any[]>(`/api/v1/recon/sessions/${sessionId}/suggestions`),
  confirmSuggestion: (sessionId: string, suggestionId: string) =>
    apiFetch<any>(`/api/v1/recon/sessions/${sessionId}/suggestions/${suggestionId}/confirm`, { method: 'POST' }),
  rejectSuggestion: (sessionId: string, suggestionId: string, data?: { reason?: string }) =>
    apiFetch<any>(`/api/v1/recon/sessions/${sessionId}/suggestions/${suggestionId}/reject`, { method: 'POST', body: JSON.stringify(data ?? {}) }),
};

export const oemApi = {
  // S098 — Profiles / adapter status / dealer codes.
  listProfiles: () => apiFetch<any[]>('/api/v1/oem/profiles'),
  getProfile: (make: string) => apiFetch<any>(`/api/v1/oem/profiles/${encodeURIComponent(make)}`),
  createProfile: (data: { make: string; programName?: string; statementSpecVersion?: string; notes?: string }) =>
    apiFetch<any>('/api/v1/oem/profiles', { method: 'POST', body: JSON.stringify(data) }),
  setProfileStatus: (make: string, data: { status: string; certificationEvidenceRef?: string | null }) =>
    apiFetch<any>(`/api/v1/oem/profiles/${encodeURIComponent(make)}/status`, { method: 'PATCH', body: JSON.stringify(data) }),
  setDealerCode: (make: string, storeId: string, dealerCode: string) =>
    apiFetch<any>(`/api/v1/oem/profiles/${encodeURIComponent(make)}/dealer-codes/${encodeURIComponent(storeId)}`, {
      method: 'PUT', body: JSON.stringify({ dealerCode }),
    }),

  // S098/S099/S100 — Staging / diff alerts.
  importFeed: (data: { make: string; storeId?: string; rawContent: string }) =>
    apiFetch<any>('/api/v1/oem/staging/import/feed', { method: 'POST', body: JSON.stringify(data) }),
  importManual: (data: { make: string; kind: string; storeId?: string; naturalKey: string; specVersion?: string; rows: Array<{ canonicalType?: string; fields: Record<string, unknown> }> }) =>
    apiFetch<any>('/api/v1/oem/staging/import/manual', { method: 'POST', body: JSON.stringify(data) }),
  listStagedDocuments: (make?: string) => apiFetch<any[]>(`/api/v1/oem/staging/documents${make ? `?make=${encodeURIComponent(make)}` : ''}`),
  getStagedDocument: (id: string) => apiFetch<any>(`/api/v1/oem/staging/documents/${id}`),
  listDiffAlerts: (resolved?: boolean) => apiFetch<any[]>(`/api/v1/oem/staging/diff-alerts${resolved === undefined ? '' : `?resolved=${resolved}`}`),
  resolveDiffAlert: (id: string) => apiFetch<any>(`/api/v1/oem/staging/diff-alerts/${id}/resolve`, { method: 'POST' }),

  // S101A — Match workbench.
  createMatchSession: (storeId: string, statementDocumentId: string) =>
    apiFetch<any>('/api/v1/oem/match/sessions', { method: 'POST', body: JSON.stringify({ storeId, statementDocumentId }) }),
  listMatchSessions: (storeId?: string) => apiFetch<any[]>(`/api/v1/oem/match/sessions${storeId ? `?storeId=${encodeURIComponent(storeId)}` : ''}`),
  getMatchSession: (id: string) => apiFetch<any>(`/api/v1/oem/match/sessions/${id}`),
  disposeMatchRow: (sessionId: string, rowId: string, disposition: string, note?: string) =>
    apiFetch<any>(`/api/v1/oem/match/sessions/${sessionId}/rows/${rowId}/dispose`, { method: 'POST', body: JSON.stringify({ disposition, note }) }),
  completeMatchSession: (id: string) => apiFetch<any>(`/api/v1/oem/match/sessions/${id}/complete`, { method: 'POST' }),

  // S103A — Incentive registry / RDR accruals.
  listIncentivePrograms: () => apiFetch<any[]>('/api/v1/oem/incentives/programs'),
  registerIncentiveProgram: (data: Record<string, unknown>) =>
    apiFetch<any>('/api/v1/oem/incentives/programs', { method: 'POST', body: JSON.stringify(data) }),
  accrueIncentives: (storeId: string, since?: string) =>
    apiFetch<any>('/api/v1/oem/incentives/accrue', { method: 'POST', body: JSON.stringify({ storeId, since }) }),
  listIncentiveAccruals: (storeId?: string) => apiFetch<any[]>(`/api/v1/oem/incentives/accruals${storeId ? `?storeId=${encodeURIComponent(storeId)}` : ''}`),
  trueUpIncentiveAccrual: (id: string, data: { adjustmentAmount: string; reason: string; statementRowRef?: string }) =>
    apiFetch<any>(`/api/v1/oem/incentives/accruals/${id}/true-up`, { method: 'POST', body: JSON.stringify(data) }),
  getIncentiveReceivableTie: (storeId: string) => apiFetch<any>(`/api/v1/oem/incentives/receivable-tie?storeId=${encodeURIComponent(storeId)}`),

  // S104 — Statement renderer.
  listStatementProfiles: () => apiFetch<any[]>('/api/v1/oem/statement/profiles'),
  createStatementProfile: (data: { make: string; version: string; pageLineDefinitions: unknown; effectiveFrom: string }) =>
    apiFetch<any>('/api/v1/oem/statement/profiles', { method: 'POST', body: JSON.stringify(data) }),
  listStatementMappings: (profileId: string) => apiFetch<any[]>(`/api/v1/oem/statement/profiles/${profileId}/mappings`),
  authorStatementMapping: (profileId: string, data: { glAccountId: string; statementLineRef: string }) =>
    apiFetch<any>(`/api/v1/oem/statement/profiles/${profileId}/mappings`, { method: 'POST', body: JSON.stringify(data) }),
  activateStatementMapping: (id: string) => apiFetch<any>(`/api/v1/oem/statement/mappings/${id}/activate`, { method: 'POST' }),
  renderStatement: (data: { storeId: string; statementProfileId: string; period: string; injectVarianceForCertification?: string }) =>
    apiFetch<any>('/api/v1/oem/statement/renders', { method: 'POST', body: JSON.stringify(data) }),
  getStatementRender: (id: string) => apiFetch<any>(`/api/v1/oem/statement/renders/${id}`),
  drillStatementCell: (id: string, lineRef: string) => apiFetch<any>(`/api/v1/oem/statement/renders/${id}/drill?lineRef=${encodeURIComponent(lineRef)}`),
  exportStatementRender: (id: string, format = 'JSON') =>
    apiFetch<any>(`/api/v1/oem/statement/renders/${id}/export`, { method: 'POST', body: JSON.stringify({ format }) }),
  listStatementExports: (renderId?: string) => apiFetch<any[]>(`/api/v1/oem/statement/exports${renderId ? `?renderId=${renderId}` : ''}`),

  // S105 — Warranty chargeback / reserve.
  createChargebackNotice: (data: { storeId: string; make: string; sourceDocumentId?: string; noticeDate: string; lines: Array<{ originalClaimItemRef: string; amount: string }> }) =>
    apiFetch<any>('/api/v1/oem/warranty/notices', { method: 'POST', body: JSON.stringify(data) }),
  listChargebackNotices: (storeId?: string) => apiFetch<any[]>(`/api/v1/oem/warranty/notices${storeId ? `?storeId=${encodeURIComponent(storeId)}` : ''}`),
  getChargebackNotice: (id: string) => apiFetch<any>(`/api/v1/oem/warranty/notices/${id}`),
  disposeChargebackLine: (id: string, disposition: 'ACCEPTED' | 'DISPUTED') =>
    apiFetch<any>(`/api/v1/oem/warranty/lines/${id}/dispose`, { method: 'POST', body: JSON.stringify({ disposition }) }),
  addChargebackEvidence: (id: string, evidenceRef: string, note?: string) =>
    apiFetch<any>(`/api/v1/oem/warranty/lines/${id}/evidence`, { method: 'POST', body: JSON.stringify({ evidenceRef, note }) }),
  setReserveConfig: (storeId: string, ratePercent: string, effectiveFrom: string) =>
    apiFetch<any>('/api/v1/oem/warranty/reserve/config', { method: 'POST', body: JSON.stringify({ storeId, ratePercent, effectiveFrom }) }),
  previewReserve: (storeId: string, period: string, paidWarrantyVolume: string) =>
    apiFetch<any>('/api/v1/oem/warranty/reserve/preview', { method: 'POST', body: JSON.stringify({ storeId, period, paidWarrantyVolume }) }),
  approveReservePreview: (id: string) => apiFetch<any>(`/api/v1/oem/warranty/reserve/previews/${id}/approve`, { method: 'POST' }),
  drawReserve: (storeId: string, chargebackLineId: string) =>
    apiFetch<any>('/api/v1/oem/warranty/reserve/draws', { method: 'POST', body: JSON.stringify({ storeId, chargebackLineId }) }),
  getReserveRollforward: (storeId: string) => apiFetch<any>(`/api/v1/oem/warranty/reserve/rollforward?storeId=${encodeURIComponent(storeId)}`),

  // S106 — Co-op advertising claims.
  listCoopPrograms: () => apiFetch<any[]>('/api/v1/oem/coop/programs'),
  registerCoopProgram: (data: Record<string, unknown>) =>
    apiFetch<any>('/api/v1/oem/coop/programs', { method: 'POST', body: JSON.stringify(data) }),
  createCoopClaim: (storeId: string, programId: string) =>
    apiFetch<any>('/api/v1/oem/coop/claims', { method: 'POST', body: JSON.stringify({ storeId, programId }) }),
  listCoopClaims: (storeId?: string) => apiFetch<any[]>(`/api/v1/oem/coop/claims${storeId ? `?storeId=${encodeURIComponent(storeId)}` : ''}`),
  getCoopClaim: (id: string) => apiFetch<any>(`/api/v1/oem/coop/claims/${id}`),
  addCoopClaimLine: (claimId: string, data: { spendItemRef: string; description: string; amount: string; evidenceRef: string }) =>
    apiFetch<any>(`/api/v1/oem/coop/claims/${claimId}/lines`, { method: 'POST', body: JSON.stringify(data) }),
  exportCoopClaim: (claimId: string) => apiFetch<any>(`/api/v1/oem/coop/claims/${claimId}/export`, { method: 'POST' }),
  recordCoopResponse: (lineId: string, responseStatus: string, approvedAmount?: string) =>
    apiFetch<any>(`/api/v1/oem/coop/lines/${lineId}/response`, { method: 'POST', body: JSON.stringify({ responseStatus, approvedAmount }) }),
  writeOffCoopLine: (lineId: string) => apiFetch<any>(`/api/v1/oem/coop/lines/${lineId}/write-off`, { method: 'POST' }),
  previewCoopAccrual: (storeId: string, programId: string, period: string, periodQualifyingSalesAmount: string) =>
    apiFetch<any>('/api/v1/oem/coop/accrual/preview', { method: 'POST', body: JSON.stringify({ storeId, programId, period, periodQualifyingSalesAmount }) }),
  approveCoopAccrual: (id: string) => apiFetch<any>(`/api/v1/oem/coop/accrual/previews/${id}/approve`, { method: 'POST' }),
};

// ─── close-service (CE-15 Close & Statutory) ────────────────────────────
export const closeApi = {
  // State
  getState: (legalEntityId: string, periodYear: number, periodMonth: number) =>
    apiFetch<any>(`/api/v1/close/state?legalEntityId=${legalEntityId}&periodYear=${periodYear}&periodMonth=${periodMonth}`),
  transition: (data: any) => apiFetch<any>('/api/v1/close/transition', { method: 'POST', body: JSON.stringify(data) }),
  getReadiness: (legalEntityId: string, periodYear: number, periodMonth: number) =>
    apiFetch<any>(`/api/v1/close/readiness?legalEntityId=${legalEntityId}&periodYear=${periodYear}&periodMonth=${periodMonth}`),
  // Reconciliation
  listRegister: (params?: string) => apiFetch<any[]>(`/api/v1/close/register${params ? `?${params}` : ''}`),
  createRegister: (data: any) => apiFetch<any>('/api/v1/close/register', { method: 'POST', body: JSON.stringify(data) }),
  signOffRegister: (id: string, data: any) => apiFetch<any>(`/api/v1/close/register/${id}/sign-off`, { method: 'POST', body: JSON.stringify(data) }),
  exportPbc: (data: any) => apiFetch<any>('/api/v1/close/pbc-export', { method: 'POST', body: JSON.stringify(data) }),
  // Scrub
  runScrub: (data: any) => apiFetch<any>('/api/v1/close/runs', { method: 'POST', body: JSON.stringify(data) }),
  listScrubRuns: () => apiFetch<any[]>('/api/v1/close/runs'),
  getScrubFindings: (id: string) => apiFetch<any[]>(`/api/v1/close/runs/${id}/findings`),
  disposeFinding: (id: string, data: any) => apiFetch<any>(`/api/v1/close/findings/${id}/dispose`, { method: 'POST', body: JSON.stringify(data) }),
  // Year-end
  previewYearEnd: (data: any) => apiFetch<any>('/api/v1/close/year-end/preview', { method: 'POST', body: JSON.stringify(data) }),
  approveYearEnd: (id: string, data: any) => apiFetch<any>(`/api/v1/close/year-end/${id}/approve`, { method: 'POST', body: JSON.stringify(data) }),
  postYearEnd: (id: string, data: any) => apiFetch<any>(`/api/v1/close/year-end/${id}/post`, { method: 'POST', body: JSON.stringify(data) }),
  // KPI
  listFormulas: () => apiFetch<any[]>('/api/v1/close/kpi/formulas'),
  createFormula: (data: any) => apiFetch<any>('/api/v1/close/kpi/formulas', { method: 'POST', body: JSON.stringify(data) }),
  computeKpi: (data: any) => apiFetch<any>('/api/v1/close/kpi/compute', { method: 'POST', body: JSON.stringify(data) }),
  // Snapshots
  captureSnapshot: (data: any) => apiFetch<any>('/api/v1/close/snapshots', { method: 'POST', body: JSON.stringify(data) }),
  primarySign: (id: string, data: any) => apiFetch<any>(`/api/v1/close/snapshots/${id}/primary-sign`, { method: 'POST', body: JSON.stringify(data) }),
  secondarySign: (id: string, data: any) => apiFetch<any>(`/api/v1/close/snapshots/${id}/secondary-sign`, { method: 'POST', body: JSON.stringify(data) }),
  verifySnapshot: (id: string, data: any) => apiFetch<any>(`/api/v1/close/snapshots/${id}/verify`, { method: 'POST', body: JSON.stringify(data) }),
  // Archive
  createArchiveObject: (data: any) => apiFetch<any>('/api/v1/close/archive', { method: 'POST', body: JSON.stringify(data) }),
  listArchiveObjects: () => apiFetch<any[]>('/api/v1/close/archive'),
  getArchiveObject: (id: string) => apiFetch<any>(`/api/v1/close/archive/${id}`),
  deleteArchiveObject: (id: string) => apiFetch<any>(`/api/v1/close/archive/${id}`, { method: 'DELETE' }),
  createRetentionSchedule: (data: any) => apiFetch<any>('/api/v1/close/archive/retention-schedules', { method: 'POST', body: JSON.stringify(data) }),
  // Currency
  getCurrencyConfig: (legalEntityId: string) => apiFetch<any>(`/api/v1/close/currency/config/${legalEntityId}`),
  setCurrencyConfig: (data: any) => apiFetch<any>('/api/v1/close/currency/config', { method: 'POST', body: JSON.stringify(data) }),
  addRate: (data: any) => apiFetch<any>('/api/v1/close/currency/rates', { method: 'POST', body: JSON.stringify(data) }),
  listRates: (params?: string) => apiFetch<any[]>(`/api/v1/close/currency/rates${params ? `?${params}` : ''}`),
  previewTranslation: (data: any) => apiFetch<any>('/api/v1/close/currency/translation-preview', { method: 'POST', body: JSON.stringify(data) }),
  approveTranslation: (id: string, data: any) => apiFetch<any>(`/api/v1/close/currency/translation/${id}/approve`, { method: 'POST', body: JSON.stringify(data) }),
  postTranslation: (id: string, data: any) => apiFetch<any>(`/api/v1/close/currency/translation/${id}/post`, { method: 'POST', body: JSON.stringify(data) }),
  // DOC
  getDoc: (legalEntityId: string, asOfDate: string) => apiFetch<any>(`/api/v1/close/doc?legalEntityId=${legalEntityId}&asOfDate=${asOfDate}`),
  // Compliance
  generateCompliancePack: (data: any) => apiFetch<any>('/api/v1/close/compliance/generate', { method: 'POST', body: JSON.stringify(data) }),
  listCompliancePacks: () => apiFetch<any[]>('/api/v1/close/compliance'),
  // Tax pack
  generateTaxPack: (data: any) => apiFetch<any>('/api/v1/close/tax-pack/generate', { method: 'POST', body: JSON.stringify(data) }),
};

// ── CE-16 Accounting Migration (S129, S130, S131, S132) ──────────────────────

const MIGRATION_BASE = '/api/v1/migration';
const qs = (params: Record<string, unknown>) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
};

export const migrationApi = {
  // Runs
  listRuns: (params: { legalEntityId?: string; state?: string; mode?: string } = {}) =>
    apiFetch<{ items: any[]; total: number }>(`${MIGRATION_BASE}/runs${qs(params)}`),
  createRun: (data: any) => apiFetch<any>(`${MIGRATION_BASE}/runs`, { method: 'POST', body: JSON.stringify(data) }),
  getRun: (runId: string) => apiFetch<any>(`${MIGRATION_BASE}/runs/${runId}`),
  transitionRun: (runId: string, data: any) =>
    apiFetch<any>(`${MIGRATION_BASE}/runs/${runId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getRunAudit: (runId: string) => apiFetch<{ items: any[]; total: number }>(`${MIGRATION_BASE}/runs/${runId}/audit`),
  getReadiness: (runId: string) => apiFetch<any>(`${MIGRATION_BASE}/runs/${runId}/readiness`),
  attestFreeze: (runId: string, data: any) =>
    apiFetch<any>(`${MIGRATION_BASE}/runs/${runId}/freeze`, { method: 'POST', body: JSON.stringify(data) }),
  markDeltaComplete: (runId: string, data: any) =>
    apiFetch<any>(`${MIGRATION_BASE}/runs/${runId}/delta-complete`, { method: 'POST', body: JSON.stringify(data) }),

  // Sources and extracts
  listSources: () => apiFetch<{
    items: any[]; total: number; configured: boolean;
    upstreamSignals: { moduleCode: string; status: string; detail: string }[];
  }>(`${MIGRATION_BASE}/sources`),
  registerSource: (data: any) => apiFetch<any>(`${MIGRATION_BASE}/sources`, { method: 'POST', body: JSON.stringify(data) }),
  listSnapshots: (sourceId: string) =>
    apiFetch<{ items: any[]; total: number }>(`${MIGRATION_BASE}/sources/${sourceId}/snapshots`),
  registerSnapshot: (sourceId: string, data: any) =>
    apiFetch<any>(`${MIGRATION_BASE}/sources/${sourceId}/snapshots`, { method: 'POST', body: JSON.stringify(data) }),
  listSnapshotFiles: (sourceId: string, snapshotId: string) =>
    apiFetch<{ items: any[]; total: number }>(`${MIGRATION_BASE}/sources/${sourceId}/snapshots/${snapshotId}/files`),
  importFile: (sourceId: string, snapshotId: string, data: any) =>
    apiFetch<any>(`${MIGRATION_BASE}/sources/${sourceId}/snapshots/${snapshotId}/files`, { method: 'POST', body: JSON.stringify(data) }),
  listSnapshotRows: (sourceId: string, snapshotId: string, params: { limit?: number; offset?: number; sourceFileId?: string } = {}) =>
    apiFetch<{ items: any[]; total: number }>(`${MIGRATION_BASE}/sources/${sourceId}/snapshots/${snapshotId}/rows${qs(params)}`),

  // Mapping workbench
  listMappingSets: (params: { legalEntityId?: string; sourceSystemId?: string } = {}) =>
    apiFetch<{ items: any[]; total: number }>(`${MIGRATION_BASE}/mapping-sets${qs(params)}`),
  createMappingSet: (data: any) => apiFetch<any>(`${MIGRATION_BASE}/mapping-sets`, { method: 'POST', body: JSON.stringify(data) }),
  getMappingSet: (id: string) => apiFetch<any>(`${MIGRATION_BASE}/mapping-sets/${id}`),
  listMappingEntries: (id: string) =>
    apiFetch<{ items: any[]; coverage: any }>(`${MIGRATION_BASE}/mapping-sets/${id}/entries`),
  seedMappingSet: (id: string, data: any) =>
    apiFetch<any>(`${MIGRATION_BASE}/mapping-sets/${id}/seed`, { method: 'POST', body: JSON.stringify(data) }),
  updateMappingEntry: (id: string, entryId: string, data: any) =>
    apiFetch<any>(`${MIGRATION_BASE}/mapping-sets/${id}/entries/${entryId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  approveMappingEntry: (id: string, entryId: string, data: any = {}) =>
    apiFetch<any>(`${MIGRATION_BASE}/mapping-sets/${id}/entries/${entryId}/approve`, { method: 'POST', body: JSON.stringify(data) }),
  freezeMappingSet: (id: string, data: any = {}) =>
    apiFetch<any>(`${MIGRATION_BASE}/mapping-sets/${id}/freeze`, { method: 'POST', body: JSON.stringify(data) }),

  // Staging, preview, validation
  preview: (runId: string, params: { snapshotId: string; mappingSetId: string; limit?: number }) =>
    apiFetch<any>(`${MIGRATION_BASE}/runs/${runId}/preview${qs(params)}`),
  stage: (runId: string, data: any) =>
    apiFetch<any>(`${MIGRATION_BASE}/runs/${runId}/stage`, { method: 'POST', body: JSON.stringify(data) }),
  validate: (runId: string, data: any = {}) =>
    apiFetch<any>(`${MIGRATION_BASE}/runs/${runId}/validate`, { method: 'POST', body: JSON.stringify(data) }),
  listDatasets: (runId: string) => apiFetch<{ items: any[]; total: number }>(`${MIGRATION_BASE}/runs/${runId}/datasets`),
  listStagingRows: (runId: string, datasetId: string, params: { limit?: number; offset?: number } = {}) =>
    apiFetch<{ items: any[]; total: number }>(`${MIGRATION_BASE}/runs/${runId}/datasets/${datasetId}/rows${qs(params)}`),
  listGates: (runId: string) => apiFetch<{ items: any[]; total: number }>(`${MIGRATION_BASE}/runs/${runId}/gates`),
  listControlTotals: (runId: string) => apiFetch<{ items: any[]; total: number }>(`${MIGRATION_BASE}/runs/${runId}/control-totals`),

  // Exceptions
  listExceptions: (runId: string, params: { disposition?: string; exceptionType?: string } = {}) =>
    apiFetch<any>(`${MIGRATION_BASE}/runs/${runId}/exceptions${qs(params)}`),
  dispositionException: (runId: string, exceptionId: string, data: any) =>
    apiFetch<any>(`${MIGRATION_BASE}/runs/${runId}/exceptions/${exceptionId}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Promotion, lineage
  promote: (runId: string, data: any = {}) =>
    apiFetch<any>(`${MIGRATION_BASE}/runs/${runId}/promote`, { method: 'POST', body: JSON.stringify(data) }),
  listLineage: (runId: string, params: { sourceRowRef?: string; journalRef?: string } = {}) =>
    apiFetch<{ items: any[]; total: number }>(`${MIGRATION_BASE}/runs/${runId}/lineage${qs(params)}`),

  // Parallel-run comparison
  listComparisons: (runId: string) => apiFetch<{ items: any[]; total: number }>(`${MIGRATION_BASE}/runs/${runId}/comparison`),
  createComparison: (runId: string, data: any) =>
    apiFetch<any>(`${MIGRATION_BASE}/runs/${runId}/comparison`, { method: 'POST', body: JSON.stringify(data) }),
  getComparison: (runId: string, comparisonRunId: string) =>
    apiFetch<any>(`${MIGRATION_BASE}/runs/${runId}/comparison/${comparisonRunId}`),
  classifyDiff: (runId: string, diffId: string, data: any) =>
    apiFetch<any>(`${MIGRATION_BASE}/runs/${runId}/comparison/diffs/${diffId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  signOffComparison: (runId: string, data: any) =>
    apiFetch<any>(`${MIGRATION_BASE}/runs/${runId}/comparison/sign-off`, { method: 'POST', body: JSON.stringify(data) }),

  // Cutover ceremony, rollback, restart
  getCeremony: (runId: string) => apiFetch<any>(`${MIGRATION_BASE}/runs/${runId}/cutover-ceremony`),
  prepareCutover: (runId: string, data: any) =>
    apiFetch<any>(`${MIGRATION_BASE}/runs/${runId}/cutover/prepare`, { method: 'POST', body: JSON.stringify(data) }),
  approveCutover: (runId: string, data: any) =>
    apiFetch<any>(`${MIGRATION_BASE}/runs/${runId}/cutover/approve`, { method: 'POST', body: JSON.stringify(data) }),
  executeCutover: (runId: string, data: any = {}) =>
    apiFetch<any>(`${MIGRATION_BASE}/runs/${runId}/cutover`, { method: 'POST', body: JSON.stringify(data) }),
  rollback: (runId: string, data: any) =>
    apiFetch<any>(`${MIGRATION_BASE}/runs/${runId}/rollback`, { method: 'POST', body: JSON.stringify(data) }),
  getRestartPlan: (runId: string) => apiFetch<any>(`${MIGRATION_BASE}/runs/${runId}/restart-plan`),

  // Statement archive (S132a)
  listArchive: (params: { legalEntityId?: string; periodYear?: number; periodMonth?: number; statementType?: string; search?: string } = {}) =>
    apiFetch<{ items: any[]; total: number }>(`${MIGRATION_BASE}/archive${qs(params)}`),
  importArchive: (data: any) => apiFetch<any>(`${MIGRATION_BASE}/archive`, { method: 'POST', body: JSON.stringify(data) }),
  recordArchiveAccess: (id: string) => apiFetch<any>(`${MIGRATION_BASE}/archive/${id}/access`, { method: 'POST', body: '{}' }),

  // Runbooks (S132b)
  listRunbookTemplates: () => apiFetch<{ items: any[]; total: number }>(`${MIGRATION_BASE}/runbooks/templates`),
  createRunbookTemplate: (data: any) =>
    apiFetch<any>(`${MIGRATION_BASE}/runbooks/templates`, { method: 'POST', body: JSON.stringify(data) }),
  listRunbooks: (params: { runId?: string } = {}) =>
    apiFetch<{ items: any[]; total: number }>(`${MIGRATION_BASE}/runbooks${qs(params)}`),
  createRunbook: (data: any) => apiFetch<any>(`${MIGRATION_BASE}/runbooks`, { method: 'POST', body: JSON.stringify(data) }),
  getRunbook: (id: string) => apiFetch<any>(`${MIGRATION_BASE}/runbooks/${id}`),
  updateRunbookStep: (id: string, stepCode: string, data: any) =>
    apiFetch<any>(`${MIGRATION_BASE}/runbooks/${id}/steps/${stepCode}`, { method: 'PATCH', body: JSON.stringify(data) }),
};

// ── CE-17 Accounting Automation ──────────────────────────────────────────────
// S022, S040, S058, S073, S091B, S095, S096, S101B, S103B, S107, S118, S126,
// S127, S128. Every capability answers at OBSERVE_ONLY until a two-person
// ceremony says otherwise, so these calls report authority rather than assume
// it.

const AUTOMATION_BASE = '/api/v1/automation';

export const automationApi = {
  // Command centre
  getOverview: (params: { legalEntityId?: string } = {}) =>
    apiFetch<any>(`${AUTOMATION_BASE}/overview${qs(params)}`),
  emergencyStop: (data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/emergency-stop`, { method: 'POST', body: JSON.stringify(data) }),

  // Capabilities and the authority ladder
  listCapabilities: (params: { legalEntityId?: string } = {}) =>
    apiFetch<{ items: any[]; total: number }>(`${AUTOMATION_BASE}/capabilities${qs(params)}`),
  getCapability: (id: string) => apiFetch<any>(`${AUTOMATION_BASE}/capabilities/${id}`),
  configureCapability: (data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/capabilities`, { method: 'POST', body: JSON.stringify(data) }),
  grantAuthority: (id: string, data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/capabilities/${id}/grants`, { method: 'POST', body: JSON.stringify(data) }),
  activateAuthority: (id: string, data: any = {}) =>
    apiFetch<any>(`${AUTOMATION_BASE}/capabilities/${id}/activate`, { method: 'POST', body: JSON.stringify(data) }),
  suspendCapability: (id: string, data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/capabilities/${id}/suspend`, { method: 'POST', body: JSON.stringify(data) }),

  // Policy gates
  listPolicies: (params: { legalEntityId?: string; capabilityCode?: string } = {}) =>
    apiFetch<{ items: any[]; total: number }>(`${AUTOMATION_BASE}/policies${qs(params)}`),
  getEffectivePolicy: (params: { legalEntityId?: string; capabilityCode?: string }) =>
    apiFetch<any>(`${AUTOMATION_BASE}/policies/effective${qs(params)}`),
  savePolicy: (data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/policies`, { method: 'POST', body: JSON.stringify(data) }),
  activatePolicy: (id: string, data: any = {}) =>
    apiFetch<any>(`${AUTOMATION_BASE}/policies/${id}/activate`, { method: 'POST', body: JSON.stringify(data) }),

  // Automation queue
  listItems: (params: { legalEntityId?: string; capabilityCode?: string; state?: string; limit?: number; offset?: number } = {}) =>
    apiFetch<{ items: any[]; total: number }>(`${AUTOMATION_BASE}/items${qs(params)}`),
  getItem: (id: string) => apiFetch<any>(`${AUTOMATION_BASE}/items/${id}`),
  getItemLineage: (id: string) => apiFetch<any>(`${AUTOMATION_BASE}/items/${id}/lineage`),
  evaluateItem: (id: string, data: any = {}) =>
    apiFetch<any>(`${AUTOMATION_BASE}/items/${id}/evaluate`, { method: 'POST', body: JSON.stringify(data) }),
  claimItem: (id: string, data: any = {}) =>
    apiFetch<any>(`${AUTOMATION_BASE}/items/${id}/claim`, { method: 'POST', body: JSON.stringify(data) }),
  approveItem: (id: string, data: any = {}) =>
    apiFetch<any>(`${AUTOMATION_BASE}/items/${id}/approve`, { method: 'POST', body: JSON.stringify(data) }),
  rejectItem: (id: string, data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/items/${id}/reject`, { method: 'POST', body: JSON.stringify(data) }),
  executeItem: (id: string, data: any = {}) =>
    apiFetch<any>(`${AUTOMATION_BASE}/items/${id}/execute`, { method: 'POST', body: JSON.stringify(data) }),
  retryItem: (id: string, data: any = {}) =>
    apiFetch<any>(`${AUTOMATION_BASE}/items/${id}/retry`, { method: 'POST', body: JSON.stringify(data) }),
  reverseItem: (id: string, data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/items/${id}/reverse`, { method: 'POST', body: JSON.stringify(data) }),

  // Health, rule and model versions
  getHealthMetrics: (params: { legalEntityId?: string; capabilityCode?: string; days?: number } = {}) =>
    apiFetch<{ items: any[]; total: number }>(`${AUTOMATION_BASE}/health-metrics${qs(params)}`),
  listVersions: (params: { capabilityCode?: string } = {}) =>
    apiFetch<{ items: any[]; total: number }>(`${AUTOMATION_BASE}/versions${qs(params)}`),
  getVersion: (id: string) => apiFetch<any>(`${AUTOMATION_BASE}/versions/${id}`),
  recordVersion: (data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/versions`, { method: 'POST', body: JSON.stringify(data) }),

  // S022 — rule simulation sandbox (never posts, never mutates)
  listSandboxes: (params: { legalEntityId?: string; state?: string } = {}) =>
    apiFetch<{ items: any[]; total: number }>(`${AUTOMATION_BASE}/sandbox${qs(params)}`),
  getSandbox: (id: string) => apiFetch<any>(`${AUTOMATION_BASE}/sandbox/${id}`),
  getSandboxDiff: (id: string) => apiFetch<any>(`${AUTOMATION_BASE}/sandbox/${id}/diff`),
  runSandbox: (data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/sandbox/run`, { method: 'POST', body: JSON.stringify(data) }),

  // S040 — OCR/EDI invoice ingestion
  listIngestionDrafts: (params: { legalEntityId?: string; state?: string; channel?: string } = {}) =>
    apiFetch<{ items: any[]; total: number }>(`${AUTOMATION_BASE}/ingestion/drafts${qs(params)}`),
  getIngestionDraft: (id: string) => apiFetch<any>(`${AUTOMATION_BASE}/ingestion/drafts/${id}`),
  createIngestionDraft: (data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/ingestion/drafts`, { method: 'POST', body: JSON.stringify(data) }),
  acceptIngestionDraft: (id: string, data: any = {}) =>
    apiFetch<any>(`${AUTOMATION_BASE}/ingestion/drafts/${id}/accept`, { method: 'POST', body: JSON.stringify(data) }),
  rejectIngestionDraft: (id: string, data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/ingestion/drafts/${id}/reject`, { method: 'POST', body: JSON.stringify(data) }),

  // S058 — lockbox remittance matching
  listLockboxFiles: (params: { legalEntityId?: string; state?: string } = {}) =>
    apiFetch<{ items: any[]; total: number }>(`${AUTOMATION_BASE}/lockbox/files${qs(params)}`),
  listLockboxLines: (fileId: string, params: { state?: string; matchType?: string } = {}) =>
    apiFetch<{ items: any[]; total: number; summary?: any }>(`${AUTOMATION_BASE}/lockbox/files/${fileId}/lines${qs(params)}`),
  ingestLockboxFile: (data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/lockbox/files`, { method: 'POST', body: JSON.stringify(data) }),
  reviewLockboxLine: (id: string, data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/lockbox/lines/${id}/review`, { method: 'POST', body: JSON.stringify(data) }),

  // S073 — LIFO overlay
  listLifoPools: (params: { legalEntityId?: string } = {}) =>
    apiFetch<{ items: any[]; total: number }>(`${AUTOMATION_BASE}/lifo/pools${qs(params)}`),
  createLifoPool: (data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/lifo/pools`, { method: 'POST', body: JSON.stringify(data) }),
  computeLifoLayer: (poolId: string, data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/lifo/pools/${poolId}/compute`, { method: 'POST', body: JSON.stringify(data) }),
  approveLifoLayer: (id: string, data: any = {}) =>
    apiFetch<any>(`${AUTOMATION_BASE}/lifo/layers/${id}/approve`, { method: 'POST', body: JSON.stringify(data) }),

  // S091B — experience-rated chargeback model (RECOMMEND ceiling)
  listChargebackModels: (params: { legalEntityId?: string; state?: string } = {}) =>
    apiFetch<{ items: any[]; total: number }>(`${AUTOMATION_BASE}/chargeback/models${qs(params)}`),
  getChargebackModel: (id: string) => apiFetch<any>(`${AUTOMATION_BASE}/chargeback/models/${id}`),
  runChargebackModel: (data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/chargeback/models`, { method: 'POST', body: JSON.stringify(data) }),
  adoptChargebackModel: (id: string, data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/chargeback/models/${id}/adopt`, { method: 'POST', body: JSON.stringify(data) }),

  // S095 — retro / portfolio reserve accrual
  listPortfolioStatements: (params: { legalEntityId?: string; state?: string } = {}) =>
    apiFetch<{ items: any[]; total: number }>(`${AUTOMATION_BASE}/portfolio/statements${qs(params)}`),
  getPortfolioStatement: (id: string) => apiFetch<any>(`${AUTOMATION_BASE}/portfolio/statements/${id}`),
  enterPortfolioStatement: (data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/portfolio/statements`, { method: 'POST', body: JSON.stringify(data) }),
  allocatePortfolioStatement: (id: string, data: any = {}) =>
    apiFetch<any>(`${AUTOMATION_BASE}/portfolio/statements/${id}/allocate`, { method: 'POST', body: JSON.stringify(data) }),
  approvePortfolioStatement: (id: string, data: any = {}) =>
    apiFetch<any>(`${AUTOMATION_BASE}/portfolio/statements/${id}/approve`, { method: 'POST', body: JSON.stringify(data) }),

  // S096 — reinsurance / DOWC cession
  listCessionStatements: (params: { legalEntityId?: string; state?: string } = {}) =>
    apiFetch<{ items: any[]; total: number }>(`${AUTOMATION_BASE}/cession/statements${qs(params)}`),
  getCessionStatement: (id: string) => apiFetch<any>(`${AUTOMATION_BASE}/cession/statements/${id}`),
  getCessionPosition: (params: { legalEntityId?: string; treatyCode?: string } = {}) =>
    apiFetch<any>(`${AUTOMATION_BASE}/cession/position${qs(params)}`),
  enterCessionStatement: (data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/cession/statements`, { method: 'POST', body: JSON.stringify(data) }),
  approveCessionStatement: (id: string, data: any = {}) =>
    apiFetch<any>(`${AUTOMATION_BASE}/cession/statements/${id}/approve`, { method: 'POST', body: JSON.stringify(data) }),

  // S101B — OEM statement auto-matcher
  listOemSuggestions: (params: { legalEntityId?: string; state?: string; sessionId?: string } = {}) =>
    apiFetch<{ items: any[]; total: number; summary?: any }>(`${AUTOMATION_BASE}/oem/suggestions${qs(params)}`),
  generateOemSuggestions: (data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/oem/suggestions`, { method: 'POST', body: JSON.stringify(data) }),
  disposeOemSuggestion: (id: string, data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/oem/suggestions/${id}/dispose`, { method: 'POST', body: JSON.stringify(data) }),

  // S103B — probability-weighted incentive accruals
  listIncentiveRecommendations: (params: { legalEntityId?: string; periodYear?: number; periodMonth?: number } = {}) =>
    apiFetch<{ items: any[]; total: number }>(`${AUTOMATION_BASE}/incentives/recommendations${qs(params)}`),
  getIncentiveRecommendation: (id: string) => apiFetch<any>(`${AUTOMATION_BASE}/incentives/recommendations/${id}`),
  computeIncentiveRecommendation: (data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/incentives/recommendations`, { method: 'POST', body: JSON.stringify(data) }),
  approveIncentiveRecommendation: (id: string, data: any = {}) =>
    apiFetch<any>(`${AUTOMATION_BASE}/incentives/recommendations/${id}/approve`, { method: 'POST', body: JSON.stringify(data) }),
  rejectIncentiveRecommendation: (id: string, data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/incentives/recommendations/${id}/reject`, { method: 'POST', body: JSON.stringify(data) }),

  // S107 — NCM / NADA composite export
  listExports: (params: { legalEntityId?: string; exportType?: string; state?: string } = {}) =>
    apiFetch<{ items: any[]; total: number }>(`${AUTOMATION_BASE}/exports${qs(params)}`),
  getExport: (id: string) => apiFetch<any>(`${AUTOMATION_BASE}/exports/${id}`),
  getExportBaselineStatus: (params: { legalEntityId?: string } = {}) =>
    apiFetch<any>(`${AUTOMATION_BASE}/exports/baseline-status${qs(params)}`),
  generateExport: (data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/exports`, { method: 'POST', body: JSON.stringify(data) }),
  approveExport: (id: string, data: any = {}) =>
    apiFetch<any>(`${AUTOMATION_BASE}/exports/${id}/approve`, { method: 'POST', body: JSON.stringify(data) }),
  recordExportResponse: (id: string, data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/exports/${id}/response`, { method: 'POST', body: JSON.stringify(data) }),

  // S118 — GAAP bridge memo generator (PREPARE_DRAFT ceiling)
  listMemos: (params: { legalEntityId?: string; state?: string; periodYear?: number; periodMonth?: number } = {}) =>
    apiFetch<{ items: any[]; total: number }>(`${AUTOMATION_BASE}/memos${qs(params)}`),
  getMemo: (id: string) => apiFetch<any>(`${AUTOMATION_BASE}/memos/${id}`),
  draftMemo: (data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/memos`, { method: 'POST', body: JSON.stringify(data) }),
  editMemo: (id: string, data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/memos/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  finalizeMemo: (id: string, data: any = {}) =>
    apiFetch<any>(`${AUTOMATION_BASE}/memos/${id}/finalize`, { method: 'POST', body: JSON.stringify(data) }),

  // S126 — DSAR automation (irreversible; dual authorization)
  listDsarCases: (params: { state?: string; requestType?: string } = {}) =>
    apiFetch<{ items: any[]; total: number }>(`${AUTOMATION_BASE}/dsar/cases${qs(params)}`),
  getDsarCase: (id: string) => apiFetch<any>(`${AUTOMATION_BASE}/dsar/cases/${id}`),
  createDsarCase: (data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/dsar/cases`, { method: 'POST', body: JSON.stringify(data) }),
  scanDsarCase: (id: string, data: any = {}) =>
    apiFetch<any>(`${AUTOMATION_BASE}/dsar/cases/${id}/scan`, { method: 'POST', body: JSON.stringify(data) }),
  produceDsarDisclosure: (id: string, data: any = {}) =>
    apiFetch<any>(`${AUTOMATION_BASE}/dsar/cases/${id}/disclosure`, { method: 'POST', body: JSON.stringify(data) }),
  authorizeDsarErasure: (id: string, data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/dsar/cases/${id}/authorize-erasure`, { method: 'POST', body: JSON.stringify(data) }),
  executeDsarErasure: (id: string, data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/dsar/cases/${id}/erase`, { method: 'POST', body: JSON.stringify(data) }),
  closeDsarCase: (id: string, data: any = {}) =>
    apiFetch<any>(`${AUTOMATION_BASE}/dsar/cases/${id}/close`, { method: 'POST', body: JSON.stringify(data) }),

  // S127 — unclaimed property
  listUnclaimedProperty: (params: { legalEntityId?: string; state?: string; jurisdiction?: string } = {}) =>
    apiFetch<{ items: any[]; total: number; summary?: any }>(`${AUTOMATION_BASE}/unclaimed-property${qs(params)}`),
  getUnclaimedPropertyItem: (id: string) => apiFetch<any>(`${AUTOMATION_BASE}/unclaimed-property/${id}`),
  identifyUnclaimedProperty: (data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/unclaimed-property/identify`, { method: 'POST', body: JSON.stringify(data) }),
  recordDueDiligence: (id: string, data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/unclaimed-property/${id}/due-diligence`, { method: 'POST', body: JSON.stringify(data) }),
  prepareRemittance: (id: string, data: any = {}) =>
    apiFetch<any>(`${AUTOMATION_BASE}/unclaimed-property/${id}/remittance`, { method: 'POST', body: JSON.stringify(data) }),

  // S128 — SOX evidence automation
  listControls: (params: { legalEntityId?: string; controlType?: string } = {}) =>
    apiFetch<{ items: any[]; total: number }>(`${AUTOMATION_BASE}/sox/controls${qs(params)}`),
  registerControl: (data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/sox/controls`, { method: 'POST', body: JSON.stringify(data) }),
  listBinders: (params: { legalEntityId?: string; state?: string; periodYear?: number; periodMonth?: number } = {}) =>
    apiFetch<{ items: any[]; total: number }>(`${AUTOMATION_BASE}/sox/binders${qs(params)}`),
  getBinder: (id: string) => apiFetch<any>(`${AUTOMATION_BASE}/sox/binders/${id}`),
  harvestBinder: (data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/sox/binders`, { method: 'POST', body: JSON.stringify(data) }),
  attestBinder: (id: string, data: any) =>
    apiFetch<any>(`${AUTOMATION_BASE}/sox/binders/${id}/attest`, { method: 'POST', body: JSON.stringify(data) }),
};
