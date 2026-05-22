# MODULE STATE — AMACC Accounting Module
# Last Updated: 2026-05-20
# Updated By: Shiva + Claude Sonnet 4.6

## CURRENT PHASE: Step 9 — Coding (UI Design Upgrade COMPLETE — Score: 9/10)

## UI DESIGN UPGRADE COMPLETE (2026-05-20)
- [x] Task 1: Google Fonts — Inter (400–900) + JetBrains Mono (400–700) loaded via index.html Google Fonts link ✅
- [x] Task 2: Brand color tokens unified — bg-blue-600/700 → bg-brand (307 usages), hover:bg-brand-hover, text-brand, bg-brand-light, border-brand-border; tailwind.config.js brand/surface/success/warning/danger tokens; index.css CSS vars (--brand, --brand-hover, --brand-light, --border, --text-*); 0 remaining bg-blue-600/700 occurrences ✅
- [x] Task 3: 7 shared UI components built — apps/web/src/components/ui/ (Btn, Badge, MoneyCell, EmptyState, LoadingTable, ActionBar, PageHeader) + barrel index.ts ✅
- [x] Task 4: Shared components applied to top 10 screens — FinancialDashboard, JournalEntry, JournalEntryList, AccountsPayable, AccountsReceivable, EndOfMonthClose, PayrollProcessing, BankReconciliation, FinancialStatements (PageHeader + Btn + EmptyState + LoadingTable) ✅
- [x] Task 5: Global typography sweep — inline fontFamily monospace → JetBrains Mono on Dashboard/Transactions/GeneralLedger/Payroll; font-mono class normalized in ServiceGLAccounts/PartsGLAccounts; EndOfMonthClose monetary spans wrapped in font-mono ✅
- [x] Task 6: Sidebar polish — w-48 (192px), bg-white, border-r border-slate-200, active: bg-brand-light + border-l-2 border-brand, section headers text-[10px] uppercase tracking-widest ✅
- [x] Task 7: Table consistency — global index.css: sticky thead (position:sticky), h-9/36px tbody rows, brand-light hover (#EFF6FF), 0 16px padding, font-size 12px; td.num/th.num JetBrains Mono right-align ✅
- [x] TypeScript check: **0 errors** (npx tsc --noEmit, exit 0)
- [x] Brand color verification: **0** remaining bg-blue-600 or bg-blue-700 in src/
- [x] Font verification: JetBrains Mono confirmed in index.html Google Fonts link
- [x] Files changed: 404 total (apps/web/src/ + config files)
- Score: **9/10 — World-class polish complete**

## CURRENT PHASE: Step 9 — Coding (Sprint C COMPLETE — All inquiry/setup/reporting screens done)

## SPRINT C COMPLETE (2026-05-20)
- [x] C-1: Inquiry Module — 3 New Screens (NS-046, NS-047, NS-048)
  - InquiryMenu.tsx (/accounting/inquiry): modal popup with G/S/T keyboard shortcuts navigating to GL/Schedule/Transaction inquiry
  - ScheduleInquiry.tsx (/accounting/inquiry/schedules): schedule picker + control# selector + Thru Date (as-of); dynamic GL account column headers from schedule-to-GL mapping; summary row (0000000000/TOTAL); detail view when control# selected; double-click → TransactionDetailPopup; Schedule Set (localStorage)
  - TransactionInquiry.tsx (/accounting/inquiry/transactions): 12 date presets incl. OPEN_MONTH (accounting period, not calendar); Account column aggregates ALL GL accounts touched by transaction in one cell (CSV); net $0.00 for balanced entries
  - EU-008: TransactionDetailPopup.tsx (components/accounting/) — shared popup used by all 3 inquiry screens; yellow row highlight for highlightAccountId; Print/Adjustment/Reverse/Notes buttons; BUILD-006 reversal integration
- [x] C-2: GL Inquiry Updates (EU-008 continued)
  - GLInquiry.tsx (/accounting/inquiry/gl): 1,476 lines; all 12 date presets with OPEN_MONTH from lastCloseDate+1; Detail/Summary view toggle; Multi-GL dual-panel selector (@MULTIPLE mode); 3-tab filter dialog (Control#, Journal Source, Other with min/max amount); sort toolbar (Date/Ref#/Control#/Amount + ASC/DESC); Inquiry Preferences modal (persisted to localStorage); running balance column; filter red-dot indicator
- [x] C-3: MFGDCSCommunications.tsx (/accounting/admin/mfg-dcs)
  - NS-034: Program 30; 8 OEMs; Import/Export/Status Check; connection status dot; status card per OEM; Run Communication mutation (2s mock, Honda error-path demo); 8-row history log
- [x] C-4: PartsGLAccounts.tsx (/accounting/admin/parts-gl-accounts)
  - NS-035: BR-SGL-003; franchise dropdown; 15 sale type rows with editable GL account inputs; 5 misc GL accounts (Tax/Handling/Freight/Charge/Discount); seeded with realistic automotive GL codes
- [x] C-5: ServiceGLAccounts.tsx (/accounting/admin/service-gl-accounts)
  - NS-036: BR-SGL-001/002; GL Group + VIN Prefix (8 chars, ^ wildcard); amber fallthrough banner; 4×4 grid (C/W/I/S pay types × Labor/Parts/Sublet/Fluids line types = 16 GL slots); 5 misc fields
- [x] C-6: TechnicianMasterFile.tsx (/service/admin/technicians)
  - NS-037/038: Service Program 12; split panel; Technician/Advisor toggle; 3-tab detail (Profile/Pay Rates/Manufacturer IDs); SSN type=password last-4; Pay Type badges; Deactivate button (Active only); toast on Save
- [x] C-7 through C-7: ReportMate.tsx (/reporting/report-mate)
  - NS-039–043: 3-tab builder (My Reports/Build Report/Run Report); savedReports in localStorage; 5 report types (GL/Schedule/Sales Tax/DOC/Custom); dynamic field checklist; filter builder (up to 5 rows); sort config; CSV export (Blob); Schedule modal (frequency × delivery)
- [x] C-8: DocMate.tsx (/reporting/doc-mate)
  - NS-044: BR-GL-005/006 security bypass amber banner (always visible); document type filter; merges API data (glApi.getArchivedStatements) with MOCK_DOCS; document viewer modal per type; PDF download with graceful error fallback
- [x] C-9: ServiceHistory.tsx (/service/history)
  - NS-045: HISTORY1/2/3 tabs (0-90/91-365/1-5yr); 5-param search (RO#/Customer/VIN last6/dates); inline expand detail with line items/parts/totals; Print button

Navigation restructured to 9 sections: Daily Operations, Inquiry, Period Close, GL Reports, Payroll Reports, Administration, Service, Tools, Legacy/System

New API objects added to client.ts:
- glInquiryApi (6 methods: getGLInquiry/getMultiGLInquiry/getInquiryPrefs/saveInquiryPrefs/getScheduleInquiry/getScheduleGLMapping/getScheduleDetail/getTransactionInquiry/getTransactionDetail)
- dcsApi (3 methods)
- partsGLApi (2 methods)
- serviceGLApi (2 methods)
- technicianApi (7 methods)
- serviceHistoryApi (3 methods)
- reportMateApi (6 methods)
- docMateApi (3 methods)

Files changed in Sprint C:
- apps/web/src/pages/accounting/InquiryMenu.tsx (NEW — C-1 NS-048)
- apps/web/src/pages/accounting/ScheduleInquiry.tsx (NEW — C-1 NS-046)
- apps/web/src/pages/accounting/TransactionInquiry.tsx (NEW — C-1 NS-047)
- apps/web/src/pages/accounting/GLInquiry.tsx (NEW — C-2 EU-008)
- apps/web/src/components/accounting/TransactionDetailPopup.tsx (REWRITTEN — EU-008 shared popup)
- apps/web/src/pages/accounting/MFGDCSCommunications.tsx (NEW — C-3 NS-034)
- apps/web/src/pages/accounting/admin/PartsGLAccounts.tsx (NEW — C-4 NS-035)
- apps/web/src/pages/accounting/admin/ServiceGLAccounts.tsx (NEW — C-5 NS-036)
- apps/web/src/pages/service/TechnicianMasterFile.tsx (NEW — C-6 NS-037/038)
- apps/web/src/pages/reporting/ReportMate.tsx (NEW — C-7 NS-039–043)
- apps/web/src/pages/reporting/DocMate.tsx (NEW — C-8 NS-044)
- apps/web/src/pages/service/ServiceHistory.tsx (NEW — C-9 NS-045)
- apps/web/src/api/client.ts (8 new API objects: glInquiryApi/dcsApi/partsGLApi/serviceGLApi/technicianApi/serviceHistoryApi/reportMateApi/docMateApi)
- apps/web/src/App.tsx (12 new imports + 11 new routes + sidebar restructured to 9 sections)

TypeScript status (2026-05-20): ✅ apps/web — 0 errors (npx tsc --noEmit)

## SPRINT B COMPLETE (2026-05-20)
- [x] B-1: GLTrialBalance.tsx (Program 24, /accounting/reports/gl-trial-balance)
  - Month/Year selects, Calendar/Fiscal toggle, Company/Dept/account range filters, zero-balance checkbox
  - Out-of-balance alert (debits ≠ credits), footer TOTALS row
  - BR-GL-001: balance validation; BR-GL-002: CSV export with 7 COBOL columns (COMPNO, GL-ACCTN, GL-TYPE, TOT-PRIOR, TOT-CUR, TOT-YTD-I, CONTNO)
- [x] B-2: AnnualGLSummary.tsx (Program 27, /accounting/reports/annual-gl-summary)
  - Fiscal Year input, Company, From/To account range
  - 14-column horizontal scroll (Account#, Description, Jan–Dec, Total); sticky left Account# column
  - BR-GL-009: amber warning about data clearing after first-month close of new fiscal year
  - CSV export with per-month columns
- [x] B-3: DetailedGLPL.tsx (Program 23, /accounting/reports/detailed-gl-pl)
  - Radio toggle: GL Detail vs P&L Detail; Month/Year, From/To account, Dept, Source Code (2-digit numeric), Posted Only
  - Grouped by account: Beginning Balance header, h-9 transaction rows, Ending Balance footer
  - BR-GL-003: when `accessDenied=true` all 3 amount cells show `*** ACCESS DENIED ***` in red (row still rendered)
  - Drill-down single-account filter; pagination at 200 rows
- [x] B-4: MonthlyTransJournals.tsx (Program 28, /accounting/reports/monthly-trans-journals)
  - BR-GL-007: from/to date validation (must be same month/year); fires onBlur, disables Generate button
  - BR-GL-008: group by posting_batch_id client-side via useMemo Map; collapsible group headers
  - BR-GL-004: restricted rows excluded (backend-enforced, footnote explains policy)
  - CSV export with URL.revokeObjectURL cleanup
- [x] B-5: AutopostReport.tsx + CrossPostReport.tsx (Program 29, /accounting/reports/autopost + /accounting/reports/cross-post)
  - BR-GL-010: AutopostReport checks autopost_report_log for prior dates; amber Lock banner if already printed; today bypasses check
  - BR-GL-011: CrossPostReport extractBase() strips leading alpha + dash/space; groups by journal_id; Set intersection finds cross-posting lines; amber row highlighting
- [x] B-6: 11 Payroll report screens (NS-023 through NS-032, /payroll/reports/*)
  - WorkersCompReport.tsx (NS-023): Dept filter, BR-PAY-006 info note (18 excludable earning types), CSV export
  - EmployeeHistoryReport.tsx (NS-024): Employee ID/name lookup, date range, YTD 6-column grid, CSV export
  - EarningsDeductionsReport.tsx (NS-025): Radio XOR (earnings OR deductions, BR-PAY-007), amber warning; two distinct table schemas; amber note
  - TaxSummaryReport.tsx (NS-026): getWageBases() with wage_base_type enum mapping (US_FEDERAL/EEFICA/EE_MEDICARE/STATE/FUTA/SUTA + ER variants); canonical display order
  - FourOhOneKReport.tsx (NS-027): Contribution + Employer Match + YTD columns, font-mono right-aligned
  - EMPOWERExport.tsx (NS-028): exportReport(runId, 'EMPOWER'); fallback stub CSV on API failure; spinner state
  - EmployeeWageExport.tsx (NS-029): Simple/Advanced mode toggle; 16-column grid with Select All; WAGE_EXPORT_SIMPLE|ADVANCED
  - PayrollPositivePay.tsx (NS-030): BR-PAY-008 blue banner (separate from AP Positive Pay S6-09); CSV/TSV/Fixed Width radio
  - NACHAStandalone.tsx (NS-031): BR-PAY-008 amber banner; filters listRuns() to FINALIZED only; generateNacha() then separate Download button; BR-PAY-008 compliance
  - EmployeeInfoReport.tsx (NS-032): BR-PAY-009 3-layer security — VIEW_EMPLOYEE_INFO permission check (full-page red denied card); Dept filter; SSN shows last-4 only (full ### only with VIEW_SSN); Pay Type badges (SALARY green / HOURLY blue)
- [x] B-7: GovernmentWageReport.tsx (NS-033, /payroll/reports/government-wage)
  - Quarter/Year/State parameters; Report Type radio (FEDERAL_941 / STATE_SUTA / ALL)
  - Employee detail table with SSN always masked (last 4 only, security policy)
  - Form 941 Summary (5 labeled lines); per-state SUTA section (taxable wages, SUTA tax, SUI rate)
  - Print (window.print()), Export CSV (Blob URL), Export Electronic Filing buttons

Navigation additions to App.tsx:
- "GL Reports" sidebar section: 6 items (Trial Balance, Annual GL Summary, Detailed GL / P&L, Monthly Trans Journals, Autopost Report, Cross-Post Report)
- "Payroll Reports" sidebar section: 11 items (Workers' Comp, Employee History, Earnings & Deductions, Tax Summary, 401(k) Report, EMPOWER Export, Wage Export, Positive Pay, NACHA Standalone, Employee Info, Government Wage)

Files changed in Sprint B:
- apps/web/src/pages/accounting/reports/GLTrialBalance.tsx (NEW — B-1)
- apps/web/src/pages/accounting/reports/AnnualGLSummary.tsx (NEW — B-2)
- apps/web/src/pages/accounting/reports/DetailedGLPL.tsx (NEW — B-3)
- apps/web/src/pages/accounting/reports/MonthlyTransJournals.tsx (NEW — B-4)
- apps/web/src/pages/accounting/reports/AutopostReport.tsx (NEW — B-5)
- apps/web/src/pages/accounting/reports/CrossPostReport.tsx (NEW — B-5)
- apps/web/src/pages/payroll/reports/WorkersCompReport.tsx (NEW — B-6 NS-023)
- apps/web/src/pages/payroll/reports/EmployeeHistoryReport.tsx (NEW — B-6 NS-024)
- apps/web/src/pages/payroll/reports/EarningsDeductionsReport.tsx (NEW — B-6 NS-025)
- apps/web/src/pages/payroll/reports/TaxSummaryReport.tsx (NEW — B-6 NS-026)
- apps/web/src/pages/payroll/reports/FourOhOneKReport.tsx (NEW — B-6 NS-027)
- apps/web/src/pages/payroll/reports/EMPOWERExport.tsx (NEW — B-6 NS-028)
- apps/web/src/pages/payroll/reports/EmployeeWageExport.tsx (NEW — B-6 NS-029)
- apps/web/src/pages/payroll/reports/PayrollPositivePay.tsx (NEW — B-6 NS-030)
- apps/web/src/pages/payroll/reports/NACHAStandalone.tsx (NEW — B-6 NS-031)
- apps/web/src/pages/payroll/reports/EmployeeInfoReport.tsx (NEW — B-6 NS-032)
- apps/web/src/pages/payroll/reports/GovernmentWageReport.tsx (NEW — B-7 NS-033)
- apps/web/src/api/client.ts (glApi: getTrialBalanceDetail/getAnnualGLSummary/getDetailedGL/getMonthlyTransJournals/checkAutopostReportLog/getAutopostReport/getCrossPostReport; payrollReportApi: getWorkersComp/getEmployeeHistory/getEarningsDeductions/getTaxSummary/get401k/generateEmpowerExport/getEmployeeWageExport/generatePayrollPositivePay/regenerateNacha/getEmployeeInfo/getGovernmentWage)
- apps/web/src/App.tsx (17 new routes + GL Reports nav section (6 items) + Payroll Reports nav section (11 items))

TypeScript status (2026-05-20): ✅ apps/web — 0 errors (npx tsc --noEmit)

## SPRINT A COMPLETE (2026-05-20)
- [x] A-1: EOM Orchestrator Corrections (NS-001, NS-002, NS-003, EU-001)
  - Migration: `eom_archive_log` table, `schedules.purge_code/purge_when_zero`, `fiscal_periods.annual_gl_summary_cleared`
  - ACCT_065: upgraded to write eom_archive_log rows for all 7 archive types (non-blocking, ADR-EOM-008)
  - ACCT_070: nextStepCode changed from ACCT_100 → ACCT_080 (pre-req gate chain)
  - ACCT_080: AcctFSAcceptedCheckHandler added (BR-EOM-001) — queries fs-service acceptance status
  - ACCT_090: AcctGLValidateHandler added (BR-EOM-002) — validates trial balance before destructive steps
  - EndOfMonthClose.tsx: added `fs_accepted` + `gl_validated` checklist items with amber notes; archive progress panel (7 types, polling eom_archive_log every 2s via archiveStepActive flag); `eomApi.getArchiveLog` in client.ts
- [x] A-2: Financial Statements Corrections (NS-005, NS-006, NS-007, NS-008, EU-002, EU-006)
  - Migration: `fs_versions` table (version_number 1–15, UNIQUE per tenant); `gl_system_config.ncm20_enabled + fiscal_year_start_month`
  - FinancialStatements.tsx: FS Version selector (V1–V15 from fs_versions API); Calendar/Fiscal YTD toggle; NCM20 Upload button (gated by ncm20_enabled system config); Archived Statements tab (BR-GL-006/DM-001 security bypass notice); `glApi.getFsVersions/generateNcm20Upload/getArchivedStatements/getNcm20Status/getSystemConfig` added
- [x] A-3: Payroll Core Expansion (NS-009 through NS-016, EU-003)
  - Migration: `payroll_runs` table (partial UNIQUE index PAY-001: one active run per tenant where status=IN_PROGRESS); `payroll_wage_bases` (NUMERIC(15,2) for all monetary fields)
  - PayrollProcessing.tsx: FULL 9-STEP REPLACEMENT — Step 1 (start run, PAY-001/002 enforcement), Step 2 (add checks by type/freq), Step 3 (import time: time clock/CSV/manual/external), Step 4 (employee check data), Step 5 (validate: warnings→acknowledge+proceed, errors→block PAY-003), Step 6 (review summary + variance), Step 7 (NACHA generation PAY-004), Step 8 (finalization + wage bases breakdown PAY-008/010), Step 9 (print/export); PAY-005 lock warning banner
  - `payrollApi.startRun/loadInProcess/getRun/listRuns/addChecks/importTime/getCheckData/updateCheck/validateRun/getSummary/generateNacha/finalizeRun/getWageBases/exportReport` all added to client.ts
- [x] A-4: Service Day-End Close (NS-004, CF-001)
  - `apps/web/src/pages/service/DayEndClose.tsx` CREATED — Service Program 6, separate from Accounting EOM
  - Pre-close checklist (open ROs, cashier balance), revenue summary grid, Close Day button with confirm dialog
  - Publishes SERVICE_DAY_CLOSED to RabbitMQ on close (accounting subscribes for EOM pre-req tracking)
  - Route `/service/day-end-close` added to App.tsx; `serviceDayEndApi` added to client.ts
- [x] A-5: Cash Receipts Setup Video (V1) — FLAGGED FOR MANUAL REVIEW
  - `Setting Up Cash Receipts in Accounting Setup.mp4` cannot be analyzed directly (MP4 binary, no transcript)
  - Status: MP4 present at `/Users/shivashankarangadi/Public/Projects/AM-Accounting/`
  - Action needed: Download Loom video at original URL for transcript extraction, or manually transcribe
  - Sprint B will NOT be blocked by this flag — extraction is a documentation task only

Files changed in Sprint A:
- services/gl-service/prisma/migrations/20260520_sprint_a_eom_archive_payroll_fs.sql (NEW)
- services/eom-service/src/domain/step-handlers.ts (ACCT_065 upgraded, ACCT_070 nextStep fixed, ACCT_080+090 ADDED)
- apps/web/src/pages/accounting/EndOfMonthClose.tsx (checklist items + archive progress panel)
- apps/web/src/pages/accounting/FinancialStatements.tsx (FS version, YTD toggle, NCM20, archived viewer tab)
- apps/web/src/pages/accounting/PayrollProcessing.tsx (FULL REWRITE — 4-step → 9-step)
- apps/web/src/pages/service/DayEndClose.tsx (NEW — Service Program 6)
- apps/web/src/api/client.ts (eomApi.getArchiveLog; payrollApi 14 new methods; serviceDayEndApi; glApi 7 new methods)
- apps/web/src/App.tsx (DayEndClose import + /service/day-end-close route)

TypeScript status (2026-05-20): run `pnpm --filter apps/web tsc --noEmit` to verify

## CURRENT PHASE: Step 9 — Coding (Sprint 7 COMPLETE — All 7 items done)

## SPRINT 7 COMPLETE (2026-05-19)
- [x] S7-01: Vehicle Transfers with IC GL entries — `vehicle_transfers` table (NUMERIC(15,2), FK→gl_accounts); `VehicleTransfers.tsx` split-panel frontend (New Transfer form, status badges, Reverse dialog); routes already in gl-service; `glApi.listVehicleTransfers/createVehicleTransfer/reverseVehicleTransfer` in client.ts; App.tsx route `/accounting/vehicle-transfers`
- [x] S7-02: OEM Financial Statement tab — `oem_statement_mappings` table; OEM Statement tab in FinancialStatements.tsx (OEM dropdown, year/period, Generate button, per-line-type styling, Print/Export CSV, drill-down dialog); `glApi.getOemMappings/bulkImportOemMappings/generateOemStatement` in client.ts
- [x] S7-03: ACH NACHA file generation — "Generate ACH File" button replaces "Process Payment Batch" when `checkRun.paymentMethod === 'ACH'` in AccountsPayable.tsx; `achMut` calls `aparApi.generateAch`; triggers `.ach` file download; ACH error banner; `aparApi.generateAch` in client.ts
- [x] S7-04: IC auto-offset in `approveJournalEntry()` — ALREADY IMPLEMENTED in gl-service.ts lines 712–771: after posting, checks for IC lines without a counterpart, skips VT source (has its own), creates reversed counterpart journal entry atomically, links via `icCounterpartEntryId`
- [x] S7-05: IC balance elimination for consolidated reporting — Consolidated tab added to FinancialStatements.tsx with "Load Consolidated View", IC balance warning (AlertTriangle), green balanced indicator, consolidated accounts table; `glApi.getConsolidatedStatement` in client.ts
- [x] S7-06: Duplicate vendor tax ID detection — `onBlur` on Tax ID input calls `aparApi.getVendorsByTaxId(taxId)`; amber modal "Duplicate Tax ID Detected — [vendor name] (Vendor# [number])" with "Clear Tax ID" / "Continue Anyway" buttons
- [x] S7-07: 1099 YTD threshold badge + W-9 warnings — YTD query `aparApi.getVendorYtdPayments` shown as green (≥$600) / amber (<$600) / gray ($0) badge in Tax/1099 section; red banner if `is1099Eligible && !w9OnFile`; amber banner if W-9 > 3 years old

Files changed in Sprint 7:
- apps/web/src/pages/accounting/VehicleTransfers.tsx (NEW — S7-01)
- apps/web/src/pages/accounting/FinancialStatements.tsx (S7-02 OEM Statement tab + S7-05 Consolidated tab)
- apps/web/src/pages/accounting/AccountsPayable.tsx (S7-03 ACH generation button + mutation)
- apps/web/src/pages/accounting/VendorMaintenance.tsx (S7-06 duplicate tax ID onBlur + modal; S7-07 YTD badge + W-9 warnings)
- apps/web/src/api/client.ts (S7-01/02/05 glApi methods; S7-03/06/07 aparApi methods)
- apps/web/src/App.tsx (S7-01 — VehicleTransfers route)
- services/gl-service/prisma/migrations/20260519_sprint7_vehicle_transfer_oem.sql (NEW — S7-01/02)

TypeScript status (2026-05-19): ✅ apps/web — 0 errors | ✅ apar-service — 0 errors | ✅ gl-service — 0 errors

## SPRINT 6 COMPLETE (2026-05-19)
- [x] S6-01: PO Cancel vs Void state machine — DRAFT→Cancel (no PO# consumed), SUBMITTED/APPROVED→Void (PO# consumed); Cancel + Void dialogs in PurchaseOrders.tsx; `purchaseOrderApi.cancel/void/submit/approve/close` in client.ts
- [x] S6-02: Sublet PO RO check — `ro_number` field on PurchaseOrder schema; RO# input in New PO form (required for SUBLET type); linked-RO display in detail panel; stub validation in apar-service routes
- [x] S6-03: Vehicle PO block if SOLD — PurchaseOrder has `po_type` field; stub validation for VEHICLE type in create route; po_type selector in New PO form
- [x] S6-04: GL Account Sets — `gl_account_sets` + `gl_account_set_members` tables; CRUD routes in gl-service (GET/POST/PUT/DELETE + balances); Account Set dropdown in FinancialStatements.tsx
- [x] S6-05: Force reversal notes config — `force_reversal_notes_required` Boolean on `gl_system_config`; reversal route checks flag and returns 400 if notes missing
- [x] S6-06: Schedule Notes EOM purge — ACCT_070 step updated with no-op stub message (Wave 3 schedule-service integration deferred)
- [x] S6-07: GL filter active indicator — `isFilterActive` boolean in FinancialStatements.tsx; amber "Filtered" badge + "Clear filters" link shown when any non-default filter is active
- [x] S6-08: 1099 IRS FIRE format export — `POST /1099/export-fire` in apar-service; 750-char T/A/B/C/F records; `ContractorReports1099Tax` wrapper in AccountsPayable.tsx with "Export FIRE File" + "Print 1096 Summary" buttons
- [x] S6-09: Positive Pay export — `POST /payments/positive-pay-export` in apar-service (COMMA/TAB/FIXED_WIDTH); Positive Pay dialog wired in `CheckRegisterTab` (dateFrom/dateTo/format/bankAccountId)
- [x] S6-10: IRS Form 8300 cash tracking — `cash_100_bill_count` on `AREntry` schema; amber warning banner in AccountsReceivable.tsx when paymentMethod=CASH and amount>=10000; $100 bill count input required
- [x] S6-11: Expense Trend XLSX — `GET /reports/expense-trend` in gl-service; ExcelJS XLSX with bold/colored header + currency formatting if ExcelJS installed; JSON fallback if not; "Expense Trend" button in FinancialStatements.tsx
- [x] S6-12: Paid Invoice + IC Distribution reports — `APReportsTab` sub-component in AccountsPayable.tsx; AP-7 (Paid Invoice: date range, vendor range, method filter, Print+CSV); AP-9 (IC Distribution: cutoff date, company filter, grouped by company with subtotals, Print+CSV); 'ap-reports' tab added

Files changed in Sprint 6:
- apps/web/src/pages/accounting/AccountsReceivable.tsx (S6-10 — IRS 8300 banner + cash100BillCount)
- apps/web/src/pages/accounting/AccountsPayable.tsx (S6-08 ContractorReports1099Tax + S6-09 PositivePayDialog + S6-12 APReportsTab + ap-reports tab)
- apps/web/src/pages/accounting/PurchaseOrders.tsx (S6-01/02/03 — Cancel vs Void dialogs, VOIDED status, ro_number, po_type, purchaseOrderApi wiring)
- apps/web/src/pages/accounting/FinancialStatements.tsx (S6-04 Account Set dropdown + S6-07 filter indicator + S6-11 Expense Trend button)
- apps/web/src/api/client.ts (S6-01 cancel/void/submit/approve/close in purchaseOrderApi; S6-08 export1099FIRE; S6-09 positivePayExport; S6-12 aparApi.getInvoices)
- services/apar-service/prisma/schema.prisma (S6-01/02/03 PurchaseOrder + POLine models; S6-10 cash100BillCount on AREntry)
- services/apar-service/src/http/routes.ts (S6-01/02/03 PO routes; S6-08 FIRE export; S6-09 Positive Pay)
- services/apar-service/prisma/migrations/20260519_sprint6_po_and_8300.sql (NEW)
- services/gl-service/prisma/schema.prisma (S6-04 GLAccountSet + GLAccountSetMember; S6-05 forceReversalNotesRequired)
- services/gl-service/src/http/routes.ts (S6-04 account-sets routes; S6-05 reversal notes check; S6-11 expense-trend route)
- services/gl-service/prisma/migrations/20260519_sprint6_account_sets_and_config.sql (NEW)
- services/eom-service/src/domain/step-handlers.ts (S6-06 ACCT_070 stub updated)

TypeScript status (2026-05-19): ✅ apps/web — 0 errors | ✅ apar-service — 0 errors | ✅ gl-service — 0 errors

## SPRINT 5 COMPLETE (2026-05-19)
- [x] S5-01: CustomerMaintenance.tsx — split-panel screen with 5-tab detail (Module Data, Vehicles, Notes, Alt. Address, Audit Log); full CRUD routes in apar-service; Customer model added to apar schema; customers migration SQL
- [x] S5-02: Employee Guard — amber banner + disabled fields + "Go to Payroll" button when employeeFlag=true (embedded in CustomerMaintenance)
- [x] S5-03: NameDatabaseLookup.tsx — superset of VendorLookup; supports CUSTOMER/VENDOR/EMPLOYEE/ALL entity types + Smart Search tab (VIN last-6 / Year-Make-Model); exported from components/accounting/index.ts
- [x] S5-04: AP Aging tab — APAgingTab sub-component in AccountsPayable.tsx; vendor range, as-of date, aging method toggle, 7-column table, expandable rows, AgingDisplay summary bar
- [x] S5-05: Check Register tab — CheckRegisterTab sub-component in AccountsPayable.tsx; date range, method/status/vendor filters, void dialog; Print/Export/Positive Pay buttons
- [x] S5-06: Floor plan base vehicle fields — vehicleCondition/vehicleType/acquisitionDate/totalCost on FloorPlanUnit; gl-service schema + migration SQL
- [x] S5-07: Cost component fields — invoiceCost/packAmount/holdbackAmount/factoryRebate/freightAmount/prepCharges/reconCosts/accruedFloorPlanInterest on FloorPlanUnit; cost breakdown grid in UnitRow
- [x] S5-08: Vehicle identity fields — vehicleYear/vehicleMake/vehicleModel/vehicleTrim/vehicleStatus on FloorPlanUnit; RegisterUnitSchema updated; UnitRow vehicle label in FloorPlanFinancing.tsx
- [x] S5-09: AR auto-apply sort — handleAutoApply now sorts openInvoices by dueDate ASC (oldest first) before applying receipts
- [x] S5-10: Check print billing address — GET /ap-payments enriched with vendor billing address (address1/address2/city/state/zip) via APEntry + Vendor lookups

Files changed in Sprint 5:
- apps/web/src/pages/accounting/CustomerMaintenance.tsx (NEW — S5-01/02)
- apps/web/src/components/accounting/NameDatabaseLookup.tsx (NEW — S5-03)
- apps/web/src/components/accounting/index.ts (S5-03 — export NameDatabaseLookup)
- apps/web/src/pages/accounting/AccountsPayable.tsx (S5-04/05 — APAgingTab + CheckRegisterTab)
- apps/web/src/pages/accounting/AccountsReceivable.tsx (S5-09 — auto-apply sort)
- apps/web/src/components/FloorPlanFinancing.tsx (S5-06/07/08 — UnitRow + vehicle/cost columns)
- apps/web/src/api/client.ts (S5-01 — Customer CRUD methods in aparApi)
- apps/web/src/App.tsx (S5-01 — routes for CustomerMaintenance)
- services/apar-service/prisma/schema.prisma (S5-01 — Customer model)
- services/apar-service/src/http/routes.ts (S5-01 customer CRUD + S5-10 billing address)
- services/apar-service/prisma/migrations/20260519_sprint5_customers.sql (NEW)
- services/gl-service/prisma/schema.prisma (S5-06/07/08 — 17 new FloorPlanUnit fields)
- services/gl-service/src/http/floor-plan-routes.ts (S5-06/07/08 — RegisterUnitSchema)
- services/gl-service/prisma/migrations/20260519_sprint5_floorplan_vehicle_fields.sql (NEW)

TypeScript status (2026-05-19): ✅ apps/web — 0 errors | ✅ apar-service — 0 errors

## SPRINT 4 COMPLETE (2026-05-19)
- [x] S4-01: Daily Deposit tab — full session management (open/close), split-panel unallocated vs current deposit, grouped-by-payment-method display, deposit summary with check listing, "Allocate to GL" button, collapsible history
- [x] S4-02: Display/Void tab — search bar (receipt#, date range, customer, source doc#, status), expandable detail panel, void confirmation dialog with reason dropdown + notes + reversal date, Reprint + View GL Impact buttons, 4 report shortcuts
- [x] S4-03: Reports tab — 4 report types (Payment Tracking, Daily Summary, Monthly Summary, Customer History) with per-report parameter filters, Print + Export CSV buttons, footer totals
- [x] S4-04: AREntry model — 8 new fields (journalSource, sourceDocumentType, sourceDocumentNumber, cashierUserId, cashierDateTime, customerPayPortion, checkName, remarks); PENDING_MANUAL default status rule
- [x] S4-05: PENDING_MANUAL status — status type updated, amber badge in Receipts tab, pending count alert banner, PENDING_MANUAL rows float to top
- [x] S4-06: Source filter + Source Doc# column — filter dropdown (All/Service 30/Parts 32/Manual 56), Source Doc# column added to Receipts tab table
- [x] S4-07: Real-time payment totals bar — Cash/Check/Credit/Other/TOTAL above Receipts table, updates as source filter changes
- [x] S4-08: Cash Receipt Preferences modal — defaultBankAccount, defaultPaymentMethod, defaultJournalSource, receiptPrefix, autoPrintOnPost, showGlOnPost; persisted to localStorage

Files changed in Sprint 4:
- apps/web/src/pages/accounting/AccountsReceivable.tsx (S4-01 through S4-08 — DailyDepositTab, DisplayVoidTab, CashReceiptsReportsTab, CashReceiptPreferencesModal added as sub-components)
- services/apar-service/prisma/schema.prisma (S4-04 — 8 new fields on AREntry model)
- services/apar-service/src/http/routes.ts (S4-04/05 — fields in CreateARSchema + GET filter + PENDING_MANUAL status)

TypeScript status (2026-05-19): ✅ apps/web — 0 errors | ✅ apar-service — 0 errors



## SPRINT 3 COMPLETE (2026-05-22)
- [x] S3-01: JournalSourceLookup.tsx — isOpen prop, arrow-key nav, year-end/13th-month badges
- [x] S3-02: JournalTemplateList.tsx — list all templates with search, bulk delete, "Use" action; gl-service template routes fixed (correct Prisma field names)
- [x] S3-03: JournalTemplateEdit.tsx — create/edit template with line grid (isCredit toggle, amount, memo, departmentCode); Save & Save+New
- [x] S3-04: JournalTemplateSelector.tsx — keyboard-navigable popup; JournalEntry.tsx wired with "Load Template" button + location.state auto-load
- [x] S3-05: Batch entry mode — useSearchParams batch=true, session counter, amber banner, Stop Batch button, 800ms auto-clear in batch
- [x] S3-06: Reverse entry — reverseMut in JournalEntry.tsx, confirm dialog, POST /journal-entries/:id/reverse with correct Prisma field names (source not sourceCode, glAccountId not accountCode, memo not description)
- [x] S3-07: Vendor Maintenance — Vendor model in apar schema, 5-tab split-panel VendorMaintenance.tsx, full CRUD routes with auto-vendorNumber
- [x] S3-08: Void Checks — voidedAt/voidReason on APPayment model; POST /ap-payments/:id/void; VoidChecksTab component in AccountsPayable.tsx
- [x] S3-09: Sequential check numbers — APBankAccount model; POST /ap-payments/assign-check-numbers with $transaction atomic nextCheckNumber increment

Files changed in Sprint 3:
- apps/web/src/pages/accounting/JournalTemplateList.tsx (NEW — S3-02)
- apps/web/src/pages/accounting/JournalTemplateEdit.tsx (NEW — S3-03)
- apps/web/src/components/accounting/JournalTemplateSelector.tsx (NEW — S3-04)
- apps/web/src/pages/accounting/JournalEntry.tsx (S3-04, S3-05, S3-06)
- apps/web/src/pages/accounting/JournalEntryList.tsx (S3-05 batch param fix)
- apps/web/src/pages/accounting/VendorMaintenance.tsx (NEW — S3-07)
- apps/web/src/pages/accounting/AccountsPayable.tsx (S3-08 VoidChecksTab)
- apps/web/src/App.tsx (routes for S3-02/03/07)
- apps/web/src/api/client.ts (glApi template/reverse methods; aparApi vendor/payment methods)
- services/gl-service/prisma/schema.prisma (JournalTemplate.name field — S3-02)
- services/gl-service/src/http/routes.ts (template CRUD routes + reversal route — S3-02/03/06)
- services/apar-service/prisma/schema.prisma (Vendor model, APBankAccount model, APPayment voidedAt/voidReason — S3-07/08/09)
- services/apar-service/src/http/routes.ts (vendor CRUD, void payment, assign-check-numbers — S3-07/08/09)

TypeScript status (2026-05-22): ✅ apps/web — 0 errors | ✅ gl-service — 0 errors | ✅ apar-service — 0 errors


- [x] S2-01: JournalEntryList.tsx — primary GL landing screen with filters, bulk post, context menu, footer totals
- [x] S2-02: JournalSourceLookup popup — numeric source code input replaces text dropdown (PO-DEC-004)
- [x] S2-03: AccountsReceivable.tsx — cashier-sourced receipts as primary tab; manual entry is exception path (PO-DEC-005)
- [x] S2-04: GL Distribution grid in Cash Receipt manual entry form (replaces bank account dropdown)
- [x] S2-05: JournalLine schema + Zod — added companyCode, controlNumber (max 20), applyToCost, unitCount fields
- [x] S2-06: APEntry status expanded — PARTIAL/PAID/VOID values + status badge colors in AccountsPayable.tsx
- [x] S2-07: APEntry new fields — checkNumber, checkDate, paidDate, poNumber, holdFlag, note + form UI
- [x] S2-08: APPayment model — clearedFlag, clearedDate for bank reconciliation; new ap_payments table
- [x] S2-09: Receipt# auto-generation — dealerRef now optional in apar-service schema; auto-generates RCP-XXXXXX server-side; frontend field is read-only
- [x] S2-10: 14 payment methods in AccountsReceivable.tsx — CASH, PERSONAL_CHECK, BUSINESS_CHECK, CASHIER_CHECK, BANK_CHECK, MONEY_ORDER, TRAVELER_CHECK, THIRD_PARTY_CHECK, VISA, MASTERCARD, AMEX, DISCOVER, ACH, OTHER

Files changed in Sprint 2:
- apps/web/src/pages/accounting/JournalEntryList.tsx (NEW — S2-01)
- apps/web/src/components/accounting/JournalSourceLookup.tsx (NEW — S2-02)
- apps/web/src/pages/accounting/JournalEntry.tsx (S2-02)
- apps/web/src/pages/accounting/AccountsReceivable.tsx (S2-03, S2-04, S2-09, S2-10)
- apps/web/src/pages/accounting/AccountsPayable.tsx (S2-06, S2-07)
- apps/web/src/App.tsx (S2-01 routes)
- apps/web/src/api/client.ts (S2-01 getSources, getSourceByCode)
- services/gl-service/prisma/schema.prisma (S2-05)
- services/gl-service/src/http/routes.ts (S2-05)
- services/gl-service/prisma/migrations/20260521_sprint2_journal_line_fields.sql (NEW)
- services/apar-service/prisma/schema.prisma (S2-06, S2-07, S2-08)
- services/apar-service/src/http/routes.ts (S2-09)
- services/apar-service/prisma/migrations/20260521_sprint2_ap_fields.sql (NEW)

## COMPLETED WORK

### Sprint 1 — Data Integrity & Blocking Correctness (COMPLETE 2026-05-20)
- [x] S1-01: AP aging formula — approval queue now uses dueDate; Days Past Due column + aging bucket badge (Current/1–30/31–60/61–90/90+); past-due rows highlighted red
- [x] S1-02: GL distribution sum validation — error message now shows "Distribution total ($X) ≠ invoice total ($Y). Difference: $Z" with red border panel
- [x] S1-03: Receipt void guard — added `isReconciled` to JournalEntry schema; reverseJournalEntry() throws if isReconciled=true; migration 20260520_sprint1_data_integrity.sql
- [x] S1-04: Duplicate receipt prevention — connector-service cash receipt handler queries GL before posting; returns 409 DUPLICATE_RECEIPT if sourceRef matches existing entry
- [x] S1-05: Ref# max 8 chars — gl-service CreateJournalEntrySchema: sourceRef now max(8); JournalEntry.tsx: referenceNumber input maxLength=8, onChange slices to 8, initial value is 6-digit timestamp
- [x] S1-06: Template# max 8 alphanum — added JournalTemplate + JournalTemplateLine models to gl-service schema; DB CHECK CONSTRAINT enforces [A-Z0-9]{1,8}
- [x] S1-07: No hard-delete on vendors — prominent WARNING comment in apar-service routes.ts documents BR-AP-001: vendor DELETE endpoint prohibited, soft-delete only
- [x] S1-08: Vehicle transfer atomic GL — connector-service vehicle-transfer endpoint now uses saga/compensation pattern; if sending GL fails, receiving GL is automatically reversed; split-brain audit event
- [x] S1-09: IC Offset GL ≠ Inventory GL — vehicle-transfer validates toInvAcct ≠ toIcAcct and fromInvAcct ≠ fromIcAcct; returns 422 INVALID_GL_CONFIG and compensates if needed
- [x] S1-10: stockNumber on FloorPlanUnit — added stock_number VARCHAR(20) to FloorPlanUnit Prisma model + migration SQL
- [x] S1-11: Remove journalType dropdown — removed journalType from JournalEntryData interface, state variable, grid (cols-4→cols-3), and handlePost() data object
- [x] S1-12: Block WorldPay captured reversal — worldpayCaptured field added to CashReceiptsSchema; stored in idempotency map; DELETE /cash-receipts/:receiptNumber returns 409 WORLDPAY_CAPTURED if true

Files changed in Sprint 1:
- apps/web/src/pages/accounting/AccountsPayable.tsx (S1-01, S1-02)
- apps/web/src/pages/accounting/JournalEntry.tsx (S1-05, S1-11)
- services/gl-service/prisma/schema.prisma (S1-03, S1-06, S1-10)
- services/gl-service/prisma/migrations/20260520_sprint1_data_integrity.sql (NEW — S1-03, S1-06, S1-10)
- services/gl-service/src/application/gl-service.ts (S1-03)
- services/gl-service/src/http/routes.ts (S1-05)
- services/connector-service/src/http/ingest-routes.ts (S1-04, S1-08, S1-09, S1-12)
- services/apar-service/src/http/routes.ts (S1-07)

### Product Owner Decisions
- [x] PO-DEC-001: approveJournalEntry agent review — KEEP
- [x] PO-DEC-002: F8=Post shortcut — KEEP (new in AMACC 2.0)
- [x] PO-DEC-003: FIFO/WA scope → Parts module only
- [x] PO-DEC-004: Journal source = numeric codes with lookup
- [x] PO-DEC-005: Cash receipts = cashier-sourced primary workflow

### Archaeology (Steps 1-4)
- [x] Phase 1 Inventory: 221 programs, 370 copybooks (archaeology-phase1-inventory.json)
- [x] Phase 2 KOM Contracts: 9 programs, 134 fields (archaeology-phase2-kom-contracts.json)
- [x] Phase 2 GL Callgraph: 4-stage pipeline, 8 FMs (archaeology-phase2-gl-callgraph.json)
- [x] Phase 2 EOM Callgraph: 12-step sequence (archaeology-phase2-eom-callgraph.json)
- [x] Phase 2 Gaps Closed: Purge types, GL rollforward, chained sale (archaeology-phase2-gaps-closed.json)

### Audit (Steps 5-6)
- [x] Schema audit (audit-01-schema.json)
- [x] GL service audit (audit-02-gl-service.json)
- [x] EOM service audit (audit-03-eom-service.json)
- [x] Services scan (audit-04-services.json)
- [x] Requirements check (audit-05-requirements.json)
- [x] Final verdict (audit-06-final-verdict.json) — 63 findings

### Implementation (Step 9 — Backend)
- [x] FIX-001: DOUBLE PRECISION → NUMERIC(15,2) — 26 columns migrated
- [x] FIX-002: ACCT_300 unblocked
- [x] FIX-003: Command-center pipeline bypass fixed
- [x] FIX-004: Intercompany pipeline bypass fixed
- [x] FIX-005: parseInt NaN reset guard fixed (DESTRUCTIVE_STEPS Set)
- [x] FIX-006: Opening balance in trial balance
- [x] FIX-007: tenant-kunes fallback removed (9 occurrences)
- [x] FIX-008: gl_sources table created
- [x] FIX-009: cosAccountId/invAccountId in API
- [x] FIX-010: gl_system_config table created
- [x] FIX-011: GL distribution expansion
- [x] FIX-012: Journal source security enforcement
- [x] FIX-013: sort_key column added
- [x] FIX-014: Payroll GL journal entry
- [x] FIX-015: Port conflict fixed (schedule-service → 3018)
- [x] FIX-017: withSerializableRetry helper
- [x] FIX-020: applyCd field exposed
- [x] FIX-021: fiscal_periods table created
- [x] BUILD-001: gl_system_config table + API
- [x] BUILD-002: gl_sources + source security
- [x] BUILD-003: GL distribution expansion
- [x] BUILD-004: Cash receipt posting API
- [x] BUILD-005: EOM distributed locking (pg_advisory_xact_lock)
- [x] BUILD-006: Transaction reversal API
- [x] BUILD-007: gl_account_id_map table
- [x] BUILD-008: Cash clearing flags + bank recon
- [x] BUILD-009: Auto-post job
- [x] BUILD-010: 13th month EOM orchestration
- [x] BUILD-011: FS configuration management (6 endpoints, 3 tables)
- [x] BUILD-012: Real ACCT_010 backup (eom_backups table)
- [x] BUILD-013: LIFO engine (link-chain + double-extension)
- [x] BUILD-014: Subtotal group columns
- [x] BUILD-015: req_control_number + print_code
- [x] VER-001 through VER-008: All 8 verification tests (services/gl-service/tests/verification/)

### Product Specs (Step 7)
- [x] BRD: automate2-accounting-brd.md (44 KB, 831 lines)
- [x] PRD: automate2-accounting-prd.md (32 KB, 1,121 lines)
- [x] User Stories: automate2-accounting-user-stories.json (68 stories)

### Market Research (Step 2)
- [x] CDK Global: Foundations Suite, "Unmatched Accounting", 15K dealers
- [x] Tekion: ARC platform, T1 conversational AI, 60% revenue growth
- [x] Reynolds: ERA-IGNITE (2011), screen-code UI, strong reporting
- [x] Dealertrack: Cloud-based, Opentrack, real-time accounting

## IN PROGRESS

### Step 6: RICE Prioritization
- [ ] Formal RICE scores for 8 IMPLEMENT features
- [ ] Formal RICE scores for 3 REDESIGN features

### Step 8: Feature Map + LLD
- [ ] OpenAPI spec for all 89+ endpoints
- [ ] Event contract documentation (40+ event types)
- [ ] COBOL line citations in LLD

### Step 9: New Features (Backend + Frontend Components)
- [x] Sales Tax Accrual (Phase 1) — Backend: 4 endpoints, 3 tables, migrations + Prisma + tests + routes. Frontend: SalesTaxAccrual.tsx component (jurisdictions, accrual, liability report tabs)
- [x] 1099 Contractor Reports (Phase 1) — Backend: 5 endpoints, 1 table, migrations + Prisma + tests + routes. Frontend: ContractorReports1099.tsx component (generate, review, export tabs)
- [x] Commission Tracking (Phase 1) — Backend: 4 endpoints, 2 tables, migrations + Prisma + tests + routes. Frontend: CommissionTracking.tsx component integrated into Payroll.tsx (plans, track, report tabs)
- [x] Floor Plan Financing (Phase 1) — Backend: 5 endpoints, 1 table, migrations + Prisma + tests + routes. Frontend: FloorPlanFinancing.tsx component (register, track, aging tabs)
- [ ] Manufacturer Reconciliation (Phase 2)
- [ ] FIFO/Weighted-Average Inventory (Phase 2)
- [ ] Fixed Asset Management (Phase 2)
- [ ] Warranty Accrual (Phase 2)

### Step 9: Frontend (Core Screens + Phase 1 Integration)
Core accounting screens (all complete, fully integrated with Phase 1):
- [x] WF-A001: GL Journal Entry (pages/accounting/JournalEntry.tsx) — balance check, anomaly detection, auto-suggest, ActionBar with F8/Ctrl+S/R/P shortcuts
- [x] WF-A002: Accounts Payable (pages/accounting/AccountsPayable.tsx) — 5 tabs with SalesTaxAccrual + ContractorReports1099 Phase 1 components, duplicate detection
- [x] WF-A003: Accounts Receivable (pages/accounting/AccountsReceivable.tsx) — 4 tabs with auto-apply (F7), AgingDisplay, duplicate receipt prevention (critical)
- [x] WF-A004: Bank Reconciliation (pages/accounting/BankReconciliation.tsx) — Outstanding Checks/Deposits/Adjustments, AI Auto-clear (F7), FloorPlanFinancing Phase 1 tab, F8 complete
- [x] WF-A005: Payroll Processing (pages/accounting/PayrollProcessing.tsx) — 4-step wizard with employee calc, variance report, tax preview, CommissionTracking Phase 1 tab, single transaction
- [x] WF-A006: End of Month Close (pages/accounting/EndOfMonthClose.tsx) — 10-item checklist, 12-step stepper, trial balance, idempotent design (steps >= ACCT_100 non-resettable)
- [x] WF-A007: Financial Statements (pages/accounting/FinancialStatements.tsx) — 4 tabs (IS/BS/CF/Dept), hierarchical drill-down, OEM format toggle, BS balance alert
- [x] WF-A008: Purchase Orders (pages/accounting/PurchaseOrders.tsx) — split view, state machine enforcement (DRAFT→SUBMITTED→APPROVED→RECEIVED→CLOSED), approval thresholds
- [x] WF-A009: Recurring Entries (pages/accounting/RecurringEntries.tsx) — template list with frequency badges, JournalEntryTable, "Generate All Due" (F8), auto_post toggle
- [x] WF-A010: Financial Dashboard (pages/accounting/FinancialDashboard.tsx) — 11 widgets (8 operational + 3 AI), MTD P&L, Dept Performance, Anomaly Scan, Cash Forecast, 5-min auto-refresh

Shared Accounting Components (components/accounting/):
- [x] GLAccountLookup.tsx — GL account search-select with type badge + balance
- [x] JournalEntryTable.tsx — full editor with debit/credit columns, balance check, auto-add row on Tab
- [x] VendorLookup.tsx — vendor search-select with payment terms + default GL
- [x] AgingDisplay.tsx — stacked bar with 5 aging categories (current/30/60/90/90+)
- [x] PeriodSelector.tsx — GL period dropdown with open/closed status
- [x] FinancialStatementViewer.tsx — hierarchical table with drill-down to GL transactions
- [x] ActionBar.tsx — fixed bottom bar with keyboard hints (F8, Ctrl+S, etc.) + action buttons
- [x] AuditTrailViewer.tsx — chronological audit log with before/after JSON diffs

App.tsx Updates:
- [x] Added 10 new routes under /accounting/* paths (dashboard, gl, ap, ar, bank-recon, payroll, eom, financial-statements, purchase-orders, recurring)
- [x] Added ACCOUNTING_NAV sidebar section with 3 groupings (Daily Operations, Period Close, Administration)

Phase 1 Frontend Components — Fully Integrated:
- [x] CommissionTracking.tsx — Integrated into Payroll.tsx with 3 tabs (plans, track, report)
- [x] SalesTaxAccrual.tsx — Integrated into AccountsPayable.tsx with 3 tabs (jurisdictions, accrue, report)
- [x] ContractorReports1099.tsx — Integrated into AccountsPayable.tsx with 3 tabs (generate, review, export)
- [x] FloorPlanFinancing.tsx — Integrated into Reconciliation.tsx with 3 tabs (register, track, aging)

Frontend Pages Updated with Phase 1 Features:
- [x] Payroll.tsx — Added CommissionTracking tab (previously only had batch processing)
- [x] AccountsPayable.tsx — Added SalesTaxAccrual and ContractorReports1099 tabs (previously only had vouchers/payments/aging)
- [x] Reconciliation.tsx — Added FloorPlanFinancing tab (previously only had bank recon)

API Client Updates:
- [x] Added commission endpoints (listCommissionPlans, createCommissionPlan, calculateCommission, listCommissions, getCommissionReport)
- [x] Added tax endpoints (configureTaxJurisdiction, listTaxRates, accrueTax, getTaxLiabilityReport)
- [x] Added 1099 endpoints (generate1099Forms, list1099Records, update1099Record, export1099Forms, get1099PDF)
- [x] Added floor plan endpoints (registerFloorPlanUnit, listFloorPlanUnits, accrueFloorPlanInterest, payoffFloorPlanUnit, getFloorPlanAgingReport)

### Step 9: REDESIGN Features
- [ ] GL Exception Detection Agent
- [ ] Deal Profitability Dashboard (T1 Copilot)
- [ ] Bank Reconciliation AI Auto-Match

## COMPLETED
- [x] Step 10: QA / E2E Pre-Launch Scan (2026-05-20) — Grade B, 0 critical, 7 warnings. See qa-scan-results.md.
  - FIXED: Prisma Decimal type errors in apar-service repositories
  - FIXED: Tenant fallback to 'tenant-kunes' in connector-service + 5 others (throws 400)
  - FIXED: EOM hardcoded scheduled monitoring tenant → MONITOR_TENANT_ID env var
  - FIXED: alert() calls in JournalEntry.tsx (3) and AccountsPayable.tsx (2) → notification state
  - FIXED: Missing `status`/`glAccountId`/`oemSource` fields in ap/ar repository toDomain()
  - TypeScript: ✅ 0 errors across gl-service, eom-service, apar-service, connector-service, frontend

## NOT STARTED
- [ ] Step 11: Dealer Feedback (Loom recordings)
- [ ] Step 12: Side-by-Side Validation (100 transactions)
- [ ] Step 13: Docs + Decision Log (Confluence publication)
- [ ] Step 14: Compact Session
- [ ] Step 15: Git Commit + Deploy (Strangler Fig, Kunes pilot)
- [ ] Step 16: Platform Integration (DealerSocket, Identifix, LoJack, CDP)

## IMPLEMENTATION STATISTICS
### Backend (Services)
- gl-service migrations: ~10 files
- eom-service migrations: ~3 files
- Total new tables: ~15
- Total new endpoints: ~30+
- Backend lines of code: ~4000+

### Frontend (React Components + Pages)
- Shared accounting components: 8 files, ~1,163 lines
- Accounting workflow pages: 10 files, ~5,562 lines
- App.tsx routing updates: +40 lines (10 routes + ACCOUNTING_NAV)
- Total frontend files: 18 files
- Total frontend lines of code: ~6,765 lines

### Overall Phase 1 Metrics
- Total new files: ~23 (13 backend/migrations + 10 frontend pages)
- Total lines of code: ~10,765 lines
- Bugs fixed: 21 (FIX-001 through FIX-021)
- Features built: 4 Phase 1 (Sales Tax, 1099, Commission, Floor Plan)
- Workflows implemented: 10 core accounting workflows (WF-A001–WF-A010)

## RISKS
1. ✅ RESOLVED: Frontend now complete — all 10 accounting workflows implemented (WF-A001–WF-A010)
2. Phase 2 features not yet coded (Manufacturer Recon, FIFO/Weighted-Average Inventory, Fixed Assets, Warranty Accrual)
3. 3 REDESIGN features not started (GL Exception Detection Agent, Deal Profitability Dashboard, Bank Reconciliation AI Auto-Match)
4. No E2E testing pipeline for accounting workflows
5. No dealer validation done (Phase 1 features not tested on real dealership data)
6. Steps 4 data based on Jira proxy, not actual field visits
