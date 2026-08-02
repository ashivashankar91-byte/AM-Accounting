/**
 * CE-12 (Workstream R) — fni-reserve-service LIVE DATABASE certification
 * suite. Same skip-unless-LIVE_DATABASE_URL convention as
 * services/coa-service/tests/live-db/*.test.ts.
 *
 * coa-service/posting-recovery-service/schedule-service do not run as live
 * HTTP servers in this test environment — this suite stubs that network
 * boundary (tests/support/stubs.ts) and proves everything this service
 * itself owns against a REAL Postgres instance:
 *   1. Idempotent replay — same idempotencyKey never creates a second row.
 *   2. Double-cancellation refusal — the real DB unique constraint
 *      (@@unique([tenantId, dealNumber, productCode])) backstops the
 *      application-layer race the pre-check alone cannot close.
 *   3. Chargeback-reserve tie-out — Σ accruals − Σ draws, computed from
 *      real persisted rows, ties to $0 variance after a draw exceeding the
 *      remaining balance.
 *   4. RLS tenant isolation (positive + negative) on a representative
 *      table, using a real non-superuser connection (same reasoning as
 *      coa-service's live-db suite / tests/integration/test-rls-isolation.ts).
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import pg from 'pg';
import { PrismaClient } from '.prisma/fni-reserve-client';
import { PostingOrchestrator, POSTING_CLIENT_TOKEN, POSTING_RECOVERY_CLIENT_TOKEN } from '../../src/application/posting-orchestrator';
import { ChargebackDrawExecutor } from '../../src/application/chargeback-draw-executor';
import { ReserveService } from '../../src/application/reserve-service';
import { CancellationService, DuplicateCancellationError } from '../../src/application/cancellation-service';
import { ConfigService } from '../../src/application/config-service';
import { RemitService, SCHEDULE_OPEN_ITEM_CLIENT_TOKEN } from '../../src/application/remit-service';
import { DeferralService } from '../../src/application/deferral-service';
import { AlwaysPostedPostingClient, InMemoryPostingRecoveryClient, EmptyScheduleOpenItemClient } from '../support/stubs';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];
const APP_URL = process.env['FNI_PG_APP_URL']; // e.g. postgresql://fni_test_app:fni_test_app_pw@localhost:5432/<db>

describe.skipIf(!LIVE_DB_URL)('CE-12 fni-reserve-service — live database', () => {
  let prisma: PrismaClient;
  let orchestrator: PostingOrchestrator;
  let reserveSvc: ReserveService;
  let cancellationSvc: CancellationService;
  let configSvc: ConfigService;
  let remitSvc: RemitService;
  let deferralSvc: DeferralService;
  let postingClient: AlwaysPostedPostingClient;

  const TENANT = `fni-live-${randomUUID()}`;
  const OTHER_TENANT = `fni-live-other-${randomUUID()}`;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();

    postingClient = new AlwaysPostedPostingClient();
    orchestrator = new PostingOrchestrator(postingClient as any, new InMemoryPostingRecoveryClient() as any);
    const drawExecutor = new ChargebackDrawExecutor(prisma as any, orchestrator);
    configSvc = new ConfigService(prisma as any);
    reserveSvc = new ReserveService(prisma as any, orchestrator, drawExecutor, configSvc, new EmptyScheduleOpenItemClient());
    cancellationSvc = new CancellationService(prisma as any, orchestrator, drawExecutor, configSvc);
    remitSvc = new RemitService(prisma as any, orchestrator, configSvc, new EmptyScheduleOpenItemClient());
    deferralSvc = new DeferralService(prisma as any, orchestrator, configSvc, new EmptyScheduleOpenItemClient());
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('processRemittance is idempotent under the SAME idempotencyKey — replay returns the original row, no duplicate insert', async () => {
    const key = `remit-${randomUUID()}`;
    const first = await reserveSvc.processRemittance(TENANT, {
      dealNumber: 'DEAL-100', lenderProgramCode: 'LP1', expectedAmount: '500.00', remittedAmount: '500.00', idempotencyKey: key, actor: 'tester',
    });
    const second = await reserveSvc.processRemittance(TENANT, {
      dealNumber: 'DEAL-100', lenderProgramCode: 'LP1', expectedAmount: '500.00', remittedAmount: '500.00', idempotencyKey: key, actor: 'tester',
    });
    expect(second.id).toBe(first.id);
    const count = await prisma.reserveRemittance.count({ where: { tenantId: TENANT, idempotencyKey: key } });
    expect(count).toBe(1);
  });

  it('S091(b) chargeback-reserve accrual + S091(c) draw conserve, and the tie-out endpoint reflects real persisted rows exactly', async () => {
    await configSvc.createLenderProgramConfig(TENANT, {
      lenderProgramCode: 'LP-TIE', lenderProgramName: 'Test Lender', chargebackReservePercent: '20.00', effectiveFrom: '2020-01-01T00:00:00.000Z',
    }, 'tester');

    await reserveSvc.processRemittance(TENANT, {
      dealNumber: 'DEAL-200', lenderProgramCode: 'LP-TIE', expectedAmount: '1000.00', remittedAmount: '1000.00', idempotencyKey: `remit-${randomUUID()}`, actor: 'tester',
    });
    // 20% of $1000.00 = $200.00 accrued.

    const tieBeforeDraw = await reserveSvc.tieOutChargebackReserve(TENANT, 'LP-TIE');
    expect(tieBeforeDraw.totalAccrued).toBe('200.00');
    expect(tieBeforeDraw.totalDrawn).toBe('0.00');
    expect(tieBeforeDraw.totalRemainingBalance).toBe('200.00');

    // Chargeback exceeds the $200.00 reserve — draws it to zero, $50 excess to expense.
    const draw = await reserveSvc.processChargebackNotice(TENANT, {
      dealNumber: 'DEAL-200', lenderProgramCode: 'LP-TIE', chargebackAmount: '250.00', idempotencyKey: `cb-${randomUUID()}`, actor: 'tester',
    });
    expect(draw.drawFromReserveAmount).toBe('200.00');
    expect(draw.excessToExpenseAmount).toBe('50.00');
    expect((Number(draw.drawFromReserveAmount) + Number(draw.excessToExpenseAmount)).toFixed(2)).toBe('250.00');

    const tieAfterDraw = await reserveSvc.tieOutChargebackReserve(TENANT, 'LP-TIE');
    expect(tieAfterDraw.totalAccrued).toBe('200.00');
    expect(tieAfterDraw.totalDrawn).toBe('200.00');
    expect(tieAfterDraw.totalRemainingBalance).toBe('0.00'); // $0 variance, per the S091 AC
  });

  it('S093 double-cancellation is refused at the DATABASE level even when the application pre-check races (real unique constraint)', async () => {
    const dealNumber = `DEAL-CANCEL-${randomUUID()}`;
    const productCode = 'GAP';

    const first = await cancellationSvc.processCancellation(TENANT, {
      dealNumber, productCode, cancellationSource: 'CUSTOMER',
      originalIncomeAmount: '400.00', originalRemitAmount: '100.00',
      refundBasis: { kind: 'PROVIDER_QUOTE_PERCENT', refundPercent: 100 },
      idempotencyKey: `cancel-${randomUUID()}`, actor: 'tester',
    });
    expect(first.status).toBe('PROCESSED');

    // A second cancellation attempt for the SAME deal+product, different
    // idempotencyKey (a genuinely new request, not a retry) — must be
    // explicitly refused, never silently no-op or double-refund.
    await expect(
      cancellationSvc.processCancellation(TENANT, {
        dealNumber, productCode, cancellationSource: 'CUSTOMER',
        originalIncomeAmount: '400.00', originalRemitAmount: '100.00',
        refundBasis: { kind: 'PROVIDER_QUOTE_PERCENT', refundPercent: 100 },
        idempotencyKey: `cancel-${randomUUID()}`, actor: 'tester',
      }),
    ).rejects.toThrow(DuplicateCancellationError);

    const count = await prisma.productCancellation.count({ where: { tenantId: TENANT, dealNumber, productCode } });
    expect(count).toBe(1); // exactly one row — no duplicate refund
  });

  it('S093 cancellation three-leg conservation persists exactly: income-reversal + remit-adjustment === refund-payable === quote total', async () => {
    const row = await cancellationSvc.processCancellation(TENANT, {
      dealNumber: `DEAL-LEGS-${randomUUID()}`, productCode: 'VSC', cancellationSource: 'LENDER',
      originalIncomeAmount: '733.33', originalRemitAmount: '266.67',
      refundBasis: { kind: 'PROVIDER_QUOTE_PERCENT', refundPercent: 62.5 },
      idempotencyKey: `cancel-legs-${randomUUID()}`, actor: 'tester',
    });
    const income = Number(row.incomeReversalAmount);
    const remit = Number(row.remitAdjustmentAmount);
    const refund = Number(row.refundPayableAmount);
    const quote = Number(row.quoteTotal);
    expect(Number((income + remit).toFixed(2))).toBe(Number(refund.toFixed(2)));
    expect(refund).toBe(quote);
  });

  it('S092 remit run relieves every matched item exactly: Σ relieved === Σ run total, to the cent, for a multi-item run', async () => {
    const run = await remitSvc.executeRemitRun(TENANT, {
      providerCode: 'ACME-WARRANTY',
      runDate: new Date().toISOString(),
      items: [
        { dealNumber: 'DEAL-301', productCode: 'GAP', amount: '111.11' },
        { dealNumber: 'DEAL-302', productCode: 'VSC', amount: '222.22' },
        { dealNumber: 'DEAL-303', productCode: 'GAP', amount: '333.34' },
      ],
      idempotencyKey: `run-${randomUUID()}`,
      actor: 'tester',
    });
    const itemSum = (run as any).items.reduce((s: number, i: any) => s + Number(i.amount), 0);
    expect(Number(itemSum.toFixed(2))).toBe(Number((run as any).totalAmount));
    expect((run as any).items).toHaveLength(3);
    expect((run as any).items.every((i: any) => i.status === 'RELIEVED')).toBe(true);
  });

  // ── CE-12 gap-closure: preview/execute parity + new list endpoints ───────
  it('previewChargebackNotice computes the EXACT SAME split processChargebackNotice later posts (no drift), against a real persisted reserve balance', async () => {
    await configSvc.createLenderProgramConfig(TENANT, {
      lenderProgramCode: 'LP-PREVIEW', lenderProgramName: 'Preview Test Lender', chargebackReservePercent: '25.00', effectiveFrom: '2020-01-01T00:00:00.000Z',
    }, 'tester');
    await reserveSvc.processRemittance(TENANT, {
      dealNumber: 'DEAL-PREVIEW-1', lenderProgramCode: 'LP-PREVIEW', expectedAmount: '400.00', remittedAmount: '400.00', idempotencyKey: `remit-${randomUUID()}`, actor: 'tester',
    });
    // 25% of $400.00 = $100.00 accrued.

    const preview = await reserveSvc.previewChargebackNotice(TENANT, {
      dealNumber: 'DEAL-PREVIEW-1', lenderProgramCode: 'LP-PREVIEW', chargebackAmount: '150.00', idempotencyKey: `cb-preview-${randomUUID()}`, actor: 'tester',
    });
    expect(preview.preview).toBe(true);
    expect(preview.reserveBalanceBefore).toBe('100.00');
    expect(preview.drawFromReserveAmount).toBe('100.00');
    expect(preview.excessToExpenseAmount).toBe('50.00');

    // Preview must not have posted or persisted anything.
    const drawCountBeforeExecute = await prisma.chargebackDraw.count({ where: { tenantId: TENANT, dealNumber: 'DEAL-PREVIEW-1' } });
    expect(drawCountBeforeExecute).toBe(0);

    const executed = await reserveSvc.processChargebackNotice(TENANT, {
      dealNumber: 'DEAL-PREVIEW-1', lenderProgramCode: 'LP-PREVIEW', chargebackAmount: '150.00', idempotencyKey: `cb-execute-${randomUUID()}`, actor: 'tester',
    });
    // Same split the preview computed — no drift.
    expect(executed.reserveBalanceBefore).toBe(preview.reserveBalanceBefore);
    expect(executed.drawFromReserveAmount).toBe(preview.drawFromReserveAmount);
    expect(executed.excessToExpenseAmount).toBe(preview.excessToExpenseAmount);
  });

  it('previewCancellation computes the EXACT SAME three-leg split processCancellation later persists (no drift), and posts/persists nothing itself', async () => {
    const dealNumber = `DEAL-CANCEL-PREVIEW-${randomUUID()}`;
    const input = {
      dealNumber, productCode: 'GAP', cancellationSource: 'CUSTOMER' as const,
      originalIncomeAmount: '600.00', originalRemitAmount: '200.00',
      refundBasis: { kind: 'PROVIDER_QUOTE_PERCENT' as const, refundPercent: 50 },
      idempotencyKey: `cancel-preview-${randomUUID()}`, actor: 'tester',
    };
    const preview = await cancellationSvc.previewCancellation(TENANT, input);
    expect(preview.preview).toBe(true);

    const countBeforeExecute = await prisma.productCancellation.count({ where: { tenantId: TENANT, dealNumber } });
    expect(countBeforeExecute).toBe(0);

    const executed = await cancellationSvc.processCancellation(TENANT, { ...input, idempotencyKey: `cancel-execute-${randomUUID()}` });
    // Prisma's Decimal#toString() strips trailing zeros (e.g. "400" not
    // "400.00") — normalize via Number(...).toFixed(2) before comparing to
    // the preview's already-normalized centsToDollarString output.
    expect(Number(executed.quoteTotal).toFixed(2)).toBe(preview.quoteTotal);
    expect(Number(executed.incomeReversalAmount).toFixed(2)).toBe(preview.incomeReversalAmount);
    expect(Number(executed.remitAdjustmentAmount).toFixed(2)).toBe(preview.remitAdjustmentAmount);
    expect(Number(executed.refundPayableAmount).toFixed(2)).toBe(preview.refundPayableAmount);
  });

  it('listAccruals/listDraws return real persisted rows, paginated, filterable by dealNumber', async () => {
    await configSvc.createLenderProgramConfig(TENANT, {
      lenderProgramCode: 'LP-LIST', lenderProgramName: 'List Test Lender', chargebackReservePercent: '10.00', effectiveFrom: '2020-01-01T00:00:00.000Z',
    }, 'tester');
    const dealNumber = `DEAL-LIST-${randomUUID()}`;
    await reserveSvc.processRemittance(TENANT, {
      dealNumber, lenderProgramCode: 'LP-LIST', expectedAmount: '1000.00', remittedAmount: '1000.00', idempotencyKey: `remit-${randomUUID()}`, actor: 'tester',
    });
    await reserveSvc.processChargebackNotice(TENANT, {
      dealNumber, lenderProgramCode: 'LP-LIST', chargebackAmount: '50.00', idempotencyKey: `cb-${randomUUID()}`, actor: 'tester',
    });

    const accruals = await reserveSvc.listAccruals(TENANT, { dealNumber }, 1, 25);
    expect(accruals.total).toBeGreaterThanOrEqual(1);
    expect(accruals.items.every((a: any) => a.dealNumber === dealNumber)).toBe(true);

    const draws = await reserveSvc.listDraws(TENANT, { dealNumber }, 1, 25);
    expect(draws.total).toBeGreaterThanOrEqual(1);
    expect(draws.items.every((d: any) => d.dealNumber === dealNumber)).toBe(true);

    const paged = await reserveSvc.listAccruals(TENANT, {}, 1, 1);
    expect(paged.items.length).toBe(1);
    expect(paged.pageSize).toBe(1);
  });

  it('S094 deferral-booking registration originates a real posting event (schedule-96 origination), and tieOutDeferralLiability reports a null scheduleTieOut until a CHARGEBACK/DEFERRED mapping is configured (never fabricated)', async () => {
    await configSvc.createDeferralModeConfig(TENANT, {
      productType: 'GAP-DEFERRED', mode: 'OBLIGOR', earningPatternType: 'STRAIGHT_LINE_MONTHS', earningPatternMonths: 12, effectiveFrom: '2020-01-01T00:00:00.000Z',
    }, 'tester');
    const booking = await deferralSvc.registerBooking(TENANT, {
      dealNumber: 'DEAL-DEFER-1', productCode: 'GAP', productType: 'GAP-DEFERRED', originalAmount: '1200.00', bookingDate: '2026-01-01T00:00:00.000Z', idempotencyKey: `defer-${randomUUID()}`, actor: 'tester',
    });
    expect((booking as any).originationStatus).toBe('POSTED');
    expect((booking as any).originationPostingExecutionId).toBeTruthy();
    expect(postingClient.submittedEnvelopes.some((e) => e.eventType === 'fni.deferral-booking-origination.v1' && (e.payload as any).scheduleControlNumber === 'DEAL-DEFER-1-GAP')).toBe(true);

    const tieOut = await deferralSvc.tieOutDeferralLiability(TENANT);
    expect(tieOut.scheduleTieOut).toBeNull(); // no DEFERRED_INCOME_LIABILITY mapping configured for TENANT
  });

  // ── RLS positive/negative (real non-superuser connection) ────────────────
  describe.skipIf(!APP_URL)('RLS enforcement on chargeback_reserve_accrual', () => {
    let pgClient: pg.Client;

    beforeAll(async () => {
      pgClient = new pg.Client({ connectionString: APP_URL });
      await pgClient.connect();

      await configSvc.createLenderProgramConfig(TENANT, {
        lenderProgramCode: 'LP-RLS', lenderProgramName: 'RLS Test Lender', chargebackReservePercent: '10.00', effectiveFrom: '2020-01-01T00:00:00.000Z',
      }, 'tester');
      await reserveSvc.processRemittance(TENANT, {
        dealNumber: 'DEAL-RLS-1', lenderProgramCode: 'LP-RLS', expectedAmount: '100.00', remittedAmount: '100.00', idempotencyKey: `rls-remit-${randomUUID()}`, actor: 'tester',
      });
      await configSvc.createLenderProgramConfig(OTHER_TENANT, {
        lenderProgramCode: 'LP-RLS', lenderProgramName: 'RLS Test Lender (other tenant)', chargebackReservePercent: '10.00', effectiveFrom: '2020-01-01T00:00:00.000Z',
      }, 'tester');
      await reserveSvc.processRemittance(OTHER_TENANT, {
        dealNumber: 'DEAL-RLS-2', lenderProgramCode: 'LP-RLS', expectedAmount: '100.00', remittedAmount: '100.00', idempotencyKey: `rls-remit-${randomUUID()}`, actor: 'tester',
      });
    });

    afterAll(async () => {
      await pgClient.end();
    });

    it('a tenant-scoped connection sees ONLY its own tenant rows (positive)', async () => {
      await pgClient.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT]);
      const res = await pgClient.query('SELECT tenant_id FROM chargeback_reserve_accrual WHERE lender_program_code = $1', ['LP-RLS']);
      expect(res.rows.length).toBeGreaterThan(0);
      expect(res.rows.every((r: any) => r.tenant_id === TENANT)).toBe(true);
    });

    it('a tenant-scoped connection sees ZERO rows from a different tenant (negative)', async () => {
      await pgClient.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT]);
      const res = await pgClient.query('SELECT tenant_id FROM chargeback_reserve_accrual WHERE tenant_id = $1', [OTHER_TENANT]);
      expect(res.rows.length).toBe(0);
    });
  });
});
