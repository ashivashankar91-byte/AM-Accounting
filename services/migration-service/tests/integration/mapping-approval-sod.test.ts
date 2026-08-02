/**
 * S130 — mapping decisions carry provenance, and a mapping approval may not be
 * granted by the person who made the decision.
 */
import { describe, it, expect } from 'vitest';
import { makeServices, setupSource, TENANT, OPERATOR, APPROVER, CONTROLLER, BALANCED_TB_ROWS } from '../helpers/service-harness';

async function seedOneDecision(s: ReturnType<typeof makeServices>, decidedBy = OPERATOR) {
  const { mappingSet } = await setupSource(s, BALANCED_TB_ROWS);
  await s.mappingService.upsertEntries({
    tenantId: TENANT, mappingSetId: mappingSet.id, actor: decidedBy,
    entries: [{
      sourceField: 'accountCode', sourceValue: '1000', targetField: 'accountCode', targetValue: '1010',
      classification: 'MAP', provenanceNote: 'Legacy 1000 splits into modern 1010 operating cash',
    }],
  });
  const { items } = await s.mappingService.listEntries(TENANT, mappingSet.id);
  const entry = (items as any[]).find((e) => e.sourceField === 'accountCode' && e.sourceValue === '1000');
  return { mappingSet, entry };
}

describe('mapping decision provenance', () => {
  it('records who decided a mapping and when', async () => {
    const s = makeServices();
    const { entry } = await seedOneDecision(s);
    expect(entry.decidedBy).toBe(OPERATOR);
    expect(entry.decidedAt).toBeTruthy();
    expect(entry.status).toBe('MAPPED');
  });

  it('retains the provenance note explaining the decision', async () => {
    const s = makeServices();
    const { entry } = await seedOneDecision(s);
    expect(entry.provenanceNote).toMatch(/operating cash/);
  });

  it('leaves an undecided value in MANUAL_REVIEW_REQUIRED rather than defaulting it', async () => {
    const s = makeServices();
    const { mappingSet } = await seedOneDecision(s);
    const { items } = await s.mappingService.listEntries(TENANT, mappingSet.id);
    const untouched = (items as any[]).find((e) => e.sourceValue === '2000');
    expect(untouched.status).toBe('MANUAL_REVIEW_REQUIRED');
    expect(untouched.classification).toBeNull();
  });

  it('reverts an entry to MANUAL_REVIEW_REQUIRED when its classification is cleared', async () => {
    const s = makeServices();
    const { mappingSet, entry } = await seedOneDecision(s);
    const updated = await s.mappingService.updateEntry({
      tenantId: TENANT, mappingSetId: mappingSet.id, entryId: entry.id, actor: OPERATOR,
      patch: { status: 'MANUAL_REVIEW_REQUIRED', classification: null },
    });
    expect(updated.status).toBe('MANUAL_REVIEW_REQUIRED');
  });
});

describe('mapping approval separation of duties', () => {
  it('refuses approval by the same user who decided the mapping', async () => {
    const s = makeServices();
    const { mappingSet, entry } = await seedOneDecision(s, OPERATOR);
    await expect(s.mappingService.approveEntry({
      tenantId: TENANT, mappingSetId: mappingSet.id, entryId: entry.id, actor: OPERATOR,
    })).rejects.toThrow(/may not|SoD|approve/i);
  });

  it('names the offending identity so the denial is auditable', async () => {
    const s = makeServices();
    const { mappingSet, entry } = await seedOneDecision(s, OPERATOR);
    await expect(s.mappingService.approveEntry({
      tenantId: TENANT, mappingSetId: mappingSet.id, entryId: entry.id, actor: OPERATOR,
    })).rejects.toThrow(new RegExp(OPERATOR));
  });

  it('accepts approval from a different identity', async () => {
    const s = makeServices();
    const { mappingSet, entry } = await seedOneDecision(s, OPERATOR);
    const approved = await s.mappingService.approveEntry({
      tenantId: TENANT, mappingSetId: mappingSet.id, entryId: entry.id, actor: APPROVER,
    });
    expect(approved.approvedBy).toBe(APPROVER);
    expect(approved.approvedAt).toBeTruthy();
  });

  it('keeps the original decider on the record after approval', async () => {
    const s = makeServices();
    const { mappingSet, entry } = await seedOneDecision(s, OPERATOR);
    const approved = await s.mappingService.approveEntry({
      tenantId: TENANT, mappingSetId: mappingSet.id, entryId: entry.id, actor: CONTROLLER,
    });
    expect(approved.decidedBy).toBe(OPERATOR);
    expect(approved.approvedBy).toBe(CONTROLLER);
  });

  it('refuses to approve an entry that is still in manual review', async () => {
    const s = makeServices();
    const { mappingSet } = await seedOneDecision(s);
    const { items } = await s.mappingService.listEntries(TENANT, mappingSet.id);
    const pending = (items as any[]).find((e) => e.status === 'MANUAL_REVIEW_REQUIRED');
    await expect(s.mappingService.approveEntry({
      tenantId: TENANT, mappingSetId: mappingSet.id, entryId: pending.id, actor: APPROVER,
    })).rejects.toThrow();
  });
});
