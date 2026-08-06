import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { RlsTenantContext } from '@amacc/shared-kernel';
import { makeTestPrisma, cleanupTenant } from '../support/db';
import { OemProfileService } from '../../src/application/profile-service';
import { OemStatementService } from '../../src/application/statement-service';
import { OemSeparationOfDutiesError, OemValidationError } from '../../src/domain/errors';

const prisma = makeTestPrisma();
const tenantId = `test-tenant-${randomUUID()}`;
const storeId = 'STORE-1';

const profiles = new OemProfileService(prisma as any);

const fakeGl = {
  async fetchTrialBalance(_tenantId: string, _year: number, _month: number) {
    return {
      accounts: [
        { accountCode: '4100', debit: '0.00', credit: '50000.00' }, // revenue: net credit -50000
        { accountCode: '5100', debit: '30000.00', credit: '0.00' }, // COGS: net debit +30000
      ],
    };
  },
};
const statements = new OemStatementService(prisma as any, fakeGl as any);

beforeAll(async () => {
  RlsTenantContext.set(tenantId);
  await prisma.$connect();
  await profiles.create(tenantId, { make: 'FORD' }, 'tester');
});
afterAll(async () => { await cleanupTenant(prisma, tenantId); await prisma.$disconnect(); });

describe('S104 OEM Financial Statement Renderer', () => {
  it('blocks rendering truthfully when there is no statement profile', async () => {
    await expect(statements.render(tenantId, storeId, 'nonexistent-id', '2026-07', 'tester')).rejects.toThrow(OemValidationError);
  });

  it('blocks rendering truthfully when the profile has no ACTIVE mapping — never approximates', async () => {
    const profile = await statements.createProfile(tenantId, 'FORD', '1.0', {
      lines: [{ lineRef: 'REVENUE', label: 'Revenue', section: 'INCOME' }, { lineRef: 'COGS', label: 'COGS', section: 'INCOME' }],
      totals: [{ lineRef: 'GROSS_PROFIT', label: 'Gross Profit', componentLineRefs: ['REVENUE', 'COGS'] }],
    }, '2026-01-01', 'tester');
    await expect(statements.render(tenantId, storeId, profile.id, '2026-07', 'tester')).rejects.toThrow(OemValidationError);
  });

  it('activation requires a DIFFERENT actor than the author — real SoD boundary', async () => {
    const [profile] = await statements.listProfiles(tenantId);
    const mapping = await statements.authorMapping(tenantId, profile.id, '4100', 'REVENUE', 'author-alice');
    await expect(statements.activateMapping(tenantId, mapping.id, 'author-alice')).rejects.toThrow(OemSeparationOfDutiesError);
    const activated = await statements.activateMapping(tenantId, mapping.id, 'activator-bob');
    expect(activated.status).toBe('ACTIVE');
  });

  it('renders from real trial-balance data, cross-foots, ties, and drills to the contributing GL account', async () => {
    const [profile] = await statements.listProfiles(tenantId);
    const cogsMapping = await statements.authorMapping(tenantId, profile.id, '5100', 'COGS', 'author-alice');
    await statements.activateMapping(tenantId, cogsMapping.id, 'activator-bob');

    const render = await statements.render(tenantId, storeId, profile.id, '2026-07', 'tester');
    expect(render.crossFootOk).toBe(true);
    expect(render.tbTieOk).toBe(true);
    const cells = render.cellValues as any;
    expect(cells.REVENUE).toBe(-50000); // debit(0) - credit(50000)
    expect(cells.COGS).toBe(30000);
    expect(cells.GROSS_PROFIT).toBe(-20000); // -50000 + 30000

    const drill = await statements.drillCell(tenantId, render.id, 'REVENUE');
    expect(drill.contributingAccounts).toContain('4100');
  });

  it('injects a TEST-ONLY variance only when explicitly allowed by env, producing a loud (tbTieOk=false) result', async () => {
    const [profile] = await statements.listProfiles(tenantId);
    process.env['OEM_ALLOW_VARIANCE_INJECTION'] = 'true';
    try {
      const render = await statements.render(tenantId, storeId, profile.id, '2026-08', 'tester', '999.99');
      expect(render.tbTieOk).toBe(false);
      expect(Number(render.varianceAmount)).toBe(999.99);
    } finally {
      delete process.env['OEM_ALLOW_VARIANCE_INJECTION'];
    }
  });

  it('variance injection is a no-op when OEM_ALLOW_VARIANCE_INJECTION is not set — never fabricable by default', async () => {
    const [profile] = await statements.listProfiles(tenantId);
    const render = await statements.render(tenantId, storeId, profile.id, '2026-09', 'tester', '999.99');
    expect(render.tbTieOk).toBe(true);
  });

  it('exports a render and retains export history', async () => {
    const [profile] = await statements.listProfiles(tenantId);
    const render = await statements.render(tenantId, storeId, profile.id, '2026-10', 'tester');
    const exported = await statements.exportRender(tenantId, render.id, 'JSON', 'tester');
    expect(exported.retained).toBe(true);
    const history = await statements.listExports(tenantId, render.id);
    expect(history.some((e: any) => e.id === exported.id)).toBe(true);
  });
});
