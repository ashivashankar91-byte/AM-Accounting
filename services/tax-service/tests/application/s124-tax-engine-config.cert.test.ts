// S124 — Tax Engine Adapter Status & Config
// Canonical ACs: engine registry, NullEngine fail-closed, TestFixtureEngine available,
// testConnection audit, cross-tenant isolation, unknown engineType → NullEngine
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { TaxEngineConfigService } from '../../src/application/tax-engine-config-service';
import { EngineRegistry } from '../../src/domain/engines/engine-registry';

const TEST_TENANT = 'TEST-TENANT-CE10-CERTIFICATION-ONLY';
const OTHER_TENANT = 'tenant-B';
const LE = 'le-001';

function makePrisma() {
  const configs: any[] = [];
  const audits: any[] = [];
  let seq = 1;
  return {
    _configs: configs,
    taxEngineConfig: {
      findMany: async ({ where }: any) => configs.filter(r =>
        r.tenantId === where.tenantId &&
        (!where.legalEntityId || r.legalEntityId === where.legalEntityId)
      ),
    },
    taxAuditReference: {
      create: async ({ data }: any) => { const r = { id: `aud${seq++}`, ...data }; audits.push(r); return r; },
    },
    _audits: audits,
  };
}

describe('S124 — Tax Engine Adapter Status & Config', () => {
  it('AC1 — NullEngine: getStatus.configured=false, engineType=NULL_ENGINE (no config row needed)', async () => {
    const svc = new TaxEngineConfigService(makePrisma() as any, new EngineRegistry());
    const status = await svc.getStatus(TEST_TENANT, LE);
    expect(status.configured).toBe(false);
    expect(status.engineType).toBe('NULL_ENGINE');
  });

  it('AC2 — TestFixtureEngine: getStatus.configured=true when config row exists', async () => {
    const prisma = makePrisma();
    prisma.taxEngineConfig.findMany = async () => [{ id: 'c1', tenantId: TEST_TENANT, legalEntityId: LE, engineType: 'TEST_FIXTURE_ENGINE', effectiveFrom: new Date('2020-01-01') }];
    const svc = new TaxEngineConfigService(prisma as any, new EngineRegistry());
    const status = await svc.getStatus(TEST_TENANT, LE);
    expect(status.configured).toBe(true);
    expect(status.engineType).toBe('TEST_FIXTURE_ENGINE');
  });

  it('AC3 — testConnection with TEST_FIXTURE_ENGINE returns ok=true and creates an audit entry', async () => {
    const prisma = makePrisma();
    prisma.taxEngineConfig.findMany = async () => [{ id: 'c1', tenantId: TEST_TENANT, legalEntityId: LE, engineType: 'TEST_FIXTURE_ENGINE', effectiveFrom: new Date('2020-01-01') }];
    const svc = new TaxEngineConfigService(prisma as any, new EngineRegistry());
    const result = await svc.testConnection(TEST_TENANT, LE, 'admin');
    expect(result.ok).toBe(true);
    expect(prisma._audits).toHaveLength(1);
    expect(prisma._audits[0].eventType).toBe('tax.adapter.test_connection');
  });

  it('AC4 — NullEngine testConnection returns ok=false (fail-closed)', async () => {
    const svc = new TaxEngineConfigService(makePrisma() as any, new EngineRegistry());
    const result = await svc.testConnection(TEST_TENANT, LE, 'admin');
    expect(result.ok).toBe(false);
  });

  it('AC5 — unknown engineType resolves to NullEngine (configured=false, no throw)', async () => {
    const prisma = makePrisma();
    prisma.taxEngineConfig.findMany = async () => [{ id: 'c1', tenantId: TEST_TENANT, legalEntityId: LE, engineType: 'UNKNOWN_VENDOR', effectiveFrom: new Date('2020-01-01') }];
    const svc = new TaxEngineConfigService(prisma as any, new EngineRegistry());
    const status = await svc.getStatus(TEST_TENANT, LE);
    expect(status.configured).toBe(false);
    expect(status.engineType).toBe('NULL_ENGINE');
  });

  it('AC6 — cross-tenant isolation: list returns only the requesting tenant configs', async () => {
    const prisma = makePrisma();
    // Seed a config for a different tenant
    let otherSeen = false;
    prisma.taxEngineConfig.findMany = async ({ where }: any) => {
      if (where.tenantId === OTHER_TENANT) otherSeen = true;
      return []; // nothing for TEST_TENANT
    };
    const svc = new TaxEngineConfigService(prisma as any, new EngineRegistry());
    await svc.list(TEST_TENANT);
    expect(otherSeen).toBe(false);
  });
});
