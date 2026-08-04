import { describe, it, expect, beforeEach } from 'vitest';
import { InMemorySoDPolicyStore } from '../../src/sod/InMemorySoDPolicyStore';
import type { SoDPolicy } from '../../src/sod/types';

const BASE_POLICY_DATA: Omit<SoDPolicy, 'id' | 'createdAt' | 'updatedAt' | 'version'> = {
  tenantId: 'tenant-1',
  legalEntityId: 'le-1',
  status: 'DRAFT',
  conflicts: [],
  requesterApproverBarrier: true,
  authorActivatorBarrier: true,
  preparerPosterBarrier: true,
  migrationPreparerApproverBarrier: true,
  automationIdentityRestrictions: ['allowed-service'],
  effectiveFrom: new Date('2024-01-01'),
  authorId: 'author-1',
};

async function getActivePolicyInStore(store: InMemorySoDPolicyStore, tenantId: string, legalEntityId?: string): Promise<SoDPolicy> {
  const draft = await store.saveDraft({ ...BASE_POLICY_DATA, tenantId, legalEntityId });
  return store.activatePolicy(draft.id, 'activator-1');
}

describe('InMemorySoDPolicyStore', () => {
  let store: InMemorySoDPolicyStore;

  beforeEach(() => {
    store = new InMemorySoDPolicyStore();
  });

  it('fails closed when no active policy', async () => {
    const result = await store.evaluate({ tenantId: 'tenant-1', actorId: 'user-1', action: 'POST' });
    expect(result.permitted).toBe(false);
    expect(result.violations[0].ruleId).toBe('NO_ACTIVE_POLICY');
  });

  it('requesterApproverBarrier: self-approval refused', async () => {
    await getActivePolicyInStore(store, 'tenant-1', 'le-1');
    const result = await store.evaluate({
      tenantId: 'tenant-1', legalEntityId: 'le-1', actorId: 'user-1', action: 'APPROVE',
      relatedActorId: 'user-1',
    });
    expect(result.permitted).toBe(false);
    expect(result.violations.some(v => v.ruleId === 'REQUESTER_APPROVER_BARRIER')).toBe(true);
  });

  it('valid separate-user approval succeeds', async () => {
    await getActivePolicyInStore(store, 'tenant-1', 'le-1');
    const result = await store.evaluate({
      tenantId: 'tenant-1', legalEntityId: 'le-1', actorId: 'user-2', action: 'APPROVE',
      relatedActorId: 'user-1',
    });
    expect(result.permitted).toBe(true);
    expect(result.violations.length).toBe(0);
  });

  it('draft matrix cannot authorize (fail closed)', async () => {
    // Draft policy — not activated
    await store.saveDraft({ ...BASE_POLICY_DATA, tenantId: 'tenant-2', legalEntityId: 'le-2' });
    const result = await store.evaluate({ tenantId: 'tenant-2', legalEntityId: 'le-2', actorId: 'user-1', action: 'POST' });
    expect(result.permitted).toBe(false);
  });

  it('superseded versions remain auditable', async () => {
    const policy = await getActivePolicyInStore(store, 'tenant-1', 'le-1');
    const newDraft = await store.saveDraft({ ...BASE_POLICY_DATA, tenantId: 'tenant-1', legalEntityId: 'le-1' });
    const newPolicy = await store.activatePolicy(newDraft.id, 'activator-2');
    await store.supersedePolicy(policy.id, newPolicy.id, 'admin');
    const history = await store.getAuditHistory('tenant-1', 'le-1');
    const superseded = history.find(p => p.id === policy.id);
    expect(superseded?.status).toBe('SUPERSEDED');
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  it('cross-tenant access denied (policy from different tenant)', async () => {
    await getActivePolicyInStore(store, 'tenant-1', 'le-1');
    // tenant-2 has no active policy
    const result = await store.evaluate({ tenantId: 'tenant-2', legalEntityId: 'le-1', actorId: 'user-1', action: 'POST' });
    expect(result.permitted).toBe(false);
  });

  it('service identity without explicit authorization denied', async () => {
    await getActivePolicyInStore(store, 'tenant-1', 'le-1');
    const result = await store.evaluate({
      tenantId: 'tenant-1', legalEntityId: 'le-1', actorId: 'svc-1', action: 'POST',
      serviceIdentity: 'unauthorized-service',
    });
    expect(result.permitted).toBe(false);
    expect(result.violations.some(v => v.ruleId === 'AUTOMATION_NOT_ALLOWED')).toBe(true);
  });

  it('allowed service identity succeeds', async () => {
    await getActivePolicyInStore(store, 'tenant-1', 'le-1');
    const result = await store.evaluate({
      tenantId: 'tenant-1', legalEntityId: 'le-1', actorId: 'svc-allowed', action: 'POST',
      serviceIdentity: 'allowed-service',
    });
    expect(result.permitted).toBe(true);
  });

  it('author cannot activate own policy version', async () => {
    const draft = await store.saveDraft({ ...BASE_POLICY_DATA, tenantId: 'tenant-1', legalEntityId: 'le-1', authorId: 'author-1' });
    await expect(store.activatePolicy(draft.id, 'author-1')).rejects.toThrow('Author cannot activate own policy version');
  });
});
