import {
  IAgentWriteTools,
  TenantId,
  GLAccount,
  JournalEntry,
  EntryFilters,
  TrialBalance,
  PayrollBatch,
  EOMStep,
  Period,
  OEMType,
  FSDocument,
  PendingAgentAction,
  EOMReadinessReport,
  EntityRef,
  Severity,
  CreateJournalLineDTO,
} from '@amacc/shared-kernel';

const GL_SERVICE_URL = process.env['GL_SERVICE_URL'] ?? 'http://gl-service:3010';
const EOM_SERVICE_URL = process.env['EOM_SERVICE_URL'] ?? 'http://eom-service:3011';
const PAYROLL_SERVICE_URL = process.env['PAYROLL_SERVICE_URL'] ?? 'http://payroll-service:3012';
const FS_SERVICE_URL = process.env['FS_SERVICE_URL'] ?? 'http://fs-service:3015';
const APPROVAL_SERVICE_URL = process.env['APPROVAL_SERVICE_URL'] ?? 'http://approval-service:3033';

/**
 * HTTP-backed IAgentWriteTools for the T1 Copilot Agent.
 *
 * Implements all 13 tools that the T1 copilot's tool executor calls.
 * T1 is instantiated per-request, so tenantId is set once in constructor.
 */
export class T1AgentTools implements IAgentWriteTools {
  constructor(private readonly tenantId: TenantId) {}

  // ── Read tools ─────────────────────────────────────────────────────────────

  async getGLAccounts(_tenantId: TenantId): Promise<GLAccount[]> {
    const res = await fetch(`${GL_SERVICE_URL}/api/v1/gl/accounts`, {
      headers: { 'x-tenant-id': this.tenantId },
    });
    if (!res.ok) throw new Error(`getGLAccounts failed (${res.status})`);
    return res.json() as Promise<GLAccount[]>;
  }

  async getJournalEntries(_tenantId: TenantId, filters: EntryFilters): Promise<JournalEntry[]> {
    const params = new URLSearchParams();
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom instanceof Date ? filters.dateFrom.toISOString() : String(filters.dateFrom));
    if (filters.dateTo) params.set('dateTo', filters.dateTo instanceof Date ? filters.dateTo.toISOString() : String(filters.dateTo));
    if (filters.status) params.set('status', filters.status);
    if (filters.source) params.set('source', filters.source);
    if (filters.limit) params.set('limit', String(filters.limit));
    const qs = params.toString();
    const res = await fetch(`${GL_SERVICE_URL}/api/v1/gl/journal-entries${qs ? `?${qs}` : ''}`, {
      headers: { 'x-tenant-id': this.tenantId },
    });
    if (!res.ok) throw new Error(`getJournalEntries failed (${res.status})`);
    return res.json() as Promise<JournalEntry[]>;
  }

  async getTrialBalance(_tenantId: TenantId, period: Period): Promise<TrialBalance> {
    const res = await fetch(`${GL_SERVICE_URL}/api/v1/gl/trial-balance?year=${period.year}&month=${period.month}`, {
      headers: { 'x-tenant-id': this.tenantId },
    });
    if (!res.ok) throw new Error(`getTrialBalance failed (${res.status})`);
    return res.json() as Promise<TrialBalance>;
  }

  async getPayrollBatch(batchId: string): Promise<PayrollBatch> {
    const res = await fetch(`${PAYROLL_SERVICE_URL}/api/v1/payroll/batches/${encodeURIComponent(batchId)}`, {
      headers: { 'x-tenant-id': this.tenantId },
    });
    if (!res.ok) throw new Error(`getPayrollBatch failed (${res.status})`);
    return res.json() as Promise<PayrollBatch>;
  }

  async getEOMSteps(closeId: string): Promise<EOMStep[]> {
    const res = await fetch(`${EOM_SERVICE_URL}/api/v1/eom/${encodeURIComponent(closeId)}/steps`, {
      headers: { 'x-tenant-id': this.tenantId },
    });
    if (!res.ok) throw new Error(`getEOMSteps failed (${res.status})`);
    return res.json() as Promise<EOMStep[]>;
  }

  async getFSPreview(_tenantId: TenantId, period: Period, oem: OEMType): Promise<FSDocument> {
    const periodStr = `${period.year}-${String(period.month).padStart(2, '0')}`;
    const res = await fetch(`${FS_SERVICE_URL}/api/v1/fs/preview/${encodeURIComponent(this.tenantId)}/${periodStr}/${oem}`, {
      headers: { 'x-tenant-id': this.tenantId },
    });
    if (!res.ok) throw new Error(`getFSPreview failed (${res.status})`);
    return res.json() as Promise<FSDocument>;
  }

  async getPendingApprovals(_tenantId: TenantId): Promise<PendingAgentAction[]> {
    const res = await fetch(`${APPROVAL_SERVICE_URL}/api/v1/approvals/pending/${encodeURIComponent(this.tenantId)}`, {
      headers: { 'x-tenant-id': this.tenantId },
    });
    if (!res.ok) throw new Error(`getPendingApprovals failed (${res.status})`);
    return res.json() as Promise<PendingAgentAction[]>;
  }

  async getEOMReadiness(_tenantId: TenantId, _period: Period): Promise<EOMReadinessReport> {
    // EOM readiness approximated by listing closes for the tenant
    const res = await fetch(`${EOM_SERVICE_URL}/api/v1/eom`, {
      headers: { 'x-tenant-id': this.tenantId },
    });
    if (!res.ok) throw new Error(`getEOMReadiness failed (${res.status})`);
    const closes = await res.json() as any[];
    return { ready: closes.length > 0 && closes[0]?.status !== 'BLOCKED', period: _period, checks: [] } as EOMReadinessReport;
  }

  // ── Write tools ────────────────────────────────────────────────────────────

  async postJournalEntry(entryId: string): Promise<void> {
    const res = await fetch(`${GL_SERVICE_URL}/api/v1/gl/journal-entries/${encodeURIComponent(entryId)}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': this.tenantId, 'x-user-id': 'agent-t1' },
    });
    if (!res.ok) throw new Error(`postJournalEntry failed (${res.status})`);
  }

  async holdPayrollBatch(batchId: string, reason: string): Promise<void> {
    const res = await fetch(`${PAYROLL_SERVICE_URL}/api/v1/payroll/batches/${encodeURIComponent(batchId)}/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': this.tenantId },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) throw new Error(`holdPayrollBatch failed (${res.status})`);
  }

  async createJournalEntry(_tenantId: TenantId, lines: CreateJournalLineDTO[]): Promise<string> {
    const res = await fetch(`${GL_SERVICE_URL}/api/v1/gl/journal-entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': this.tenantId },
      body: JSON.stringify({
        entryDate: new Date().toISOString().split('T')[0],
        description: 'T1 Copilot — agent-generated entry',
        source: 'AGENT_T1',
        lines,
      }),
    });
    if (!res.ok) throw new Error(`createJournalEntry failed (${res.status})`);
    const entry = await res.json() as { id: string };
    return entry.id;
  }

  async advanceEOMStep(closeId: string, _stepCode: string): Promise<void> {
    const res = await fetch(`${EOM_SERVICE_URL}/api/v1/eom/${encodeURIComponent(closeId)}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': this.tenantId },
    });
    if (!res.ok) throw new Error(`advanceEOMStep failed (${res.status})`);
  }

  async requestApproval(action: PendingAgentAction): Promise<string> {
    const res = await fetch(`${APPROVAL_SERVICE_URL}/api/v1/approvals/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': this.tenantId },
      body: JSON.stringify({
        agentName: 't1-copilot',
        actionType: action.actionType,
        entityRef: action.entityRef,
        reasoning: action.reasoning,
        evidence: action.evidence,
        requiredRole: 'AGENT_APPROVER',
        timeoutMinutes: 60,
      }),
    });
    if (!res.ok) throw new Error(`requestApproval failed (${res.status})`);
    const result = await res.json() as { id: string };
    return result.id;
  }

  async flagForHumanReview(entity: EntityRef, reason: string, severity: Severity): Promise<void> {
    const res = await fetch(`${APPROVAL_SERVICE_URL}/api/v1/approvals/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': this.tenantId },
      body: JSON.stringify({
        agentName: 't1-copilot',
        actionType: 'FLAG_ANOMALY',
        entityRef: `${entity.entityType}:${entity.entityId}`,
        reasoning: reason,
        evidence: [`severity: ${severity}`],
        requiredRole: 'AGENT_APPROVER',
        timeoutMinutes: 60,
      }),
    });
    if (!res.ok) throw new Error(`flagForHumanReview failed (${res.status})`);
  }
}
