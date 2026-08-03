import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../node_modules/.prisma/gl-client';
import { randomUUID } from 'crypto';
import { StructuralImbalanceError, TrialBalanceService } from '../src/application/trial-balance-service';
import { FinancialStatementService, FSStructuralImbalanceError } from '../src/application/financial-statement-service';

/**
 * Income Statement refinement (Golden R0 UI convergence, 2026-07-28) --
 * corrects the same deferred defect class already fixed for Balance Sheet
 * (see balance-sheet-export-structural-imbalance.test.ts). getIncomeStatement()
 * calls TrialBalanceService.getReport() first, exactly like getBalanceSheet()
 * does -- so it can throw the SAME TB-level StructuralImbalanceError (code
 * STRUCTURAL_IMBALANCE, shape {drSum,crSum,delta}) whenever the underlying
 * trial balance for the slice doesn't foot. This was the exact gap the
 * GOLDEN_R0_UX_IMPLEMENTATION_MAPPING.md previously mis-documented as
 * "STRUCTURAL_IMBALANCE is never thrown by getIncomeStatement()" -- that
 * claim only ever held for the FS-level check (assets vs
 * liabilities+equity), which has no Income-Statement equivalent and is NOT
 * asserted as reachable here. This test proves the TB-level condition is
 * real and reachable from getIncomeStatement(); the /reports/income-statement
 * and /reports/income-statement/export routes were fixed to catch it
 * (mirroring the already-fixed Balance Sheet routes), verified live against
 * the running service (see checkpoint evidence), not re-mocked here.
 */

const DATABASE_URL = process.env['DATABASE_URL'];

describe.skipIf(!DATABASE_URL)('getIncomeStatement() propagates the real TB-level StructuralImbalanceError (live-db proof)', () => {
  let prisma: PrismaClient;
  let fs: FinancialStatementService;
  const tenantId = `is-imbalance-tenant-${randomUUID()}`;
  const companyCode = '01';
  const accountId = randomUUID();

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL + "?connection_limit=1" } } });
    await prisma.$executeRawUnsafe(`SET app.current_tenant_id = '${tenantId}'`);
    await prisma.$connect();
    fs = new FinancialStatementService(new TrialBalanceService(prisma as any));

    await prisma.gLAccount.create({
      data: { id: accountId, tenantId, code: '9701', name: 'One-sided scratch (IS)', type: 'REVENUE', normalBalance: 'CREDIT', allowPosting: true, openingBalance: 0 },
    });
    // Same fixture pattern as the Balance Sheet proof: no offsetting entry
    // anywhere, so a real double-entry posting flow could never produce
    // this -- a genuine one-sided balance is the only way to reach a real
    // STRUCTURAL_IMBALANCE. Isolated under a fresh random tenant id, cleaned
    // up in afterAll -- does not touch the shared certified evidence scope.
    // For a CREDIT-normal-balance account, TrialBalanceService applies a
    // -1 factor to the raw stored runningBalance before assigning it to a
    // debit/credit side (see trial-balance-service.ts toBalanceSides()) --
    // a raw -42 here yields a genuine +42 credit-side balance with nothing
    // offsetting it (drSum=0, crSum=42), confirmed against the real
    // sign-conversion logic rather than assumed.
    await prisma.gLAccountPeriodBalance.create({
      data: { id: randomUUID(), tenantId, glAccountId: accountId, periodYear: 2026, periodMonth: 6, journalSource: 'TB', companyCode, runningBalance: -42, unitCount: 0 },
    });
  });

  afterAll(async () => {
    await prisma.gLAccountPeriodBalance.deleteMany({ where: { tenantId } });
    await prisma.gLAccount.deleteMany({ where: { tenantId } });
    await prisma.$disconnect();
  });

  it('throws StructuralImbalanceError (TB-level shape: drSum/crSum/delta), NOT FSStructuralImbalanceError', async () => {
    const err = await fs.getIncomeStatement(tenantId, { entity: companyCode, asOf: '2026-06' }).catch((e) => e);
    expect(err).toBeInstanceOf(StructuralImbalanceError);
    expect(err).not.toBeInstanceOf(FSStructuralImbalanceError);
    expect(err.code).toBe('STRUCTURAL_IMBALANCE');
    expect(err.drSum).toBe(0);
    expect(err.crSum).toBe(42);
    expect(err.delta).toBe(-42);
    // getIncomeStatement() has no assets/liabilities+equity-equivalent
    // check of its own, so the FS-level error's fields must never appear
    // here -- confirming the TB-level shape is the only reachable one.
    expect(err.totalAssets).toBeUndefined();
    expect(err.totalLiabilitiesAndEquity).toBeUndefined();
  });
});
