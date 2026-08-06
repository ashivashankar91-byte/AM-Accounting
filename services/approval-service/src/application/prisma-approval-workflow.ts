import {
  IApprovalWorkflow,
  PendingAgentAction,
  ApprovalRequest,
  UserRole,
  UserId,
  TenantId,
  IEventPublisher,
  createEvent,
} from '@amacc/shared-kernel';
import { ApprovalError } from './errors';

function toApprovalRequest(record: any): ApprovalRequest {
  return {
    id: record.id,
    tenantId: record.tenantId as TenantId,
    agentName: record.agentName,
    actionType: record.actionType as any,
    entityRef: record.entityRef,
    reasoning: record.reasoning,
    evidence: record.evidence as string[],
    requiredRole: record.requiredRole as any,
    status: record.status as any,
    timeoutMinutes: 0,
    proposedAt: record.proposedAt,
    expiresAt: record.expiresAt,
    decidedAt: record.decidedAt ?? undefined,
    decidedBy: record.decidedBy ?? undefined,
    note: record.decisionNote ?? undefined,
  };
}

export class PrismaApprovalWorkflow implements IApprovalWorkflow {
  constructor(
    private readonly prisma: any,
    private readonly eventPublisher: IEventPublisher,
  ) {}

  getSelf(): string {
    return 'PrismaApprovalWorkflow';
  }

  async requestApproval(
    action: PendingAgentAction,
    requiredRole: UserRole,
    tenantId: TenantId,
    timeoutMinutes: number,
    options?: { idempotencyKey?: string; requesterId?: string },
  ): Promise<ApprovalRequest> {
    if (options?.idempotencyKey) {
      const existing = await this.prisma.approvalRequestRecord.findFirst({
        where: { idempotencyKey: options.idempotencyKey },
      });
      if (existing) return toApprovalRequest(existing);
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + timeoutMinutes * 60_000);

    const record = await this.prisma.approvalRequestRecord.create({
      data: {
        tenantId,
        agentName: action.agentName,
        actionType: action.actionType,
        entityRef: action.entityRef,
        reasoning: action.reasoning,
        evidence: action.evidence ?? [],
        requiredRole,
        requesterId: options?.requesterId ?? null,
        expiresAt,
        idempotencyKey: options?.idempotencyKey ?? null,
        status: 'PENDING',
        version: 0,
      },
    });

    await this.eventPublisher.publish(
      createEvent('APPROVAL_REQUESTED', tenantId, { requestId: record.id, agentName: action.agentName, actionType: action.actionType }),
    );

    return toApprovalRequest(record);
  }

  async processDecision(
    requestId: string,
    approverId: UserId,
    decision: 'APPROVE' | 'REJECT',
    note?: string,
    opts?: { tenantId?: string },
  ): Promise<void> {
    const record = await this.prisma.approvalRequestRecord.findUnique({ where: { id: requestId } });
    if (!record) throw new ApprovalError('NOT_FOUND', 404);

    if (opts?.tenantId && record.tenantId !== opts.tenantId) {
      throw new ApprovalError('CROSS_TENANT', 403);
    }

    if (record.requesterId && approverId === record.requesterId) {
      throw new ApprovalError('SELF_APPROVAL', 403);
    }

    if (record.status !== 'PENDING') {
      const expectedStatus = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      if (record.decidedBy === approverId && record.status === expectedStatus) {
        return; // idempotent
      }
      throw new ApprovalError('ALREADY_DECIDED', 409);
    }

    const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const result = await this.prisma.approvalRequestRecord.updateMany({
      where: { id: requestId, version: record.version },
      data: {
        status,
        decidedBy: approverId,
        decisionNote: note ?? null,
        decidedAt: new Date(),
        version: record.version + 1,
      },
    });

    if (result.count === 0) throw new ApprovalError('CONFLICT', 409);

    await this.prisma.approvalDecisionHistory.create({
      data: { requestId, actorId: approverId, decision, note: note ?? null },
    });

    await this.eventPublisher.publish(
      createEvent('APPROVAL_DECIDED', record.tenantId as TenantId, { requestId, decision, decidedBy: approverId }),
    );
  }

  async getPending(tenantId: TenantId, role?: UserRole): Promise<ApprovalRequest[]> {
    const records = await this.prisma.approvalRequestRecord.findMany({
      where: { tenantId, status: 'PENDING' },
    });
    const now = new Date();
    const results: ApprovalRequest[] = [];
    for (const record of records) {
      if (record.expiresAt < now) {
        await this.prisma.approvalRequestRecord.updateMany({
          where: { id: record.id, version: record.version },
          data: { status: 'EXPIRED', version: record.version + 1 },
        });
      } else {
        results.push(toApprovalRequest(record));
      }
    }
    return results;
  }

  async getExpired(tenantId: TenantId): Promise<ApprovalRequest[]> {
    const records = await this.prisma.approvalRequestRecord.findMany({
      where: { tenantId, status: 'EXPIRED' },
    });
    return records.map(toApprovalRequest);
  }

  async getHistory(tenantId: TenantId): Promise<ApprovalRequest[]> {
    const records = await this.prisma.approvalRequestRecord.findMany({
      where: { tenantId },
    });
    return records.map(toApprovalRequest);
  }

  async cancelRequest(requestId: string, actorId: string, reason?: string): Promise<void> {
    await this.prisma.approvalRequestRecord.updateMany({
      where: { id: requestId },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason ?? null },
    });
    await this.prisma.approvalDecisionHistory.create({
      data: { requestId, actorId, decision: 'CANCELLED', note: reason ?? null },
    });
  }
}
