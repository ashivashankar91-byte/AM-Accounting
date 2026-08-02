// CE-13 RBAC gap-closure — mirrors the exact keys defined server-side in
// services/payroll-service/src/http/security.ts (PAYROLL_PERMISSIONS) and
// seeded by the auth-service catalog migration
// 20260803000000_add_ce13_payroll_permissions. Kept as a plain literal
// object (not imported cross-package) since the frontend has no build-time
// dependency on payroll-service's source.
export const PAYROLL_PERMISSIONS = {
  CONFIG_VIEW: 'payroll.config.view',
  CONFIG_MANAGE: 'payroll.config.manage',
  SOURCE_MODE_MANAGE: 'payroll.source_mode.manage',
  RULE_PACK_VIEW: 'payroll.rule_pack.view',
  RULE_PACK_MANAGE: 'payroll.rule_pack.manage',
  RULE_PACK_ACTIVATE: 'payroll.rule_pack.activate',
  BATCH_VIEW: 'payroll.batch.view',
  BATCH_CREATE: 'payroll.batch.create',
  BATCH_EDIT: 'payroll.batch.edit',
  BATCH_VALIDATE: 'payroll.batch.validate',
  BATCH_APPROVE: 'payroll.batch.approve',
  BATCH_HOLD_RELEASE: 'payroll.batch.hold_release',
  BATCH_POST: 'payroll.batch.post',
  BATCH_VOID_REVERSE: 'payroll.batch.void_reverse',
  COMMISSION_VIEW: 'payroll.commission.view',
  COMMISSION_MANAGE: 'payroll.commission.manage',
  COMMISSION_DISPUTE_RESOLVE: 'payroll.commission_dispute.resolve',
  CLAWBACK_VIEW: 'payroll.clawback.view',
  CLAWBACK_MANAGE: 'payroll.clawback.manage',
  ACCRUAL_VIEW: 'payroll.accrual.view',
  ACCRUAL_MANAGE: 'payroll.accrual.manage',
  ACCRUAL_APPROVE: 'payroll.accrual.approve',
  TECH_BRIDGE_VIEW: 'payroll.tech_bridge.view',
  TECH_BRIDGE_MANAGE: 'payroll.tech_bridge.manage',
  REGISTER_YTD_VIEW: 'payroll.register_ytd.view',
  AUDIT_VIEW: 'payroll.audit.view',
} as const;
