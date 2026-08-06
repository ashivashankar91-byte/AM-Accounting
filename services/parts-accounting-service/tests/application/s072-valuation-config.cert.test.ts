// S072 — Parts Valuation Config & Landed Cost
// Canonical ACs: method election, prospective-only, tenant+entity scope, effective date resolution
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { ValuationConfigService } from '../../src/application/valuation-config-service';

function makePrisma() {
  const rows: any[] = [];
  let seq = 1;
  return {
    partsValuationConfig: {
      create: async ({ data }: any) => { const r = { id: `vc${seq++}`, ...data }; rows.push(r); return r; },
      findFirst: async ({ where, orderBy }: any) => {
        const asOf = where.effectiveFrom.lte;
        const matches = rows.filter(r =>
          r.tenantId === where.tenantId &&
          r.legalEntityId === where.legalEntityId &&
          new Date(r.effectiveFrom) <= asOf
        );
        if (!matches.length) return null;
        return matches.sort((a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime())[0];
      },
    },
  };
}

describe('S072 — Parts Valuation Config & Landed Cost', () => {
  const TENANT = 'tenant-A';
  const LE = 'le-001';
  // Use a future date to pass prospective-only validation
  const futureDate = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);

  it('AC1 — create accepts REPLACEMENT method and persists tenantId + legalEntityId separately', async () => {
    const svc = new ValuationConfigService(makePrisma() as any);
    const result = await svc.create({ tenantId: TENANT, legalEntityId: LE, method: 'REPLACEMENT', effectiveFrom: futureDate, ceremonyApprovedBy: 'controller-1' });
    expect(result.method).toBe('REPLACEMENT');
    expect(result.tenantId).toBe(TENANT);
    expect(result.legalEntityId).toBe(LE);
  });

  it('AC2 — create accepts AVERAGE method', async () => {
    const svc = new ValuationConfigService(makePrisma() as any);
    const result = await svc.create({ tenantId: TENANT, legalEntityId: LE, method: 'AVERAGE', effectiveFrom: futureDate, ceremonyApprovedBy: 'controller-1' });
    expect(result.method).toBe('AVERAGE');
  });

  it('AC3 — rejects unsupported method FIFO with a validation error (no invented methods)', async () => {
    const svc = new ValuationConfigService(makePrisma() as any);
    await expect(svc.create({ tenantId: TENANT, legalEntityId: LE, method: 'FIFO', effectiveFrom: futureDate, ceremonyApprovedBy: 'controller-1' }))
      .rejects.toThrow(/only REPLACEMENT or AVERAGE/i);
  });

  it('AC4 — rejects a past effectiveFrom (prospective-only enforcement)', async () => {
    const svc = new ValuationConfigService(makePrisma() as any);
    const past = '2020-01-01';
    await expect(svc.create({ tenantId: TENANT, legalEntityId: LE, method: 'AVERAGE', effectiveFrom: past, ceremonyApprovedBy: 'controller-1' }))
      .rejects.toThrow(/prospective-only/i);
  });

  it('AC5 — getActive resolves the most-recently effective config as-of a date', async () => {
    const prisma = makePrisma();
    const svc = new ValuationConfigService(prisma as any);
    const d1 = new Date(Date.now() + 86400000 * 10).toISOString().slice(0, 10);
    const d2 = new Date(Date.now() + 86400000 * 20).toISOString().slice(0, 10);
    await svc.create({ tenantId: TENANT, legalEntityId: LE, method: 'REPLACEMENT', effectiveFrom: d1, ceremonyApprovedBy: 'ctrl' });
    await svc.create({ tenantId: TENANT, legalEntityId: LE, method: 'AVERAGE', effectiveFrom: d2, ceremonyApprovedBy: 'ctrl' });
    // As-of d1 date → REPLACEMENT
    const active = await svc.getActive(TENANT, LE, d1);
    expect(active.method).toBe('REPLACEMENT');
  });

  it('AC6 — getActive throws NotFoundError when no config exists for a legal entity', async () => {
    const svc = new ValuationConfigService(makePrisma() as any);
    await expect(svc.getActive(TENANT, 'le-unknown')).rejects.toThrow(/No PartsValuationConfig/i);
  });
});
