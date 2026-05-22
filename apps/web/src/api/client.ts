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
  hold: (id: string, reason: string) => apiFetch<any>(`/api/v1/payroll/batches/${id}/hold`, { method: 'POST', body: JSON.stringify({ reason }) }),
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
  // Commission Tracking (Phase 1)
  listCommissionPlans: () => apiFetch<any[]>('/api/v1/payroll/commission-plans'),
  createCommissionPlan: (data: any) => apiFetch<any>('/api/v1/payroll/commission-plans', { method: 'POST', body: JSON.stringify(data) }),
  calculateCommission: (data: any) => apiFetch<any>('/api/v1/payroll/commissions/calculate', { method: 'POST', body: JSON.stringify(data) }),
  listCommissions: (params?: string) => apiFetch<any[]>(`/api/v1/payroll/commissions${params ? `?${params}` : ''}`),
  getCommissionReport: (params?: string) => apiFetch<any>(`/api/v1/payroll/commissions/report${params ? `?${params}` : ''}`),
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
  // Vendor maintenance (S3-07)
  getVendors: (params?: string) => apiFetch<any[]>(`/api/v1/apar/vendors${params ? `?${params}` : ''}`),
  getVendor: (id: string) => apiFetch<any>(`/api/v1/apar/vendors/${id}`),
  createVendor: (data: any) => apiFetch<any>('/api/v1/apar/vendors', { method: 'POST', body: JSON.stringify(data) }),
  updateVendor: (id: string, data: any) => apiFetch<any>(`/api/v1/apar/vendors/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deactivateVendor: (id: string) => apiFetch<any>(`/api/v1/apar/vendors/${id}`, { method: 'PATCH', body: JSON.stringify({ isActive: false }) }),
  // AP Payments (S3-08/09)
  getPayments: (params?: string) => apiFetch<any[]>(`/api/v1/apar/ap-payments${params ? `?${params}` : ''}`),
  voidPayment: (id: string, data: any) => apiFetch<any>(`/api/v1/apar/ap-payments/${id}/void`, { method: 'POST', body: JSON.stringify(data) }),
  // Customer Master (S5-01)
  getCustomers: (params?: string) => apiFetch<any[]>(`/api/v1/apar/customers${params ? `?${params}` : ''}`),
  getCustomer: (id: string) => apiFetch<any>(`/api/v1/apar/customers/${id}`),
  createCustomer: (data: any) => apiFetch<any>('/api/v1/apar/customers', { method: 'POST', body: JSON.stringify(data) }),
  updateCustomer: (id: string, data: any) => apiFetch<any>(`/api/v1/apar/customers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deactivateCustomer: (id: string) => apiFetch<any>(`/api/v1/apar/customers/${id}/deactivate`, { method: 'PATCH' }),
  // S6-12: AP invoice queries for reports
  getInvoices: (params?: string) => apiFetch<any[]>(`/api/v1/apar/ap${params ? `?${params}` : ''}`),
  // S7-03: ACH / NACHA generation
  generateAch: (data: { bankAccountId: string; paymentIds: string[] }) => apiFetch<any>('/api/v1/ap/payments/generate-ach', { method: 'POST', body: JSON.stringify(data) }),
  // S7-06: Vendor duplicate tax ID check
  getVendorsByTaxId: (taxId: string) => apiFetch<any[]>(`/api/v1/apar/vendors?taxId=${encodeURIComponent(taxId)}`),
  // S7-07: Vendor 1099 YTD payments
  getVendorYtdPayments: (vendorId: string) => apiFetch<any>(`/api/v1/apar/vendors/${vendorId}/ytd-payments`),
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
  list: (params?: string) => apiFetch<any[]>(`/api/v1/cash-receipts${params ? `?${params}` : ''}`),
  create: (data: any) => apiFetch<any>('/api/v1/cash-receipts', { method: 'POST', body: JSON.stringify(data) }),
  void: (id: string, data: any) => apiFetch<any>(`/api/v1/cash-receipts/${id}/void`, { method: 'POST', body: JSON.stringify(data) }),
  getDeposits: (params?: string) => apiFetch<any[]>(`/api/v1/cash-receipts/deposits${params ? `?${params}` : ''}`),
  createDeposit: (data: any) => apiFetch<any>('/api/v1/cash-receipts/deposits', { method: 'POST', body: JSON.stringify(data) }),
  addReceiptsToDeposit: (depositId: string, receiptIds: string[]) => apiFetch<any>(`/api/v1/cash-receipts/deposits/${depositId}/receipts`, { method: 'POST', body: JSON.stringify({ receiptIds }) }),
  allocateDeposit: (depositId: string, glAccountId: string) => apiFetch<any>(`/api/v1/cash-receipts/deposits/${depositId}/allocate`, { method: 'POST', body: JSON.stringify({ glAccountId }) }),
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
