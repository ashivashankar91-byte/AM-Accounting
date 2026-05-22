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
    const result = await this.claudeClient.runWithTools(
      this.getSystemPrompt(tenantContext),
      this.buildUserMessage(trigger),
      this.buildTools(tenantContext),
      this.buildToolExecutor(tenantContext),
    );

    const auditEntry: AuditEntry = {
      agentName: this.getAgentName(),
      tenantId: tenantContext.tenantId,
      actionTaken: result.actionTaken,
      outcome: result.outcome,
      humanRequired: result.humanRequired,
      details: result.details,
    };
    await this.auditLogger.log(auditEntry);

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
