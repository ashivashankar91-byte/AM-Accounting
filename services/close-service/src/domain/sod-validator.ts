import { SoDPolicy } from '@amacc/shared-kernel';

export class SoDViolationError extends Error {
  constructor(msg: string) { super(msg); this.name = 'SoDViolationError'; }
}

export interface SoDContext {
  tenantId: string;
  legalEntityId: string;
  periodYear: number;
  periodMonth: number;
  actor: string;
  overriderIds: string[];
}

export function validateFinalCloseActor(ctx: SoDContext): void {
  if (ctx.overriderIds.includes(ctx.actor)) {
    throw new SoDViolationError(
      `Actor ${ctx.actor} has previously overridden exceptions for this period and cannot grant final close`
    );
  }
}

export function validateReopenActor(initiatorId: string, approverId: string): void {
  if (initiatorId === approverId) {
    throw new SoDViolationError('Reopen initiator and approver must be different users');
  }
}

export function createDefaultSoDPolicy(tenantId: string, legalEntityId: string): SoDPolicy {
  return {
    id: `default-${tenantId}-${legalEntityId}`,
    tenantId,
    legalEntityId,
    version: 1,
    status: 'ACTIVE',
    conflicts: [],
    requesterApproverBarrier: true,
    authorActivatorBarrier: true,
    preparerPosterBarrier: true,
    migrationPreparerApproverBarrier: true,
    automationIdentityRestrictions: [],
    effectiveFrom: new Date('2024-01-01'),
    authorId: 'system',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
}
