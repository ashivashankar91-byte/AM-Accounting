// ── Branded Types ──────────────────────────────────────
export type TenantId = string & { readonly __brand: 'TenantId' };
export type AccountId = string & { readonly __brand: 'AccountId' };
export type EntryId = string & { readonly __brand: 'EntryId' };
export type UserId = string & { readonly __brand: 'UserId' };

export function asTenantId(id: string): TenantId {
  return id as TenantId;
}
export function asUserId(id: string): UserId {
  return id as UserId;
}

// ── User Roles ─────────────────────────────────────────
export type UserRole =
  | 'DEALER_ACCOUNTANT'
  | 'GROUP_CONTROLLER'
  | 'PLATFORM_ADMIN'
  | 'AGENT_APPROVER';

// ── Money ──────────────────────────────────────────────
export interface Money {
  readonly amount: number; // In cents — never floating point
  readonly currency: 'USD';
}

export interface MoneyRange {
  min: Money;
  max: Money;
}

export function money(amountCents: number, currency: 'USD' = 'USD'): Money {
  return { amount: Math.round(amountCents), currency };
}

// ── Period — supports 13th month ───────────────────────
export type StandardPeriod = {
  year: number;
  month: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  is13th: false;
};

export type ThirteenthMonthPeriod = {
  year: number;
  month: 12;
  is13th: true;
};

export type Period = StandardPeriod | ThirteenthMonthPeriod;

export function periodKey(p: Period): string {
  const suffix = 'is13th' in p && p.is13th ? '-13' : '';
  return `${p.year}-${String(p.month).padStart(2, '0')}${suffix}`;
}

export function standardPeriod(year: number, month: number): Period {
  return { year, month: month as StandardPeriod['month'], is13th: false };
}

// ── OEM & DMS Types ────────────────────────────────────
export type OEMType =
  | 'GM' | 'FORD' | 'FCA' | 'TOYOTA'
  | 'HONDA' | 'NISSAN' | 'BMW' | 'MERCEDES'
  | 'HYUNDAI' | 'KIA' | 'OTHER';

export enum DMSType {
  AUTOMATE = 'AUTOMATE',
  CDK = 'CDK',
  REYNOLDS = 'REYNOLDS',
  DEALERTRACK = 'DEALERTRACK',
  OTHER = 'OTHER',
}

// ── Enums ──────────────────────────────────────────────
export type EOMCloseType = 'MONTHLY' | 'YEAR_END' | '13TH_MONTH' | 'ACCOUNTING_EOM';

export enum GLAccountType {
  ASSET = 'ASSET',
  LIABILITY = 'LIABILITY',
  EQUITY = 'EQUITY',
  REVENUE = 'REVENUE',
  EXPENSE = 'EXPENSE',
  COST_OF_SALES = 'COST_OF_SALES',
  DISTRIBUTION = 'DISTRIBUTION', // @cobol-origin GL-TYPE='%' — splits amount across sub-accounts by percentage
}

export type FSCategory =
  | 'CASH' | 'RECEIVABLES' | 'INVENTORY' | 'FIXED_ASSETS'
  | 'CURRENT_LIABILITIES' | 'LONG_TERM_LIABILITIES'
  | 'NET_WORTH' | 'REVENUE' | 'EXPENSE' | 'PROFIT_LOSS';

export type TransactionType =
  | 'VEHICLE_SALE' | 'PARTS_SALE' | 'SERVICE_LABOR'
  | 'WARRANTY_CLAIM' | 'CASH_RECEIPT' | 'ACCOUNTS_PAYABLE'
  | 'PAYROLL' | 'JOURNAL_ENTRY' | 'ADJUSTMENT' | 'YEAR_END';

export enum JournalStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  PENDING_REVIEW = 'PENDING_REVIEW',
  POSTED = 'POSTED',
  HELD = 'HELD',
  REVERSED = 'REVERSED',
}

export enum EOMCloseStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  BLOCKED = 'BLOCKED',
}

export enum EOMStepStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  DONE = 'DONE',
  BLOCKED = 'BLOCKED',
  SKIPPED = 'SKIPPED',
}

export enum PayrollBatchStatus {
  PENDING = 'PENDING',
  VALIDATED = 'VALIDATED',
  POSTED = 'POSTED',
  REJECTED = 'REJECTED',
  HELD = 'HELD',
}

export enum BankTransactionStatus {
  UNMATCHED = 'UNMATCHED',
  MATCHED = 'MATCHED',
  DISPUTED = 'DISPUTED',
}

export enum ReconStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

export enum AREntryType {
  WARRANTY = 'WARRANTY',
  FLOORPLAN = 'FLOORPLAN',
  RECEIVABLE = 'RECEIVABLE',
}

export enum Severity {
  INFO = 'INFO',
  WARN = 'WARN',
  CRITICAL = 'CRITICAL',
}

export enum TenantStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  PROVISIONING = 'PROVISIONING',
  ONBOARDING = 'ONBOARDING',
  DELETED = 'DELETED',
}

// ── Agent Action Types ─────────────────────────────────
export type AgentActionType =
  | 'POST_JOURNAL_ENTRY'
  | 'HOLD_PAYROLL_BATCH'
  | 'ADVANCE_EOM_STEP'
  | 'CREATE_ADJUSTMENT'
  | 'FLAG_ANOMALY';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'AUTO_RESOLVED';

// ── Canonical GL Account (OEM-mapped) ──────────────────
export interface OEMMapping {
  accountCode: string;
  lineNumber: number;
  pageNumber: number;
  required: boolean;
  fsCategory: FSCategory;
  validationRules?: string[];
}

export interface CanonicalGLAccount {
  amaccCode: string;
  standardName: string;
  accountType: GLAccountType;
  normalBalance: 'DEBIT' | 'CREDIT';
  fsCategory: FSCategory;
  oemMappings: Partial<Record<OEMType, OEMMapping>>;
  allowedTransactionTypes: TransactionType[];
  isSystemAccount: boolean;
}

export interface StandardChartOfAccounts {
  version: string;
  effectiveDate: Date;
  accounts: CanonicalGLAccount[];
  oemCoverage: OEMType[];
}

// ── Financial Statement ────────────────────────────────
export interface FSLine {
  lineNumber: number;
  accountCode: string;
  label: string;
  amount: Money;
  units?: number;
  pageNumber: number;
}

export interface FSPage {
  pageNumber: number;
  title: string;
  lines: FSLine[];
}

export interface AgentAnnotation {
  lineNumber: number;
  accountCode: string;
  severity: Severity;
  message: string;
  suggestedAction?: string;
  autoResolvable: boolean;
  requiresHumanApproval: boolean;
}

export interface FSDocument {
  oem: OEMType;
  tenantId: TenantId;
  period: Period;
  dealerCode: string;
  pages: FSPage[];
  lines: FSLine[];
  agentAnnotations: AgentAnnotation[];
  submissionStatus: 'DRAFT' | 'PREVIEW_READY' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED';
  submissionTimestamp?: Date;
  rejectionReason?: string;
  totalAssets: Money;
  totalLiabilities: Money;
  netWorth: Money;
  netProfit: Money;
}

export interface FSValidationResult {
  lineNumber: number;
  accountCode: string;
  message: string;
  severity: Severity;
}

export interface FSSubmissionResult {
  submissionId: string;
  accepted: boolean;
  rejectionReason?: string;
}

export interface FSMappingValidationResult {
  accountCode: string;
  issue: string;
  severity: Severity;
}

// ── Domain Models ──────────────────────────────────────
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  dmsType: DMSType;
  dmsApiKey: string;
  schemaName: string;
  status: TenantStatus;
  rooftopCount: number;
  oems: OEMType[];
  webhookUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GLAccount {
  id: string;
  tenantId: TenantId;
  code: string;
  name: string;
  type: GLAccountType;
  subType?: string;
  normalBalance: 'DEBIT' | 'CREDIT';
  allowPosting: boolean;
  scheduleCode?: string;
  glGroup?: string;
  parentId: string | null;
  isActive: boolean;
}

export interface JournalLine {
  id: string;
  journalEntryId: string;
  glAccountId: string;
  glAccountCode?: string;
  debit: number;
  credit: number;
  memo: string | null;
  transactionType?: TransactionType;
  sourceRef?: string;
  departmentCode?: string;
  technicianId?: string;
  roNumber?: string;
  roLineNumber?: number;
  flatRateHours?: number;
  clockHours?: number;
  partNumber?: string;
  partQuantity?: number;
  earningCode?: string;
  dealProductCode?: string;
  dealNumber?: string;
  vehicleVin?: string;
  moduleSource?: string;
  laborType?: string;
  costType?: string;
  agentConfidence?: number;
}

export interface JournalEntry {
  id: string;
  tenantId: TenantId;
  period?: Period;
  entryDate: Date;
  description: string;
  source: string;
  sourceRef: string | null;
  postedBy: string | null;
  postedAt: Date | null;
  status: JournalStatus;
  agentReviewed: boolean;
  heldReason?: string;
  createdByUserId?: string;
  approvedByUserId?: string;
  approvedAt?: Date;
  priorPeriodAdjustment?: boolean;
  adjustmentReason?: string;
  lines: JournalLine[];
  dealProductLines?: DealProductLine[];
}

export interface EOMClose {
  id: string;
  tenantId: TenantId;
  periodYear: number;
  periodMonth: number;
  closeType: EOMCloseType;
  status: EOMCloseStatus;
  currentStep: string | null;
  startedAt: Date;
  completedAt: Date | null;
  blockedReason: string | null;
  steps: EOMStep[];
}

export interface EOMStep {
  id: string;
  eomCloseId: string;
  stepCode: string;
  stepName: string;
  status: EOMStepStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
  retryCount: number;
}

export interface PayrollBatch {
  id: string;
  tenantId: TenantId;
  batchRef: string;
  periodStart: Date;
  periodEnd: Date;
  totalAmount: number;
  status: PayrollBatchStatus;
  idempotencyKey: string;
  submittedAt: Date;
  postedAt: Date | null;
  heldReason: string | null;
  lines?: PayrollLine[];
}

export interface BankRecon {
  id: string;
  tenantId: TenantId;
  accountName: string;
  reconDate: Date;
  glBalance: number;
  bankBalance: number;
  variance: number;
  status: ReconStatus;
  lockedBy: string | null;
  lockedAt: Date | null;
}

export interface BankTransaction {
  id: string;
  bankReconId: string;
  transactionDate: Date;
  description: string;
  amount: number;
  matchedJournalLineId: string | null;
  status: BankTransactionStatus;
}

export interface AREntry {
  id: string;
  tenantId: TenantId;
  dealerRef: string;
  type: AREntryType;
  amount: number;
  dueDate: Date;
  status: string;
  oemSource: string | null;
}

export interface APEntry {
  id: string;
  tenantId: TenantId;
  vendorName: string;
  invoiceRef: string;
  amount: number;
  dueDate: Date;
  status: string;
  glAccountId: string | null;
}

export interface AgentLogEntry {
  id: string;
  tenantId: TenantId;
  agentName: string;
  triggerEvent: string;
  inputSummary: string;
  actionTaken: string;
  outcome: string;
  humanRequired: boolean;
  humanResolvedAt: Date | null;
  createdAt: Date;
}

// ── Pending Agent Action (approval workflow) ───────────
export interface PendingAgentAction {
  id: string;
  tenantId: TenantId;
  agentName: string;
  actionType: AgentActionType;
  entityRef: string;
  reasoning: string;
  evidence: string[];
  proposedAt: Date;
  expiresAt: Date;
  status: ApprovalStatus;
  approvedBy?: UserId;
  rejectedBy?: UserId;
  note?: string;
}

// ── EOM Readiness ──────────────────────────────────────
export interface EOMReadinessReport {
  ready: boolean;
  period: Period;
  checks: EOMReadinessCheck[];
}

export interface EOMReadinessCheck {
  name: string;
  passed: boolean;
  message: string;
  severity: Severity;
}

// ── DMS Connection ─────────────────────────────────────
export interface DMSConnectionConfig {
  apiUrl: string;
  apiKey: string;
  dmsType: DMSType;
}

// ── OEM Credentials ────────────────────────────────────
export interface OEMCredentials {
  oem: OEMType;
  dealerCode: string;
  username: string;
  password: string;
}

// ── Legacy GL Mapping (onboarding) ─────────────────────
export interface LegacyGLAccount {
  legacyCode: string;
  legacyName: string;
  dmsType: DMSType;
}

export interface UnmappedGLWarning {
  legacyCode: string;
  legacyName: string;
  reason: string;
}

export interface LegacyMappingResult {
  mapped: { legacy: LegacyGLAccount; canonical: CanonicalGLAccount }[];
  unmapped: UnmappedGLWarning[];
}

// ── Onboarding ─────────────────────────────────────────
export type OnboardingStep = 'DMS_CONFIG' | 'OEM_CONFIG' | 'COA_SETUP' | 'IMPORT_HISTORY' | 'FS_VALIDATION';
export type OnboardingStatus = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export interface OnboardingSession {
  id: string;
  tenantId: TenantId;
  currentStep: OnboardingStep;
  stepsCompleted: OnboardingStep[];
  status: OnboardingStatus;
  createdAt: Date;
  completedAt?: Date;
}

// ── DTOs & Contexts ────────────────────────────────────
export interface TenantContext {
  tenantId: TenantId;
  schemaName: string;
  dmsType: DMSType;
  oems?: OEMType[];
  userName?: string;
  userRole?: UserRole;
  dealerName?: string;
}

export interface EntityRef {
  entityType: string;
  entityId: string;
}

export interface CreateJournalEntryDTO {
  entryDate: Date;
  description: string;
  source: string;
  sourceRef?: string;
  createdByUserId?: string;
  priorPeriodAdjustment?: boolean;
  adjustmentReason?: string;
  lines: CreateJournalLineDTO[];
}

export interface CreateJournalLineDTO {
  glAccountId: string;
  debit: number;
  credit: number;
  memo?: string;
  departmentCode?: string;
  technicianId?: string;
  roNumber?: string;
  roLineNumber?: number;
  flatRateHours?: number;
  clockHours?: number;
  partNumber?: string;
  partQuantity?: number;
  earningCode?: string;
  dealProductCode?: string;
  dealNumber?: string;
  vehicleVin?: string;
  moduleSource?: string;
  laborType?: string;
  costType?: string;
}

export interface PayrollLine {
  id: string;
  payrollBatchId: string;
  employeeId: string;
  employeeName: string;
  departmentCode: string;
  earningCode: string;
  hours: number | null;
  rate: number | null;
  amount: number;
  technicianId: string | null;
  flatRateHours: number | null;
  roNumber: string | null;
}

export interface DealProductLine {
  id: string;
  journalEntryId: string;
  dealNumber: string;
  productType: string;
  productName: string;
  salePrice: number;
  dealerCost: number;
  grossProfit: number;
  providerName: string | null;
}

export interface CreatePayrollLineDTO {
  employeeId: string;
  employeeName: string;
  departmentCode: string;
  earningCode: string;
  hours?: number;
  rate?: number;
  amount: number;
  technicianId?: string;
  flatRateHours?: number;
  roNumber?: string;
}

export interface CreateDealProductLineDTO {
  dealNumber: string;
  productType: string;
  productName: string;
  salePrice: number;
  dealerCost: number;
  grossProfit: number;
  providerName?: string;
}

export interface EntryFilters {
  dateFrom?: Date;
  dateTo?: Date;
  status?: JournalStatus;
  source?: string;
  limit?: number;
  offset?: number;
}

export interface TrialBalance {
  period: Period;
  accounts: TrialBalanceRow[];
  totalDebits: number;
  totalCredits: number;
}

export interface TrialBalanceRow {
  accountCode: string;
  accountName: string;
  accountType: GLAccountType;
  debit: number;
  credit: number;
}

export interface ValidationResult {
  valid: boolean;
  ruleName: string;
  message: string;
  severity: Severity;
}

export interface StepResult {
  stepCode: string;
  success: boolean;
  message: string;
  nextStepCode?: string;
}

export interface AgentResult {
  agentName: string;
  actionTaken: string;
  outcome: string;
  humanRequired: boolean;
  details: Record<string, unknown>;
}

export interface AuditEntry {
  agentName: string;
  tenantId?: TenantId;
  actionTaken: string;
  outcome: string;
  humanRequired: boolean;
  details?: Record<string, unknown>;
}

export interface CanonicalDealPost {
  sourceSystem: DMSType;
  tenantId: TenantId;
  dealNumber: string;
  dealType: 'NEW' | 'USED' | 'LEASE' | 'FLEET' | 'WHOLESALE';
  oem: OEMType;
  vehicleVin: string;
  vehicleStockNo?: string;
  customerName: string;
  dealDate: Date;
  salePrice: Money;
  costOfSale: Money;
  grossProfit: Money;
  fiIncome: Money;
  tradeAllowance?: Money;
  journalLines: CreateJournalLineDTO[];
  financeSources: { name: string; amount: number }[];
  addOns: { description: string; price: number; cost: number }[];
  tradeIn?: { vin: string; allowance: number; payoff: number };
  rawPayload?: unknown;
}

// ── Anthropic Tool Types ───────────────────────────────
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ToolExecutor = (
  toolName: string,
  toolInput: Record<string, unknown>,
) => Promise<unknown>;

// ── Approval Request (returned by approval-service) ────
export interface ApprovalRequest {
  id: string;
  tenantId: TenantId;
  agentName: string;
  actionType: AgentActionType;
  entityRef: string;
  reasoning: string;
  evidence: string[];
  requiredRole: UserRole;
  status: ApprovalStatus;
  timeoutMinutes: number;
  proposedAt: Date;
  expiresAt: Date;
  decidedAt?: Date;
  decidedBy?: UserId;
  note?: string;
}

// ── Event Payload Types ───────────────────────────────

export interface ServiceRoClosedPayload {
  roNumber: string;
  tenantId: string;
  technicianId: string;
  laborLines: Array<{
    lineNumber: number;
    laborType: string;
    hours: number;
    rate: number;
    amount: number;
    technicianId: string;
  }>;
  partsLines: Array<{
    lineNumber: number;
    partNumber: string;
    quantity: number;
    cost: number;
    salePrice: number;
  }>;
  subletLines: Array<{
    description: string;
    amount: number;
    vendor: string;
  }>;
  totalLabor: number;
  totalParts: number;
}

export interface PartsInvoiceClosedPayload {
  invoiceNumber: string;
  tenantId: string;
  partLines: Array<{
    partNumber: string;
    quantity: number;
    cost: number;
    salePrice: number;
    departmentCode: string;
  }>;
  totalAmount: number;
}

export interface DealProductDetailPayload {
  dealNumber: string;
  tenantId: string;
  vehicleVin: string;
  products: Array<{
    productType: string;
    productName: string;
    salePrice: number;
    dealerCost: number;
    grossProfit: number;
    providerName?: string;
  }>;
}

export interface VehiclePurchasedPayload {
  vin: string;
  stockNo: string;
  tenantId: string;
  vendor: string;
  cost: number;
  floorplanSource: string;
  departmentCode: string;
}

export interface VehicleTransferredPayload {
  vin: string;
  fromTenantId: string;
  toTenantId: string;
  bookValue: number;
}

export interface PayrollLinesSubmittedPayload {
  batchRef: string;
  tenantId: string;
  lines: Array<{
    employeeId: string;
    employeeName: string;
    earningCode: string;
    hours: number | null;
    rate: number | null;
    amount: number;
    departmentCode: string;
    technicianId: string | null;
    flatRateHours: number | null;
    roNumber: string | null;
  }>;
}

export interface FinanceChargePostedPayload {
  tenantId: string;
  accountId: string;
  customerId: string;
  amount: number;
  chargeType: string;
}

export interface CreditCardBatchSettledPayload {
  batchNo: string;
  tenantId: string;
  merchant: string;
  lines: Array<{
    amount: number;
    type: string;
    settlementDate: string;
  }>;
}

export interface CashReceiptDetailedPayload {
  receiptNumber: string;
  tenantId: string;
  lines: Array<{
    customerId: string;
    amount: number;
    glAccountCode: string;
    paymentMethod: string;
    ref: string;
  }>;
}

export interface YearEndClosePostedPayload {
  tenantId: string;
  closingLines: Array<{
    glAccountCode: string;
    debit: number;
    credit: number;
    departmentCode: string;
  }>;
}

export interface AmdbDropmateImportedPayload {
  tenantId: string;
  transactionLines: Array<{
    glAccountCode: string;
    debit: number;
    credit: number;
    description: string;
    moduleSource: string;
  }>;
}

export interface TechHoursReconciledPayload {
  technicianId: string;
  tenantId: string;
  period: string;
  payrollHours: number;
  billedHours: number;
  variance: number;
  roNumbers: string[];
}

export interface DepartmentPlReadyPayload {
  tenantId: string;
  period: string;
  departmentCode: string;
  revenue: number;
  costOfSales: number;
  grossProfit: number;
  expenses: number;
  netIncome: number;
}
