import {
  BaseAgent, TenantContext, AnthropicTool, ToolExecutor,
  IAgentWriteTools, DomainEvent,
} from '@amacc/shared-kernel';

export class APARReconAgent extends BaseAgent {
  private tools: IAgentWriteTools | null = null;
  setTools(tools: IAgentWriteTools): void { this.tools = tools; }
  getAgentName(): string { return 'apar-recon'; }

  getSystemPrompt(context: TenantContext): string {
    return `You are the AP/AR Reconciliation Agent for tenant ${context.tenantId}.
When OEM remittance is imported or bank recon starts:
1. Match warranty AR entries to remittance lines by claim number + amount
2. Flag unmatched AR older than 45 days
3. Identify short-payments
4. Auto-generate journal entries for matched items
5. Flag unmatched items for human review

Additional line-level validation:
6. Warranty labor rate verification: When matching warranty AR entries, verify that the labor amount = flatRateHours × OEM warranty labor rate for the technicianId on the RO. If mismatch > 5%, flag with both the claimed amount and the calculated amount — the dealer may be under-claiming or over-claiming.
7. Warranty parts matching: When matching parts warranty claims, verify that each partNumber on the warranty claim exists in the JournalLines for the same roNumber. If a part is claimed but not found on the RO, flag — this could indicate fraudulent claims or data entry errors.`;
  }

  buildTools(_context: TenantContext): AnthropicTool[] {
    return [
      { name: 'get_gl_accounts', description: 'Get GL accounts', input_schema: { type: 'object', properties: {} } },
      { name: 'get_journal_entries', description: 'Get journal entries', input_schema: { type: 'object', properties: { status: { type: 'string' } } } },
      { name: 'create_journal_entry', description: 'Create a new journal entry', input_schema: { type: 'object', properties: { description: { type: 'string' }, lines: { type: 'array', items: { type: 'object', properties: { glAccountId: { type: 'string' }, debit: { type: 'number' }, credit: { type: 'number' } } } } }, required: ['description', 'lines'] } },
      { name: 'flag_for_human_review', description: 'Flag for human review', input_schema: { type: 'object', properties: { entityType: { type: 'string' }, entityId: { type: 'string' }, reason: { type: 'string' }, severity: { type: 'string', enum: ['INFO', 'WARN', 'CRITICAL'] } }, required: ['entityType', 'entityId', 'reason', 'severity'] } },
    ];
  }

  buildToolExecutor(context: TenantContext): ToolExecutor {
    return async (toolName, input) => {
      if (!this.tools) throw new Error('Tools not set');
      switch (toolName) {
        case 'get_gl_accounts': return this.tools.getGLAccounts(context.tenantId);
        case 'get_journal_entries': return this.tools.getJournalEntries(context.tenantId, { status: input['status'] as any });
        case 'create_journal_entry': return this.tools.createJournalEntry(context.tenantId, (input['lines'] as any[]) ?? []);
        case 'flag_for_human_review': await this.tools.flagForHumanReview({ entityType: input['entityType'] as string, entityId: input['entityId'] as string }, input['reason'] as string, input['severity'] as any); return { flagged: true };
        default: return { error: `Unknown tool: ${toolName}` };
      }
    };
  }

  protected buildUserMessage(trigger: DomainEvent): string {
    if (trigger.type === 'OEM_REMITTANCE_IMPORTED') {
      return `OEM remittance has been imported with ${trigger.payload['count']} entries totaling $${trigger.payload['totalAmount']}. Please match AR entries and create journal entries for matched items.`;
    }
    return `Bank reconciliation started. Recon ID: ${trigger.payload['reconId']}. Please match transactions.`;
  }
}
