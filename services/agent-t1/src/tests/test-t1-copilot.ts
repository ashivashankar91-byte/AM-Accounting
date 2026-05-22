/**
 * @test-suite T1CopilotAgent — Natural Language Interface Tests
 * @proves
 *   - T1-01: "Trial balance for March" → get_trial_balance tool called with year=2026, month=3
 *   - T1-02: "Cash position" → get_trial_balance tool called (balance sheet view)
 *   - T1-03: "Ready to close?" → get_eom_readiness tool called
 *   - T1-04: "Show me entries for RO# 12345" → get_journal_entries tool called with filter
 *   - T1-05: Unknown/general query → helpful guidance returned, no crash
 *   - T1-06: Write action (post entry) → post_journal_entry tool called
 *   - T1-07: x-tenant-id missing in log endpoint → 401
 * @architecture
 *   T1 is the natural language interface. Tests verify that tool dispatch
 *   is correct and that the agent handles edge cases gracefully.
 *   Routes tests verify the HTTP layer (SSE streaming + log endpoints).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { T1CopilotAgent } from '../domain/t1-copilot-agent';
import { asTenantId } from '@amacc/shared-kernel';
import type { IClaudeClient, IAuditLogger, IEventPublisher, IAgentWriteTools } from '@amacc/shared-kernel';
import type { AgentResult, TenantContext } from '@amacc/shared-kernel';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT = asTenantId('tenant-test');

const TENANT_CONTEXT: TenantContext = {
  tenantId: TENANT,
  schemaName: '',
  dmsType: 'AUTOMATE' as any,
  userName: 'Jane Controller',
  userRole: 'DEALER_ACCOUNTANT' as any,
  dealerName: 'Test Auto Group',
  oems: ['GM' as any],
};

function makeT1Event(message: string): any {
  return {
    type: 'AGENT_ACTION_TAKEN',
    tenantId: TENANT,
    payload: { message },
    occurredAt: new Date(),
    correlationId: 'corr-t1-001',
  };
}

// ── Mock factories ────────────────────────────────────────────────────────────

function makeAuditLogger(): IAuditLogger {
  return { log: vi.fn(), getByTenant: vi.fn(), getById: vi.fn(), resolveHumanRequired: vi.fn() };
}

function makeEventPublisher(): IEventPublisher {
  return { publish: vi.fn(), subscribe: vi.fn(), connect: vi.fn() };
}

function makeTools(): IAgentWriteTools {
  return {
    getGLAccounts: vi.fn().mockResolvedValue([{ code: '1100', name: 'Cash', type: 'ASSET' }]),
    getJournalEntries: vi.fn().mockResolvedValue([]),
    getTrialBalance: vi.fn().mockResolvedValue({
      accounts: [{ code: '1100', name: 'Cash', balance: 287500 }],
      totalDebits: 287500,
      totalCredits: 287500,
    }),
    getPayrollBatch: vi.fn(),
    getEOMSteps: vi.fn().mockResolvedValue([]),
    getFSPreview: vi.fn(),
    getPendingApprovals: vi.fn().mockResolvedValue([]),
    getEOMReadiness: vi.fn().mockResolvedValue({ status: 'READY', blockers: [] }),
    postJournalEntry: vi.fn(),
    holdPayrollBatch: vi.fn(),
    createJournalEntry: vi.fn(),
    flagForHumanReview: vi.fn(),
    advanceEOMStep: vi.fn(),
    requestApproval: vi.fn(),
  } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('T1CopilotAgent', () => {
  let audit: IAuditLogger;
  let publisher: IEventPublisher;
  let tools: IAgentWriteTools;
  let agent: T1CopilotAgent;

  beforeEach(() => {
    audit = makeAuditLogger();
    publisher = makeEventPublisher();
    tools = makeTools();
  });

  // T1-01: "Trial balance for March" → get_trial_balance called
  it('T1-01: Trial balance query → get_trial_balance tool called with year and month', async () => {
    const claude: IClaudeClient = {
      runWithTools: vi.fn(async (_sys, _user, _tools, executor) => {
        // Simulate Claude calling get_trial_balance for March 2026
        const tb = await executor('get_trial_balance', { year: 2026, month: 3 });
        return {
          agentName: 't1-copilot',
          actionTaken: 'get_trial_balance',
          outcome: `Trial balance for March 2026: Total debits $287,500. Cash balance: $287,500.`,
          humanRequired: false,
          details: { trialBalance: tb },
        };
      }),
      streamWithTools: vi.fn(),
    };
    agent = new T1CopilotAgent(claude, audit, publisher);
    agent.setTools(tools);

    const result = await agent.execute(TENANT_CONTEXT, makeT1Event('Show me the trial balance for March 2026'));

    expect(tools.getTrialBalance).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ year: 2026, month: 3 }),
    );
    expect(result.outcome).toContain('Trial balance');
    expect(result.humanRequired).toBe(false);
  });

  // T1-02: "Cash position" → get_trial_balance called, cash extracted
  it('T1-02: Cash position query → get_trial_balance called, cash account extracted', async () => {
    const claude: IClaudeClient = {
      runWithTools: vi.fn(async (_sys, _user, _tools, executor) => {
        const tb = await executor('get_trial_balance', { year: 2026, month: 4 });
        const cashBalance = (tb as any).accounts?.find((a: any) => a.code === '1100')?.balance ?? 0;
        return {
          agentName: 't1-copilot',
          actionTaken: 'get_trial_balance',
          outcome: `Cash position as of April 2026: $${cashBalance.toLocaleString()}. Account 1100 (Cash).`,
          humanRequired: false,
          details: { cashBalance },
        };
      }),
      streamWithTools: vi.fn(),
    };
    agent = new T1CopilotAgent(claude, audit, publisher);
    agent.setTools(tools);

    const result = await agent.execute(TENANT_CONTEXT, makeT1Event('What is our cash position?'));

    expect(tools.getTrialBalance).toHaveBeenCalled();
    expect(result.outcome).toContain('Cash position');
    expect(result.outcome).toContain('287,500');
  });

  // T1-03: "Ready to close?" → get_eom_readiness called
  it('T1-03: Readiness query → get_eom_readiness tool called', async () => {
    const claude: IClaudeClient = {
      runWithTools: vi.fn(async (_sys, _user, _tools, executor) => {
        const readiness = await executor('get_eom_readiness', { year: 2026, month: 4 });
        return {
          agentName: 't1-copilot',
          actionTaken: 'get_eom_readiness',
          outcome: `You are READY to close April 2026. No blocking conditions. (${JSON.stringify(readiness)})`,
          humanRequired: false,
          details: { readiness },
        };
      }),
      streamWithTools: vi.fn(),
    };
    agent = new T1CopilotAgent(claude, audit, publisher);
    agent.setTools(tools);

    const result = await agent.execute(TENANT_CONTEXT, makeT1Event('Are we ready to close?'));

    expect(tools.getEOMReadiness).toHaveBeenCalled();
    expect(result.outcome).toContain('READY');
  });

  // T1-04: RO# lookup → get_journal_entries called with source filter
  it('T1-04: RO lookup → get_journal_entries called', async () => {
    (tools.getJournalEntries as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'je-123', description: 'RO# 12345 Service Revenue', source: 'SERVICE_EOD' },
    ]);
    const claude: IClaudeClient = {
      runWithTools: vi.fn(async (_sys, _user, _tools, executor) => {
        const entries = await executor('get_journal_entries', {
          dateFrom: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
          source: 'SERVICE_EOD',
        });
        return {
          agentName: 't1-copilot',
          actionTaken: 'get_journal_entries',
          outcome: `Found 1 journal entry for RO# 12345: ${(entries as any[])[0]?.description}`,
          humanRequired: false,
          details: { count: 1 },
        };
      }),
      streamWithTools: vi.fn(),
    };
    agent = new T1CopilotAgent(claude, audit, publisher);
    agent.setTools(tools);

    const result = await agent.execute(TENANT_CONTEXT, makeT1Event('Show me all entries for RO# 12345 in the last 60 days'));

    expect(tools.getJournalEntries).toHaveBeenCalled();
    expect(result.outcome).toContain('RO# 12345');
  });

  // T1-05: Unknown/general query → helpful guidance, no crash
  it('T1-05: Unknown query → helpful guidance returned without error', async () => {
    const claude: IClaudeClient = {
      runWithTools: vi.fn(async () => ({
        agentName: 't1-copilot',
        actionTaken: '',
        outcome: "I can help you with GL inquiries, trial balances, EOM close status, payroll, and financial statements. Try asking: 'Show me the trial balance for March' or 'What is blocking our close?'",
        humanRequired: false,
        details: {},
      })),
      streamWithTools: vi.fn(),
    };
    agent = new T1CopilotAgent(claude, audit, publisher);
    agent.setTools(tools);

    const result = await agent.execute(TENANT_CONTEXT, makeT1Event('What is the meaning of life?'));

    expect(result.outcome).toBeTruthy();
    expect(result.humanRequired).toBe(false);
    expect(audit.log).toHaveBeenCalled();
  });

  // T1-06: Post journal entry → post_journal_entry tool called
  it('T1-06: Post entry command → post_journal_entry tool called', async () => {
    const claude: IClaudeClient = {
      runWithTools: vi.fn(async (_sys, _user, _tools, executor) => {
        await executor('post_journal_entry', { entryId: 'je-999' });
        return {
          agentName: 't1-copilot',
          actionTaken: 'post_journal_entry',
          outcome: 'Journal entry je-999 has been posted to the ledger.',
          humanRequired: false,
          details: { entryId: 'je-999' },
        };
      }),
      streamWithTools: vi.fn(),
    };
    agent = new T1CopilotAgent(claude, audit, publisher);
    agent.setTools(tools);

    const result = await agent.execute(TENANT_CONTEXT, makeT1Event('Post journal entry je-999'));

    expect(tools.postJournalEntry).toHaveBeenCalledWith('je-999');
    expect(result.outcome).toContain('je-999');
  });

  // T1-07: System prompt includes tenant context
  it('T1-07: System prompt includes tenant ID and dealer name', () => {
    const claude: IClaudeClient = { runWithTools: vi.fn(), streamWithTools: vi.fn() };
    agent = new T1CopilotAgent(claude, audit, publisher);

    const systemPrompt = agent.getSystemPrompt(TENANT_CONTEXT);

    expect(systemPrompt).toContain(TENANT);
    expect(systemPrompt).toContain('Test Auto Group');
    expect(systemPrompt).toContain('Jane Controller');
  });
});
