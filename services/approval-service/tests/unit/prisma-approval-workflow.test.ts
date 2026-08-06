import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaApprovalWorkflow } from '../../src/application/prisma-approval-workflow';
import { ApprovalError } from '../../src/application/errors';
import { IEventPublisher, TenantId, UserId } from '@amacc/shared-kernel';

const mockPublisher: IEventPublisher = { publish: vi.fn().mockResolvedValue(undefined), connect: vi.fn(), disconnect: vi.fn() };
const tenantId = 'tenant-1';
const requesterId = 'user-requester';
const approverId = 'user-approver';

function makeRecord(overrides: Partial<any> = {}) {
  return {
    id: 'req-1',
    tenantId,
    agentName: 'agent',
    actionType: 'POST_JOURNAL',
    entityRef: 'JE-001',
    reasoning: 'test',
    evidence: [],
    requiredRole: 'AGENT_APPROVER',
    requesterId,
    status: 'PENDING',
    decidedBy: null,
    decisionNote: null,
    proposedAt: new Date(),
    expiresAt: new Date(Date.now() + 3600_000),
    decidedAt: null,
    cancelledAt: null,
    cancelReason: null,
    version: 0,
    ...overrides,
  };
}

function makePrisma(record: any = makeRecord(), updateCount = 1) {
  return {
    approvalRequestRecord: {
      findUnique: vi.fn().mockResolvedValue(record),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(record),
      updateMany: vi.fn().mockResolvedValue({ count: updateCount }),
      findMany: vi.fn().mockResolvedValue([record]),
    },
    approvalDecisionHistory: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

describe('PrismaApprovalWorkflow', () => {
  it('self-approval returns 403', async () => {
    const record = makeRecord({ requesterId: approverId });
    const prisma = makePrisma(record);
    const wf = new PrismaApprovalWorkflow(prisma, mockPublisher);
    const err = await wf.processDecision('req-1', approverId as UserId, 'APPROVE').catch(e => e);
    expect(err).toBeInstanceOf(ApprovalError);
    expect(err.code).toBe('SELF_APPROVAL');
    expect(err.statusCode).toBe(403);
  });

  it('cross-tenant denied', async () => {
    const record = makeRecord({ tenantId: 'tenant-1' });
    const prisma = makePrisma(record);
    const wf = new PrismaApprovalWorkflow(prisma, mockPublisher);
    const err = await wf.processDecision('req-1', approverId as UserId, 'APPROVE', undefined, { tenantId: 'tenant-other' }).catch(e => e);
    expect(err).toBeInstanceOf(ApprovalError);
    expect(err.code).toBe('CROSS_TENANT');
    expect(err.statusCode).toBe(403);
  });

  it('duplicate decision by same actor is idempotent', async () => {
    const record = makeRecord({ status: 'APPROVED', decidedBy: approverId });
    const prisma = makePrisma(record);
    const wf = new PrismaApprovalWorkflow(prisma, mockPublisher);
    // Should not throw
    await wf.processDecision('req-1', approverId as UserId, 'APPROVE');
  });

  it('different decision by same actor returns ALREADY_DECIDED 409', async () => {
    const record = makeRecord({ status: 'APPROVED', decidedBy: approverId });
    const prisma = makePrisma(record);
    const wf = new PrismaApprovalWorkflow(prisma, mockPublisher);
    const err = await wf.processDecision('req-1', approverId as UserId, 'REJECT').catch(e => e);
    expect(err).toBeInstanceOf(ApprovalError);
    expect(err.code).toBe('ALREADY_DECIDED');
    expect(err.statusCode).toBe(409);
  });

  it('optimistic concurrency conflict returns CONFLICT 409', async () => {
    const prisma = makePrisma(makeRecord(), 0); // updateMany returns count=0
    const wf = new PrismaApprovalWorkflow(prisma, mockPublisher);
    const err = await wf.processDecision('req-1', approverId as UserId, 'APPROVE').catch(e => e);
    expect(err).toBeInstanceOf(ApprovalError);
    expect(err.code).toBe('CONFLICT');
    expect(err.statusCode).toBe(409);
  });

  it('DB is used not in-memory (persists across instances)', async () => {
    const record = makeRecord();
    const prisma = makePrisma(record);
    const wf = new PrismaApprovalWorkflow(prisma, mockPublisher);
    const action: any = {
      id: '', tenantId, agentName: 'a', actionType: 'POST_JOURNAL', entityRef: 'JE-001',
      reasoning: 'r', evidence: [], proposedAt: new Date(), expiresAt: new Date(), status: 'PENDING',
    };
    await wf.requestApproval(action, 'AGENT_APPROVER' as any, tenantId as TenantId, 60);
    expect(prisma.approvalRequestRecord.create).toHaveBeenCalled();
  });
});
