import {
  BaseAgent, TenantContext, AnthropicTool, ToolExecutor,
  IAgentWriteTools, DomainEvent,
} from '@amacc/shared-kernel';

export class T1CopilotAgent extends BaseAgent {
  private tools: IAgentWriteTools | null = null;
  setTools(tools: IAgentWriteTools): void { this.tools = tools; }
  getAgentName(): string { return 't1-copilot'; }

  getSystemPrompt(context: TenantContext): string {
    return `You are the T1 Accounting Copilot for AMACC — the comprehensive AI-powered Automotive Accounting Cloud platform.

## Current Context
- Tenant: ${context.tenantId}
- Dealer: ${context.dealerName ?? 'Unknown'}
- User: ${context.userName ?? 'Unknown'} (${context.userRole ?? 'DEALER_ACCOUNTANT'})
- DMS: ${context.dmsType}
- OEMs: ${(context.oems ?? []).join(', ') || 'Not configured'}

## Capabilities
You have full access to the dealership's accounting data and can:

### Read Operations
- Query GL accounts, journal entries, trial balances
- Check EOM close progress and identify blockers
- View payroll batch status and details
- Preview OEM Financial Statements (GM/Ford/etc.)
- Check pending approval requests
- Review EOM readiness across departments
- Query technician productivity (flatRateHours vs clockHours by tech)
- View parts gross profit by part number
- Break down payroll by earning code and employee
- Generate department-level P&L from journal line departmentCodes
- View deal F&I product profitability from DealProductLine data

### Write Operations (Require Approval for High-Impact)
- Post validated journal entries
- Hold/release payroll batches
- Create correcting journal entries
- Request approval for significant actions
- Flag items for human review

## OEM Financial Statements
For GM dealers: Generate GM Standard Financial Statement format
For Ford dealers: Generate Ford OWS (Online Warranty System) format
You can preview FS before submission, validate for errors, and submit when ready.

## Approval Workflow
Actions that exceed thresholds or affect posted data require approval from an AGENT_APPROVER.
When you encounter such actions, use request_approval to create an approval request.
The user will be notified and can approve/reject from the Approvals page.

## Guidelines
- Always be precise with dollar amounts (amounts in cents internally, display as dollars)
- Reference specific account codes (e.g., 4100 Service Labor Sales)
- When you take an action, explain what you did and why
- For large corrections, recommend splitting into smaller entries
- If unsure, flag for human review rather than guessing

## Example Queries
"Why is our trial balance out by $4,200?"
"Show me the March financial statement preview for GM"
"What is blocking our March EOM close?"
"How many pending approvals do we have?"
"Post all validated journal entries for today"
"Show me warranty labor vs customer-pay breakdown"
"Show me technician productivity — who has the best flat-rate efficiency?"
"What is our parts gross profit by part number this month?"
"Break down payroll by earning code for the last pay period"
"Show me department-level P&L for March"
"Which F&I products are most profitable per deal?"
"Compare tech #T001's billed hours vs paid hours"`;
  }

  buildTools(_context: TenantContext): AnthropicTool[] {
    return [
      { name: 'get_gl_accounts', description: 'Get all GL accounts for the tenant', input_schema: { type: 'object', properties: {} } },
      { name: 'get_journal_entries', description: 'Get journal entries with optional filters', input_schema: { type: 'object', properties: { dateFrom: { type: 'string' }, dateTo: { type: 'string' }, status: { type: 'string', enum: ['DRAFT', 'POSTED', 'REVERSED', 'PENDING', 'HELD'] }, source: { type: 'string' } } } },
      { name: 'get_trial_balance', description: 'Get trial balance for a specific period', input_schema: { type: 'object', properties: { year: { type: 'number' }, month: { type: 'number' } }, required: ['year', 'month'] } },
      { name: 'get_payroll_batch', description: 'Get a specific payroll batch', input_schema: { type: 'object', properties: { batchId: { type: 'string' } }, required: ['batchId'] } },
      { name: 'get_eom_steps', description: 'Get EOM close steps and identify blockers', input_schema: { type: 'object', properties: { closeId: { type: 'string' } }, required: ['closeId'] } },
      { name: 'get_fs_preview', description: 'Get OEM Financial Statement preview for a period', input_schema: { type: 'object', properties: { period: { type: 'string', description: 'Period in YYYY-MM format' }, oem: { type: 'string', enum: ['GM', 'FORD', 'FCA', 'TOYOTA', 'HONDA'] } }, required: ['period', 'oem'] } },
      { name: 'get_pending_approvals', description: 'Get pending approval requests for the tenant', input_schema: { type: 'object', properties: {} } },
      { name: 'get_eom_readiness', description: 'Get EOM readiness report across all departments', input_schema: { type: 'object', properties: { year: { type: 'number' }, month: { type: 'number' } }, required: ['year', 'month'] } },
      { name: 'post_journal_entry', description: 'Post a journal entry', input_schema: { type: 'object', properties: { entryId: { type: 'string' } }, required: ['entryId'] } },
      { name: 'hold_payroll_batch', description: 'Hold a payroll batch for review', input_schema: { type: 'object', properties: { batchId: { type: 'string' }, reason: { type: 'string' } }, required: ['batchId', 'reason'] } },
      { name: 'create_journal_entry', description: 'Create a new journal entry', input_schema: { type: 'object', properties: { description: { type: 'string' }, lines: { type: 'array', items: { type: 'object', properties: { glAccountId: { type: 'string' }, glAccountCode: { type: 'string' }, debit: { type: 'number' }, credit: { type: 'number' }, memo: { type: 'string' } } } } }, required: ['description', 'lines'] } },
      { name: 'request_approval', description: 'Request human approval for a significant action', input_schema: { type: 'object', properties: { actionType: { type: 'string' }, entityRef: { type: 'string' }, reasoning: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } } }, required: ['actionType', 'entityRef', 'reasoning'] } },
      { name: 'flag_for_human_review', description: 'Flag an item for human review', input_schema: { type: 'object', properties: { entityType: { type: 'string' }, entityId: { type: 'string' }, reason: { type: 'string' }, severity: { type: 'string', enum: ['INFO', 'WARN', 'CRITICAL'] } }, required: ['entityType', 'entityId', 'reason', 'severity'] } },
      {
        name: 'get_tech_productivity',
        description: 'Get technician productivity metrics: flatRateHours vs clockHours for a period',
        input_schema: {
          type: 'object',
          properties: {
            technicianId: { type: 'string', description: 'Optional — omit for all techs' },
            period: { type: 'string', description: 'YYYY-MM format' },
          },
          required: ['period'],
        },
      },
      {
        name: 'get_parts_profitability',
        description: 'Get parts gross profit breakdown by part number for a period',
        input_schema: {
          type: 'object',
          properties: {
            period: { type: 'string', description: 'YYYY-MM format' },
            topN: { type: 'number', description: 'Return top N parts by profit (default 20)' },
          },
          required: ['period'],
        },
      },
      {
        name: 'get_payroll_by_earning_code',
        description: 'Break down payroll amounts by earning code for a batch or period',
        input_schema: {
          type: 'object',
          properties: {
            batchId: { type: 'string' },
            period: { type: 'string', description: 'YYYY-MM format' },
          },
        },
      },
      {
        name: 'get_department_pl',
        description: 'Get department-level P&L from journal line departmentCodes',
        input_schema: {
          type: 'object',
          properties: {
            period: { type: 'string', description: 'YYYY-MM format' },
            departmentCode: { type: 'string', description: 'Optional — omit for all departments' },
          },
          required: ['period'],
        },
      },
      {
        name: 'get_deal_product_profitability',
        description: 'Get F&I product profitability from DealProductLine data',
        input_schema: {
          type: 'object',
          properties: {
            period: { type: 'string', description: 'YYYY-MM format' },
          },
          required: ['period'],
        },
      },
    ];
  }

  buildToolExecutor(context: TenantContext): ToolExecutor {
    return async (toolName, input) => {
      if (!this.tools) throw new Error('Tools not set');
      switch (toolName) {
        case 'get_gl_accounts': return this.tools.getGLAccounts(context.tenantId);
        case 'get_journal_entries': return this.tools.getJournalEntries(context.tenantId, {
          dateFrom: input['dateFrom'] ? new Date(input['dateFrom'] as string) : undefined,
          dateTo: input['dateTo'] ? new Date(input['dateTo'] as string) : undefined,
          status: input['status'] as any,
          source: input['source'] as string,
        });
        case 'get_trial_balance': return this.tools.getTrialBalance(context.tenantId, { year: input['year'] as number, month: input['month'] as number } as any);
        case 'get_payroll_batch': return this.tools.getPayrollBatch(input['batchId'] as string);
        case 'get_eom_steps': return this.tools.getEOMSteps(input['closeId'] as string);
        case 'get_fs_preview': return (this.tools as any).getFSPreview?.(context.tenantId, input['period'] as string, input['oem'] as string) ?? { error: 'FS preview not available' };
        case 'get_pending_approvals': return (this.tools as any).getPendingApprovals?.(context.tenantId) ?? [];
        case 'get_eom_readiness': return (this.tools as any).getEOMReadiness?.(context.tenantId, { year: input['year'] as number, month: input['month'] as number }) ?? { error: 'EOM readiness not available' };
        case 'post_journal_entry': await this.tools.postJournalEntry(input['entryId'] as string); return { posted: true };
        case 'hold_payroll_batch': await this.tools.holdPayrollBatch(input['batchId'] as string, input['reason'] as string); return { held: true };
        case 'create_journal_entry': return this.tools.createJournalEntry(context.tenantId, (input['lines'] as any[]) ?? []);
        case 'request_approval': return (this.tools as any).requestApproval?.(context.tenantId, input as any) ?? { error: 'Approvals not available' };
        case 'flag_for_human_review': await this.tools.flagForHumanReview({ entityType: input['entityType'] as string, entityId: input['entityId'] as string }, input['reason'] as string, input['severity'] as any); return { flagged: true };
        default: return { error: `Unknown tool: ${toolName}` };
      }
    };
  }

  protected buildUserMessage(trigger: DomainEvent): string {
    return trigger.payload['message'] as string ?? 'Hello';
  }
}
