import {
  BaseAgent, TenantContext, AnthropicTool, ToolExecutor,
  IAgentWriteTools, DomainEvent,
} from '@amacc/shared-kernel';

export class PayrollIntegrityAgent extends BaseAgent {
  private tools: IAgentWriteTools | null = null;
  setTools(tools: IAgentWriteTools): void { this.tools = tools; }
  getAgentName(): string { return 'payroll-integrity'; }

  getSystemPrompt(context: TenantContext): string {
    return `You are the Payroll Integrity Agent for tenant ${context.tenantId}.
Check payroll batches for:
1. Idempotency key uniqueness (same key in 24h = duplicate → REJECT)
2. Total amount vs prior period (>15% variance = warn)
3. GL account mapping completeness
4. Batch period overlap detection
5. Earning code validation: For each PayrollLine, verify the earningCode maps to a valid GL expense account. If unmapped, flag with the specific earning code in the message so the accountant can fix the mapping.
6. Tech hours cross-check: For technicians in the payroll batch, compare flatRateHours from payroll to the sum of flatRateHours on SERVICE_RO journal lines for the same period. If variance > 10%, flag — techs may be paid for unbilled hours or vice versa.
7. Department allocation: For each PayrollLine with departmentCode, verify the department is a valid cost center. Flag if payroll is posted to an invalid or inactive department.
8. Per-employee variance: Compare each individual employee's total pay to their prior period total (not just the batch total). Flag if any single employee's pay changes by more than 50% — this catches individual errors hidden in aggregate totals.

Actions: PASS (auto-post eligible), HOLD (needs human), REJECT (clear duplicate)`;
  }

  buildTools(_context: TenantContext): AnthropicTool[] {
    return [
      { name: 'get_payroll_batch', description: 'Get payroll batch details', input_schema: { type: 'object', properties: { batchId: { type: 'string' } }, required: ['batchId'] } },
      { name: 'hold_payroll_batch', description: 'Hold a payroll batch for human review', input_schema: { type: 'object', properties: { batchId: { type: 'string' }, reason: { type: 'string' } }, required: ['batchId', 'reason'] } },
      { name: 'flag_for_human_review', description: 'Flag for human review', input_schema: { type: 'object', properties: { entityType: { type: 'string' }, entityId: { type: 'string' }, reason: { type: 'string' }, severity: { type: 'string', enum: ['INFO', 'WARN', 'CRITICAL'] } }, required: ['entityType', 'entityId', 'reason', 'severity'] } },
      {
        name: 'get_payroll_lines',
        description: 'Get line-level detail for a payroll batch including employee, earning codes, hours, and departments',
        input_schema: {
          type: 'object',
          properties: { batchId: { type: 'string' } },
          required: ['batchId'],
        },
      },
    ];
  }

  buildToolExecutor(context: TenantContext): ToolExecutor {
    return async (toolName, input) => {
      if (!this.tools) throw new Error('Tools not set');
      switch (toolName) {
        case 'get_payroll_batch': return this.tools.getPayrollBatch(input['batchId'] as string);
        case 'hold_payroll_batch': await this.tools.holdPayrollBatch(input['batchId'] as string, input['reason'] as string); return { held: true };
        case 'flag_for_human_review': await this.tools.flagForHumanReview({ entityType: input['entityType'] as string, entityId: input['entityId'] as string }, input['reason'] as string, input['severity'] as any); return { flagged: true };
        default: return { error: `Unknown tool: ${toolName}` };
      }
    };
  }

  protected buildUserMessage(trigger: DomainEvent): string {
    return `Payroll batch submitted for validation. Batch ID: ${trigger.payload['batchId']}, Total: $${trigger.payload['totalAmount']}, Ref: ${trigger.payload['batchRef']}. Please validate this batch.`;
  }
}
