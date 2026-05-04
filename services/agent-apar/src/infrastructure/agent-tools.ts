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
 * HTTP-backed IAgentWriteTools for the AP/AR Reconciliation Agent.
 *
 * Implements the four methods the agent's tool executor actually calls.
 * Remaining interface methods throw — they are never invoked by this agent.
 */
export class APARAgentTools implements IAgentWriteTools {
  private _tenantId: TenantId;

  constructor(tenantId: TenantId) {
    this._tenantId = tenantId;
  }

  setTenantId(tenantId: TenantId): void {
    this._tenantId = tenantId;
  }

  // ── Methods used by APAR recon agent ───────────────────────────────────────

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

  async getJournalEntries(_tenantId: TenantId, filters: EntryFilters): Promise<JournalEntry[]> {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.source) params.set('source', filters.source);
    if (filters.limit) params.set('limit', String(filters.limit));
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

  async createJournalEntry(_tenantId: TenantId, lines: CreateJournalLineDTO[]): Promise<string> {
    const res = await fetch(
      `${GL_SERVICE_URL}/api/v1/gl/journal-entries`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': this._tenantId,
        },
        body: JSON.stringify({
          entryDate: new Date().toISOString().split('T')[0],
          description: 'AP/AR Reconciliation — agent-generated',
          source: 'AGENT_APAR',
          lines,
        }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`createJournalEntry failed (${res.status}): ${text}`);
    }
    const entry = await res.json() as { id: string };
    return entry.id;
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
          agentName: 'apar-recon',
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

  // ── Not used by APAR agent — satisfy interface ─────────────────────────────

  async getTrialBalance(_tenantId: TenantId, _period: Period): Promise<TrialBalance> {
    throw new Error('getTrialBalance not implemented in APARAgentTools');
  }

  async getPayrollBatch(_batchId: string): Promise<PayrollBatch> {
    throw new Error('getPayrollBatch not implemented in APARAgentTools');
  }

  async getEOMSteps(_closeId: string): Promise<EOMStep[]> {
    throw new Error('getEOMSteps not implemented in APARAgentTools');
  }

  async getFSPreview(_tenantId: TenantId, _period: Period, _oem: OEMType): Promise<FSDocument> {
    throw new Error('getFSPreview not implemented in APARAgentTools');
  }

  async getPendingApprovals(_tenantId: TenantId): Promise<PendingAgentAction[]> {
    throw new Error('getPendingApprovals not implemented in APARAgentTools');
  }

  async getEOMReadiness(_tenantId: TenantId, _period: Period): Promise<EOMReadinessReport> {
    throw new Error('getEOMReadiness not implemented in APARAgentTools');
  }

  async postJournalEntry(_entryId: string): Promise<void> {
    throw new Error('postJournalEntry not implemented in APARAgentTools');
  }

  async holdPayrollBatch(_batchId: string, _reason: string): Promise<void> {
    throw new Error('holdPayrollBatch not implemented in APARAgentTools');
  }

  async advanceEOMStep(_closeId: string, _stepCode: string): Promise<void> {
    throw new Error('advanceEOMStep not implemented in APARAgentTools');
  }

  async requestApproval(_action: PendingAgentAction): Promise<string> {
    throw new Error('requestApproval not implemented in APARAgentTools');
  }
}
