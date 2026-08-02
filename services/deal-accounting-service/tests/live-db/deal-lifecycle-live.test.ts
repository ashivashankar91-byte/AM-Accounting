/**
 * CE-12 Workstream D — deal-accounting-service LIVE DATABASE certification
 * suite. Same skip-unless-LIVE_DATABASE_URL convention as services/coa-
 * service/tests/live-db's own suite.
 *
 * This service's external HTTP boundaries (coa-service posting-engine,
 * posting-recovery-service, tax-service, coa-service journal reversal) are
 * exercised through deterministic in-memory fakes (tests/support/fakes.ts)
 * — spinning up those sibling services as real HTTP processes is outside
 * this service's own test boundary (see coa-service's own live-db suite,
 * which likewise constructs its dependencies in-process against a real DB
 * rather than calling out to a separately-running server). Everything
 * exercised here — Prisma persistence, RLS-scoped queries (via the tenant
 * RLS middleware + real Postgres), idempotency races, the funded-unwind
 * guard, biller SoD, CIT short-fund conservation, payoff variance,
 * wholesale title gate + arbitration, and D-CE12-01 DELTA/REVERSE_REPOST
 * routing — is this service's own real, live-Postgres-backed logic.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { createTenantRlsMiddleware, RlsTenantContext } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/deal-accounting-client';
import { DealPostingOrchestrator } from '../../src/application/deal-posting-orchestrator';
import { DealFinalizeService } from '../../src/application/deal-finalize-service';
import { BillerReviewService } from '../../src/application/biller-review-service';
import { UnwindService } from '../../src/application/unwind-service';
import { RecontractService } from '../../src/application/recontract-service';
import { CitFundingService } from '../../src/application/cit-funding-service';
import { PayoffService } from '../../src/application/payoff-service';
import { WholesaleService } from '../../src/application/wholesale-service';
import { FundedUnwindRefusedError, BillerSoDViolationError, AlreadyRelievedError, IdempotentReplayConflictError } from '../../src/application/errors';
import { TradeInSplitMissingError } from '../../src/domain/recap-validation';
import { TitleNotReleasedError } from '../../src/application/errors';
import { FakePostingEngineClient, FakePostingRecoveryClient, FakeTaxResultClient, FakeJournalReversalClient } from '../support/fakes';
import { retailRecapFixture } from '../support/fixtures';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];

describe.skipIf(!LIVE_DB_URL)('CE-12 Workstream D — Live database certification', () => {
  let prisma: PrismaClient;
  let postingEngine: FakePostingEngineClient;
  let postingRecovery: FakePostingRecoveryClient;
  let taxResults: FakeTaxResultClient;
  let reversalClient: FakeJournalReversalClient;

  let orchestrator: DealPostingOrchestrator;
  let finalizeSvc: DealFinalizeService;
  let reviewSvc: BillerReviewService;
  let unwindSvc: UnwindService;
  let recontractSvc: RecontractService;
  let citSvc: CitFundingService;
  let payoffSvc: PayoffService;
  let wholesaleSvc: WholesaleService;

  const allTenants: string[] = [];
  // Gap-closure — RLS fix: this suite previously never wired up
  // app.current_tenant_id at all (neither the $use middleware on the base
  // client, matching index.ts's real bootstrap, nor RlsTenantContext for the
  // request-scoped async storage it reads) — every write against this
  // service's real RLS-enforced tables (migration
  // 20260802010001_add_rls_policies_deal_accounting_svc) was therefore
  // guaranteed to violate policy (42501) the moment it ran against a real
  // Postgres instance with that migration applied, which this cert
  // environment has. freshTenant() now also seeds the async-local tenant
  // context so every subsequent await in that same test resolves the same
  // tenant (tests run sequentially, never concurrently, in this file).
  function freshTenant(): string {
    const t = `deal-live-${randomUUID()}`;
    allTenants.push(t);
    RlsTenantContext.set(t);
    return t;
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();
    (prisma as any).$use(createTenantRlsMiddleware(prisma));

    postingEngine = new FakePostingEngineClient();
    postingRecovery = new FakePostingRecoveryClient();
    taxResults = new FakeTaxResultClient();
    reversalClient = new FakeJournalReversalClient();

    orchestrator = new DealPostingOrchestrator(prisma as any, postingEngine, postingRecovery);
    finalizeSvc = new DealFinalizeService(prisma as any, taxResults, orchestrator);
    reviewSvc = new BillerReviewService(prisma as any, postingEngine, taxResults, orchestrator);
    unwindSvc = new UnwindService(prisma as any, reversalClient);
    recontractSvc = new RecontractService(prisma as any, postingEngine, postingRecovery, reversalClient, taxResults, orchestrator);
    citSvc = new CitFundingService(prisma as any, postingEngine, postingRecovery);
    payoffSvc = new PayoffService(prisma as any, postingEngine, postingRecovery);
    wholesaleSvc = new WholesaleService(prisma as any, postingEngine, postingRecovery, reversalClient);

    taxResults.seed('tax-result-1', '1950.00');
  });

  afterAll(async () => {
    for (const tenantId of allTenants) {
      RlsTenantContext.set(tenantId);
      await prisma.dealAuditReference.deleteMany({ where: { tenantId } });
      await prisma.dealOutboxEvent.deleteMany({ where: { tenantId } });
      await prisma.arbitrationCase.deleteMany({ where: { tenantId } });
      await prisma.wholesaleDisposition.deleteMany({ where: { tenantId } });
      await prisma.payoffIssuance.deleteMany({ where: { tenantId } });
      await prisma.citFundingReceipt.deleteMany({ where: { tenantId } });
      await prisma.dealUnwind.deleteMany({ where: { tenantId } });
      await prisma.dealRecontract.deleteMany({ where: { tenantId } });
      await prisma.dealOpenItemApplication.deleteMany({ where: { tenantId } });
      await prisma.dealOpenItem.deleteMany({ where: { tenantId } });
      await prisma.dealPostingRecord.deleteMany({ where: { tenantId } });
      await prisma.dealReviewCase.deleteMany({ where: { tenantId } });
      await prisma.dealRecap.deleteMany({ where: { tenantId } });
      await prisma.deal.deleteMany({ where: { tenantId } });
      await prisma.dealTenantConfig.deleteMany({ where: { tenantId } });
    }
    await prisma.$disconnect();
  });

  // ── S084 finalize + idempotency ──────────────────────────────────────────
  describe('S084 finalize', () => {
    it('D-CE12-02: rejects a recap with a trade-in but no explicit allowance/ACV split before any coa-service call', async () => {
      const tenantId = freshTenant();
      const recap = retailRecapFixture({ dealNumber: `D-${randomUUID()}`, tradeAcvAmount: null });
      const before = postingEngine.submittedEventIds.length;
      await expect(finalizeSvc.finalize({ tenantId, payload: recap, actor: 'desk-1' })).rejects.toThrow(TradeInSplitMissingError);
      expect(postingEngine.submittedEventIds.length).toBe(before); // never called coa-service
    });

    it('finalize files a PENDING_REVIEW case and posts nothing (S085 default)', async () => {
      const tenantId = freshTenant();
      const dealNumber = `D-${randomUUID()}`;
      const recap = retailRecapFixture({ dealNumber, taxResultId: 'tax-result-1' });
      const before = postingEngine.submittedEventIds.length;
      const result = await finalizeSvc.finalize({ tenantId, payload: recap, actor: 'desk-1' });
      expect(result.reviewStatus).toBe('PENDING_REVIEW');
      expect(result.autoPosted).toBe(false);
      expect(postingEngine.submittedEventIds.length).toBe(before);
    });

    it('idempotent replay: the same recapVersion + identical payload is a no-op, not a duplicate row', async () => {
      const tenantId = freshTenant();
      const dealNumber = `D-${randomUUID()}`;
      const recap = retailRecapFixture({ dealNumber, taxResultId: 'tax-result-1' });
      const first = await finalizeSvc.finalize({ tenantId, payload: recap, actor: 'desk-1' });
      const second = await finalizeSvc.finalize({ tenantId, payload: recap, actor: 'desk-1' });
      expect(second.idempotentReplay).toBe(true);
      expect(second.dealId).toBe(first.dealId);
      const recaps = await prisma.dealRecap.findMany({ where: { tenantId, dealId: first.dealId } });
      expect(recaps).toHaveLength(1);
    });

    it('a different payload under the same recapVersion is refused, never silently overwritten', async () => {
      const tenantId = freshTenant();
      const dealNumber = `D-${randomUUID()}`;
      const recap = retailRecapFixture({ dealNumber, taxResultId: 'tax-result-1' });
      await finalizeSvc.finalize({ tenantId, payload: recap, actor: 'desk-1' });
      const mutated = { ...recap, saleAmount: '99999.00' };
      await expect(finalizeSvc.finalize({ tenantId, payload: mutated, actor: 'desk-1' })).rejects.toThrow(IdempotentReplayConflictError);
    });
  });

  // ── S085 biller review workbench ─────────────────────────────────────────
  describe('S085 biller review workbench', () => {
    it('a HELD deal posts nothing at all', async () => {
      const tenantId = freshTenant();
      const dealNumber = `D-${randomUUID()}`;
      const recap = retailRecapFixture({ dealNumber, taxResultId: 'tax-result-1' });
      await finalizeSvc.finalize({ tenantId, payload: recap, actor: 'desk-1' });
      const before = postingEngine.submittedEventIds.length;
      await reviewSvc.hold(tenantId, dealNumber, 1, 'awaiting manager review', 'biller-1');
      expect(postingEngine.submittedEventIds.length).toBe(before);
      const deal = await prisma.deal.findUnique({ where: { tenantId_dealNumber: { tenantId, dealNumber } } });
      expect(deal!.status).not.toBe('POSTED');
    });

    it('SoD: the releasing biller must differ from the finalizing desk actor', async () => {
      const tenantId = freshTenant();
      const dealNumber = `D-${randomUUID()}`;
      const recap = retailRecapFixture({ dealNumber, taxResultId: 'tax-result-1' });
      await finalizeSvc.finalize({ tenantId, payload: recap, actor: 'desk-1' });
      await expect(reviewSvc.release(tenantId, dealNumber, 1, 'desk-1')).rejects.toThrow(BillerSoDViolationError);
    });

    it('release posts exactly the previewed segment set and relieves nothing that was not previewed', async () => {
      const tenantId = freshTenant();
      const dealNumber = `D-${randomUUID()}`;
      const recap = retailRecapFixture({ dealNumber, taxResultId: 'tax-result-1' });
      await finalizeSvc.finalize({ tenantId, payload: recap, actor: 'desk-1' });

      const preview = await reviewSvc.preview(tenantId, dealNumber, 1);
      expect(preview.segments.every((s) => s.status === 'BLUEPRINT_GENERATED')).toBe(true);
      // core + trade-allowance + trade-acv + trade-payoff + cit + reserve + fees + tax + rebate + 2 products = 11
      expect(preview.segments).toHaveLength(11);

      const { postResult } = await reviewSvc.release(tenantId, dealNumber, 1, 'biller-1');
      expect(postResult.allPosted).toBe(true);
      expect(postResult.outcomes).toHaveLength(11);

      const deal = await prisma.deal.findUnique({ where: { tenantId_dealNumber: { tenantId, dealNumber } } });
      expect(deal!.status).toBe('POSTED');

      // Open items born exactly per the recap: CIT, RESERVE, PAYOFF, + 2 PRODUCT_REMIT.
      const openItems = await prisma.dealOpenItem.findMany({ where: { tenantId, dealId: deal!.id } });
      expect(openItems.map((i: any) => i.itemType).sort()).toEqual(['CIT', 'PAYOFF', 'PRODUCT_REMIT', 'PRODUCT_REMIT', 'RESERVE'].sort());
      const cit = openItems.find((i: any) => i.itemType === 'CIT')!;
      expect(Number(cit.originalAmount).toFixed(2)).toBe('25000.00');
      expect(Number(cit.remainingBalance).toFixed(2)).toBe('25000.00');
    });

    it('return-to-desking is audited and resets the deal to DESKED', async () => {
      const tenantId = freshTenant();
      const dealNumber = `D-${randomUUID()}`;
      const recap = retailRecapFixture({ dealNumber, taxResultId: 'tax-result-1' });
      await finalizeSvc.finalize({ tenantId, payload: recap, actor: 'desk-1' });
      await reviewSvc.returnToDesking(tenantId, dealNumber, 1, 'missing product cost detail', 'biller-1');
      const deal = await prisma.deal.findUnique({ where: { tenantId_dealNumber: { tenantId, dealNumber } } });
      expect(deal!.status).toBe('DESKED');
      const reviewCase = await prisma.dealReviewCase.findUnique({ where: { tenantId_dealId_recapVersion: { tenantId, dealId: deal!.id, recapVersion: 1 } } });
      expect(reviewCase!.status).toBe('RETURNED');
    });
  });

  // ── S086 unwind ───────────────────────────────────────────────────────────
  describe('S086 deal unwind', () => {
    async function financeReadyDeal(tenantId: string) {
      const dealNumber = `D-${randomUUID()}`;
      const recap = retailRecapFixture({ dealNumber, taxResultId: 'tax-result-1' });
      await finalizeSvc.finalize({ tenantId, payload: recap, actor: 'desk-1' });
      await reviewSvc.release(tenantId, dealNumber, 1, 'biller-1');
      return { dealNumber, recap };
    }

    it('unwinds a released deal: reverses every posted segment and closes the CIT item', async () => {
      const tenantId = freshTenant();
      const { dealNumber } = await financeReadyDeal(tenantId);
      const beforeReversed = reversalClient.reversed.length;

      const result: any = await unwindSvc.unwind({ tenantId, dealNumber, reason: 'customer rescinded', actor: 'controller-1' });
      expect(result.status).toBe('COMPLETED');
      expect(reversalClient.reversed.length).toBeGreaterThan(beforeReversed);

      const deal = await prisma.deal.findUnique({ where: { tenantId_dealNumber: { tenantId, dealNumber } } });
      expect(deal!.status).toBe('UNWOUND');

      const citItem = await prisma.dealOpenItem.findUnique({ where: { tenantId_itemType_itemNumber: { tenantId, itemType: 'CIT', itemNumber: dealNumber } } });
      expect(citItem!.status).toBe('CLOSED');

      // Every POSTED posting record for this deal is now marked reversed.
      const records = await prisma.dealPostingRecord.findMany({ where: { tenantId, dealId: deal!.id, coaStatus: 'POSTED' } });
      expect(records.every((r: any) => r.reversedAt !== null)).toBe(true);
    });

    it('refuses an unwind once CIT funding has been applied — named, audited refusal', async () => {
      const tenantId = freshTenant();
      const { dealNumber } = await financeReadyDeal(tenantId);
      await citSvc.recordFundingReceipt({ tenantId, dealNumber, amount: '25000.00', lenderRef: 'LENDER-1', receivedAt: new Date().toISOString(), idempotencyKey: `fund-${dealNumber}`, actor: 'ar-clerk-1' });

      await expect(unwindSvc.unwind({ tenantId, dealNumber, reason: 'attempted cancel after funding', actor: 'controller-1' })).rejects.toThrow(FundedUnwindRefusedError);

      const deal = await prisma.deal.findUnique({ where: { tenantId_dealNumber: { tenantId, dealNumber } } });
      const refusal = await prisma.dealUnwind.findFirst({ where: { tenantId, dealId: deal!.id, status: 'REFUSED' } });
      expect(refusal).not.toBeNull();
      expect(refusal!.refusalCode).toBe('FUNDED_UNWIND_REFUSED');
    });
  });

  // ── S087 recontract ────────────────────────────────────────────────────────
  describe('S087 recontract delta / D-CE12-01', () => {
    it('DELTA path: same structure, only an amount changed — posts a small delta journal, not a reversal', async () => {
      const tenantId = freshTenant();
      const dealNumber = `D-${randomUUID()}`;
      const v1 = retailRecapFixture({ dealNumber, taxResultId: 'tax-result-1' });
      await finalizeSvc.finalize({ tenantId, payload: v1, actor: 'desk-1' });
      await reviewSvc.release(tenantId, dealNumber, 1, 'biller-1');

      const beforeReversed = reversalClient.reversed.length;
      const v2 = { ...v1, recapVersion: 2, saleAmount: '33100.00' };
      const result: any = await recontractSvc.recontract({ tenantId, dealNumber, newRecap: v2, actor: 'desk-1' });
      expect(result.mode).toBe('DELTA');
      expect(reversalClient.reversed.length).toBe(beforeReversed); // no reversal happened

      const deltaRecords = await prisma.dealPostingRecord.findMany({ where: { tenantId, dealId: result.dealId ?? (await prisma.deal.findUnique({ where: { tenantId_dealNumber: { tenantId, dealNumber } } }))!.id, segmentType: 'RECONTRACT_DELTA' } });
      expect(deltaRecords.length).toBeGreaterThan(0);
      expect(deltaRecords.every((r: any) => r.coaStatus === 'POSTED')).toBe(true);
    });

    it('REVERSE_REPOST path: adding a trade-in that v1 lacked changes the structure — reverses + reposts', async () => {
      const tenantId = freshTenant();
      const dealNumber = `D-${randomUUID()}`;
      const v1 = retailRecapFixture({ dealNumber, taxResultId: 'tax-result-1', hasTradeIn: false, tradeVin: null, tradeAllowanceAmount: null, tradeAcvAmount: null, tradePayoffAmount: null });
      await finalizeSvc.finalize({ tenantId, payload: v1, actor: 'desk-1' });
      await reviewSvc.release(tenantId, dealNumber, 1, 'biller-1');

      const beforeReversed = reversalClient.reversed.length;
      const v2 = { ...v1, recapVersion: 2, hasTradeIn: true, tradeVin: '1G1ZD5ST0JF999999', tradeAllowanceAmount: '5000.00', tradeAcvAmount: '4200.00' };
      const result: any = await recontractSvc.recontract({ tenantId, dealNumber, newRecap: v2, actor: 'desk-1' });
      expect(result.mode).toBe('REVERSE_REPOST');
      expect(reversalClient.reversed.length).toBeGreaterThan(beforeReversed);
    });
  });

  // ── S088 CIT funding match ──────────────────────────────────────────────
  describe('S088 CIT funding match', () => {
    it('an exact funding receipt relieves the CIT item exactly and closes it', async () => {
      const tenantId = freshTenant();
      const dealNumber = `D-${randomUUID()}`;
      const recap = retailRecapFixture({ dealNumber, taxResultId: 'tax-result-1' });
      await finalizeSvc.finalize({ tenantId, payload: recap, actor: 'desk-1' });
      await reviewSvc.release(tenantId, dealNumber, 1, 'biller-1');

      const receipt = await citSvc.recordFundingReceipt({ tenantId, dealNumber, amount: '25000.00', lenderRef: 'LENDER-1', receivedAt: new Date().toISOString(), idempotencyKey: `fund-${dealNumber}`, actor: 'ar-clerk-1' });
      expect((receipt as any).status).toBe('MATCHED');

      const item = await prisma.dealOpenItem.findUnique({ where: { tenantId_itemType_itemNumber: { tenantId, itemType: 'CIT', itemNumber: dealNumber } } });
      expect(item!.status).toBe('CLOSED');
      expect(Number(item!.remainingBalance).toFixed(2)).toBe('0.00');
    });

    it('a second funding attempt against an already-relieved item is refused, not silently re-applied', async () => {
      const tenantId = freshTenant();
      const dealNumber = `D-${randomUUID()}`;
      const recap = retailRecapFixture({ dealNumber, taxResultId: 'tax-result-1' });
      await finalizeSvc.finalize({ tenantId, payload: recap, actor: 'desk-1' });
      await reviewSvc.release(tenantId, dealNumber, 1, 'biller-1');
      await citSvc.recordFundingReceipt({ tenantId, dealNumber, amount: '25000.00', lenderRef: 'LENDER-1', receivedAt: new Date().toISOString(), idempotencyKey: `fund-${dealNumber}`, actor: 'ar-clerk-1' });

      await expect(citSvc.recordFundingReceipt({ tenantId, dealNumber, amount: '100.00', lenderRef: 'LENDER-1', receivedAt: new Date().toISOString(), idempotencyKey: `fund-${dealNumber}-again`, actor: 'ar-clerk-1' })).rejects.toThrow(AlreadyRelievedError);
    });

    it('short-fund FEE_WITHHELD conserves: received + fee === original CIT amount, exactly', async () => {
      const tenantId = freshTenant();
      const dealNumber = `D-${randomUUID()}`;
      const recap = retailRecapFixture({ dealNumber, taxResultId: 'tax-result-1' });
      await finalizeSvc.finalize({ tenantId, payload: recap, actor: 'desk-1' });
      await reviewSvc.release(tenantId, dealNumber, 1, 'biller-1');

      const receipt: any = await citSvc.recordFundingReceipt({ tenantId, dealNumber, amount: '24500.00', lenderRef: 'LENDER-1', receivedAt: new Date().toISOString(), idempotencyKey: `fund-${dealNumber}`, actor: 'ar-clerk-1' });
      expect(receipt.status).toBe('SHORT_FUNDED_PENDING_DISPOSITION');
      expect(Number(receipt.shortfallAmount).toFixed(2)).toBe('500.00');

      const dispositioned: any = await citSvc.dispositionShortfall(tenantId, receipt.id, 'FEE_WITHHELD', 'lender doc fee', 'controller-1');
      expect(dispositioned.status).toBe('SHORT_FUNDED_FEE_WITHHELD');

      const item = await prisma.dealOpenItem.findUnique({ where: { tenantId_itemType_itemNumber: { tenantId, itemType: 'CIT', itemNumber: dealNumber } } });
      expect(item!.status).toBe('CLOSED');
    });

    it('short-fund CONTRACT_ISSUE leaves the item open pending correction and reopens the review case', async () => {
      const tenantId = freshTenant();
      const dealNumber = `D-${randomUUID()}`;
      const recap = retailRecapFixture({ dealNumber, taxResultId: 'tax-result-1' });
      await finalizeSvc.finalize({ tenantId, payload: recap, actor: 'desk-1' });
      await reviewSvc.release(tenantId, dealNumber, 1, 'biller-1');

      const receipt: any = await citSvc.recordFundingReceipt({ tenantId, dealNumber, amount: '24000.00', lenderRef: 'LENDER-1', receivedAt: new Date().toISOString(), idempotencyKey: `fund-${dealNumber}`, actor: 'ar-clerk-1' });
      await citSvc.dispositionShortfall(tenantId, receipt.id, 'CONTRACT_ISSUE', 'stips outstanding', 'controller-1');

      const item = await prisma.dealOpenItem.findUnique({ where: { tenantId_itemType_itemNumber: { tenantId, itemType: 'CIT', itemNumber: dealNumber } } });
      expect(item!.status).toBe('PARTIALLY_APPLIED');

      const deal = await prisma.deal.findUnique({ where: { tenantId_dealNumber: { tenantId, dealNumber } } });
      const reviewCase = await prisma.dealReviewCase.findUnique({ where: { tenantId_dealId_recapVersion: { tenantId, dealId: deal!.id, recapVersion: 1 } } });
      expect(reviewCase!.status).toBe('PENDING_REVIEW');
    });
  });

  // ── S089 payoff issuance & variance ─────────────────────────────────────
  describe('S089 payoff issuance & variance', () => {
    it('refuses to issue a payoff with no linked deal item (no orphan payoffs)', async () => {
      const tenantId = freshTenant();
      await expect(payoffSvc.issuePayoff({ tenantId, dealNumber: 'NO-SUCH-DEAL', actualAmount: '100.00', idempotencyKey: randomUUID(), actor: 'ar-clerk-1' })).rejects.toThrow();
    });

    it('issues a payoff exactly once; a second attempt is refused', async () => {
      const tenantId = freshTenant();
      const dealNumber = `D-${randomUUID()}`;
      const recap = retailRecapFixture({ dealNumber, taxResultId: 'tax-result-1' });
      await finalizeSvc.finalize({ tenantId, payload: recap, actor: 'desk-1' });
      await reviewSvc.release(tenantId, dealNumber, 1, 'biller-1');

      const issuance: any = await payoffSvc.issuePayoff({ tenantId, dealNumber, actualAmount: '4200.00', idempotencyKey: `payoff-${dealNumber}`, actor: 'ar-clerk-1' });
      expect(issuance.varianceDisposition).toBe('NONE');

      const item = await prisma.dealOpenItem.findUnique({ where: { tenantId_itemType_itemNumber: { tenantId, itemType: 'PAYOFF', itemNumber: dealNumber } } });
      expect(item!.status).toBe('CLOSED');

      await expect(payoffSvc.issuePayoff({ tenantId, dealNumber, actualAmount: '4200.00', idempotencyKey: `payoff-${dealNumber}-retry`, actor: 'ar-clerk-1' })).rejects.toThrow(AlreadyRelievedError);
    });

    it('a per-diem variance requires an explicit disposition ceremony', async () => {
      const tenantId = freshTenant();
      const dealNumber = `D-${randomUUID()}`;
      const recap = retailRecapFixture({ dealNumber, taxResultId: 'tax-result-1' });
      await finalizeSvc.finalize({ tenantId, payload: recap, actor: 'desk-1' });
      await reviewSvc.release(tenantId, dealNumber, 1, 'biller-1');

      const issuance: any = await payoffSvc.issuePayoff({ tenantId, dealNumber, actualAmount: '4215.00', idempotencyKey: `payoff-${dealNumber}`, actor: 'ar-clerk-1' });
      expect(issuance.varianceDisposition).toBeNull();

      const dispositioned: any = await payoffSvc.dispositionVariance(tenantId, dealNumber, 'ADDITIONAL_PAYMENT', 'per-diem accrual', 'controller-1');
      expect(dispositioned.varianceDisposition).toBe('ADDITIONAL_PAYMENT');
    });
  });

  // ── S090 wholesale disposition & arbitration ─────────────────────────────
  describe('S090 wholesale disposition & arbitration', () => {
    it('refuses to post the wholesale AR unless title is RELEASED', async () => {
      const tenantId = freshTenant();
      await expect(wholesaleSvc.dispose({
        tenantId, legalEntityId: 'entity-1', storeId: 'store-1', unitRef: `VIN-${randomUUID()}`, titleStatus: 'PENDING',
        wholesaleAmount: '12000.00', unitReliefAmount: '10000.00', auctionFeesAmount: '300.00', idempotencyKey: randomUUID(), actor: 'wholesale-clerk-1',
      })).rejects.toThrow(TitleNotReleasedError);
    });

    it('disposes a unit at a GAIN, conserving unit value to gain exactly', async () => {
      const tenantId = freshTenant();
      const disposition: any = await wholesaleSvc.dispose({
        tenantId, legalEntityId: 'entity-1', storeId: 'store-1', unitRef: `VIN-${randomUUID()}`, titleStatus: 'RELEASED',
        wholesaleAmount: '12000.00', unitReliefAmount: '10000.00', auctionFeesAmount: '300.00', idempotencyKey: randomUUID(), actor: 'wholesale-clerk-1',
      });
      expect(disposition.dispositionOutcome).toBe('GAIN');
      expect(Number(disposition.gainLossAmount).toFixed(2)).toBe('2000.00');
    });

    it('arbitration price adjustment updates the AR precisely', async () => {
      const tenantId = freshTenant();
      const disposition: any = await wholesaleSvc.dispose({
        tenantId, legalEntityId: 'entity-1', storeId: 'store-1', unitRef: `VIN-${randomUUID()}`, titleStatus: 'RELEASED',
        wholesaleAmount: '12000.00', unitReliefAmount: '10000.00', auctionFeesAmount: '300.00', idempotencyKey: randomUUID(), actor: 'wholesale-clerk-1',
      });
      await wholesaleSvc.priceAdjustment(tenantId, disposition.id, '-500.00', 'condition dispute settled', 'controller-1', randomUUID());
      const updated = await prisma.wholesaleDisposition.findUnique({ where: { id: disposition.id } });
      expect(Number(updated!.wholesaleAmount).toFixed(2)).toBe('11500.00');
      expect(updated!.status).toBe('ARBITRATED_ADJUSTED');
    });

    it('arbitration unit return reverses the original disposition and marks it returned', async () => {
      const tenantId = freshTenant();
      const disposition: any = await wholesaleSvc.dispose({
        tenantId, legalEntityId: 'entity-1', storeId: 'store-1', unitRef: `VIN-${randomUUID()}`, titleStatus: 'RELEASED',
        wholesaleAmount: '12000.00', unitReliefAmount: '10000.00', auctionFeesAmount: '300.00', idempotencyKey: randomUUID(), actor: 'wholesale-clerk-1',
      });
      const beforeReversed = reversalClient.reversed.length;
      await wholesaleSvc.unitReturn(tenantId, disposition.id, '450.00', 'buyer rejected on inspection', 'controller-1', randomUUID());
      expect(reversalClient.reversed.length).toBeGreaterThan(beforeReversed);
      const updated = await prisma.wholesaleDisposition.findUnique({ where: { id: disposition.id } });
      expect(updated!.status).toBe('ARBITRATED_RETURNED');
    });
  });
});
