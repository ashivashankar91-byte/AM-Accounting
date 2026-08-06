import type { ISoDPolicyStore } from './ISoDPolicyStore';
import type { SoDPolicy, SoDEvaluationContext, SoDEvaluationResult, SoDViolation } from './types';

export class InMemorySoDPolicyStore implements ISoDPolicyStore {
  private policies = new Map<string, SoDPolicy>();
  private nextVersion = new Map<string, number>(); // key=tenantId+legalEntityId

  async getActivePolicy(tenantId: string, legalEntityId?: string): Promise<SoDPolicy | null> {
    for (const p of this.policies.values()) {
      if (p.tenantId === tenantId && p.legalEntityId === legalEntityId && p.status === 'ACTIVE') {
        return p;
      }
    }
    return null;
  }

  async evaluate(ctx: SoDEvaluationContext): Promise<SoDEvaluationResult> {
    const policy = await this.getActivePolicy(ctx.tenantId, ctx.legalEntityId);
    // Fail closed
    if (!policy) {
      return {
        permitted: false,
        violations: [{ ruleId: 'NO_ACTIVE_POLICY', description: 'No active SoD policy found — fail closed', actorId: ctx.actorId, action: ctx.action }],
      };
    }

    const violations: SoDViolation[] = [];

    // requesterApproverBarrier: if actor is same as related actor and this is an approval-type action
    if (policy.requesterApproverBarrier && ctx.relatedActorId && ctx.actorId === ctx.relatedActorId) {
      violations.push({ ruleId: 'REQUESTER_APPROVER_BARRIER', description: 'Actor cannot approve own request', actorId: ctx.actorId, action: ctx.action });
    }

    // automationIdentityRestrictions: if serviceIdentity set and not in allowlist
    if (ctx.serviceIdentity) {
      if (!policy.automationIdentityRestrictions.includes(ctx.serviceIdentity)) {
        violations.push({ ruleId: 'AUTOMATION_NOT_ALLOWED', description: `Service identity ${ctx.serviceIdentity} not in allowlist`, actorId: ctx.actorId, action: ctx.action });
      }
    }

    // preparerPosterBarrier: if action is 'POST' and relatedAction is 'PREPARE' and actorId is relatedActorId
    if (policy.preparerPosterBarrier && ctx.action === 'POST' && ctx.relatedAction === 'PREPARE' && ctx.relatedActorId && ctx.actorId === ctx.relatedActorId) {
      violations.push({ ruleId: 'PREPARER_POSTER_BARRIER', description: 'Preparer cannot post own entry', actorId: ctx.actorId, action: ctx.action });
    }

    return {
      permitted: violations.length === 0,
      violations,
      policyVersion: policy.version,
    };
  }

  async saveDraft(policy: Omit<SoDPolicy, 'id' | 'createdAt' | 'updatedAt' | 'version'>): Promise<SoDPolicy> {
    const key = `${policy.tenantId}:${policy.legalEntityId ?? ''}`;
    const version = (this.nextVersion.get(key) ?? 0) + 1;
    this.nextVersion.set(key, version);
    const id = `${key}-v${version}-${Date.now()}`;
    const now = new Date();
    const full: SoDPolicy = { ...policy, id, version, createdAt: now, updatedAt: now, status: 'DRAFT' };
    this.policies.set(id, full);
    return full;
  }

  validatePolicy(policy: SoDPolicy): string[] {
    const errors: string[] = [];
    if (!policy.tenantId) errors.push('tenantId is required');
    if (!policy.authorId) errors.push('authorId is required');
    if (!policy.effectiveFrom) errors.push('effectiveFrom is required');
    return errors;
  }

  async activatePolicy(policyId: string, actorId: string): Promise<SoDPolicy> {
    const policy = this.policies.get(policyId);
    if (!policy) throw new Error(`Policy not found: ${policyId}`);
    if (policy.status !== 'DRAFT') throw new Error(`Policy is not DRAFT: ${policy.status}`);
    if (policy.authorActivatorBarrier && policy.authorId === actorId) {
      throw new Error('Author cannot activate own policy version');
    }
    const updated = { ...policy, status: 'ACTIVE' as const, activatedBy: actorId, updatedAt: new Date() };
    this.policies.set(policyId, updated);
    return updated;
  }

  async supersedePolicy(policyId: string, newPolicyId: string, actorId: string): Promise<void> {
    const policy = this.policies.get(policyId);
    if (!policy) throw new Error(`Policy not found: ${policyId}`);
    if (policy.status !== 'ACTIVE') throw new Error('Only ACTIVE policies can be superseded');
    const updated = { ...policy, status: 'SUPERSEDED' as const, supersededBy: newPolicyId, updatedAt: new Date() };
    this.policies.set(policyId, updated);
  }

  async getAuditHistory(tenantId: string, legalEntityId?: string): Promise<SoDPolicy[]> {
    return [...this.policies.values()].filter(p => p.tenantId === tenantId && p.legalEntityId === legalEntityId);
  }
}
