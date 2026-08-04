export type SoDRuleId = string;
export type SoDAction = string;
export type SoDRole = string;

export interface SoDConflict {
  id: SoDRuleId;
  description: string;
  action1: SoDAction;
  action2: SoDAction;
  reason: string;
}

export interface SoDPolicy {
  id: string;
  tenantId: string;
  legalEntityId?: string;
  version: number;
  status: 'DRAFT' | 'ACTIVE' | 'SUPERSEDED';
  conflicts: SoDConflict[];
  requesterApproverBarrier: boolean;
  authorActivatorBarrier: boolean;
  preparerPosterBarrier: boolean;
  migrationPreparerApproverBarrier: boolean;
  automationIdentityRestrictions: string[];
  effectiveFrom: Date;
  effectiveTo?: Date;
  authorId: string;
  activatedBy?: string;
  supersededBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SoDEvaluationContext {
  tenantId: string;
  legalEntityId?: string;
  actorId: string;
  action: SoDAction;
  relatedActorId?: string;
  relatedAction?: SoDAction;
  serviceIdentity?: string;
}

export interface SoDEvaluationResult {
  permitted: boolean;
  violations: SoDViolation[];
  policyVersion?: number;
}

export interface SoDViolation {
  ruleId: SoDRuleId;
  description: string;
  actorId: string;
  action: string;
}
