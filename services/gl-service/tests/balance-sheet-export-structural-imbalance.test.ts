import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../node_modules/.prisma/gl-client';
import { randomUUID } from 'crypto';
import { StructuralImbalanceError, TrialBalanceService } from '../src/application/trial-balance-service';
import { FinancialStatementService, FSStructuralImbalanceError } from '../src/application/financial-statement-service';

/**
 * Real, confirmed defect found while refining Balance Sheet (Golden R0 UI
 * convergence, 2026-07-28): FinancialStatementService.getBalanceSheet()
 * calls TrialBalanceService.getReport() first -- if the underlying trial
 * balance itself doesn't foot, it throws the TB-level StructuralImbalanceError
 * (code STRUCTURAL_IMBALANCE, shape {drSum,crSum,delta}), a DIFFERENT
 * failure mode and response shape from FSStructuralImbalanceError (assets !=
 * liabilities+equity on an already-footed slice, shape
 * {totalAssets,totalLiabilitiesAndEquity,delta}). The real /reports/
 * balance-sheet view route already caught both error types; the export
 * route (routes.ts) only caught FSStructuralImbalanceError, so exporting a
 * TB-level-imbalanced slice previously fell through to an uncaught
 * exception. Fixed by adding the same StructuralImbalanceError catch already
 * present on the view route -- this test proves the underlying condition is
 * real and reachable; the fixed route handler itself was verified live
 * against the running service (see checkpoint evidence), not re-mocked here.
 */

const DATABASE_URL = process.env['DATABASE_URL'];

describe.skipIf(!DATABASE_URL)('getBalanceSheet() propagates the real TB-level StructuralImbalanceError (live-db proof)', () => {
  let prisma: PrismaClient;
  let fs: FinancialStatementService;
  const tenantId = `bs-imbalance-tenant-${randomUUID()}`;
  const companyCode = '01';
  const accountId = randomUUID();

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL + "?connection_limit=1" } } });
    await prisma.$executeRawUnsafe(`SET app.current_tenant_id = '${tenantId}'`);
    await prisma.$connect();
    fs = new FinancialStatementService(new TrialBalanceService(prisma as any));

    await prisma.gLAccount.create({
      data: { id: accountId, tenantId, code: '9700', name: 'One-sided scratch', type: 'ASSET', normalBalance: 'DEBIT', allowPosting: true, openingBalance: 0 },
    });
    // No offsetting entry anywhere -- a real double-entry posting flow can
    // never produce this; a genuine one-sided balance is the only way to
    // reach a real STRUCTURAL_IMBALANCE, matching the established
    // direct-fixture precedent already used in this fleet's negative tests.
    // Isolated under a fresh random tenant id, cleaned up in afterAll --
    // does not touch the shared certified evidence scope (entity 01/2026-02).
    await prisma.gLAccountPeriodBalance.create({
      data: { id: randomUUID(), tenantId, glAccountId: accountId, periodYear: 2026, periodMonth: 6, journalSource: 'TB', companyCode, runningBalance: 77, unitCount: 0 },
    });
  });

  afterAll(async () => {
    await prisma.gLAccountPeriodBalance.deleteMany({ where: { tenantId } });
    await prisma.gLAccount.deleteMany({ where: { tenantId } });
    await prisma.$disconnect();
  });

  it('throws StructuralImbalanceError (TB-level shape: drSum/crSum/delta), NOT FSStructuralImbalanceError', async () => {
    const err = await fs.getBalanceSheet(tenantId, { entity: companyCode, asOf: '2026-06' }).catch((e) => e);
    expect(err).toBeInstanceOf(StructuralImbalanceError);
    expect(err).not.toBeInstanceOf(FSStructuralImbalanceError);
    expect(err.code).toBe('STRUCTURAL_IMBALANCE');
    expect(err.drSum).toBe(77);
    expect(err.crSum).toBe(0);
    expect(err.delta).toBe(77);
    // The FS-level error's own fields (totalAssets/totalLiabilitiesAndEquity)
    // must NOT be present -- this is genuinely a different error shape, not
    // just a naming variant, which is exactly why the frontend must branch
    // on which fields are actually present rather than assume one shape.
    expect(err.totalAssets).toBeUndefined();
    expect(err.totalLiabilitiesAndEquity).toBeUndefined();
  });
});
