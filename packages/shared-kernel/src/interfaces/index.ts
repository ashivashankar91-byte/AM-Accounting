import {
  TenantId,
  TenantContext,
  GLAccount,
  JournalEntry,
  EntryFilters,
  TrialBalance,
  PayrollBatch,
  EOMStep,
  Period,
  EntityRef,
  Severity,
  ValidationResult,
  AgentResult,
  AuditEntry,
  AnthropicTool,
  ToolExecutor,
  CanonicalDealPost,
  CanonicalGLAccount,
  FSDocument,
  FSValidationResult,
  FSSubmissionResult,
  FSMappingValidationResult,
  OEMType,
  OEMCredentials,
  StepResult,
  CreateJournalEntryDTO,
  CreateJournalLineDTO,
  JournalLine,
  JournalStatus,
  DMSType,
  DMSConnectionConfig,
  EOMCloseType,
  UserRole,
  UserId,
  PendingAgentAction,
  ApprovalRequest,
  EOMReadinessReport,
  LegacyGLAccount,
  LegacyMappingResult,
  UnmappedGLWarning,
  StandardChartOfAccounts,
  OEMMapping,
} from '../types';
import { DomainEvent } from '../events';

// ── Agent Interfaces ───────────────────────────────────

export interface IAgentReadTools {
  getGLAccounts(tenantId: TenantId): Promise<GLAccount[]>;
  getJournalEntries(tenantId: TenantId, filters: EntryFilters): Promise<JournalEntry[]>;
  getTrialBalance(tenantId: TenantId, period: Period): Promise<TrialBalance>;
  getPayrollBatch(batchId: string): Promise<PayrollBatch>;
  getEOMSteps(closeId: string): Promise<EOMStep[]>;
  getFSPreview(tenantId: TenantId, period: Period, oem: OEMType): Promise<FSDocument>;
  getPendingApprovals(tenantId: TenantId): Promise<PendingAgentAction[]>;
  getEOMReadiness(tenantId: TenantId, period: Period): Promise<EOMReadinessReport>;
}

export interface IAgentWriteTools extends IAgentReadTools {
  postJournalEntry(entryId: string): Promise<void>;
  holdPayrollBatch(batchId: string, reason: string): Promise<void>;
  advanceEOMStep(closeId: string, stepCode: string): Promise<void>;
  flagForHumanReview(entity: EntityRef, reason: string, severity: Severity): Promise<void>;
  createJournalEntry(tenantId: TenantId, lines: CreateJournalLineDTO[]): Promise<string>;
  requestApproval(action: PendingAgentAction): Promise<string>;
}

// ── Claude Client Interface ────────────────────────────

export interface IClaudeClient {
  runWithTools(
    systemPrompt: string,
    userMessage: string,
    tools: AnthropicTool[],
    toolExecutor: ToolExecutor,
  ): Promise<AgentResult>;

  streamWithTools(
    systemPrompt: string,
    userMessage: string,
    tools: AnthropicTool[],
    toolExecutor: ToolExecutor,
    onChunk: (chunk: string) => void,
  ): Promise<AgentResult>;
}

// ── Event Publisher Interface ──────────────────────────

export interface IEventPublisher {
  connect?(): Promise<void>;
  publish(event: DomainEvent): Promise<void>;
  publishBatch?(events: DomainEvent[]): Promise<void>;
  subscribe(eventType: string, handler: (event: DomainEvent) => Promise<void>): void;
}

// ── Repository Interfaces ──────────────────────────────

export interface IJournalRepository {
  findById(id: string, tenantId: TenantId): Promise<JournalEntry | null>;
  findBySourceRef(ref: string, tenantId: TenantId, since: Date): Promise<JournalEntry[]>;
  findByPeriod(tenantId: TenantId, period: Period): Promise<JournalEntry[]>;
  findAll(tenantId: TenantId, filters: EntryFilters): Promise<JournalEntry[]>;
  create(entry: CreateJournalEntryDTO, tenantId: TenantId): Promise<JournalEntry>;
  setPendingReview(id: string, tenantId: TenantId): Promise<JournalEntry>;
  post(id: string, tenantId: TenantId, postedBy: string): Promise<JournalEntry>;
  hold(id: string, tenantId: TenantId, reason: string): Promise<JournalEntry>;
}

export interface IGLAccountRepository {
  findAll(tenantId: TenantId): Promise<GLAccount[]>;
  findById(id: string, tenantId: TenantId): Promise<GLAccount | null>;
  findByCode(code: string, tenantId: TenantId): Promise<GLAccount | null>;
  create(account: Omit<GLAccount, 'id'>, tenantId: TenantId): Promise<GLAccount>;
  update(id: string, data: Partial<GLAccount>, tenantId: TenantId): Promise<GLAccount>;
}

export interface ITenantRepository {
  findAll(): Promise<import('../types').Tenant[]>;
  findById(id: string): Promise<import('../types').Tenant | null>;
  findBySlug(slug: string): Promise<import('../types').Tenant | null>;
  create(data: Omit<import('../types').Tenant, 'id' | 'createdAt' | 'updatedAt'>): Promise<import('../types').Tenant>;
  update(id: string, data: Partial<import('../types').Tenant>): Promise<import('../types').Tenant>;
  softDelete(id: string): Promise<void>;
}

export interface IPayrollBatchRepository {
  findById(id: string, tenantId: TenantId): Promise<PayrollBatch | null>;
  findByIdempotencyKey(key: string, tenantId: TenantId, since: Date): Promise<PayrollBatch | null>;
  findAll(tenantId: TenantId): Promise<PayrollBatch[]>;
  create(data: Omit<PayrollBatch, 'id'>, tenantId: TenantId): Promise<PayrollBatch>;
  updateStatus(id: string, status: string, tenantId: TenantId, reason?: string): Promise<PayrollBatch>;
}

export interface IEOMCloseRepository {
  findById(id: string, tenantId: TenantId): Promise<import('../types').EOMClose | null>;
  findAll(tenantId: TenantId): Promise<import('../types').EOMClose[]>;
  create(data: Omit<import('../types').EOMClose, 'id' | 'steps'>, tenantId: TenantId): Promise<import('../types').EOMClose>;
  updateStatus(id: string, status: string, tenantId: TenantId): Promise<void>;
}

export interface IEOMStepRepository {
  findByCloseId(closeId: string): Promise<EOMStep[]>;
  updateStatus(id: string, status: string, errorMessage?: string): Promise<EOMStep>;
  incrementRetry(id: string): Promise<EOMStep>;
}

export interface IBankReconRepository {
  findById(id: string, tenantId: TenantId): Promise<import('../types').BankRecon | null>;
  findAll(tenantId: TenantId): Promise<import('../types').BankRecon[]>;
  create(data: Omit<import('../types').BankRecon, 'id'>, tenantId: TenantId): Promise<import('../types').BankRecon>;
  update(id: string, data: Partial<import('../types').BankRecon>, tenantId: TenantId): Promise<import('../types').BankRecon>;
}

export interface IBankTransactionRepository {
  findByReconId(reconId: string): Promise<import('../types').BankTransaction[]>;
  findUnmatched(reconId: string): Promise<import('../types').BankTransaction[]>;
  create(data: Omit<import('../types').BankTransaction, 'id'>): Promise<import('../types').BankTransaction>;
  createMany(data: Omit<import('../types').BankTransaction, 'id'>[]): Promise<number>;
  match(id: string, journalLineId: string): Promise<import('../types').BankTransaction>;
}

export interface IAREntryRepository {
  findAll(tenantId: TenantId): Promise<import('../types').AREntry[]>;
  create(data: Omit<import('../types').AREntry, 'id'>, tenantId: TenantId): Promise<import('../types').AREntry>;
  update(id: string, data: Partial<import('../types').AREntry>, tenantId: TenantId): Promise<import('../types').AREntry>;
}

export interface IAPEntryRepository {
  findAll(tenantId: TenantId): Promise<import('../types').APEntry[]>;
  create(data: Omit<import('../types').APEntry, 'id'>, tenantId: TenantId): Promise<import('../types').APEntry>;
  update(id: string, data: Partial<import('../types').APEntry>, tenantId: TenantId): Promise<import('../types').APEntry>;
}

// ── Audit Logger Interface ─────────────────────────────

export interface IAuditLogger {
  log(entry: AuditEntry): Promise<void>;
  getByTenant(tenantId: TenantId, limit?: number): Promise<import('../types').AgentLogEntry[]>;
  getById(id: string): Promise<import('../types').AgentLogEntry | null>;
  resolveHumanRequired(id: string): Promise<void>;
}

// ── DMS Adapter Interface ──────────────────────────────

export interface IDMSAdapter {
  normalise(rawPayload: unknown): CanonicalDealPost;
  getAdapterName(): string;
  getSupportedVersion(): string;
  validateConnection?(config: DMSConnectionConfig): Promise<boolean>;
}

// ── Financial Statement Formatter Interface ────────────

export interface IFSFormatter {
  format(trialBalance: TrialBalance, tenantContext: TenantContext): FSDocument;
  getOEM(): OEMType;
  validateBeforeSubmission(doc: FSDocument): FSValidationResult[];
  submit?(doc: FSDocument, credentials: OEMCredentials): Promise<FSSubmissionResult>;
}

// ── FS Line Mapper Interface ───────────────────────────

export interface IFSLineMapper {
  mapGLToFSLine(glAccount: CanonicalGLAccount, oem: OEMType, tenantId: TenantId): OEMMapping | null;
  validateMapping(trialBalance: TrialBalance, oem: OEMType, tenantId: TenantId): FSMappingValidationResult[];
  getUnmappedAccounts(tenantId: TenantId, oem: OEMType): Promise<CanonicalGLAccount[]>;
}

// ── Legacy GL Mapper (onboarding) ──────────────────────

export interface ILegacyGLMapper {
  mapLegacyGL(legacyAccountNo: string, dmsType: DMSType, tenantId: TenantId): CanonicalGLAccount | UnmappedGLWarning;
  bulkMap(legacyAccounts: LegacyGLAccount[], dmsType: DMSType, tenantId: TenantId): LegacyMappingResult;
}

// ── Validation Rule Interface ──────────────────────────

export interface IValidationRule<T> {
  validate(entity: T, context: TenantContext): ValidationResult;
  getRuleName(): string;
  getSeverity?(): Severity;
}

// ── EOM Step Handler Interface ─────────────────────────

export interface IEOMStepContext {
  closeId: string;
  tenantId: TenantId;
  period: Period;
  closeType: EOMCloseType;
  periodEnd: string;
  currentStep: EOMStep;
  getPreviousStepResult(stepCode: string): StepResult | null;
}

export interface IStepHandler {
  canHandle(stepCode: string): boolean;
  execute(context: IEOMStepContext): Promise<StepResult>;
}

// ── Approval Workflow Interface ────────────────────────

export interface IApprovalWorkflow {
  requestApproval(
    action: PendingAgentAction,
    requiredRole: UserRole,
    tenantId: TenantId,
    timeoutMinutes: number,
  ): Promise<ApprovalRequest>;

  processDecision(
    requestId: string,
    approverId: UserId,
    decision: 'APPROVE' | 'REJECT',
    note?: string,
  ): Promise<void>;

  getPending(tenantId: TenantId, role?: UserRole): Promise<ApprovalRequest[]>;
  getExpired(tenantId: TenantId): Promise<ApprovalRequest[]>;
}

// ── Notification Channel Interface ─────────────────────

export interface INotificationChannel {
  send(tenantId: TenantId, message: string, metadata: Record<string, unknown>): Promise<void>;
  getChannelName(): string;
}

// ── Pay Plan Calculator Interface ──────────────────────

export interface IPayPlanCalculator {
  calculate(earnings: number, plan: Record<string, unknown>): number;
  getPlanName(): string;
}

// ── Tenant Schema Manager Interface ────────────────────

export interface ITenantSchemaManager {
  provision(schemaName: string): Promise<void>;
  migrate(schemaName: string): Promise<void>;
  drop(schemaName: string): Promise<void>;
}

// ── CoA Repository Interface ───────────────────────────

export interface ICoARepository {
  getStandardCoA(version?: string): Promise<StandardChartOfAccounts>;
  getTenantCoA(tenantId: TenantId): Promise<CanonicalGLAccount[]>;
  getOEMMapping(tenantId: TenantId, oem: OEMType): Promise<OEMMapping[]>;
  getUnmappedAccounts(tenantId: TenantId, oem: OEMType): Promise<CanonicalGLAccount[]>;
  upsertAccount(account: CanonicalGLAccount, tenantId: TenantId): Promise<void>;
}

// ── Onboarding Service Interface ───────────────────────

export interface IOnboardingService {
  startOnboarding(tenantId: TenantId): Promise<import('../types').OnboardingSession>;
  getStatus(tenantId: TenantId): Promise<import('../types').OnboardingSession | null>;
  configureDMS(tenantId: TenantId, config: DMSConnectionConfig): Promise<void>;
  configureOEM(tenantId: TenantId, oems: OEMType[]): Promise<void>;
  setupCoA(tenantId: TenantId, useStandard: boolean, legacyAccounts?: LegacyGLAccount[]): Promise<LegacyMappingResult | null>;
  importHistory(tenantId: TenantId, months: number): Promise<{ jobId: string }>;
  completeOnboarding(tenantId: TenantId): Promise<void>;
}
