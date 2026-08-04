// S095 — Portfolio Reserve Accrual
// Canonical ACs: config CRUD, accrual computation (bp-based), idempotency,
// no direct GL write, tenant scope, config-not-found fail-closed, out-of-range bp rejected
import { describe, it, expect, vi } from 'vitest';
import Decimal from 'decimal.js';
import { PortfolioReserveService, PortfolioReserveConfigNotFoundError, PortfolioReserveDuplicateError } from '../../src/application/portfolio-reserve-service';

const TENANT = 'tenant-A';
const LE = 'le-001';
const CODE = 'PORTFOLIO-A';

function makePrisma(seedConfig: any = null) {
  const configs: any[] = seedConfig ? [seedConfig] : [];
  const accruals: any[] = [];
  let seq = 1;
  return {
    portfolioReserveConfig: {
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const r = { id: `cfg${seq++}`, ...data };
        configs.push(r);
        return r;
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: any) => {
        return configs.filter(c =>
          c.tenantId === where.tenantId &&
          (!where.legalEntityId || c.legalEntityId === where.legalEntityId) &&
          (!where.portfolioCode || c.portfolioCode === where.portfolioCode)
        );
      }),
    },
    portfolioReserveAccrual: {
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const r = { id: `acc${seq++}`, ...data };
        accruals.push(r);
        return r;
      }),
      findUnique: vi.fn().mockImplementation(async ({ where }: any) =>
        accruals.find(a => a.tenantId === where.tenantId_idempotencyKey?.tenantId &&
          a.idempotencyKey === where.tenantId_idempotencyKey?.idempotencyKey) ?? null
      ),
      findMany: vi.fn().mockImplementation(async ({ where }: any) =>
        accruals.filter(a => a.tenantId === where.tenantId && a.legalEntityId === where.legalEntityId)
      ),
    },
  };
}

function makePosting(journalEntryId = 'JE-PRV-001') {
  return { submit: vi.fn().mockResolvedValue({ submitResult: { status: 'POSTED' }, journalEntryId }) };
}

describe('S095 — Portfolio Reserve Accrual', () => {
  it('AC1 — createConfig persists tenantId and legalEntityId separately; rejects out-of-range basisBp', async () => {
    const svc = new PortfolioReserveService(makePrisma() as any, makePosting() as any);
    const cfg = await svc.createConfig(TENANT, { legalEntityId: LE, portfolioCode: CODE, accrualBasisBp: 100, effectiveFrom: '2026-01-01', createdBy: 'admin' });
    expect(cfg.tenantId).toBe(TENANT);
    expect(cfg.legalEntityId).toBe(LE);
    expect(cfg.accrualBasisBp).toBe(100);
    await expect(svc.createConfig(TENANT, { legalEntityId: LE, portfolioCode: CODE, accrualBasisBp: 0, effectiveFrom: '2026-01-01', createdBy: 'admin' }))
      .rejects.toThrow(/accrualBasisBp must be/);
  });

  it('AC2 — runAccrual computes accrualAmount = portfolioBalance × basisBp/10000', async () => {
    const config = { id: 'cfg1', tenantId: TENANT, legalEntityId: LE, portfolioCode: CODE, accrualBasisBp: 200, effectiveFrom: new Date('2020-01-01'), effectiveTo: null };
    const posting = makePosting();
    const svc = new PortfolioReserveService(makePrisma(config) as any, posting as any);
    const result = await svc.runAccrual(TENANT, {
      legalEntityId: LE, portfolioCode: CODE, portfolioBalance: '1000000.00',
      periodYear: 2026, periodMonth: 3, idempotencyKey: 'pra-2026-03', actor: 'scheduler',
    });
    // 1000000 × (200/10000) = 20000.00
    expect(new Decimal(result.accrualAmount).toFixed(2)).toBe('20000.00');
    expect(posting.submit).toHaveBeenCalledOnce();
  });

  it('AC3 — runAccrual posts through PostingOrchestrator (no direct GL write)', async () => {
    const config = { id: 'cfg1', tenantId: TENANT, legalEntityId: LE, portfolioCode: CODE, accrualBasisBp: 100, effectiveFrom: new Date('2020-01-01'), effectiveTo: null };
    const posting = makePosting('JE-PRV-999');
    const svc = new PortfolioReserveService(makePrisma(config) as any, posting as any);
    const result = await svc.runAccrual(TENANT, {
      legalEntityId: LE, portfolioCode: CODE, portfolioBalance: '500000.00',
      periodYear: 2026, periodMonth: 4, idempotencyKey: 'pra-2026-04', actor: 'scheduler',
    });
    expect(result.postedJournalId).toBe('JE-PRV-999');
  });

  it('AC4 — idempotency: duplicate idempotencyKey throws PortfolioReserveDuplicateError without second posting', async () => {
    const config = { id: 'cfg1', tenantId: TENANT, legalEntityId: LE, portfolioCode: CODE, accrualBasisBp: 100, effectiveFrom: new Date('2020-01-01'), effectiveTo: null };
    const posting = makePosting();
    const svc = new PortfolioReserveService(makePrisma(config) as any, posting as any);
    await svc.runAccrual(TENANT, { legalEntityId: LE, portfolioCode: CODE, portfolioBalance: '1000.00', periodYear: 2026, periodMonth: 5, idempotencyKey: 'dup-key', actor: 'scheduler' });
    await expect(svc.runAccrual(TENANT, { legalEntityId: LE, portfolioCode: CODE, portfolioBalance: '1000.00', periodYear: 2026, periodMonth: 5, idempotencyKey: 'dup-key', actor: 'scheduler' }))
      .rejects.toThrow(PortfolioReserveDuplicateError);
    expect(posting.submit).toHaveBeenCalledOnce(); // second call never reaches posting
  });

  it('AC5 — no config → PortfolioReserveConfigNotFoundError (fail-closed)', async () => {
    const svc = new PortfolioReserveService(makePrisma() as any, makePosting() as any);
    await expect(svc.runAccrual(TENANT, { legalEntityId: LE, portfolioCode: 'UNKNOWN', portfolioBalance: '1000.00', periodYear: 2026, periodMonth: 6, idempotencyKey: 'no-cfg', actor: 'scheduler' }))
      .rejects.toThrow(PortfolioReserveConfigNotFoundError);
  });

  it('AC6 — listConfigs scopes to the requesting tenant only', async () => {
    const prisma = makePrisma();
    const svc = new PortfolioReserveService(prisma as any, makePosting() as any);
    await svc.createConfig(TENANT, { legalEntityId: LE, portfolioCode: CODE, accrualBasisBp: 50, effectiveFrom: '2026-01-01', createdBy: 'admin' });
    await svc.createConfig('other-tenant', { legalEntityId: LE, portfolioCode: CODE, accrualBasisBp: 50, effectiveFrom: '2026-01-01', createdBy: 'admin' });
    const list = await svc.listConfigs(TENANT);
    expect(list.every((c: any) => c.tenantId === TENANT)).toBe(true);
  });
});
