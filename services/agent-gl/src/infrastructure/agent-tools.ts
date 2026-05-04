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
const APPROVAL_SERVICE_URL = process.env['APPROVAL_SERVICE_URL'] ?? 'http://approval-service:3033';

/**
 * HTTP-backed IAgentWriteTools for the GL Integrity Agent.
 *
 * Implements the five methods the agent's tool executor actually calls.
 * Remaining interface methods throw — they are never invoked by this agent.
 */
export class GLAgentTools implements IAgentWriteTools {
  private _tenantId: TenantId;

  constructor(tenantId: TenantId) {
    this._tenantId = tenantId;
  }

  setTenantId(tenantId: TenantId): void {
    this._tenantId = tenantId;
  }

  // ── Methods used by GL integrity agent ─────────────────────────────────────

  async getJournalEntries(_tenantId: TenantId, filters: EntryFilters): Promise<JournalEntry[]> {
    const params = new URLSearchParams();
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom instanceof Date ? filters.dateFrom.toISOString() : String(filters.dateFrom));
    if (filters.status) params.set('status', filters.status);
    if (filters.source) params.set('source', filters.source);
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.offset) params.set('offset', String(filters.offset));

    const qs = params.toString();
    const res = await fetch(
      `${GL_SERVICE_URL}/api/v1/gl/journal-entries${qs ? `?${qs}` : ''}`,
      { headers: { 'x-tenant-id': this._tenantId } },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`getJournalEntries failed (${res.status}): ${text}`);
    }
    return res.json() as Promise<JournalEntry[]>;
  }

  async getGLAccounts(_tenantId: TenantId): Promise<GLAccount[]> {
    const res = await fetch(
      `${GL_SERVICE_URL}/api/v1/gl/accounts`,
      { headers: { 'x-tenant-id': this._tenantId } },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`getGLAccounts failed (${res.status}): ${text}`);
    }
    return res.json() as Promise<GLAccount[]>;
  }

  async getTrialBalance(_tenantId: TenantId, period: Period): Promise<TrialBalance> {
    const res = await fetch(
      `${GL_SERVICE_URL}/api/v1/gl/trial-balance?year=${period.year}&month=${period.month}`,
      { headers: { 'x-tenant-id': this._tenantId } },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`getTrialBalance failed (${res.status}): ${text}`);
    }
    return res.json() as Promise<TrialBalance>;
  }

  async postJournalEntry(entryId: string): Promise<void> {
    const res = await fetch(
      `${GL_SERVICE_URL}/api/v1/gl/journal-entries/${encodeURIComponent(entryId)}/approve`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': this._tenantId,
          'x-user-id': 'agent-gl',
        },
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`postJournalEntry failed (${res.status}): ${text}`);
    }
  }

  async flagForHumanReview(entity: EntityRef, reason: string, severity: Severity): Promise<void> {
    const res = await fetch(
      `${APPROVAL_SERVICE_URL}/api/v1/approvals/request`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': this._tenantId,
        },
        body: JSON.stringify({
          agentName: 'gl-integrity',
          actionType: 'FLAG_ANOMALY',
          entityRef: `${entity.entityType}:${entity.entityId}`,
          reasoning: reason,
          evidence: [`severity: ${severity}`],
          requiredRole: 'AGENT_APPROVER',
          timeoutMinutes: 60,
        }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`flagForHumanReview failed (${res.status}): ${text}`);
    }
  }

  // ── Not used by GL agent — satisfy interface ───────────────────────────────

  async getPayrollBatch(_batchId: string): Promise<PayrollBatch> {
    throw new Error('getPayrollBatch not implemented in GLAgentTools');
  }

  async getEOMSteps(_closeId: string): Promise<EOMStep[]> {
    throw new Error('getEOMSteps not implemented in GLAgentTools');
  }

  async getFSPreview(_tenantId: TenantId, _period: Period, _oem: OEMType): Promise<FSDocument> {
    throw new Error('getFSPreview not implemented in GLAgentTools');
  }

  async getPendingApprovals(_tenantId: TenantId): Promise<PendingAgentAction[]> {
    throw new Error('getPendingApprovals not implemented in GLAgentTools');
  }

  async getEOMReadiness(_tenantId: TenantId, _period: Period): Promise<EOMReadinessReport> {
    throw new Error('getEOMReadiness not implemented in GLAgentTools');
  }

  async holdPayrollBatch(_batchId: string, _reason: string): Promise<void> {
    throw new Error('holdPayrollBatch not implemented in GLAgentTools');
  }

  async advanceEOMStep(_closeId: string, _stepCode: string): Promise<void> {
    throw new Error('advanceEOMStep not implemented in GLAgentTools');
  }

  async createJournalEntry(_tenantId: TenantId, _lines: CreateJournalLineDTO[]): Promise<string> {
    throw new Error('createJournalEntry not implemented in GLAgentTools');
  }

  async requestApproval(_action: PendingAgentAction): Promise<string> {
    throw new Error('requestApproval not implemented in GLAgentTools');
  }
}
