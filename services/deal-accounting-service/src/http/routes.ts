import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware } from '@amacc/shared-kernel';
import type { PrismaClient } from '.prisma/deal-accounting-client';
import { DealFinalizeService } from '../application/deal-finalize-service';
import { BillerReviewService } from '../application/biller-review-service';
import { UnwindService } from '../application/unwind-service';
import { RecontractService } from '../application/recontract-service';
import { CitFundingService } from '../application/cit-funding-service';
import { PayoffService } from '../application/payoff-service';
import { WholesaleService } from '../application/wholesale-service';
import { DueBillService } from '../application/due-bill-service';
import { DealAccountingError } from '../application/errors';
import { RecapValidationError, TradeInSplitMissingError } from '../domain/recap-validation';
import { TaxResultNotFoundError, TaxResultUnusableError, TaxServiceUnavailableError } from '../infrastructure/tax-result-client';
import { getTenantId, getActor, requireDealAccountingPermission, DEAL_ACCOUNTING_PERMISSIONS } from './security';

function handleError(error: unknown, reply: any) {
  if (error instanceof RecapValidationError) return reply.status(400).send({ error: error.code, message: error.message, fieldErrors: error.fieldErrors });
  if (error instanceof TradeInSplitMissingError) return reply.status(422).send({ error: error.code, message: error.message, detail: error.detail });
  if (error instanceof TaxResultNotFoundError) return reply.status(422).send({ error: 'TAX_RESULT_NOT_FOUND', message: error.message });
  if (error instanceof TaxResultUnusableError) return reply.status(422).send({ error: 'TAX_RESULT_UNUSABLE', message: error.message, status: error.status });
  if (error instanceof TaxServiceUnavailableError) return reply.status(502).send({ error: 'TAX_SERVICE_UNAVAILABLE', message: error.message });
  if (error instanceof DealAccountingError) return reply.status(error.status).send({ error: error.code, message: error.message, ...(error as any) });
  if (error instanceof z.ZodError) return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: error.issues });
  if ((error as any)?.statusCode === 400) return reply.status(400).send({ error: 'BAD_REQUEST', message: (error as any).message });
  throw error;
}

const ProductLineSchema = z.object({
  productCode: z.string().min(1),
  providerRef: z.string().min(1),
  customerPriceAmount: z.string(),
  providerCostAmount: z.string(),
});

const RecapPayloadSchema = z.object({
  dealNumber: z.string().min(1),
  recapVersion: z.number().int().min(1),
  dealType: z.enum(['RETAIL', 'LEASE', 'WHOLESALE', 'DEALER_TRADE']),
  vin: z.string().nullish(),
  stockNumber: z.string().min(1),
  legalEntityId: z.string().min(1),
  storeId: z.string().min(1),
  businessDate: z.string(),
  saleAmount: z.string().nullish(),
  dealerTradeAmount: z.string().nullish(),
  wholesaleAmount: z.string().nullish(),
  leaseCapitalizedCostAmount: z.string().nullish(),
  leaseResidualAmount: z.string().nullish(),
  unitCostAmount: z.string(),
  hasTradeIn: z.boolean(),
  tradeVin: z.string().nullish(),
  tradeAllowanceAmount: z.string().nullish(),
  tradeAcvAmount: z.string().nullish(),
  tradePayoffAmount: z.string().nullish(),
  tradeLienholderRef: z.string().nullish(),
  financedAmount: z.string().nullish(),
  reserveIncomeAmount: z.string().nullish(),
  reserveTermsRef: z.string().nullish(),
  products: z.array(ProductLineSchema).optional(),
  feesAmount: z.string().nullish(),
  taxResultId: z.string().nullish(),
  rebateReceivableAmount: z.string().nullish(),
  downPaymentRef: z.string().nullish(),
  commissionBasisSnapshot: z.record(z.unknown()).nullish(),
}) as z.ZodType<any>;

const ReasonSchema = z.object({ reason: z.string().min(1).max(500) });

export async function dealAccountingRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is not set. Set it before starting deal-accounting-service.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const prisma = container.resolve<PrismaClient>('PrismaClient');
  const finalizeSvc = container.resolve(DealFinalizeService);
  const reviewSvc = container.resolve(BillerReviewService);
  const unwindSvc = container.resolve(UnwindService);
  const recontractSvc = container.resolve(RecontractService);
  const citSvc = container.resolve(CitFundingService);
  const payoffSvc = container.resolve(PayoffService);
  const wholesaleSvc = container.resolve(WholesaleService);
  const dueBillSvc = container.resolve(DueBillService);

  function parsePagination(query: any): { page?: number; pageSize?: number } {
    return {
      page: query?.page ? Number(query.page) : undefined,
      pageSize: query?.pageSize ? Number(query.pageSize) : undefined,
    };
  }

  // ── S084 — finalize ────────────────────────────────────────────────────
  app.post('/deals/finalize', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.DEAL_FINALIZE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const payload = RecapPayloadSchema.parse(request.body ?? {});
      if (payload.tenantId && payload.tenantId !== tenantId) return reply.status(400).send({ error: 'TENANT_MISMATCH' });
      const result = await finalizeSvc.finalize({ tenantId, payload, actor: getActor(request) });
      return reply.status(result.idempotentReplay ? 200 : 201).send(result);
    } catch (err) { return handleError(err, reply); }
  });

  app.get('/deals/:dealNumber', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.DEAL_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const dealNumber = (request.params as any).dealNumber as string;
      const deal = await prisma.deal.findUnique({ where: { tenantId_dealNumber: { tenantId, dealNumber } } });
      if (!deal) return reply.status(404).send({ error: 'DEAL_NOT_FOUND' });
      const [recaps, postingRecords, reviewCases, openItems] = await Promise.all([
        prisma.dealRecap.findMany({ where: { tenantId, dealId: deal.id }, orderBy: { recapVersion: 'asc' } }),
        prisma.dealPostingRecord.findMany({ where: { tenantId, dealId: deal.id }, orderBy: { createdAt: 'asc' } }),
        prisma.dealReviewCase.findMany({ where: { tenantId, dealId: deal.id }, orderBy: { recapVersion: 'asc' } }),
        prisma.dealOpenItem.findMany({ where: { tenantId, dealId: deal.id } }),
      ]);
      return reply.send({ deal, recaps, postingRecords, reviewCases, openItems });
    } catch (err) { return handleError(err, reply); }
  });

  app.get('/deals', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.DEAL_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const items = await prisma.deal.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 200 });
      return reply.send({ items });
    } catch (err) { return handleError(err, reply); }
  });

  // ── Gap-closure — GET recontract/unwind lineage: the full chain (original
  // posting, recontract DELTA/REVERSE_REPOST deltas, unwind reversals), not
  // just the immediate ceremony response a single POST call returns. ──────
  app.get('/deals/:dealNumber/lineage', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.DEAL_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const dealNumber = (request.params as any).dealNumber as string;
      const deal = await prisma.deal.findUnique({ where: { tenantId_dealNumber: { tenantId, dealNumber } } });
      if (!deal) return reply.status(404).send({ error: 'DEAL_NOT_FOUND' });
      const [postingRecords, recontracts, unwinds] = await Promise.all([
        prisma.dealPostingRecord.findMany({ where: { tenantId, dealId: deal.id }, orderBy: { createdAt: 'asc' } }),
        prisma.dealRecontract.findMany({ where: { tenantId, dealId: deal.id }, orderBy: { createdAt: 'asc' } }),
        prisma.dealUnwind.findMany({ where: { tenantId, dealId: deal.id }, orderBy: { executedAt: 'asc' } }),
      ]);
      return reply.send({
        deal: { dealNumber: deal.dealNumber, dealType: deal.dealType, status: deal.status, currentRecapVersion: deal.currentRecapVersion },
        chain: postingRecords.map((r: any) => ({
          id: r.id, recapVersion: r.recapVersion, segmentType: r.segmentType, eventType: r.eventType, eventId: r.eventId,
          coaStatus: r.coaStatus, journalEntryId: r.journalEntryId, journalNumber: r.journalNumber,
          reversalJournalEntryId: r.reversalJournalEntryId, reversalJournalNumber: r.reversalJournalNumber, reversedAt: r.reversedAt,
          createdAt: r.createdAt,
        })),
        recontracts: recontracts.map((r: any) => ({
          id: r.id, fromRecapVersion: r.fromRecapVersion, toRecapVersion: r.toRecapVersion, mode: r.mode,
          deltaPostingRecordId: r.deltaPostingRecordId, reversalPostingRecordId: r.reversalPostingRecordId, repostPostingRecordId: r.repostPostingRecordId,
          createdAt: r.createdAt,
        })),
        unwinds: unwinds.map((u: any) => ({
          id: u.id, recapVersion: u.recapVersion, status: u.status, reason: u.reason, refusalCode: u.refusalCode,
          reversalPostingRecordIds: u.reversalPostingRecordIds, executedAt: u.executedAt,
        })),
      });
    } catch (err) { return handleError(err, reply); }
  });

  // ── S085 — biller review workbench ─────────────────────────────────────
  app.get('/review/queue', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.REVIEW_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const status = (request.query as any)?.status as string | undefined;
      const items = await reviewSvc.getQueue(tenantId, status);
      return reply.send({ items });
    } catch (err) { return handleError(err, reply); }
  });

  app.get('/deals/:dealNumber/recap/:version/preview', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.REVIEW_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { dealNumber, version } = request.params as any;
      const result = await reviewSvc.preview(tenantId, dealNumber, Number(version));
      return reply.send(result);
    } catch (err) { return handleError(err, reply); }
  });

  app.post('/deals/:dealNumber/recap/:version/hold', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.BILLER_HOLD) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { dealNumber, version } = request.params as any;
      const body = ReasonSchema.parse(request.body ?? {});
      const result = await reviewSvc.hold(tenantId, dealNumber, Number(version), body.reason, getActor(request));
      return reply.send(result);
    } catch (err) { return handleError(err, reply); }
  });

  app.post('/deals/:dealNumber/recap/:version/return', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.BILLER_RETURN) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { dealNumber, version } = request.params as any;
      const body = ReasonSchema.parse(request.body ?? {});
      const result = await reviewSvc.returnToDesking(tenantId, dealNumber, Number(version), body.reason, getActor(request));
      return reply.send(result);
    } catch (err) { return handleError(err, reply); }
  });

  app.post('/deals/:dealNumber/recap/:version/release', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.BILLER_RELEASE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { dealNumber, version } = request.params as any;
      const result = await reviewSvc.release(tenantId, dealNumber, Number(version), getActor(request));
      return reply.status(200).send(result);
    } catch (err) { return handleError(err, reply); }
  });

  // ── S086 — unwind ───────────────────────────────────────────────────────
  app.post('/deals/:dealNumber/unwind', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.UNWIND_EXECUTE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const dealNumber = (request.params as any).dealNumber as string;
      const body = ReasonSchema.extend({ recapVersion: z.number().int().optional() }).parse(request.body ?? {});
      const result = await unwindSvc.unwind({ tenantId, dealNumber, recapVersion: body.recapVersion, reason: body.reason, actor: getActor(request) });
      return reply.status(201).send(result);
    } catch (err) { return handleError(err, reply); }
  });

  // ── S087 — recontract ───────────────────────────────────────────────────
  app.post('/deals/:dealNumber/recontract', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.RECONTRACT_EXECUTE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const dealNumber = (request.params as any).dealNumber as string;
      const newRecap = RecapPayloadSchema.parse((request.body as any)?.newRecap ?? {});
      if (newRecap.dealNumber !== dealNumber) return reply.status(400).send({ error: 'DEAL_NUMBER_MISMATCH' });
      const result = await recontractSvc.recontract({ tenantId, dealNumber, newRecap, actor: getActor(request) });
      return reply.status(201).send(result);
    } catch (err) { return handleError(err, reply); }
  });

  // ── S088 — CIT funding ───────────────────────────────────────────────────
  const CitFundingSchema = z.object({
    dealNumber: z.string().min(1), amount: z.string(), lenderRef: z.string().min(1), receivedAt: z.string(), idempotencyKey: z.string().min(1),
  });
  app.post('/cit/funding-receipts', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.CIT_FUND) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = CitFundingSchema.parse(request.body ?? {});
      const result = await citSvc.recordFundingReceipt({ tenantId, ...body, actor: getActor(request) });
      return reply.status(201).send(result);
    } catch (err) { return handleError(err, reply); }
  });

  const CitDispositionSchema = z.object({ dispositionType: z.enum(['FEE_WITHHELD', 'CONTRACT_ISSUE']), reason: z.string().min(1).max(500) });
  app.post('/cit/funding-receipts/:id/disposition', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.CIT_DISPOSITION) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const id = (request.params as any).id as string;
      const body = CitDispositionSchema.parse(request.body ?? {});
      const result = await citSvc.dispositionShortfall(tenantId, id, body.dispositionType, body.reason, getActor(request));
      return reply.send(result);
    } catch (err) { return handleError(err, reply); }
  });

  app.get('/cit/aging', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.CIT_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const threshold = (request.query as any)?.thresholdDays ? Number((request.query as any).thresholdDays) : undefined;
      const items = await citSvc.listAging(tenantId, threshold);
      return reply.send({ items });
    } catch (err) { return handleError(err, reply); }
  });

  // ── Gap-closure — GET list endpoint for CIT funding receipts (previously
  // only POST existed) ─────────────────────────────────────────────────────
  app.get('/cit/funding-receipts', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.CIT_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as any;
      const result = await citSvc.listFundingReceipts(tenantId, { dealNumber: q?.dealNumber, status: q?.status, ...parsePagination(q) });
      return reply.send(result);
    } catch (err) { return handleError(err, reply); }
  });

  // ── Gap-closure — Sold-Not-Funded (SNF) explicit view ───────────────────
  app.get('/cit/sold-not-funded', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.CIT_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const threshold = (request.query as any)?.thresholdDays ? Number((request.query as any).thresholdDays) : undefined;
      const items = await citSvc.listSoldNotFunded(tenantId, threshold);
      return reply.send({ items });
    } catch (err) { return handleError(err, reply); }
  });

  // ── S089 — payoff ────────────────────────────────────────────────────────
  const PayoffIssueSchema = z.object({ dealNumber: z.string().min(1), actualAmount: z.string(), idempotencyKey: z.string().min(1) });
  app.post('/payoffs', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.PAYOFF_ISSUE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = PayoffIssueSchema.parse(request.body ?? {});
      const result = await payoffSvc.issuePayoff({ tenantId, ...body, actor: getActor(request) });
      return reply.status(201).send(result);
    } catch (err) { return handleError(err, reply); }
  });

  const PayoffVarianceSchema = z.object({ disposition: z.enum(['ADDITIONAL_PAYMENT', 'REFUND_RECEIVABLE']), reason: z.string().min(1).max(500) });
  app.post('/payoffs/:dealNumber/variance-disposition', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.PAYOFF_VARIANCE_DISPOSITION) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const dealNumber = (request.params as any).dealNumber as string;
      const body = PayoffVarianceSchema.parse(request.body ?? {});
      const result = await payoffSvc.dispositionVariance(tenantId, dealNumber, body.disposition, body.reason, getActor(request));
      return reply.send(result);
    } catch (err) { return handleError(err, reply); }
  });

  app.get('/payoffs/:dealNumber', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.PAYOFF_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const dealNumber = (request.params as any).dealNumber as string;
      const deal = await prisma.deal.findUnique({ where: { tenantId_dealNumber: { tenantId, dealNumber } } });
      if (!deal) return reply.status(404).send({ error: 'DEAL_NOT_FOUND' });
      const issuance = await prisma.payoffIssuance.findUnique({ where: { tenantId_dealId: { tenantId, dealId: deal.id } } });
      return reply.send({ issuance });
    } catch (err) { return handleError(err, reply); }
  });

  // ── S090 — wholesale + arbitration ──────────────────────────────────────
  const WholesaleDisposeSchema = z.object({
    unitRef: z.string().min(1), titleStatus: z.string().min(1), wholesaleAmount: z.string(), unitReliefAmount: z.string(),
    auctionFeesAmount: z.string(), idempotencyKey: z.string().min(1), dealNumber: z.string().nullish(),
    legalEntityId: z.string().min(1), storeId: z.string().min(1),
  });
  app.post('/wholesale/dispositions', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.WHOLESALE_DISPOSE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = WholesaleDisposeSchema.parse(request.body ?? {});
      const result = await wholesaleSvc.dispose({ tenantId, ...body, actor: getActor(request) });
      return reply.status(201).send(result);
    } catch (err) { return handleError(err, reply); }
  });

  const ArbitrationPriceSchema = z.object({ adjustmentAmount: z.string(), reason: z.string().min(1).max(500), idempotencyKey: z.string().min(1) });
  app.post('/wholesale/dispositions/:id/arbitration/price-adjustment', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.WHOLESALE_ARBITRATION) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const id = (request.params as any).id as string;
      const body = ArbitrationPriceSchema.parse(request.body ?? {});
      const result = await wholesaleSvc.priceAdjustment(tenantId, id, body.adjustmentAmount, body.reason, getActor(request), body.idempotencyKey);
      return reply.status(201).send(result);
    } catch (err) { return handleError(err, reply); }
  });

  const ArbitrationReturnSchema = z.object({ conditionCostAmount: z.string(), reason: z.string().min(1).max(500), idempotencyKey: z.string().min(1) });
  app.post('/wholesale/dispositions/:id/arbitration/unit-return', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.WHOLESALE_ARBITRATION) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const id = (request.params as any).id as string;
      const body = ArbitrationReturnSchema.parse(request.body ?? {});
      const result = await wholesaleSvc.unitReturn(tenantId, id, body.conditionCostAmount, body.reason, getActor(request), body.idempotencyKey);
      return reply.status(201).send(result);
    } catch (err) { return handleError(err, reply); }
  });

  app.get('/wholesale/dispositions/:id', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.WHOLESALE_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const id = (request.params as any).id as string;
      const disposition = await prisma.wholesaleDisposition.findFirst({ where: { id, tenantId } });
      if (!disposition) return reply.status(404).send({ error: 'WHOLESALE_DISPOSITION_NOT_FOUND' });
      const arbitrationCases = await prisma.arbitrationCase.findMany({ where: { tenantId, dispositionId: id } });
      return reply.send({ disposition, arbitrationCases });
    } catch (err) { return handleError(err, reply); }
  });

  // ── Gap-closure — GET list endpoint for wholesale dispositions (previously
  // only create + get-by-id existed) ──────────────────────────────────────
  app.get('/wholesale/dispositions', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.WHOLESALE_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as any;
      const result = await wholesaleSvc.listDispositions(tenantId, { status: q?.status, unitRef: q?.unitRef, ...parsePagination(q) });
      return reply.send(result);
    } catch (err) { return handleError(err, reply); }
  });

  // ── Gap-closure — Due-Bill / We-Owe items (schedule 91) ─────────────────
  const DueBillCreateSchema = z.object({
    dealNumber: z.string().min(1), itemDescription: z.string().min(1).max(500), amount: z.string(),
    reason: z.string().min(1).max(500), idempotencyKey: z.string().min(1),
  });
  app.post('/due-bills', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.DUE_BILL_RECORD) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = DueBillCreateSchema.parse(request.body ?? {});
      const result = await dueBillSvc.recordDueBill({ tenantId, ...body, actor: getActor(request) });
      return reply.status(201).send(result);
    } catch (err) { return handleError(err, reply); }
  });

  app.get('/due-bills', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.DUE_BILL_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as any;
      const result = await dueBillSvc.list(tenantId, { dealNumber: q?.dealNumber, status: q?.status, ...parsePagination(q) });
      return reply.send(result);
    } catch (err) { return handleError(err, reply); }
  });

  app.get('/due-bills/:id', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.DUE_BILL_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const id = (request.params as any).id as string;
      const result = await dueBillSvc.getById(tenantId, id);
      return reply.send(result);
    } catch (err) { return handleError(err, reply); }
  });

  app.post('/due-bills/:id/fulfill', { preHandler: requireDealAccountingPermission(DEAL_ACCOUNTING_PERMISSIONS.DUE_BILL_RECORD) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const id = (request.params as any).id as string;
      const result = await dueBillSvc.fulfill(tenantId, id, getActor(request));
      return reply.send(result);
    } catch (err) { return handleError(err, reply); }
  });
}
