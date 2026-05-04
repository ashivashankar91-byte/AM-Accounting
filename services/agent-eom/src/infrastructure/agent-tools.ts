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

const EOM_SERVICE_URL = process.env['EOM_SERVICE_URL'] ?? 'http://eom-service:3011';
const APPROVAL_SERVICE_URL = process.env['APPROVAL_SERVICE_URL'] ?? 'http://approval-service:3033';

/**
 * HTTP-backed IAgentWriteTools for the EOM Orchestration Agent.
 *
 * Implements the three methods the agent's tool executor actually calls.
 * Remaining interface methods throw — they are never invoked by this agent.
 */
export class EOMAgentTools implements IAgentWriteTools {
  private _tenantId: TenantId;

  constructor(tenantId: TenantId) {
    this._tenantId = tenantId;
  }

  setTenantId(tenantId: TenantId): void {
    this._tenantId = tenantId;
  }

  // ── Methods used by EOM orchestration agent ────────────────────────────────

  async getEOMSteps(closeId: string): Promise<EOMStep[]> {
    const res = await fetch(
      `${EOM_SERVICE_URL}/api/v1/eom/${encodeURIComponent(closeId)}/steps`,
      { headers: { 'x-tenant-id': this._tenantId } },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`getEOMSteps failed (${res.status}): ${text}`);
    }
    return res.json() as Promise<EOMStep[]>;
  }

  async advanceEOMStep(closeId: string, _stepCode: string): Promise<void> {
    // The eom-service /advance endpoint advances the current step automatically;
    // stepCode is informational context from the agent but not sent in the body.
    const res = await fetch(
      `${EOM_SERVICE_URL}/api/v1/eom/${encodeURIComponent(closeId)}/advance`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': this._tenantId,
        },
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`advanceEOMStep failed (${res.status}): ${text}`);
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
          agentName: 'eom-orchestration',
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

  // ── Not used by EOM agent — satisfy interface ──────────────────────────────

  async getGLAccounts(_tenantId: TenantId): Promise<GLAccount[]> {
    throw new Error('getGLAccounts not implemented in EOMAgentTools');
  }

  async getJournalEntries(_tenantId: TenantId, _filters: EntryFilters): Promise<JournalEntry[]> {
    throw new Error('getJournalEntries not implemented in EOMAgentTools');
  }

  async getTrialBalance(_tenantId: TenantId, _period: Period): Promise<TrialBalance> {
    throw new Error('getTrialBalance not implemented in EOMAgentTools');
  }

  async getPayrollBatch(_batchId: string): Promise<PayrollBatch> {
    throw new Error('getPayrollBatch not implemented in EOMAgentTools');
  }

  async getFSPreview(_tenantId: TenantId, _period: Period, _oem: OEMType): Promise<FSDocument> {
    throw new Error('getFSPreview not implemented in EOMAgentTools');
  }

  async getPendingApprovals(_tenantId: TenantId): Promise<PendingAgentAction[]> {
    throw new Error('getPendingApprovals not implemented in EOMAgentTools');
  }

  async getEOMReadiness(_tenantId: TenantId, _period: Period): Promise<EOMReadinessReport> {
    throw new Error('getEOMReadiness not implemented in EOMAgentTools');
  }

  async postJournalEntry(_entryId: string): Promise<void> {
    throw new Error('postJournalEntry not implemented in EOMAgentTools');
  }

  async holdPayrollBatch(_batchId: string, _reason: string): Promise<void> {
    throw new Error('holdPayrollBatch not implemented in EOMAgentTools');
  }

  async createJournalEntry(_tenantId: TenantId, _lines: CreateJournalLineDTO[]): Promise<string> {
    throw new Error('createJournalEntry not implemented in EOMAgentTools');
  }

  async requestApproval(_action: PendingAgentAction): Promise<string> {
    throw new Error('requestApproval not implemented in EOMAgentTools');
  }
}
