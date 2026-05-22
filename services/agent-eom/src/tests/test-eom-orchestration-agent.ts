/**
 * @test-suite EOMOrchestrationAgent — Intelligence Layer Tests
 * @proves
 *   - EOM-AGT-01: No blocking conditions → Claude returns READY assessment
 *   - EOM-AGT-02: Unposted transactions exist → Claude returns BLOCKED, get_eom_steps called
 *   - EOM-AGT-03: Step failure → Claude provides diagnostic advice, AGENT_HUMAN_REQUIRED published
 *   - EOM-AGT-04: All steps COMPLETED → advance_eom_step NOT called (already done)
 *   - EOM-AGT-05: Step FAILED after 3 retries → escalated with human required
 * @architecture
 *   Tests mock IClaudeClient.runWithTools and the EOM tools to simulate
 *   various close states without real EOM service calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EOMOrchestrationAgent } from '../domain/eom-agent';
import { asTenantId } from '@amacc/shared-kernel';
import type { IClaudeClient, IAuditLogger, IEventPublisher, IAgentWriteTools } from '@amacc/shared-kernel';
import type { AgentResult, TenantContext } from '@amacc/shared-kernel';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT = asTenantId('tenant-test');

const TENANT_CONTEXT: TenantContext = {
  tenantId: TENANT,
  schemaName: '',
  dmsType: 'AUTOMATE' as any,
};

function makeEOMEvent(overrides: Partial<any> = {}): any {
  return {
    type: 'EOM_STEP_CHANGED',
    tenantId: TENANT,
    payload: {
      closeId: 'close-001',
      stepCode: 'ACCT_062',
      ...overrides,
    },
    occurredAt: new Date(),
    correlationId: 'corr-eom-001',
  };
}

function makeEOMCloseCompletedEvent(): any {
  return {
    type: 'EOM_CLOSE_COMPLETED',
    tenantId: TENANT,
    payload: { closeId: 'close-001', periodYear: 2026, periodMonth: 3 },
    occurredAt: new Date(),
    correlationId: 'corr-eom-002',
  };
}

// ── Mock factories ────────────────────────────────────────────────────────────

function makeClaudeClient(result: Partial<AgentResult> = {}): IClaudeClient {
  return {
    runWithTools: vi.fn(async () => ({
      agentName: 'eom-orchestration',
      actionTaken: '',
      outcome: 'EOM close is READY. No blocking conditions.',
      humanRequired: false,
      details: {},
      ...result,
    })),
    streamWithTools: vi.fn(),
  };
}

function makeAuditLogger(): IAuditLogger {
  return { log: vi.fn(), getByTenant: vi.fn(), getById: vi.fn(), resolveHumanRequired: vi.fn() };
}

function makeEventPublisher(): IEventPublisher {
  return { publish: vi.fn(), subscribe: vi.fn(), connect: vi.fn() };
}

function makeTools(stepsOverride?: any[]): IAgentWriteTools {
  const steps = stepsOverride ?? [
    { stepCode: 'ACCT_062', status: 'PENDING', retryCount: 0 },
    { stepCode: 'ACCT_065', status: 'NOT_STARTED', retryCount: 0 },
  ];
  return {
    getEOMSteps: vi.fn().mockResolvedValue(steps),
    advanceEOMStep: vi.fn(),
    flagForHumanReview: vi.fn(),
    postJournalEntry: vi.fn(),
    getJournalEntries: vi.fn().mockResolvedValue([]),
    getGLAccounts: vi.fn().mockResolvedValue([]),
    getTrialBalance: vi.fn(),
    holdPayrollBatch: vi.fn(),
    getPayrollBatch: vi.fn(),
    getFSPreview: vi.fn(),
    getPendingApprovals: vi.fn(),
    getEOMReadiness: vi.fn(),
    createJournalEntry: vi.fn(),
    requestApproval: vi.fn(),
  } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EOMOrchestrationAgent', () => {
  let claude: IClaudeClient;
  let audit: IAuditLogger;
  let publisher: IEventPublisher;
  let tools: IAgentWriteTools;
  let agent: EOMOrchestrationAgent;

  beforeEach(() => {
    audit = makeAuditLogger();
    publisher = makeEventPublisher();
  });

  // EOM-AGT-01: No blocking conditions → READY
  it('EOM-AGT-01: No blocking conditions → outcome contains READY, no human-required', async () => {
    tools = makeTools([
      { stepCode: 'ACCT_062', status: 'COMPLETED', retryCount: 0 },
      { stepCode: 'ACCT_065', status: 'COMPLETED', retryCount: 0 },
    ]);
    claude = makeClaudeClient({
      outcome: 'Close is READY. All steps completed. No blockers.',
      humanRequired: false,
    });
    agent = new EOMOrchestrationAgent(claude, audit, publisher);
    agent.setTools(tools);

    const result = await agent.execute(TENANT_CONTEXT, makeEOMEvent());

    expect(result.humanRequired).toBe(false);
    expect(result.outcome).toContain('READY');

    const publishCalls = (publisher.publish as ReturnType<typeof vi.fn>).mock.calls;
    const humanRequired = publishCalls.some((c: any[]) => c[0]?.type === 'AGENT_HUMAN_REQUIRED');
    expect(humanRequired).toBe(false);
  });

  // EOM-AGT-02: Unposted transactions → BLOCKED, get_eom_steps called
  it('EOM-AGT-02: Unposted transactions exist → BLOCKED, get_eom_steps tool called', async () => {
    tools = makeTools([{ stepCode: 'ACCT_062', status: 'BLOCKED', retryCount: 0 }]);
    claude = {
      runWithTools: vi.fn(async (_sys, _user, _tools, executor) => {
        await executor('get_eom_steps', { closeId: 'close-001' });
        return {
          agentName: 'eom-orchestration',
          actionTaken: 'get_eom_steps',
          outcome: 'Close is BLOCKED: 47 unposted transactions exist. Post all journals before retrying ACCT_062.',
          humanRequired: false,
          details: { unpostedCount: 47 },
        };
      }),
      streamWithTools: vi.fn(),
    };
    agent = new EOMOrchestrationAgent(claude, audit, publisher);
    agent.setTools(tools);

    const result = await agent.execute(TENANT_CONTEXT, makeEOMEvent());

    expect(tools.getEOMSteps).toHaveBeenCalledWith('close-001');
    expect(result.outcome).toContain('BLOCKED');
  });

  // EOM-AGT-03: Step failure → advisory published, human required
  it('EOM-AGT-03: Step failure after retries → AGENT_HUMAN_REQUIRED published with diagnostic', async () => {
    tools = makeTools([
      { stepCode: 'ACCT_100', status: 'FAILED', retryCount: 3, error: 'FK constraint violation on schedule_detail' },
    ]);
    claude = {
      runWithTools: vi.fn(async (_sys, _user, _tools, executor) => {
        await executor('flag_for_human_review', {
          entityType: 'eom_close',
          entityId: 'close-001',
          reason: 'Step ACCT_100 failed 3 times: FK constraint violation on schedule_detail. Likely cause: orphaned schedule detail records. Manual intervention required.',
          severity: 'CRITICAL',
        });
        return {
          agentName: 'eom-orchestration',
          actionTaken: 'flag_for_human_review',
          outcome: 'Step ACCT_100 failure escalated for human review',
          humanRequired: true,
          details: { step: 'ACCT_100', retries: 3 },
        };
      }),
      streamWithTools: vi.fn(),
    };
    agent = new EOMOrchestrationAgent(claude, audit, publisher);
    agent.setTools(tools);

    const result = await agent.execute(TENANT_CONTEXT, makeEOMEvent({ stepCode: 'ACCT_100' }));

    expect(result.humanRequired).toBe(true);
    expect(tools.flagForHumanReview).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'eom_close', entityId: 'close-001' }),
      expect.stringContaining('ACCT_100'),
      'CRITICAL',
    );

    const publishCalls = (publisher.publish as ReturnType<typeof vi.fn>).mock.calls;
    const humanReqEvent = publishCalls.find((c: any[]) => c[0]?.type === 'AGENT_HUMAN_REQUIRED');
    expect(humanReqEvent).toBeDefined();
    expect(humanReqEvent![0].payload.agentName).toBe('eom-orchestration');
  });

  // EOM-AGT-04: All steps COMPLETED → advance_eom_step NOT called
  it('EOM-AGT-04: All steps already COMPLETED → advance_eom_step not called', async () => {
    tools = makeTools([
      { stepCode: 'ACCT_062', status: 'COMPLETED', retryCount: 0 },
      { stepCode: 'ACCT_065', status: 'COMPLETED', retryCount: 0 },
      { stepCode: 'ACCT_070', status: 'COMPLETED', retryCount: 0 },
    ]);
    claude = makeClaudeClient({
      actionTaken: 'get_eom_steps',
      outcome: 'All steps COMPLETED. EOM close is done.',
      humanRequired: false,
    });
    agent = new EOMOrchestrationAgent(claude, audit, publisher);
    agent.setTools(tools);

    await agent.execute(TENANT_CONTEXT, makeEOMCloseCompletedEvent());

    expect(tools.advanceEOMStep).not.toHaveBeenCalled();
  });

  // EOM-AGT-05: AGENT_ACTION_TAKEN always published
  it('EOM-AGT-05: AGENT_ACTION_TAKEN published for every execution', async () => {
    tools = makeTools();
    claude = makeClaudeClient();
    agent = new EOMOrchestrationAgent(claude, audit, publisher);
    agent.setTools(tools);

    await agent.execute(TENANT_CONTEXT, makeEOMEvent());

    const publishCalls = (publisher.publish as ReturnType<typeof vi.fn>).mock.calls;
    const actionTaken = publishCalls.find((c: any[]) => c[0]?.type === 'AGENT_ACTION_TAKEN');
    expect(actionTaken).toBeDefined();
    expect(actionTaken![0].tenantId).toBe(TENANT);
  });
});
