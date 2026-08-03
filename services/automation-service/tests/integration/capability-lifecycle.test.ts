/**
 * The capability authority lifecycle, driven through the real services.
 *
 * The properties asserted here are the ones the epic is built on: every
 * capability starts at OBSERVE_ONLY, the ladder is climbed one rung at a time
 * by two different people, a declared ceiling cannot be exceeded by any route,
 * and suspension is immediate and unilateral.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeHarness, promoteTo, Harness, TENANT, OTHER_TENANT, LE, OTHER_LE, GRANTOR, ACTIVATOR, OPERATOR,
} from '../helpers/service-harness';

let h: Harness;
beforeEach(() => { h = makeHarness(); });

const CODE = 'S040_OCR_INGESTION';

describe('capability configuration', () => {
  it('lists all fourteen capabilities even when none has been configured', async () => {
    const grid = await h.capabilities.list(TENANT, LE);
    expect(grid).toHaveLength(14);
    expect(grid.every((c: any) => c.truthfulState === 'NOT_CONFIGURED')).toBe(true);
    expect(grid.every((c: any) => c.currentAuthority === 'OBSERVE_ONLY')).toBe(true);
  });

  it('reports an unconfigured capability as NOT_CONFIGURED rather than hiding it', async () => {
    const grid = await h.capabilities.list(TENANT, LE);
    const row = grid.find((c: any) => c.capabilityCode === CODE);
    expect(row).toBeDefined();
    expect(row.truthfulState).toBe('NOT_CONFIGURED');
    expect(row.configured).toBe(false);
  });

  it('creates a capability at OBSERVE_ONLY and at no other authority', async () => {
    const created = await h.capabilities.create({ tenantId: TENANT, legalEntityId: LE, capabilityCode: CODE, actor: OPERATOR });
    expect(created.currentAuthority).toBe('OBSERVE_ONLY');
    expect(h.events.has('automation.capability.configured')).toBe(true);
  });

  it('is idempotent: configuring twice does not create a second row', async () => {
    const a = await h.capabilities.create({ tenantId: TENANT, legalEntityId: LE, capabilityCode: CODE, actor: OPERATOR });
    const b = await h.capabilities.create({ tenantId: TENANT, legalEntityId: LE, capabilityCode: CODE, actor: OPERATOR });
    expect(b.id).toBe(a.id);
    expect(h.prisma.rows('AutomationCapability')).toHaveLength(1);
  });

  it('refuses an unknown capability code', async () => {
    await expect(h.capabilities.create({ tenantId: TENANT, legalEntityId: LE, capabilityCode: 'S999_FAKE', actor: OPERATOR }))
      .rejects.toThrowError(/Unknown automation capability/);
  });
});

describe('authority grant ceremony', () => {
  it('needs two different identities: grant then activate', async () => {
    const cap = await h.capabilities.create({ tenantId: TENANT, legalEntityId: LE, capabilityCode: CODE, actor: OPERATOR, baselineEvidenceRef: 'evidence://baseline' });
    const { grant, capability } = await h.capabilities.grant({
      tenantId: TENANT, id: cap.id, toAuthority: 'RECOMMEND', grantedBy: GRANTOR, evidenceRefs: ['evidence://baseline'],
    });

    // A grant on its own changes nothing — authority is still OBSERVE_ONLY.
    expect(capability.currentAuthority).toBe('OBSERVE_ONLY');

    const activated = await h.capabilities.activateGrant({ tenantId: TENANT, id: cap.id, grantId: grant.id, activatedBy: ACTIVATOR });
    expect(activated.currentAuthority).toBe('RECOMMEND');
  });

  it('refuses activation by the grantor', async () => {
    const cap = await h.capabilities.create({ tenantId: TENANT, legalEntityId: LE, capabilityCode: CODE, actor: OPERATOR, baselineEvidenceRef: 'evidence://baseline' });
    const { grant } = await h.capabilities.grant({ tenantId: TENANT, id: cap.id, toAuthority: 'RECOMMEND', grantedBy: GRANTOR });
    await expect(h.capabilities.activateGrant({ tenantId: TENANT, id: cap.id, grantId: grant.id, activatedBy: GRANTOR }))
      .rejects.toThrowError(/same identity that granted/);

    const after = await h.capabilities.get(TENANT, cap.id);
    expect(after.currentAuthority).toBe('OBSERVE_ONLY');
  });

  it('refuses a grant made by an automation identity', async () => {
    const cap = await h.capabilities.create({ tenantId: TENANT, legalEntityId: LE, capabilityCode: CODE, actor: OPERATOR, baselineEvidenceRef: 'evidence://baseline' });
    await expect(h.capabilities.grant({ tenantId: TENANT, id: cap.id, toAuthority: 'RECOMMEND', grantedBy: 'automation:ce17' }))
      .rejects.toThrowError(/Automation identities may not grant/);
  });

  it('refuses to skip a rung', async () => {
    const cap = await h.capabilities.create({ tenantId: TENANT, legalEntityId: LE, capabilityCode: CODE, actor: OPERATOR, baselineEvidenceRef: 'evidence://baseline' });
    await expect(h.capabilities.grant({ tenantId: TENANT, id: cap.id, toAuthority: 'EXECUTE_WITH_APPROVAL', grantedBy: GRANTOR }))
      .rejects.toThrowError(/one rung at a time/);
  });

  it('refuses promotion above OBSERVE_ONLY without baseline evidence', async () => {
    h.baseline.approved = false;
    const cap = await h.capabilities.create({ tenantId: TENANT, legalEntityId: LE, capabilityCode: CODE, actor: OPERATOR });
    await expect(h.capabilities.grant({ tenantId: TENANT, id: cap.id, toAuthority: 'RECOMMEND', grantedBy: GRANTOR }))
      .rejects.toThrowError(/baseline evidence/);
  });

  it('records every grant, so the promotion history is inspectable', async () => {
    await promoteTo(h, CODE, 'PREPARE_DRAFT');
    const grants = h.prisma.rows('AutomationGrant');
    expect(grants).toHaveLength(2);
    expect(grants.map((g: any) => g.toAuthority)).toEqual(['RECOMMEND', 'PREPARE_DRAFT']);
    expect(grants.every((g: any) => g.grantedBy !== g.activatedBy)).toBe(true);
  });

  it('refuses to activate the same grant twice', async () => {
    const cap = await h.capabilities.create({ tenantId: TENANT, legalEntityId: LE, capabilityCode: CODE, actor: OPERATOR, baselineEvidenceRef: 'evidence://baseline' });
    const { grant } = await h.capabilities.grant({ tenantId: TENANT, id: cap.id, toAuthority: 'RECOMMEND', grantedBy: GRANTOR });
    await h.capabilities.activateGrant({ tenantId: TENANT, id: cap.id, grantId: grant.id, activatedBy: ACTIVATOR });
    await expect(h.capabilities.activateGrant({ tenantId: TENANT, id: cap.id, grantId: grant.id, activatedBy: ACTIVATOR }))
      .rejects.toThrowError(/already been activated/);
  });
});

describe('declared ceilings are absolute', () => {
  it('refuses to promote the chargeback model above RECOMMEND', async () => {
    await promoteTo(h, 'S091B_CHARGEBACK_MODEL', 'RECOMMEND');
    const cap = await h.prisma.automationCapability.findFirst({ where: { tenantId: TENANT, capabilityCode: 'S091B_CHARGEBACK_MODEL' } });
    await expect(h.capabilities.grant({ tenantId: TENANT, id: cap.id, toAuthority: 'PREPARE_DRAFT', grantedBy: GRANTOR }))
      .rejects.toThrowError(/may never exceed RECOMMEND/);
  });

  it('refuses to promote the GAAP memo generator above PREPARE_DRAFT', async () => {
    await promoteTo(h, 'S118_GAAP_MEMO', 'PREPARE_DRAFT');
    const cap = await h.prisma.automationCapability.findFirst({ where: { tenantId: TENANT, capabilityCode: 'S118_GAAP_MEMO' } });
    await expect(h.capabilities.grant({ tenantId: TENANT, id: cap.id, toAuthority: 'EXECUTE_WITH_APPROVAL', grantedBy: GRANTOR }))
      .rejects.toThrowError(/may never exceed PREPARE_DRAFT/);
  });

  it('refuses to promote LIFO to unattended execution because it is statutory-adjacent', async () => {
    await promoteTo(h, 'S073_LIFO_OVERLAY', 'EXECUTE_WITH_APPROVAL');
    const cap = await h.prisma.automationCapability.findFirst({ where: { tenantId: TENANT, capabilityCode: 'S073_LIFO_OVERLAY' } });
    await expect(h.capabilities.grant({ tenantId: TENANT, id: cap.id, toAuthority: 'AUTO_EXECUTE_WITHIN_POLICY', grantedBy: GRANTOR }))
      .rejects.toThrowError(/statutory-adjacent/);
  });

  it('refuses to promote DSAR to unattended execution because it is irreversible', async () => {
    await promoteTo(h, 'S126_DSAR', 'EXECUTE_WITH_APPROVAL');
    const cap = await h.prisma.automationCapability.findFirst({ where: { tenantId: TENANT, capabilityCode: 'S126_DSAR' } });
    await expect(h.capabilities.grant({ tenantId: TENANT, id: cap.id, toAuthority: 'AUTO_EXECUTE_WITHIN_POLICY', grantedBy: GRANTOR }))
      .rejects.toThrowError(/irreversible/);
  });

  it('refuses SUSPENDED as a grantable authority', async () => {
    const cap = await h.capabilities.create({ tenantId: TENANT, legalEntityId: LE, capabilityCode: CODE, actor: OPERATOR, baselineEvidenceRef: 'e' });
    await expect(h.capabilities.grant({ tenantId: TENANT, id: cap.id, toAuthority: 'SUSPENDED', grantedBy: GRANTOR }))
      .rejects.toThrowError(/not a grantable authority/);
  });
});

describe('suspension', () => {
  it('is immediate and needs no second signature — stopping is always safe', async () => {
    const cap: any = await promoteTo(h, CODE, 'EXECUTE_WITH_APPROVAL');
    const suspended = await h.capabilities.suspend({ tenantId: TENANT, id: cap.id, actor: OPERATOR, reason: 'drift observed' });
    expect(suspended.currentAuthority).toBe('SUSPENDED');
    expect(suspended.suspendReason).toBe('drift observed');
  });

  it('suspends the capability\'s live items along with it', async () => {
    const cap: any = await promoteTo(h, CODE, 'RECOMMEND');
    await h.items.create({
      tenantId: TENANT, legalEntityId: LE, capabilityCode: CODE, subjectRef: 'INV-1', ruleVersion: 'r1',
    });
    await h.capabilities.suspend({ tenantId: TENANT, id: cap.id, actor: OPERATOR, reason: 'stop' });
    const items = h.prisma.rows('AutomationItem');
    expect(items.every((i: any) => i.state === 'SUSPENDED')).toBe(true);
  });

  it('can be lifted only by climbing the ladder again with two signatures', async () => {
    const cap: any = await promoteTo(h, CODE, 'RECOMMEND');
    await h.capabilities.suspend({ tenantId: TENANT, id: cap.id, actor: OPERATOR, reason: 'stop' });
    const { grant } = await h.capabilities.grant({ tenantId: TENANT, id: cap.id, toAuthority: 'RECOMMEND', grantedBy: GRANTOR });
    await expect(h.capabilities.activateGrant({ tenantId: TENANT, id: cap.id, grantId: grant.id, activatedBy: GRANTOR }))
      .rejects.toThrow();
    const restored = await h.capabilities.activateGrant({ tenantId: TENANT, id: cap.id, grantId: grant.id, activatedBy: ACTIVATOR });
    expect(restored.currentAuthority).toBe('RECOMMEND');
  });
});

describe('tenant and entity isolation', () => {
  it('never returns another tenant\'s capability', async () => {
    const cap = await h.capabilities.create({ tenantId: TENANT, legalEntityId: LE, capabilityCode: CODE, actor: OPERATOR });
    await expect(h.capabilities.get(OTHER_TENANT, cap.id)).rejects.toThrowError(/not configured/i);
  });

  it('scopes capabilities per legal entity, so one entity\'s promotion is not another\'s', async () => {
    await promoteTo(h, CODE, 'RECOMMEND', { legalEntityId: LE });
    await h.capabilities.create({ tenantId: TENANT, legalEntityId: OTHER_LE, capabilityCode: CODE, actor: OPERATOR });

    const here = await h.capabilities.list(TENANT, LE);
    const there = await h.capabilities.list(TENANT, OTHER_LE);
    expect(here.find((c: any) => c.capabilityCode === CODE).currentAuthority).toBe('RECOMMEND');
    expect(there.find((c: any) => c.capabilityCode === CODE).currentAuthority).toBe('OBSERVE_ONLY');
  });
});
