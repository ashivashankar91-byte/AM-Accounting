import { describe, it, expect, vi } from 'vitest';
import { InMemoryApprovalWorkflow } from '../../src/application/approval-workflow';
import { IEventPublisher, PendingAgentAction, TenantId, UserId } from '@amacc/shared-kernel';

const mockPublisher: IEventPublisher = { publish: vi.fn().mockResolvedValue(undefined), connect: vi.fn(), disconnect: vi.fn() };
const tenantId = 'tenant-1' as TenantId;
const action: PendingAgentAction = {
  id: '', tenantId, agentName: 'test-agent', actionType: 'POST_JOURNAL' as any,
  entityRef: 'JE-001', reasoning: 'test', evidence: [], proposedAt: new Date(), expiresAt: new Date(), status: 'PENDING',
};

describe('InMemoryApprovalWorkflow', () => {
  it('requestApproval creates pending', async () => {
    const wf = new InMemoryApprovalWorkflow(mockPublisher);
    const req = await wf.requestApproval(action, 'AGENT_APPROVER' as any, tenantId, 60);
    expect(req.status).toBe('PENDING');
    expect(req.id).toBeTruthy();
  });

  it('processDecision approve', async () => {
    const wf = new InMemoryApprovalWorkflow(mockPublisher);
    const req = await wf.requestApproval(action, 'AGENT_APPROVER' as any, tenantId, 60);
    await wf.processDecision(req.id, 'approver-1' as UserId, 'APPROVE');
    const history = await wf.getHistory(tenantId);
    expect(history.find(h => h.id === req.id)?.status).toBe('APPROVED');
  });

  it('processDecision reject', async () => {
    const wf = new InMemoryApprovalWorkflow(mockPublisher);
    const req = await wf.requestApproval(action, 'AGENT_APPROVER' as any, tenantId, 60);
    await wf.processDecision(req.id, 'approver-1' as UserId, 'REJECT', 'not valid');
    const history = await wf.getHistory(tenantId);
    expect(history.find(h => h.id === req.id)?.status).toBe('REJECTED');
  });

  it('getHistory returns all', async () => {
    const wf = new InMemoryApprovalWorkflow(mockPublisher);
    await wf.requestApproval(action, 'AGENT_APPROVER' as any, tenantId, 60);
    await wf.requestApproval(action, 'AGENT_APPROVER' as any, tenantId, 60);
    const history = await wf.getHistory(tenantId);
    expect(history.length).toBeGreaterThanOrEqual(2);
  });
});
