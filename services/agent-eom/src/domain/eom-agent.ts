import {
  BaseAgent, TenantContext, AnthropicTool, ToolExecutor,
  IAgentWriteTools, DomainEvent,
} from '@amacc/shared-kernel';

export class EOMOrchestrationAgent extends BaseAgent {
  private tools: IAgentWriteTools | null = null;
  setTools(tools: IAgentWriteTools): void { this.tools = tools; }
  getAgentName(): string { return 'eom-orchestration'; }

  getSystemPrompt(context: TenantContext): string {
    return `You are the EOM Orchestration Agent for tenant ${context.tenantId}.
You manage end-of-month close processes. The step dependency graph is:
Parts Close (062) → Parts Recon (065) → Service Close (068) → Variable Ops (071) → Fixed Ops (074) → Master Close (077)

Your job:
1. Check which steps are complete and what is blocking
2. Auto-advance eligible steps
3. Surface blocker root cause in plain English
4. Escalate after 3 retries with a human-readable summary

Additional data-integrity checks before advancing steps:
5. Before advancing step 068 (Service Close): Query all JournalLines where moduleSource = 'SERVICE_EOD' for this period. Verify every closed RO has at least one line with a technicianId populated. If any RO has no tech attribution, flag with the specific RO numbers — these will produce incomplete labor profitability reports.
6. Before advancing step 062 (Parts Close): Query all JournalLines where moduleSource = 'PARTS_EOD' or 'PARTS_CASHIERING'. Verify partQuantity > 0 on all parts lines. Lines with zero or null quantity indicate data ingestion issues.
7. Before step 077 (Master Close): Verify departmentCode is populated on at least 90% of all JournalLines for this period. If below 90%, warn — department-level P&L will be incomplete and the financial statement will have unattributed amounts.`;
  }

  buildTools(_context: TenantContext): AnthropicTool[] {
    return [
      { name: 'get_eom_steps', description: 'Get all steps for an EOM close', input_schema: { type: 'object', properties: { closeId: { type: 'string' } }, required: ['closeId'] } },
      { name: 'advance_eom_step', description: 'Advance to the next step', input_schema: { type: 'object', properties: { closeId: { type: 'string' }, stepCode: { type: 'string' } }, required: ['closeId', 'stepCode'] } },
      { name: 'flag_for_human_review', description: 'Escalate to human', input_schema: { type: 'object', properties: { entityType: { type: 'string' }, entityId: { type: 'string' }, reason: { type: 'string' }, severity: { type: 'string', enum: ['INFO', 'WARN', 'CRITICAL'] } }, required: ['entityType', 'entityId', 'reason', 'severity'] } },
    ];
  }

  buildToolExecutor(context: TenantContext): ToolExecutor {
    return async (toolName, input) => {
      if (!this.tools) throw new Error('Tools not set');
      switch (toolName) {
        case 'get_eom_steps': return this.tools.getEOMSteps(input['closeId'] as string);
        case 'advance_eom_step': await this.tools.advanceEOMStep(input['closeId'] as string, input['stepCode'] as string); return { advanced: true };
        case 'flag_for_human_review': await this.tools.flagForHumanReview({ entityType: input['entityType'] as string, entityId: input['entityId'] as string }, input['reason'] as string, input['severity'] as any); return { flagged: true };
        default: return { error: `Unknown tool: ${toolName}` };
      }
    };
  }

  protected buildUserMessage(trigger: DomainEvent): string {
    return `EOM step changed. Close ID: ${trigger.payload['closeId']}, Step: ${trigger.payload['stepCode']}. Please evaluate the current state and determine what to do next.`;
  }
}
