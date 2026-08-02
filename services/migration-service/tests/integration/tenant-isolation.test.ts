/**
 * Tenant and legal-entity scope are enforced server-side on every path — not
 * by filtering in the browser and not by trusting the request body.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  makeServices, stageAndValidate, setupSource, decideAndFreeze,
  BALANCED_TB_ROWS, TENANT, OTHER_TENANT, LE, OTHER_LE, OPERATOR, CONTROLLER,
} from '../helpers/service-harness';
import { makeHttpHarness, call, signToken, HttpHarness, ALL_MIGRATION_PERMISSIONS } from '../helpers/http-harness';

describe('runs are invisible across tenants', () => {
  it('does not list another tenant\u2019s runs', async () => {
    const s = makeServices();
    await s.runService.create({ tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'v', actor: OPERATOR });
    expect(((await s.runService.list(OTHER_TENANT, {})) as any[])).toHaveLength(0);
  });

  it('refuses to fetch another tenant\u2019s run even with the exact run id', async () => {
    const s = makeServices();
    const run = await s.runService.create({ tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'v', actor: OPERATOR });
    await expect(s.runService.get(OTHER_TENANT, run.runId)).rejects.toThrow(/not found/i);
  });

  it('lets both tenants use the same run id without colliding', async () => {
    const s = makeServices();
    const a = await s.runService.create({ tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'v', actor: OPERATOR, runId: 'MIG-SHARED' });
    const b = await s.runService.create({ tenantId: OTHER_TENANT, legalEntityId: OTHER_LE, mode: 'REHEARSAL', transformationVersion: 'v', actor: OPERATOR, runId: 'MIG-SHARED' });
    expect(a.id).not.toBe(b.id);
    expect(((await s.runService.list(TENANT, {})) as any[])).toHaveLength(1);
    expect(((await s.runService.list(OTHER_TENANT, {})) as any[])).toHaveLength(1);
  });

  it('keeps the audit trail tenant-scoped', async () => {
    const s = makeServices();
    const run = await s.runService.create({ tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'v', actor: OPERATOR });
    // The run is not merely empty for the other tenant — it does not exist.
    await expect(s.runService.getAudit(OTHER_TENANT, run.runId)).rejects.toThrow(/not found/i);
    await expect(s.runService.getAudit(TENANT, run.runId)).resolves.not.toHaveLength(0);
  });
});

describe('sources, mappings and staging are invisible across tenants', () => {
  it('does not list another tenant\u2019s source systems', async () => {
    const s = makeServices();
    await setupSource(s, BALANCED_TB_ROWS);
    expect(((await s.sourceService.listSystems(OTHER_TENANT)) as any[])).toHaveLength(0);
  });

  it('does not expose another tenant\u2019s snapshots or rows', async () => {
    const s = makeServices();
    const setup = await setupSource(s, BALANCED_TB_ROWS);
    expect(((await s.sourceService.listSnapshots(OTHER_TENANT, setup.system.id)) as any[])).toHaveLength(0);
    const files = (await s.sourceService.listFiles(OTHER_TENANT, setup.snapshot.id)) as any[];
    expect(files).toHaveLength(0);
  });

  it('does not list another tenant\u2019s mapping sets', async () => {
    const s = makeServices();
    await setupSource(s, BALANCED_TB_ROWS);
    expect(((await s.mappingService.listSets(OTHER_TENANT, {})) as any[])).toHaveLength(0);
  });

  it('refuses to freeze another tenant\u2019s mapping set', async () => {
    const s = makeServices();
    const setup = await setupSource(s, BALANCED_TB_ROWS);
    await expect(s.mappingService.freeze({
      tenantId: OTHER_TENANT, mappingSetId: setup.mappingSet.id, actor: CONTROLLER,
    })).rejects.toThrow();
  });

  it('does not expose another tenant\u2019s staged datasets or rows', async () => {
    const s = makeServices();
    const ctx = await stageAndValidate(s, BALANCED_TB_ROWS);
    expect(((await s.stagingService.listDatasets(OTHER_TENANT, ctx.run.runId)) as any[])).toHaveLength(0);
    const { items } = await s.stagingService.listRows(OTHER_TENANT, ctx.staged.datasetId, 100, 0, true);
    expect(items as any[]).toHaveLength(0);
  });

  it('does not expose another tenant\u2019s gates, control totals or exceptions', async () => {
    const s = makeServices();
    const ctx = await stageAndValidate(s, BALANCED_TB_ROWS);
    expect(((await s.stagingService.listGates(OTHER_TENANT, ctx.run.runId)) as any[])).toHaveLength(0);
    expect(((await s.stagingService.listControlTotals(OTHER_TENANT, ctx.run.runId)) as any[])).toHaveLength(0);
    const exceptions = await s.exceptionService.list(OTHER_TENANT, ctx.run.runId);
    expect(exceptions.items as any[]).toHaveLength(0);
  });
});

describe('promotion and cutover cannot be driven from another tenant', () => {
  it('refuses to promote another tenant\u2019s run', async () => {
    const s = makeServices();
    const ctx = await stageAndValidate(s, BALANCED_TB_ROWS);
    await expect(s.promotionService.promote({
      tenantId: OTHER_TENANT, legalEntityId: LE, runId: ctx.run.runId, actor: CONTROLLER,
    })).rejects.toThrow(/not found/i);
    expect(s.h.posting.requests).toHaveLength(0);
  });

  it('refuses to roll back another tenant\u2019s run', async () => {
    const s = makeServices();
    const ctx = await stageAndValidate(s, BALANCED_TB_ROWS);
    await expect(s.cutoverService.rollback({
      tenantId: OTHER_TENANT, runId: ctx.run.runId, actor: CONTROLLER, reason: 'not mine to roll back',
    })).rejects.toThrow(/not found/i);
    expect((await s.runService.get(TENANT, ctx.run.runId)).state).toBe('VALIDATED');
  });

  it('refuses to read another tenant\u2019s cutover ceremony', async () => {
    const s = makeServices();
    const ctx = await stageAndValidate(s, BALANCED_TB_ROWS);
    await expect(s.cutoverService.getCeremony(OTHER_TENANT, ctx.run.runId)).rejects.toThrow(/not found/i);
  });
});

describe('legal-entity scope', () => {
  it('separates runs belonging to different rooftops within one tenant', async () => {
    const s = makeServices();
    await s.runService.create({ tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'v', actor: OPERATOR });
    await s.runService.create({ tenantId: TENANT, legalEntityId: OTHER_LE, mode: 'REHEARSAL', transformationVersion: 'v', actor: OPERATOR });
    expect(((await s.runService.list(TENANT, { legalEntityId: LE })) as any[])).toHaveLength(1);
    expect(((await s.runService.list(TENANT, { legalEntityId: OTHER_LE })) as any[])).toHaveLength(1);
  });

  it('keeps archived statements scoped to their legal entity', async () => {
    const s = makeServices();
    for (const legalEntityId of [LE, OTHER_LE]) {
      await s.archiveService.import({
        tenantId: TENANT, legalEntityId, periodYear: 2025, periodMonth: 12,
        statementType: 'BALANCE_SHEET', sourceSystem: 'LEGACY-DMS', filename: `bs-${legalEntityId}.pdf`,
        fileSize: 1024, checksumSha256: legalEntityId === LE ? 'a'.repeat(64) : 'b'.repeat(64), actor: OPERATOR,
      });
    }
    const scoped = await s.archiveService.list(TENANT, { legalEntityId: LE });
    expect((scoped as any[])).toHaveLength(1);
    expect((scoped as any[])[0].legalEntityId).toBe(LE);
  });
});

describe('legal-entity scope at the HTTP boundary', () => {
  let harness: HttpHarness;
  let token: string;

  beforeEach(async () => {
    harness = await makeHttpHarness();
    token = signToken('user-lead', TENANT);
    harness.authz.grant('user-lead', ...ALL_MIGRATION_PERMISSIONS);
  });

  afterEach(async () => { await harness.close(); });

  it('denies a request whose header entity disagrees with the entity in the body', async () => {
    const res = await call(harness, {
      method: 'POST', url: '/api/v1/migration/runs', token, tenantId: TENANT, legalEntityId: LE,
      payload: { legalEntityId: OTHER_LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('LEGAL_ENTITY_SCOPE_MISMATCH');
  });

  it('accepts a request whose header and body agree', async () => {
    const res = await call(harness, {
      method: 'POST', url: '/api/v1/migration/runs', token, tenantId: TENANT, legalEntityId: LE,
      payload: { legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1' },
    });
    expect(res.statusCode).toBeLessThan(400);
  });

  it('requires a tenant header on every scoped route', async () => {
    const res = await call(harness, { url: '/api/v1/migration/runs', token, legalEntityId: LE });
    expect(res.statusCode).toBe(401);
  });

  it('refuses a token issued for one tenant when it is presented with another tenant\u2019s header', async () => {
    await call(harness, {
      method: 'POST', url: '/api/v1/migration/runs', token, tenantId: TENANT, legalEntityId: LE,
      payload: { legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1' },
    });
    const other = await call(harness, { url: '/api/v1/migration/runs', token, tenantId: OTHER_TENANT });
    expect(other.statusCode).toBe(403);
    expect(other.body).not.toContain('MIG-');
  });

  it('serves only the caller\u2019s own tenant when a properly-scoped token is used', async () => {
    await call(harness, {
      method: 'POST', url: '/api/v1/migration/runs', token, tenantId: TENANT, legalEntityId: LE,
      payload: { legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1' },
    });
    const otherToken = signToken('user-lead', OTHER_TENANT);
    const other = await call(harness, { url: '/api/v1/migration/runs', token: otherToken, tenantId: OTHER_TENANT });
    expect(other.statusCode).toBe(200);
    expect(other.json().items).toHaveLength(0);
  });
});
