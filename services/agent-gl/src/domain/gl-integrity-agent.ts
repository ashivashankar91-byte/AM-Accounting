import {
  BaseAgent,
  TenantContext,
  AnthropicTool,
  ToolExecutor,
  IAgentWriteTools,
  DomainEvent,
} from '@amacc/shared-kernel';

export class GLIntegrityAgent extends BaseAgent {
  private tools: IAgentWriteTools | null = null;

  setTools(tools: IAgentWriteTools): void {
    this.tools = tools;
  }

  getAgentName(): string {
    return 'gl-integrity';
  }

  getSystemPrompt(context: TenantContext): string {
    return `You are the GL Integrity Agent for tenant ${context.tenantId}.
Your job is to review journal entries submitted for posting and check for:
1. Duplicate entries (same source_ref within the last 5 minutes)
2. GL account type correctness (e.g., revenue posting to an asset account = flag)
3. Debit/credit balance (must be equal)
4. Unusual amounts (>3x the 30-day average = warn)
5. Module source integrity: If moduleSource is SERVICE_RO on some lines, verify that BOTH a labor revenue line (account 4100) AND a tech pay accrual line (account 2200) exist for the same roNumber. If either is missing, flag as CRITICAL — this means service revenue is booked without matching tech pay.
6. Parts margin validation: If any line has partNumber populated, verify that both a parts revenue line (4200) and a parts COS line (5200) exist for the same partNumber. Calculate implied margin = (revenue - COS) / revenue. If margin < 0 (negative), flag as WARN.
7. Department consistency: If departmentCode is populated on some lines within the same entry but missing on others, flag as INFO — inconsistent department tagging.
8. Deal product completeness: If dealProductCode is populated on any line, verify the entry has at least one DealProductLine record associated. If products are referenced but no detail exists, flag as WARN.
9. Cross-module contamination: If moduleSource differs across lines within the same journal entry (e.g., one line says SERVICE_EOD and another says PARTS_EOD), flag as WARN — entries should come from a single writer module.

If the entry looks clean, approve it by calling post_journal_entry.
If suspicious, flag it for human review with a clear reason.
Always explain your reasoning.`;
  }

  buildTools(_context: TenantContext): AnthropicTool[] {
    return [
      {
        name: 'get_journal_entries',
        description: 'Get recent journal entries for this tenant to check for duplicates',
        input_schema: {
          type: 'object',
          properties: {
            dateFrom: { type: 'string', description: 'ISO date string' },
            status: { type: 'string', enum: ['DRAFT', 'POSTED', 'REVERSED'] },
          },
        },
      },
      {
        name: 'get_gl_accounts',
        description: 'Get all GL accounts for this tenant',
        input_schema: { type: 'object', properties: {} },
      },
      {
        name: 'get_trial_balance',
        description: 'Get trial balance for a period',
        input_schema: {
          type: 'object',
          properties: {
            year: { type: 'number' },
            month: { type: 'number' },
          },
          required: ['year', 'month'],
        },
      },
      {
        name: 'post_journal_entry',
        description: 'Approve and post a journal entry',
        input_schema: {
          type: 'object',
          properties: { entryId: { type: 'string' } },
          required: ['entryId'],
        },
      },
      {
        name: 'get_journal_lines_by_tech',
        description: 'Get all journal lines for a specific technician in a period',
        input_schema: {
          type: 'object',
          properties: {
            technicianId: { type: 'string' },
            dateFrom: { type: 'string', description: 'ISO date' },
            dateTo: { type: 'string', description: 'ISO date' },
          },
          required: ['technicianId'],
        },
      },
      {
        name: 'get_journal_lines_by_part',
        description: 'Get all journal lines for a specific part number',
        input_schema: {
          type: 'object',
          properties: {
            partNumber: { type: 'string' },
            dateFrom: { type: 'string', description: 'ISO date' },
          },
          required: ['partNumber'],
        },
      },
      {
        name: 'get_journal_lines_by_module',
        description: 'Get all journal lines grouped by moduleSource for an entry',
        input_schema: {
          type: 'object',
          properties: {
            entryId: { type: 'string' },
          },
          required: ['entryId'],
        },
      },
      {
        name: 'flag_for_human_review',
        description: 'Flag an entity for human review',
        input_schema: {
          type: 'object',
          properties: {
            entityType: { type: 'string' },
            entityId: { type: 'string' },
            reason: { type: 'string' },
            severity: { type: 'string', enum: ['INFO', 'WARN', 'CRITICAL'] },
          },
          required: ['entityType', 'entityId', 'reason', 'severity'],
        },
      },
    ];
  }

  buildToolExecutor(context: TenantContext): ToolExecutor {
    return async (toolName: string, input: Record<string, unknown>): Promise<unknown> => {
      if (!this.tools) throw new Error('Tools not initialized');

      switch (toolName) {
        case 'get_journal_entries':
          return this.tools.getJournalEntries(context.tenantId, {
            dateFrom: input['dateFrom'] ? new Date(input['dateFrom'] as string) : undefined,
            status: input['status'] as any,
          });
        case 'get_gl_accounts':
          return this.tools.getGLAccounts(context.tenantId);
        case 'get_trial_balance':
          return this.tools.getTrialBalance(context.tenantId, {
            year: input['year'] as number,
            month: input['month'] as number,
          } as any);
        case 'post_journal_entry':
          await this.tools.postJournalEntry(input['entryId'] as string);
          return { success: true };
        case 'flag_for_human_review':
          await this.tools.flagForHumanReview(
            { entityType: input['entityType'] as string, entityId: input['entityId'] as string },
            input['reason'] as string,
            input['severity'] as any,
          );
          return { flagged: true };
        default:
          return { error: `Unknown tool: ${toolName}` };
      }
    };
  }

  protected buildUserMessage(trigger: DomainEvent): string {
    return `A journal entry has been submitted for posting.
Entry ID: ${trigger.payload['entryId']}
Description: ${trigger.payload['description'] ?? 'N/A'}
Total Lines: ${trigger.payload['lineCount'] ?? 'Unknown'}
Total Debits: $${trigger.payload['totalDebits'] ?? 0}

Please review this entry for integrity issues before approving it for posting.`;
  }
}
