import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware } from '@amacc/shared-kernel';
import { getTenantId, requireFixedOpsPermission, handleError, FIXEDOPS_PERMISSIONS as P } from './security';
import { RoCloseService } from '../application/ro-close-service';
import { RoReversalService } from '../application/ro-reversal-service';
import { RoReportService } from '../application/ro-report-service';
import { WipModeService } from '../application/wip-mode-service';
import { SubletService } from '../application/sublet-service';
import { TechTimeService } from '../application/tech-time-service';
import { DeferredMaintenanceService } from '../application/deferred-maintenance-service';
import { WarrantyClaimService } from '../application/warranty-claim-service';
import { ExceptionService } from '../application/exception-service';
import { AccountMappingService } from '../application/account-mapping-service';
import { LaborRateService } from '../application/labor-rate-service';

const RoCloseLineSchema = z.object({
  lineId: z.string(), payType: z.enum(['C', 'W', 'I']), category: z.enum(['LABOR', 'PARTS', 'SUBLET', 'MISC', 'FEE']),
  opcode: z.string().nullish(), techId: z.string().nullish(), partNumber: z.string().nullish(),
  saleAmount: z.union([z.number(), z.string()]), costAmount: z.union([z.number(), z.string()]).optional(),
});
const RoCloseSchema = z.object({
  legalEntityId: z.string(), storeId: z.string(), roNumber: z.string(), businessDate: z.string(),
  totalSaleAmount: z.union([z.number(), z.string()]), lines: z.array(RoCloseLineSchema).min(1),
  sourceEventId: z.string(), correlationId: z.string(),
});
const ReversalSchema = z.object({
  legalEntityId: z.string(), storeId: z.string(), reason: z.string().nullish(),
  sourceEventId: z.string(), correlationId: z.string(), customerPaymentApplied: z.boolean().optional(),
});
const WipElectSchema = z.object({
  legalEntityId: z.string(), storeId: z.string().nullish(), mode: z.enum(['WIP_MODE', 'DIRECT_MODE']),
  effectiveFrom: z.string(), impactPreview: z.unknown(),
});
const SubletPoSchema = z.object({
  legalEntityId: z.string(), storeId: z.string(), roNumber: z.string(), poNumber: z.string(),
  vendorId: z.string(), estimatedCost: z.union([z.number(), z.string()]),
});
const SubletInvoiceSchema = z.object({
  invoiceId: z.string(), invoiceAmount: z.union([z.number(), z.string()]),
  sourceEventId: z.string(), correlationId: z.string(),
});
const SubletAccrueSchema = z.object({
  legalEntityId: z.string(), roNumber: z.string(),
  sourceEventId: z.string(), correlationId: z.string(),
});
const TechTimeSchema = z.object({
  legalEntityId: z.string(), techId: z.string(), deptCode: z.string(), payrollPeriodId: z.string(),
  clockedHours: z.union([z.number(), z.string()]), flaggedAppliedHours: z.union([z.number(), z.string()]),
  businessDate: z.string(),
  sourceEventId: z.string(), correlationId: z.string(),
});
const TechTimeReverseSchema = z.object({
  legalEntityId: z.string(), techId: z.string(), payrollPeriodId: z.string(), reason: z.string().nullish(),
  sourceEventId: z.string(), correlationId: z.string(),
});
const LaborRateSetSchema = z.object({
  legalEntityId: z.string(), scope: z.enum(['TECHNICIAN', 'DEPARTMENT']), subjectKey: z.string(),
  burdenedRate: z.union([z.number(), z.string()]), effectiveFrom: z.string(),
});
const TechGuaranteeConfigSchema = z.object({
  legalEntityId: z.string(), techId: z.string(),
  guaranteedHoursPerPeriod: z.union([z.number(), z.string()]), effectiveFrom: z.string(),
});
const ContractSellSchema = z.object({
  legalEntityId: z.string(), storeId: z.string(), contractNumber: z.string(),
  soldAmount: z.union([z.number(), z.string()]), expiresAt: z.string().nullish(),
  sourceEventId: z.string(), correlationId: z.string(),
});
const ContractRedeemSchema = z.object({
  roNumber: z.string(), redeemedAmount: z.union([z.number(), z.string()]),
  sourceEventId: z.string(), correlationId: z.string(),
});
const ClaimDispositionSchema = z.object({
  type: z.enum(['WRITE_DOWN', 'TRANSFER_TO_CUSTOMER_RESPONSIBILITY', 'DENIAL', 'ADJUSTMENT']),
  amount: z.union([z.number(), z.string()]), reason: z.string(),
  sourceEventId: z.string(), correlationId: z.string(),
});
const ClaimRemitSchema = z.object({
  remittedAmount: z.union([z.number(), z.string()]), sourceReceiptId: z.string(),
  sourceEventId: z.string(), correlationId: z.string(),
});

export async function fixedOpsRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const roClose = container.resolve(RoCloseService);
  const roReversal = container.resolve(RoReversalService);
  const roReport = container.resolve(RoReportService);
  const wipMode = container.resolve(WipModeService);
  const sublet = container.resolve(SubletService);
  const techTime = container.resolve(TechTimeService);
  const laborRate = container.resolve(LaborRateService);
  const deferred = container.resolve(DeferredMaintenanceService);
  const warranty = container.resolve(WarrantyClaimService);
  const exceptions = container.resolve(ExceptionService);
  const mapping = container.resolve(AccountMappingService);
  const prisma = container.resolve<any>('PrismaClient');

  const actorOf = (request: any) => (request.user?.sub as string | undefined) ?? 'system';

  // ── S059 RO close / postings inquiry ────────────────────────────────────
  app.post('/ro/close', { preHandler: requireFixedOpsPermission(P.RO_CLOSE_EXECUTE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = RoCloseSchema.parse(request.body ?? {});
      const result = await roClose.closeRo({ ...body, tenantId, actor: actorOf(request) });
      return reply.status(result.idempotent ? 200 : 201).send(result);
    } catch (err) { return handleError(err, reply); }
  });

  app.get('/ro/:roNumber', { preHandler: requireFixedOpsPermission(P.RO_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { roNumber } = request.params as any;
      const { storeId } = request.query as any;
      if (!storeId) return reply.status(400).send({ error: 'STORE_ID_REQUIRED' });
      const ro = await roClose.getByRoNumber(tenantId, storeId, roNumber);
      if (!ro) return reply.status(404).send({ error: 'NOT_FOUND' });
      return reply.status(200).send(ro);
    } catch (err) { return handleError(err, reply); }
  });

  app.get('/postings', { preHandler: requireFixedOpsPermission(P.RO_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as Record<string, string | undefined>;
      const items = await roClose.listPostings(tenantId, { storeId: q['storeId'], status: q['status'], payType: q['payType'] });
      return reply.status(200).send({ items });
    } catch (err) { return handleError(err, reply); }
  });

  // ── S060 reopen/void ─────────────────────────────────────────────────────
  app.post('/ro/:roNumber/reopen', { preHandler: requireFixedOpsPermission(P.RO_REVERSAL_EXECUTE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { roNumber } = request.params as any;
      const body = ReversalSchema.parse(request.body ?? {});
      const result = await roReversal.reverse({ ...body, tenantId, roNumber, action: 'REOPEN', actor: actorOf(request) });
      return reply.status(result.idempotent ? 200 : 201).send(result);
    } catch (err) { return handleError(err, reply); }
  });

  app.post('/ro/:roNumber/void', { preHandler: requireFixedOpsPermission(P.RO_REVERSAL_EXECUTE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { roNumber } = request.params as any;
      const body = ReversalSchema.parse(request.body ?? {});
      const result = await roReversal.reverse({ ...body, tenantId, roNumber, action: 'VOID', actor: actorOf(request) });
      return reply.status(result.idempotent ? 200 : 201).send(result);
    } catch (err) { return handleError(err, reply); }
  });

  // ── S061 WIP mode / open-RO report ──────────────────────────────────────
  app.post('/wip-mode/elect', { preHandler: requireFixedOpsPermission(P.WIP_ELECT) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = WipElectSchema.parse(request.body ?? {});
      const row = await wipMode.elect({ ...body, tenantId, approvedBy: actorOf(request) });
      return reply.status(201).send(row);
    } catch (err) { return handleError(err, reply); }
  });

  app.get('/wip-mode/history', { preHandler: requireFixedOpsPermission(P.WIP_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { legalEntityId } = request.query as any;
      const items = await wipMode.history(tenantId, legalEntityId);
      return reply.status(200).send({ items });
    } catch (err) { return handleError(err, reply); }
  });

  app.get('/wip', { preHandler: requireFixedOpsPermission(P.WIP_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as any;
      const report = await roReport.openRoReport(tenantId, q.storeId);
      const tie = await roReport.wipTieOut(tenantId, q.legalEntityId, q.storeId, q.glWipBalance ?? null);
      return reply.status(200).send({ ...report, tie });
    } catch (err) { return handleError(err, reply); }
  });

  // ── S062 Sublet PO lifecycle ─────────────────────────────────────────────
  app.post('/sublet/po', { preHandler: requireFixedOpsPermission(P.SUBLET_MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = SubletPoSchema.parse(request.body ?? {});
      const row = await sublet.createPo({ ...body, tenantId, actor: actorOf(request) });
      return reply.status(201).send(row);
    } catch (err) { return handleError(err, reply); }
  });

  // Accrues every OPEN sublet PO for a closed RO that has not yet received a
  // vendor invoice (S062). Previously orphaned from RO-close orchestration —
  // exposed here as its own governed trigger so the accrual half of the
  // sublet lifecycle is reachable, matching invoice-match's own trigger.
  app.post('/sublet/accrue-at-close', { preHandler: requireFixedOpsPermission(P.SUBLET_MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = SubletAccrueSchema.parse(request.body ?? {});
      const rows = await sublet.accrueAtClose(tenantId, body.legalEntityId, body.roNumber, body.sourceEventId, body.correlationId, actorOf(request));
      return reply.status(200).send({ items: rows });
    } catch (err) { return handleError(err, reply); }
  });

  app.post('/sublet/po/:poNumber/invoice-match', { preHandler: requireFixedOpsPermission(P.SUBLET_MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { poNumber } = request.params as any;
      const body = SubletInvoiceSchema.parse(request.body ?? {});
      const row = await sublet.matchInvoice({ ...body, tenantId, poNumber, actor: actorOf(request) });
      return reply.status(row.idempotent ? 200 : 201).send(row);
    } catch (err) { return handleError(err, reply); }
  });

  // ── S063 Unapplied time & tech guarantee ────────────────────────────────
  app.post('/tech-time/absorb', { preHandler: requireFixedOpsPermission(P.TECHTIME_POST) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = TechTimeSchema.parse(request.body ?? {});
      const row = await techTime.absorb({ ...body, tenantId, actor: actorOf(request) });
      return reply.status(row.idempotent ? 200 : 201).send(row);
    } catch (err) { return handleError(err, reply); }
  });

  app.get('/tech-time', { preHandler: requireFixedOpsPermission(P.TECHTIME_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { legalEntityId, techId } = request.query as any;
      return reply.send({ items: await techTime.listAbsorptions(tenantId, legalEntityId, techId) });
    } catch (err) { return handleError(err, reply); }
  });

  app.get('/tech-time/reversals', { preHandler: requireFixedOpsPermission(P.TECHTIME_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { techId } = request.query as any;
      return reply.send({ items: await techTime.listReversals(tenantId, techId) });
    } catch (err) { return handleError(err, reply); }
  });

  app.post('/tech-time/reverse', { preHandler: requireFixedOpsPermission(P.TECHTIME_REVERSE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = TechTimeReverseSchema.parse(request.body ?? {});
      const row = await techTime.reverse({ ...body, tenantId, actor: actorOf(request) });
      return reply.status(row.idempotent ? 200 : 201).send(row);
    } catch (err) { return handleError(err, reply); }
  });

  // ── S063 gap-closure: labor-rate config (technician/department burdened
  // labor-cost rate, effective-dated, governed ceremony) ──────────────────
  app.post('/labor-rate', { preHandler: requireFixedOpsPermission(P.LABOR_RATE_MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = LaborRateSetSchema.parse(request.body ?? {});
      const row = await laborRate.setRate({ ...body, tenantId, actor: actorOf(request) });
      return reply.status(201).send(row);
    } catch (err) { return handleError(err, reply); }
  });

  app.get('/labor-rate', { preHandler: requireFixedOpsPermission(P.LABOR_RATE_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { legalEntityId } = request.query as any;
      return reply.send({ items: await laborRate.listForEntity(tenantId, legalEntityId) });
    } catch (err) { return handleError(err, reply); }
  });

  // ── S063 gap-closure: technician guarantee config (previously had no
  // write path — reuses the same Controller-tier governance permission as
  // labor-rate config since both feed the same absorption computation) ────
  app.post('/tech-guarantee-config', { preHandler: requireFixedOpsPermission(P.LABOR_RATE_MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = TechGuaranteeConfigSchema.parse(request.body ?? {});
      const row = await techTime.setGuaranteeConfig({ ...body, tenantId, actor: actorOf(request) });
      return reply.status(201).send(row);
    } catch (err) { return handleError(err, reply); }
  });

  app.get('/tech-guarantee-config', { preHandler: requireFixedOpsPermission(P.LABOR_RATE_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { legalEntityId } = request.query as any;
      return reply.send({ items: await techTime.listGuaranteeConfig(tenantId, legalEntityId) });
    } catch (err) { return handleError(err, reply); }
  });

  // ── S064 Deferred maintenance contracts ─────────────────────────────────
  app.post('/deferred-contracts/sell', { preHandler: requireFixedOpsPermission(P.DEFERRED_MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = ContractSellSchema.parse(request.body ?? {});
      const row = await deferred.sell({ ...body, tenantId, actor: actorOf(request) });
      return reply.status(row.idempotent ? 200 : 201).send(row);
    } catch (err) { return handleError(err, reply); }
  });

  app.post('/deferred-contracts/:contractNumber/redeem', { preHandler: requireFixedOpsPermission(P.DEFERRED_MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { contractNumber } = request.params as any;
      const body = ContractRedeemSchema.parse(request.body ?? {});
      const row = await deferred.redeem({ ...body, tenantId, contractNumber, actor: actorOf(request) });
      return reply.status(row.idempotent ? 200 : 201).send(row);
    } catch (err) { return handleError(err, reply); }
  });

  app.get('/deferred-contracts/:contractNumber', { preHandler: requireFixedOpsPermission(P.DEFERRED_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { contractNumber } = request.params as any;
      const row = await deferred.getByContractNumber(tenantId, contractNumber);
      if (!row) return reply.status(404).send({ error: 'NOT_FOUND' });
      return reply.status(200).send(row);
    } catch (err) { return handleError(err, reply); }
  });

  // ── S065 Warranty claims ─────────────────────────────────────────────────
  app.post('/warranty-claims/:claimNumber/submit', { preHandler: requireFixedOpsPermission(P.WARRANTY_DISPOSITION) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { claimNumber } = request.params as any;
      const { correlationId } = request.body as any ?? {};
      const row = await warranty.submit({ tenantId, claimNumber, actor: actorOf(request), correlationId: correlationId ?? claimNumber });
      return reply.status(200).send(row);
    } catch (err) { return handleError(err, reply); }
  });

  app.post('/warranty-claims/:claimNumber/remit', { preHandler: requireFixedOpsPermission(P.WARRANTY_DISPOSITION) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { claimNumber } = request.params as any;
      const body = ClaimRemitSchema.parse(request.body ?? {});
      const row = await warranty.remit({ ...body, tenantId, claimNumber, actor: actorOf(request) });
      return reply.status(row.idempotent ? 200 : 201).send(row);
    } catch (err) { return handleError(err, reply); }
  });

  app.post('/warranty-claims/:claimNumber/disposition', { preHandler: requireFixedOpsPermission(P.WARRANTY_DISPOSITION) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { claimNumber } = request.params as any;
      const body = ClaimDispositionSchema.parse(request.body ?? {});
      const row = await warranty.disposition({ ...body, tenantId, claimNumber, actor: actorOf(request) });
      return reply.status(row.idempotent ? 200 : 201).send(row);
    } catch (err) { return handleError(err, reply); }
  });

  app.get('/warranty-claims/aging', { preHandler: requireFixedOpsPermission(P.WARRANTY_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { storeId } = request.query as any;
      const result = await warranty.aging(tenantId, storeId);
      return reply.status(200).send(result);
    } catch (err) { return handleError(err, reply); }
  });

  app.get('/warranty-claims', { preHandler: requireFixedOpsPermission(P.WARRANTY_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as any;
      const items = await warranty.list(tenantId, { storeId: q.storeId, status: q.status });
      return reply.status(200).send({ items });
    } catch (err) { return handleError(err, reply); }
  });

  // ── Account mapping inquiry + resolution ceremony ────────────────────────
  app.get('/account-mapping', { preHandler: requireFixedOpsPermission(P.MAPPING_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { legalEntityId } = request.query as any;
      const items = await mapping.listForEntity(tenantId, legalEntityId);
      return reply.status(200).send({ items });
    } catch (err) { return handleError(err, reply); }
  });

  app.post('/account-mapping', { preHandler: requireFixedOpsPermission(P.MAPPING_MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const b = request.body as any;
      const row = await mapping.setAccountNumber(tenantId, b.legalEntityId, b.eventFamily, b.role, b.accountNumber, actorOf(request));
      return reply.status(200).send(row);
    } catch (err) { return handleError(err, reply); }
  });

  // ── S021-aligned exception / recovery queue ─────────────────────────────
  app.get('/exceptions', { preHandler: requireFixedOpsPermission(P.EXCEPTION_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as any;
      const items = await exceptions.list(tenantId, { status: q.status, reasonCode: q.reasonCode });
      return reply.status(200).send({ items });
    } catch (err) { return handleError(err, reply); }
  });

  app.post('/exceptions/:id/resolve', { preHandler: requireFixedOpsPermission(P.EXCEPTION_RESOLVE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as any;
      const row = await exceptions.resolve(tenantId, id, actorOf(request));
      return reply.status(200).send(row);
    } catch (err) { return handleError(err, reply); }
  });

  // ── Audit / lineage trail — mirrors tax-service's GET /audit/:entityType/
  // :entityId pattern, reading this service's own local AuditOutboxEvent
  // rows (written in-transaction with every material action, before the
  // async drain to the central audit-service) so the UI's audit tabs never
  // wait on drain latency. docType/docId are this service's equivalent of
  // entityType/entityId (e.g. docType='RO_CLOSE', docId=roNumber).
  app.get('/audit/:docType/:docId', { preHandler: requireFixedOpsPermission(P.RO_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { docType, docId } = request.params as any;
      const items = await prisma.auditOutboxEvent.findMany({
        where: { tenantId, docType, docId },
        orderBy: { createdAt: 'asc' },
      });
      return reply.status(200).send({ items });
    } catch (err) { return handleError(err, reply); }
  });

  // Global filterable audit view (mandatory UI screen #12, "under Fixed Ops
  // Posting Inquiry") — same table, broader filters, no docId pin.
  app.get('/audit', { preHandler: requireFixedOpsPermission(P.RO_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as any;
      const items = await prisma.auditOutboxEvent.findMany({
        where: {
          tenantId,
          ...(q.docType ? { docType: q.docType } : {}),
          ...(q.docId ? { docId: q.docId } : {}),
          ...(q.action ? { action: q.action } : {}),
          ...(q.correlationId ? { correlationId: q.correlationId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return reply.status(200).send({ items });
    } catch (err) { return handleError(err, reply); }
  });
}
