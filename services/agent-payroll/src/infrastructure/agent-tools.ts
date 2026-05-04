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

const PAYROLL_SERVICE_URL = process.env['PAYROLL_SERVICE_URL'] ?? 'http://payroll-service:3012';
const APPROVAL_SERVICE_URL = process.env['APPROVAL_SERVICE_URL'] ?? 'http://approval-service:3033';

/**
 * HTTP-backed IAgentWriteTools for the Payroll Integrity Agent.
 *
 * Only the three methods the payroll agent actually calls are implemented
 * with real HTTP calls. The remaining interface methods throw — they exist
 * only to satisfy the IAgentWriteTools contract and will never be invoked
 * by this agent's tool executor.
 */
export class PayrollAgentTools implements IAgentWriteTools {
  private _tenantId: TenantId;

  constructor(tenantId: TenantId) {
    this._tenantId = tenantId;
  }

  /** Update tenant context before each agent execution. */
  setTenantId(tenantId: TenantId): void {
    this._tenantId = tenantId;
  }

  // ── Methods used by payroll agent ──────────────────────────────────────────

  async getPayrollBatch(batchId: string): Promise<PayrollBatch> {
    const res = await fetch(
      `${PAYROLL_SERVICE_URL}/api/v1/payroll/batches/${encodeURIComponent(batchId)}`,
      { headers: { 'x-tenant-id': this._tenantId } },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`getPayrollBatch failed (${res.status}): ${text}`);
    }
    return res.json() as Promise<PayrollBatch>;
  }

  async holdPayrollBatch(batchId: string, reason: string): Promise<void> {
    const res = await fetch(
      `${PAYROLL_SERVICE_URL}/api/v1/payroll/batches/${encodeURIComponent(batchId)}/hold`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': this._tenantId,
        },
        body: JSON.stringify({ reason }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`holdPayrollBatch failed (${res.status}): ${text}`);
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
          agentName: 'payroll-integrity',
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

  // ── Not used by payroll agent — satisfy interface ──────────────────────────

  async getGLAccounts(_tenantId: TenantId): Promise<GLAccount[]> {
    throw new Error('getGLAccounts not implemented in PayrollAgentTools');
  }

  async getJournalEntries(_tenantId: TenantId, _filters: EntryFilters): Promise<JournalEntry[]> {
    throw new Error('getJournalEntries not implemented in PayrollAgentTools');
  }

  async getTrialBalance(_tenantId: TenantId, _period: Period): Promise<TrialBalance> {
    throw new Error('getTrialBalance not implemented in PayrollAgentTools');
  }

  async getEOMSteps(_closeId: string): Promise<EOMStep[]> {
    throw new Error('getEOMSteps not implemented in PayrollAgentTools');
  }

  async getFSPreview(_tenantId: TenantId, _period: Period, _oem: OEMType): Promise<FSDocument> {
    throw new Error('getFSPreview not implemented in PayrollAgentTools');
  }

  async getPendingApprovals(_tenantId: TenantId): Promise<PendingAgentAction[]> {
    throw new Error('getPendingApprovals not implemented in PayrollAgentTools');
  }

  async getEOMReadiness(_tenantId: TenantId, _period: Period): Promise<EOMReadinessReport> {
    throw new Error('getEOMReadiness not implemented in PayrollAgentTools');
  }

  async postJournalEntry(_entryId: string): Promise<void> {
    throw new Error('postJournalEntry not implemented in PayrollAgentTools');
  }

  async advanceEOMStep(_closeId: string, _stepCode: string): Promise<void> {
    throw new Error('advanceEOMStep not implemented in PayrollAgentTools');
  }

  async createJournalEntry(_tenantId: TenantId, _lines: CreateJournalLineDTO[]): Promise<string> {
    throw new Error('createJournalEntry not implemented in PayrollAgentTools');
  }

  async requestApproval(_action: PendingAgentAction): Promise<string> {
    throw new Error('requestApproval not implemented in PayrollAgentTools');
  }
}
