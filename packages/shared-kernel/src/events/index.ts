// ── Domain Events ──────────────────────────────────────
export interface DomainEvent {
  readonly type: EventType;
  readonly tenantId: string;
  readonly payload: Record<string, unknown>;
  readonly occurredAt: Date;
  readonly correlationId: string;
}

export type EventType =
  // GL events
  | 'JOURNAL_ENTRY_SUBMITTED'
  | 'JOURNAL_ENTRY_POSTED'
  | 'JOURNAL_ENTRY_HELD'
  | 'GL_ANOMALY_DETECTED'
  // EOM events
  | 'EOM_CLOSE_INITIATED'
  | 'EOM_STEP_CHANGED'
  | 'EOM_CLOSE_BLOCKED'
  | 'EOM_CLOSE_COMPLETED'
  | 'TRIAL_BALANCE_READY'
  // FS events
  | 'FS_PREVIEW_READY'
  | 'FS_LINE_ANOMALY_DETECTED'
  | 'FS_SUBMITTED'
  | 'FS_ACCEPTED_BY_OEM'
  | 'FS_REJECTED_BY_OEM'
  | 'COA_MAPPING_GAP_DETECTED'
  | 'COA_VERSION_UPDATED'
  // Payroll events
  | 'PAYROLL_BATCH_SUBMITTED'
  | 'PAYROLL_BATCH_HELD'
  | 'PAYROLL_BATCH_POSTED'
  // AP/AR events
  | 'OEM_REMITTANCE_IMPORTED'
  | 'BANK_RECON_STARTED'
  | 'BANK_RECON_COMPLETED'
  // Agent events
  | 'AGENT_HUMAN_REQUIRED'
  | 'AGENT_ACTION_TAKEN'
  | 'AGENT_ACTION_APPROVED'
  | 'AGENT_ACTION_REJECTED'
  // Approval events
  | 'APPROVAL_REQUESTED'
  | 'APPROVAL_GRANTED'
  | 'APPROVAL_REJECTED'
  | 'APPROVAL_EXPIRED'
  // Onboarding events
  | 'TENANT_PROVISIONED'
  | 'TENANT_UPDATED'
  | 'DMS_SYNC_COMPLETED'
  | 'LEGACY_GL_MAPPED'
  | 'ONBOARDING_COMPLETED'
  // Connector events (new — line-level detail)
  | 'SERVICE_RO_CLOSED'
  | 'PARTS_INVOICE_CLOSED'
  | 'DEAL_PRODUCT_DETAIL_RECEIVED'
  | 'VEHICLE_PURCHASED'
  | 'VEHICLE_TRANSFERRED'
  | 'PAYROLL_LINES_SUBMITTED'
  | 'FINANCE_CHARGE_POSTED'
  | 'CREDIT_CARD_BATCH_SETTLED'
  | 'CASH_RECEIPT_DETAILED'
  | 'YEAR_END_CLOSE_POSTED'
  | 'AMDB_DROPMATE_IMPORTED'
  // Cross-service reconciliation events
  | 'TECH_HOURS_RECONCILED'
  | 'DEPARTMENT_PL_READY'
  // Wave 1-4 events
  | 'YEAR_END_COMPLETED'
  | 'SCHEDULE_PURGED'
  | 'SCHEDULE_DETAIL_REQUESTED'
  | 'SCHEDULE_GL_ACCOUNTS_CHANGED'
  | 'SCHEDULE_DELETED'
  | 'GL_INTEGRITY_ALERT'
  | 'COMPLIANCE_ALERT'
  | 'THIRTEENTH_MONTH_FINALIZED';

export function createEvent(
  type: EventType,
  tenantId: string,
  payload: Record<string, unknown>,
): DomainEvent {
  return {
    type,
    tenantId,
    payload,
    occurredAt: new Date(),
    correlationId: crypto.randomUUID(),
  };
}

// ── Event Routing Map ──────────────────────────────────
export const EVENT_ROUTING: Record<EventType, string[]> = {
  // GL
  JOURNAL_ENTRY_SUBMITTED:  ['agent-gl'],
  JOURNAL_ENTRY_POSTED:     ['audit-service', 'fs-service'],
  JOURNAL_ENTRY_HELD:       ['notification-service', 'audit-service'],
  GL_ANOMALY_DETECTED:      ['agent-t1', 'notification-service'],
  // EOM
  EOM_CLOSE_INITIATED:      ['agent-eom', 'audit-service'],
  EOM_STEP_CHANGED:         ['agent-eom'],
  EOM_CLOSE_BLOCKED:        ['notification-service', 'agent-eom', 'agent-t1'],
  EOM_CLOSE_COMPLETED:      ['fs-service', 'audit-service'],
  TRIAL_BALANCE_READY:      ['fs-service', 'agent-t1'],
  // FS
  FS_PREVIEW_READY:         ['agent-t1', 'notification-service'],
  FS_LINE_ANOMALY_DETECTED: ['agent-t1', 'notification-service'],
  FS_SUBMITTED:             ['audit-service', 'notification-service'],
  FS_ACCEPTED_BY_OEM:       ['audit-service', 'notification-service'],
  FS_REJECTED_BY_OEM:       ['agent-t1', 'notification-service'],
  COA_MAPPING_GAP_DETECTED: ['agent-t1', 'notification-service'],
  COA_VERSION_UPDATED:      ['notification-service'],
  // Payroll
  PAYROLL_BATCH_SUBMITTED:  ['agent-payroll'],
  PAYROLL_BATCH_HELD:       ['notification-service', 'audit-service'],
  PAYROLL_BATCH_POSTED:     ['audit-service'],
  // AP/AR
  OEM_REMITTANCE_IMPORTED:  ['agent-apar'],
  BANK_RECON_STARTED:       ['agent-apar'],
  BANK_RECON_COMPLETED:     ['audit-service'],
  // Agent
  AGENT_HUMAN_REQUIRED:     ['approval-service', 'notification-service'],
  AGENT_ACTION_TAKEN:       ['audit-service'],
  AGENT_ACTION_APPROVED:    [],
  AGENT_ACTION_REJECTED:    [],
  // Approval
  APPROVAL_REQUESTED:       ['notification-service'],
  APPROVAL_GRANTED:         ['audit-service'],
  APPROVAL_REJECTED:        ['audit-service'],
  APPROVAL_EXPIRED:         ['notification-service', 'audit-service'],
  // Onboarding
  TENANT_PROVISIONED:       ['coa-service', 'gl-service', 'notification-service', 'audit-service'],
  TENANT_UPDATED:           ['audit-service'],
  DMS_SYNC_COMPLETED:       ['agent-gl', 'notification-service'],
  LEGACY_GL_MAPPED:         ['audit-service'],
  ONBOARDING_COMPLETED:     ['notification-service', 'audit-service'],
  // Connector line-level events
  SERVICE_RO_CLOSED:              ['agent-gl', 'gl-service', 'audit-service'],
  PARTS_INVOICE_CLOSED:           ['agent-gl', 'gl-service', 'audit-service'],
  DEAL_PRODUCT_DETAIL_RECEIVED:   ['agent-gl', 'gl-service', 'audit-service'],
  VEHICLE_PURCHASED:              ['agent-gl', 'gl-service', 'audit-service'],
  VEHICLE_TRANSFERRED:            ['agent-gl', 'gl-service', 'audit-service'],
  PAYROLL_LINES_SUBMITTED:        ['agent-payroll', 'payroll-service', 'audit-service'],
  FINANCE_CHARGE_POSTED:          ['agent-gl', 'gl-service', 'audit-service'],
  CREDIT_CARD_BATCH_SETTLED:      ['agent-gl', 'gl-service', 'audit-service'],
  CASH_RECEIPT_DETAILED:          ['agent-gl', 'gl-service', 'audit-service'],
  YEAR_END_CLOSE_POSTED:          ['agent-eom', 'gl-service', 'audit-service'],
  AMDB_DROPMATE_IMPORTED:         ['agent-gl', 'gl-service', 'audit-service'],
  TECH_HOURS_RECONCILED:          ['agent-gl', 'notification-service', 'audit-service'],
  DEPARTMENT_PL_READY:            ['agent-eom', 'agent-t1', 'fs-service', 'audit-service'],
  // Wave 1-4 events
  YEAR_END_COMPLETED:             ['fs-service', 'audit-service', 'notification-service'],
  SCHEDULE_PURGED:                ['audit-service', 'notification-service'],
  SCHEDULE_DETAIL_REQUESTED:      ['gl-service'],
  SCHEDULE_GL_ACCOUNTS_CHANGED:   ['gl-service', 'audit-service'],
  SCHEDULE_DELETED:               ['gl-service', 'audit-service'],
  GL_INTEGRITY_ALERT:             ['agent-t1', 'notification-service', 'audit-service'],
  COMPLIANCE_ALERT:               ['notification-service', 'audit-service'],
  THIRTEENTH_MONTH_FINALIZED:     ['fs-service', 'audit-service', 'notification-service'],
};
