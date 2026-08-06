import type { SoDPolicy, SoDEvaluationContext, SoDEvaluationResult } from './types';

export interface ISoDPolicyStore {
  getActivePolicy(tenantId: string, legalEntityId?: string): Promise<SoDPolicy | null>;
  evaluate(ctx: SoDEvaluationContext): Promise<SoDEvaluationResult>;
  saveDraft(policy: Omit<SoDPolicy, 'id' | 'createdAt' | 'updatedAt' | 'version'>): Promise<SoDPolicy>;
  validatePolicy(policy: SoDPolicy): string[];
  activatePolicy(policyId: string, actorId: string): Promise<SoDPolicy>;
  supersedePolicy(policyId: string, newPolicyId: string, actorId: string): Promise<void>;
  getAuditHistory(tenantId: string, legalEntityId?: string): Promise<SoDPolicy[]>;
}
