import {
  IApprovalWorkflow,
  PendingAgentAction,
  ApprovalRequest,
  UserRole,
  UserId,
  TenantId,
  IEventPublisher,
} from '@amacc/shared-kernel';
import { createEvent } from '@amacc/shared-kernel';

export class InMemoryApprovalWorkflow implements IApprovalWorkflow {
  private requests = new Map<string, ApprovalRequest>();

  constructor(private readonly eventPublisher: IEventPublisher) {}

  async requestApproval(
    action: PendingAgentAction,
    requiredRole: UserRole,
    tenantId: TenantId,
    timeoutMinutes: number,
  ): Promise<ApprovalRequest> {
    const id = crypto.randomUUID();
    const now = new Date();
    const request: ApprovalRequest = {
      id,
      tenantId,
      agentName: action.agentName,
      actionType: action.actionType,
      entityRef: action.entityRef,
      reasoning: action.reasoning,
      evidence: action.evidence,
      requiredRole,
      status: 'PENDING',
      timeoutMinutes,
      proposedAt: now,
      expiresAt: new Date(now.getTime() + timeoutMinutes * 60_000),
    };
    this.requests.set(id, request);

    await this.eventPublisher.publish(
      createEvent('APPROVAL_REQUESTED', tenantId, { requestId: id, agentName: action.agentName, actionType: action.actionType }),
    );

    return request;
  }

  async processDecision(
    requestId: string,
    approverId: UserId,
    decision: 'APPROVE' | 'REJECT',
    note?: string,
  ): Promise<void> {
    const req = this.requests.get(requestId);
    if (!req) throw new Error('Approval request not found');
    if (req.status !== 'PENDING') throw new Error(`Cannot ${decision} — request is ${req.status}`);

    req.status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    req.decidedAt = new Date();
    req.decidedBy = approverId;
    req.note = note;

    const eventType = decision === 'APPROVE' ? 'APPROVAL_GRANTED' as const : 'APPROVAL_REJECTED' as const;
    await this.eventPublisher.publish(
      createEvent(eventType, req.tenantId, { requestId, approverId, decision, note }),
    );
  }

  async getPending(tenantId: TenantId, _role?: UserRole): Promise<ApprovalRequest[]> {
    this.expireStale();
    return [...this.requests.values()].filter((r) => r.tenantId === tenantId && r.status === 'PENDING');
  }

  async getExpired(tenantId: TenantId): Promise<ApprovalRequest[]> {
    this.expireStale();
    return [...this.requests.values()].filter((r) => r.tenantId === tenantId && r.status === 'EXPIRED');
  }

  async getHistory(tenantId: TenantId): Promise<ApprovalRequest[]> {
    return [...this.requests.values()].filter((r) => r.tenantId === tenantId);
  }

  private expireStale(): void {
    const now = Date.now();
    for (const req of this.requests.values()) {
      if (req.status === 'PENDING' && req.expiresAt.getTime() < now) {
        req.status = 'EXPIRED';
      }
    }
  }
}
