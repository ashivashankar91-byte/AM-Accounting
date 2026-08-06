/**
 * CE-17 — Domain ports.
 *
 * The application layer talks to these, never to Prisma or fetch. The
 * upstream adapters whose contracts are not yet technically reconciled
 * (CE-09, CE-11..CE-14) satisfy their port with a truthful "unavailable"
 * answer — which the policy gates then treat as a refusal, not a pass.
 */

export const PENDING_UPSTREAM = 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION' as const;

export type UpstreamStatus = 'AVAILABLE' | typeof PENDING_UPSTREAM | 'NOT_CONFIGURED';

export interface UpstreamSignal {
  moduleCode: string;
  status: UpstreamStatus;
  detail: string;
}

// ── CE-15 close readiness ────────────────────────────────────────────────────

export interface ICloseReadinessClient {
  /**
   * Returns true when closed, false when open, and null when the answer could
   * not be obtained. null is deliberately distinct from false: an unknown
   * period is refused, never assumed open.
   */
  isPeriodClosed(tenantId: string, legalEntityId: string, year: number, month: number): Promise<boolean | null>;
}

// ── CE-16 migration baseline ─────────────────────────────────────────────────

export interface IMigrationBaselineClient {
  hasApprovedBaseline(tenantId: string, legalEntityId: string): Promise<boolean>;
  describe(tenantId: string, legalEntityId: string): Promise<UpstreamSignal>;
}
// ── CE-07 governed posting ───────────────────────────────────────────────────

export interface CanonicalEventLine {
  accountCode: string;
  debit: string;
  credit: string;
  memo?: string;
}

export interface CanonicalEventEnvelope {
  legalEntityId: string;
  sourceEntityType: string;
  sourceEntityId: string;
  idempotencyIdentity: string;
  businessDate: string;
  journalFamily: string;
  memo: string;
  lines: CanonicalEventLine[];
  originalJournalRef?: string | null;
}

export interface PostingResult {
  status: 'POSTED' | 'REJECTED' | typeof PENDING_UPSTREAM;
  postingExecutionId: string | null;
  journalEntryId: string | null;
  reason?: string;
}

export interface IPostingClient {
  post(tenantId: string, envelope: CanonicalEventEnvelope): Promise<PostingResult>;
}

// ── CE-07/CE-02 account mapping ──────────────────────────────────────────────

export interface IAccountMappingClient {
  /** null when the mapping service could not be consulted. */
  isMappingComplete(tenantId: string, legalEntityId: string, capabilityCode: string): Promise<boolean | null>;
}

// ── Domain adapters not yet technically reconciled ───────────────────────────

export interface IAparAdapter {
  getOpenArItems(tenantId: string, legalEntityId: string): Promise<{ signal: UpstreamSignal; items: any[] }>;
  getOpenApItems(tenantId: string, legalEntityId: string): Promise<{ signal: UpstreamSignal; items: any[] }>;
}

export interface IFixedOpsAdapter {
  getPartsMovements(tenantId: string, legalEntityId: string, year: number, month: number): Promise<{ signal: UpstreamSignal; items: any[] }>;
}

export interface IVehicleDealAdapter {
  getDeliveries(tenantId: string, legalEntityId: string, programRef: string): Promise<{ signal: UpstreamSignal; items: any[] }>;
  /** Cohort experience for the chargeback model and portfolio allocation. */
  getDealCohorts(tenantId: string, legalEntityId: string, from: Date, to: Date): Promise<{ signal: UpstreamSignal; cohorts: any[] }>;
}

export interface IPayrollAdapter {
  getPayrollData(tenantId: string, legalEntityId: string, year: number, month: number): Promise<{ signal: UpstreamSignal; items: any[] }>;
  /** DSAR subject scan across payroll-held personal data. */
  getEmployeeRecords(tenantId: string, subjectIdentifier: string): Promise<{ signal: UpstreamSignal; items: any[] }>;
}

export interface IOemAdapter {
  getOemStatements(tenantId: string, legalEntityId: string): Promise<{ signal: UpstreamSignal; items: any[] }>;
  /** An S101A reconciliation session, with its statement lines and book items. */
  getStatementSession(tenantId: string, sessionId: string): Promise<{ signal: UpstreamSignal; session: any | null }>;
  getIncentivePrograms(tenantId: string, legalEntityId: string): Promise<{ signal: UpstreamSignal; items: any[] }>;
}

export interface IUpstreamRegistry {
  allSignals(): Promise<UpstreamSignal[]>;
}

// ── Events ───────────────────────────────────────────────────────────────────

export interface IAutomationEventPublisher {
  publish(tenantId: string, aggregateId: string, eventType: string, payload: Record<string, unknown>): Promise<void>;
}
