import { IClaudeClient, IAuditLogger, IEventPublisher } from '../interfaces';
import {
  TenantContext,
  AnthropicTool,
  ToolExecutor,
  AgentResult,
  AuditEntry,
} from '../types';
import { DomainEvent } from '../events';

/**
 * Abstract base class for all AMACC AI agents.
 * Satisfies Liskov Substitution — any agent can be used wherever BaseAgent is expected.
 */
export abstract class BaseAgent {
  constructor(
    protected readonly claudeClient: IClaudeClient,
    protected readonly auditLogger: IAuditLogger,
    protected readonly eventPublisher: IEventPublisher,
  ) {}

  abstract getAgentName(): string;
  abstract getSystemPrompt(context: TenantContext): string;
  abstract buildTools(context: TenantContext): AnthropicTool[];
  abstract buildToolExecutor(context: TenantContext): ToolExecutor;

  async execute(tenantContext: TenantContext, trigger: DomainEvent): Promise<AgentResult> {
    let result: AgentResult;
    try {
      result = await this.claudeClient.runWithTools(
        this.getSystemPrompt(tenantContext),
        this.buildUserMessage(trigger),
        this.buildTools(tenantContext),
        this.buildToolExecutor(tenantContext),
      );
    } catch (err) {
      // Without this catch, any Claude API failure (rate limit, outage,
      // billing/credit exhaustion, etc.) propagates out of execute() and
      // into the event-publisher's consume() handler, which nacks/requeues
      // the message up to MAX_DELIVERY_ATTEMPTS and then dead-letters it —
      // silently, with no audit_action_logs row ever written. That defeats
      // the entire point of the Agents dashboard (PO-DEC-001): a real
      // review attempt happened and failed, but nothing records it, so the
      // PENDING_REVIEW entry just sits until the 30s auto-approve timeout
      // fires with zero explanation of why the agent never weighed in.
      // Treat a Claude/tool-execution failure as a result requiring human
      // review instead, so it's always logged and always visible.
      result = {
        agentName: this.getAgentName(),
        actionTaken: 'NONE',
        outcome: 'AGENT_ERROR',
        humanRequired: true,
        details: { error: err instanceof Error ? err.message : String(err) },
      };
    }

    const auditEntry: AuditEntry = {
      agentName: this.getAgentName(),
      tenantId: tenantContext.tenantId,
      actionTaken: result.actionTaken,
      outcome: result.outcome,
      humanRequired: result.humanRequired,
      details: result.details,
    };
    try {
      await this.auditLogger.log(auditEntry);
    } catch (err) {
      // A persistence-layer outage (e.g. agent_action_logs' Postgres
      // unreachable) must not be indistinguishable from an agent failure.
      // Uncaught, this throw would propagate out of execute() into the
      // event-publisher's consume() handler, which treats it exactly like
      // a Claude/tool failure: nack, requeue with an incremented attempt
      // counter, and eventually dead-letter after MAX_DELIVERY_ATTEMPTS —
      // even though the agent action itself genuinely succeeded (or was
      // already correctly classified as AGENT_ERROR above) and only the
      // audit write failed. Log the persistence failure to stderr/pino and
      // continue: the real result is still returned and the domain events
      // below still publish, so downstream automation (and a human, via
      // the dashboard once persistence recovers) isn't blocked by a
      // transient audit-store outage.
      console.error('agent_action_logs write failed (audit-service/Postgres unavailable):', err);
    }

    if (result.humanRequired) {
      await this.eventPublisher.publish({
        type: 'AGENT_HUMAN_REQUIRED',
        tenantId: tenantContext.tenantId,
        payload: {
          agentName: this.getAgentName(),
          ...result.details,
        },
        occurredAt: new Date(),
        correlationId: crypto.randomUUID(),
      });
    }

    await this.eventPublisher.publish({
      type: 'AGENT_ACTION_TAKEN',
      tenantId: tenantContext.tenantId,
      payload: {
        agentName: this.getAgentName(),
        actionTaken: result.actionTaken,
        outcome: result.outcome,
      },
      occurredAt: new Date(),
      correlationId: crypto.randomUUID(),
    });

    return result;
  }

  protected abstract buildUserMessage(trigger: DomainEvent): string;
}
