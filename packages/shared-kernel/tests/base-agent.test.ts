import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseAgent } from '../src/agents/base-agent';
import type { IClaudeClient, IAuditLogger, IEventPublisher } from '../src/interfaces';
import type { TenantContext, AgentResult } from '../src/types';
import { DomainEvent } from '../src/events';

// Unified AI Agents dashboard (PO-DEC-001): a real review attempt must
// always be visible, whether the failure is in Claude/tool execution or in
// persisting the audit record itself. These tests cover both failure modes
// and confirm neither one silently disappears or crashes the whole
// execute() call.

class FakeAgent extends BaseAgent {
  constructor(
    claudeClient: IClaudeClient,
    auditLogger: IAuditLogger,
    eventPublisher: IEventPublisher,
    private readonly resultOverride?: AgentResult,
  ) {
    super(claudeClient, auditLogger, eventPublisher);
  }
  getAgentName() { return 'fake-agent'; }
  getSystemPrompt() { return 'system prompt'; }
  buildTools() { return []; }
  buildToolExecutor() { return async () => ({}); }
  protected buildUserMessage() { return 'user message'; }
}

function fakeContext(): TenantContext {
  return { tenantId: 'tenant-a' as any, schemaName: '', dmsType: 'AUTOMATE' as any };
}

function fakeTrigger(): DomainEvent {
  return { type: 'TEST_EVENT', tenantId: 'tenant-a', payload: {}, occurredAt: new Date(), correlationId: 'corr-1' } as any;
}

describe('BaseAgent.execute() — failure logging (PO-DEC-001)', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('a Claude/tool execution failure is caught, logged as AGENT_ERROR with humanRequired=true, and still returned', async () => {
    const claudeClient: IClaudeClient = { runWithTools: vi.fn(async () => { throw new Error('rate limit exceeded'); }) } as any;
    const auditLogger: IAuditLogger = { log: vi.fn(async () => {}), getByTenant: vi.fn(), getById: vi.fn(), resolveHumanRequired: vi.fn() };
    const eventPublisher: IEventPublisher = { publish: vi.fn(async () => {}), subscribe: vi.fn() };
    const agent = new FakeAgent(claudeClient, auditLogger, eventPublisher);

    const result = await agent.execute(fakeContext(), fakeTrigger());

    expect(result).toMatchObject({ agentName: 'fake-agent', actionTaken: 'NONE', outcome: 'AGENT_ERROR', humanRequired: true });
    expect(result.details).toMatchObject({ error: 'rate limit exceeded' });
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'AGENT_ERROR', humanRequired: true }));
    expect(eventPublisher.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'AGENT_HUMAN_REQUIRED' }));
  });

  it('a genuinely successful Claude result is logged and published as-is, with no AGENT_ERROR substitution', async () => {
    const realResult: AgentResult = { agentName: 'fake-agent', actionTaken: 'JE_APPROVED', outcome: 'SUCCESS', humanRequired: false, details: {} };
    const claudeClient: IClaudeClient = { runWithTools: vi.fn(async () => realResult) } as any;
    const auditLogger: IAuditLogger = { log: vi.fn(async () => {}), getByTenant: vi.fn(), getById: vi.fn(), resolveHumanRequired: vi.fn() };
    const eventPublisher: IEventPublisher = { publish: vi.fn(async () => {}), subscribe: vi.fn() };
    const agent = new FakeAgent(claudeClient, auditLogger, eventPublisher);

    const result = await agent.execute(fakeContext(), fakeTrigger());

    expect(result).toEqual(realResult);
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'SUCCESS', humanRequired: false }));
    expect(eventPublisher.publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'AGENT_HUMAN_REQUIRED' }));
    expect(eventPublisher.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'AGENT_ACTION_TAKEN' }));
  });

  it('audit-service/Postgres unavailable (log() throws) does not crash execute() or block the domain events from publishing', async () => {
    const realResult: AgentResult = { agentName: 'fake-agent', actionTaken: 'JE_APPROVED', outcome: 'SUCCESS', humanRequired: false, details: {} };
    const claudeClient: IClaudeClient = { runWithTools: vi.fn(async () => realResult) } as any;
    const auditLogger: IAuditLogger = {
      log: vi.fn(async () => { throw new Error('ECONNREFUSED: agent_action_logs unreachable'); }),
      getByTenant: vi.fn(), getById: vi.fn(), resolveHumanRequired: vi.fn(),
    };
    const eventPublisher: IEventPublisher = { publish: vi.fn(async () => {}), subscribe: vi.fn() };
    const agent = new FakeAgent(claudeClient, auditLogger, eventPublisher);

    const result = await agent.execute(fakeContext(), fakeTrigger());

    // The real agent result is still returned -- a persistence outage never
    // masquerades as an agent failure.
    expect(result).toEqual(realResult);
    // The failure is surfaced (not silently swallowed) via an error log.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('agent_action_logs write failed'),
      expect.any(Error),
    );
    // Domain events still publish -- a DB blip must not also suppress the
    // real downstream automation signal.
    expect(eventPublisher.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'AGENT_ACTION_TAKEN' }));
  });

  it('audit-service unavailable AND a Claude failure together: still returns AGENT_ERROR, never throws out of execute()', async () => {
    const claudeClient: IClaudeClient = { runWithTools: vi.fn(async () => { throw new Error('billing/credit exhaustion'); }) } as any;
    const auditLogger: IAuditLogger = {
      log: vi.fn(async () => { throw new Error('pool exhausted'); }),
      getByTenant: vi.fn(), getById: vi.fn(), resolveHumanRequired: vi.fn(),
    };
    const eventPublisher: IEventPublisher = { publish: vi.fn(async () => {}), subscribe: vi.fn() };
    const agent = new FakeAgent(claudeClient, auditLogger, eventPublisher);

    await expect(agent.execute(fakeContext(), fakeTrigger())).resolves.toMatchObject({ outcome: 'AGENT_ERROR', humanRequired: true });
    expect(eventPublisher.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'AGENT_HUMAN_REQUIRED' }));
  });
});
