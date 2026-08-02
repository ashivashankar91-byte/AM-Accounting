import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { authMiddleware } from '@amacc/shared-kernel';
import { getTenantId, requireLegalEntityId, requirePartsPermission, handleError, PARTS_PERMISSIONS as P } from './security';
import { ValuationConfigService } from '../application/valuation-config-service';
import { MovementService } from '../application/movement-service';
import { PriceTapeService } from '../application/price-tape-service';
import { ObsolescenceService } from '../application/obsolescence-service';
import { PhysicalInventoryService } from '../application/physical-inventory-service';
import { DepositService } from '../application/deposit-service';
import { OemReturnService } from '../application/oem-return-service';
import { PartsAccountMappingService } from '../application/account-mapping-service';
import { PrismaClient } from '.prisma/parts-accounting-client';

function actorOf(request: any): string {
  return (request.user?.sub as string | undefined) ?? 'system';
}

export async function partsAccountingRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const valuation = container.resolve(ValuationConfigService);
  const movements = container.resolve(MovementService);
  const priceTape = container.resolve(PriceTapeService);
  const obsolescence = container.resolve(ObsolescenceService);
  const physical = container.resolve(PhysicalInventoryService);
  const deposits = container.resolve(DepositService);
  const oemReturns = container.resolve(OemReturnService);
  const mappings = container.resolve(PartsAccountMappingService);
  const prisma = container.resolve<PrismaClient>('PrismaClient');

  // ── S072 Valuation config ──────────────────────────────────────────────
  app.post('/valuation-config', { preHandler: requirePartsPermission(P.VALUATION_MANAGE) }, async (req, reply) => {
    try { return reply.status(201).send(await valuation.create({ tenantId: getTenantId(req), ...(req.body as any) })); }
    catch (e) { return handleError(e, reply); }
  });
  app.get('/valuation-config/active', { preHandler: requirePartsPermission(P.VALUATION_VIEW) }, async (req, reply) => {
    try {
      const q = req.query as any;
      return reply.send(await valuation.getActive(getTenantId(req), q.legalEntityId, q.asOfDate));
    } catch (e) { return handleError(e, reply); }
  });
  app.get('/valuation-config/history', { preHandler: requirePartsPermission(P.VALUATION_VIEW) }, async (req, reply) => {
    try { const q = req.query as any; return reply.send(await valuation.history(getTenantId(req), q.legalEntityId)); }
    catch (e) { return handleError(e, reply); }
  });

  // ── S066 Movements & reconciliation ────────────────────────────────────
  app.post('/movements', { preHandler: requirePartsPermission(P.MOVEMENT_POST) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req);
      const result = await movements.postMovement({ tenantId, actor: actorOf(req), ...(req.body as any) });
      return reply.status(result.idempotent ? 200 : 201).send(result);
    } catch (e) { return handleError(e, reply); }
  });
  app.get('/movements', { preHandler: requirePartsPermission(P.MOVEMENT_VIEW) }, async (req, reply) => {
    try { const q = req.query as any; return reply.send({ items: await movements.listMovements(getTenantId(req), q) }); }
    catch (e) { return handleError(e, reply); }
  });
  app.post('/reconciliation/run', { preHandler: requirePartsPermission(P.RECONCILIATION_RUN) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req);
      const run = await movements.runReconciliation({ tenantId, runBy: actorOf(req), ...(req.body as any) });
      return reply.status(201).send(run);
    } catch (e) { return handleError(e, reply); }
  });
  app.get('/reconciliation/runs', { preHandler: requirePartsPermission(P.RECONCILIATION_VIEW) }, async (req, reply) => {
    try { const q = req.query as any; return reply.send({ items: await movements.listReconciliationRuns(getTenantId(req), q.legalEntityId, q.storeId) }); }
    catch (e) { return handleError(e, reply); }
  });
  app.get('/reconciliation/runs/:id', { preHandler: requirePartsPermission(P.RECONCILIATION_VIEW) }, async (req, reply) => {
    try {
      const legalEntityId = requireLegalEntityId(req.query as any);
      return reply.send(await movements.getReconciliationRun(getTenantId(req), legalEntityId, (req.params as any).id));
    } catch (e) { return handleError(e, reply); }
  });

  // ── S067 Price tape ─────────────────────────────────────────────────────
  app.post('/price-tape/load', { preHandler: requirePartsPermission(P.PRICETAPE_APPROVE) }, async (req, reply) => {
    try {
      const b = req.body as any;
      const result = await priceTape.load(getTenantId(req), requireLegalEntityId(b), b.loadBatchId, b.lines);
      return reply.status(result.idempotent ? 200 : 201).send(result);
    } catch (e) { return handleError(e, reply); }
  });
  app.post('/price-tape/:loadBatchId/preview', { preHandler: requirePartsPermission(P.PRICETAPE_APPROVE) }, async (req, reply) => {
    try {
      const legalEntityId = requireLegalEntityId(req.body as any);
      return reply.send(await priceTape.preview(getTenantId(req), legalEntityId, (req.params as any).loadBatchId));
    } catch (e) { return handleError(e, reply); }
  });
  app.post('/price-tape/:loadBatchId/approve', { preHandler: requirePartsPermission(P.PRICETAPE_APPROVE) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req); const b = req.body as any;
      const result = await priceTape.approve(tenantId, requireLegalEntityId(b), (req.params as any).loadBatchId, actorOf(req), b.correlationId, b.businessDate);
      return reply.send(result);
    } catch (e) { return handleError(e, reply); }
  });
  app.get('/price-tape/:loadBatchId', { preHandler: requirePartsPermission(P.PRICETAPE_VIEW) }, async (req, reply) => {
    try {
      const legalEntityId = requireLegalEntityId(req.query as any);
      return reply.send(await priceTape.get(getTenantId(req), legalEntityId, (req.params as any).loadBatchId));
    } catch (e) { return handleError(e, reply); }
  });
  app.get('/price-tape', { preHandler: requirePartsPermission(P.PRICETAPE_VIEW) }, async (req, reply) => {
    try { const q = req.query as any; return reply.send({ items: await priceTape.list(getTenantId(req), q.legalEntityId) }); }
    catch (e) { return handleError(e, reply); }
  });

  // ── D-CE08-02 Scrap threshold config ────────────────────────────────────
  // Tenant/legal-entity-scoped, effective-dated. When no active row exists,
  // scrap disposal refuses with SCRAP_THRESHOLD_NOT_CONFIGURED.
  app.put('/scrap-threshold-config', { preHandler: requirePartsPermission(P.SCRAP_CONFIG_MANAGE) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req); const b = req.body as any;
      const legalEntityId = requireLegalEntityId(b);
      if (!b.thresholdAmount || Number(b.thresholdAmount) <= 0) {
        return reply.status(400).send({ error: 'VALIDATION_ERROR', message: 'thresholdAmount must be a positive number' });
      }
      if (!b.effectiveFrom) {
        return reply.status(400).send({ error: 'VALIDATION_ERROR', message: 'effectiveFrom (YYYY-MM-DD) is required' });
      }
      const row = await prisma.scrapThresholdConfig.upsert({
        where: { tenantId_legalEntityId_effectiveFrom: { tenantId, legalEntityId, effectiveFrom: new Date(b.effectiveFrom) } },
        create: { tenantId, legalEntityId, thresholdAmount: b.thresholdAmount, effectiveFrom: new Date(b.effectiveFrom), createdBy: actorOf(req) },
        update: { thresholdAmount: b.thresholdAmount },
      });
      return reply.send(row);
    } catch (e) { return handleError(e, reply); }
  });
  app.get('/scrap-threshold-config/active', { preHandler: requirePartsPermission(P.SCRAP_VIEW) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req); const q = req.query as any;
      const legalEntityId = requireLegalEntityId(q);
      const asOf = q.asOfDate ? new Date(q.asOfDate) : new Date();
      const row = await prisma.scrapThresholdConfig.findFirst({
        where: { tenantId, legalEntityId, effectiveFrom: { lte: asOf } },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (!row) return reply.status(404).send({ error: 'NOT_CONFIGURED', message: 'No scrap threshold configured for this legal entity. Set one via PUT /parts/scrap-threshold-config.' });
      return reply.send(row);
    } catch (e) { return handleError(e, reply); }
  });
  app.get('/scrap-threshold-config/history', { preHandler: requirePartsPermission(P.SCRAP_VIEW) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req); const q = req.query as any;
      const legalEntityId = requireLegalEntityId(q);
      return reply.send({ items: await prisma.scrapThresholdConfig.findMany({ where: { tenantId, legalEntityId }, orderBy: { effectiveFrom: 'desc' } }) });
    } catch (e) { return handleError(e, reply); }
  });

  // ── D-CE08-03 Obsolescence aging band config ─────────────────────────────
  app.put('/obsolescence-aging-config', { preHandler: requirePartsPermission(P.OBSOLESCENCE_CONFIG_MANAGE) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req); const b = req.body as any;
      const legalEntityId = requireLegalEntityId(b);
      if (!Array.isArray(b.bandConfig) || b.bandConfig.length === 0) {
        return reply.status(400).send({ error: 'VALIDATION_ERROR', message: 'bandConfig must be a non-empty array of band definitions' });
      }
      if (!b.effectiveFrom) {
        return reply.status(400).send({ error: 'VALIDATION_ERROR', message: 'effectiveFrom (YYYY-MM-DD) is required' });
      }
      const row = await prisma.obsolescenceAgingBandConfig.upsert({
        where: { tenantId_legalEntityId_effectiveFrom: { tenantId, legalEntityId, effectiveFrom: new Date(b.effectiveFrom) } },
        create: { tenantId, legalEntityId, bandConfig: b.bandConfig, effectiveFrom: new Date(b.effectiveFrom), createdBy: actorOf(req) },
        update: { bandConfig: b.bandConfig },
      });
      return reply.send(row);
    } catch (e) { return handleError(e, reply); }
  });
  app.get('/obsolescence-aging-config/active', { preHandler: requirePartsPermission(P.OBSOLESCENCE_VIEW) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req); const q = req.query as any;
      const legalEntityId = requireLegalEntityId(q);
      const asOf = q.asOfDate ? new Date(q.asOfDate) : new Date();
      const row = await prisma.obsolescenceAgingBandConfig.findFirst({
        where: { tenantId, legalEntityId, effectiveFrom: { lte: asOf } },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (!row) return reply.status(404).send({ error: 'NOT_CONFIGURED', message: 'No obsolescence aging-band config set for this legal entity. Set one via PUT /parts/obsolescence-aging-config.' });
      return reply.send(row);
    } catch (e) { return handleError(e, reply); }
  });
  app.get('/obsolescence-aging-config/history', { preHandler: requirePartsPermission(P.OBSOLESCENCE_VIEW) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req); const q = req.query as any;
      const legalEntityId = requireLegalEntityId(q);
      return reply.send({ items: await prisma.obsolescenceAgingBandConfig.findMany({ where: { tenantId, legalEntityId }, orderBy: { effectiveFrom: 'desc' } }) });
    } catch (e) { return handleError(e, reply); }
  });

  // ── S068 Obsolescence & scrap ────────────────────────────────────────────
  app.post('/obsolescence/preview', { preHandler: requirePartsPermission(P.OBSOLESCENCE_APPROVE) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req); const b = req.body as any;
      const legalEntityId = requireLegalEntityId(b);
      // D-CE08-03 integration fix: resolve aging bands from server-side config.
      // When no config is set, refuse with NOT_CONFIGURED — never invent defaults.
      const asOf = b.asOfDate ? new Date(b.asOfDate) : new Date();
      const bandConfigRow = await prisma.obsolescenceAgingBandConfig.findFirst({
        where: { tenantId, legalEntityId, effectiveFrom: { lte: asOf } },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (!bandConfigRow) {
        return reply.status(422).send({
          error: 'AGING_BAND_CONFIG_NOT_CONFIGURED',
          message: 'No obsolescence aging-band configuration is active for this legal entity. Set one via PUT /parts/obsolescence-aging-config before running a provision preview.',
        });
      }
      // bandConfig from DB takes precedence; caller-supplied b.bandConfig is ignored when config is present.
      return reply.status(201).send(await obsolescence.preview(tenantId, legalEntityId, b.asOfDate, bandConfigRow.bandConfig, b.lines));
    } catch (e) { return handleError(e, reply); }
  });
  app.post('/obsolescence/:runId/approve', { preHandler: requirePartsPermission(P.OBSOLESCENCE_APPROVE) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req); const b = req.body as any;
      return reply.send(await obsolescence.approve(tenantId, requireLegalEntityId(b), (req.params as any).runId, actorOf(req), b.correlationId, b.businessDate));
    } catch (e) { return handleError(e, reply); }
  });
  app.get('/obsolescence', { preHandler: requirePartsPermission(P.OBSOLESCENCE_VIEW) }, async (req, reply) => {
    try { const q = req.query as any; return reply.send({ items: await obsolescence.listRuns(getTenantId(req), q.legalEntityId) }); }
    catch (e) { return handleError(e, reply); }
  });
  app.post('/scrap', { preHandler: requirePartsPermission(P.SCRAP_EXECUTE) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req); const b = req.body as any;
      const legalEntityId = requireLegalEntityId(b);
      // D-CE08-02 integration fix: resolve scrap threshold from server-side config.
      // When no config is set, refuse with SCRAP_THRESHOLD_NOT_CONFIGURED.
      const asOf = b.businessDate ? new Date(b.businessDate) : new Date();
      const thresholdRow = await prisma.scrapThresholdConfig.findFirst({
        where: { tenantId, legalEntityId, effectiveFrom: { lte: asOf } },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (!thresholdRow) {
        return reply.status(422).send({
          error: 'SCRAP_THRESHOLD_NOT_CONFIGURED',
          message: 'No scrap-disposal threshold is configured for this legal entity. A Controller must set one via PUT /parts/scrap-threshold-config before scrap disposals can proceed.',
        });
      }
      const result = await obsolescence.scrap({
        tenantId, actor: actorOf(req), hasScrapPermission: true,
        thresholdAmount: Number(thresholdRow.thresholdAmount),
        ...b,
        legalEntityId,  // ensure legalEntityId is always from the resolved path
      });
      return reply.status(201).send(result);
    } catch (e) { return handleError(e, reply); }
  });
  app.get('/scrap', { preHandler: requirePartsPermission(P.SCRAP_VIEW) }, async (req, reply) => {
    try { const q = req.query as any; return reply.send({ items: await obsolescence.listScrap(getTenantId(req), q.legalEntityId) }); }
    catch (e) { return handleError(e, reply); }
  });

  // ── S069 Physical inventory ───────────────────────────────────────────
  app.post('/physical/sessions', { preHandler: requirePartsPermission(P.PHYSICAL_COUNT) }, async (req, reply) => {
    try { return reply.status(201).send(await physical.openSession({ tenantId: getTenantId(req), ...(req.body as any) })); }
    catch (e) { return handleError(e, reply); }
  });
  app.post('/physical/sessions/:id/freeze', { preHandler: requirePartsPermission(P.PHYSICAL_COUNT) }, async (req, reply) => {
    try {
      const b = req.body as any;
      return reply.send(await physical.freeze(getTenantId(req), requireLegalEntityId(b), (req.params as any).id, b.partNumbers));
    } catch (e) { return handleError(e, reply); }
  });
  app.post('/physical/sessions/:id/count-lines', { preHandler: requirePartsPermission(P.PHYSICAL_COUNT) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req); const id = (req.params as any).id; const b = req.body as any;
      const session = await physical.enterCounts(tenantId, requireLegalEntityId(b), id, b.counts);
      const s = await prisma.physicalInventorySession.findUnique({ where: { id } });
      // Blind-count sessions never expose perpetualQtySnapshot back to the counter.
      const sanitized = s?.blindCount
        ? { ...session, lines: session.lines.map((l: any) => ({ ...l, perpetualQtySnapshot: null, perpetualValueSnapshot: null })) }
        : session;
      return reply.send(sanitized);
    } catch (e) { return handleError(e, reply); }
  });
  app.post('/physical/sessions/:id/variance-report', { preHandler: requirePartsPermission(P.PHYSICAL_VIEW) }, async (req, reply) => {
    try {
      const legalEntityId = requireLegalEntityId(req.body as any);
      return reply.send(await physical.varianceReport(getTenantId(req), legalEntityId, (req.params as any).id));
    } catch (e) { return handleError(e, reply); }
  });
  app.post('/physical/sessions/:id/approve', { preHandler: requirePartsPermission(P.PHYSICAL_APPROVE) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req); const b = req.body as any;
      return reply.send(await physical.approve({ tenantId, legalEntityId: requireLegalEntityId(b), sessionId: (req.params as any).id, approvedBy: actorOf(req), correlationId: b.correlationId, businessDate: b.businessDate }));
    } catch (e) { return handleError(e, reply); }
  });
  app.get('/physical/sessions/:id', { preHandler: requirePartsPermission(P.PHYSICAL_VIEW) }, async (req, reply) => {
    try {
      const legalEntityId = requireLegalEntityId(req.query as any);
      return reply.send(await physical.get(getTenantId(req), legalEntityId, (req.params as any).id));
    } catch (e) { return handleError(e, reply); }
  });
  app.get('/physical/sessions', { preHandler: requirePartsPermission(P.PHYSICAL_VIEW) }, async (req, reply) => {
    try { const q = req.query as any; return reply.send({ items: await physical.list(getTenantId(req), q.legalEntityId) }); }
    catch (e) { return handleError(e, reply); }
  });

  // ── S070 Deposits & escheat ──────────────────────────────────────────────
  app.post('/deposits', { preHandler: requirePartsPermission(P.DEPOSIT_MANAGE) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req);
      const b = req.body as any;
      const result = await deposits.createDeposit({ tenantId, legalEntityId: requireLegalEntityId(b), actor: actorOf(req), ...b });
      return reply.status(result.idempotent ? 200 : 201).send(result);
    } catch (e) { return handleError(e, reply); }
  });
  app.post('/deposits/:orderNumber/apply', { preHandler: requirePartsPermission(P.DEPOSIT_MANAGE) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req); const b = req.body as any;
      return reply.send(await deposits.apply({ tenantId, legalEntityId: requireLegalEntityId(b), orderNumber: (req.params as any).orderNumber, actor: actorOf(req), ...b }));
    } catch (e) { return handleError(e, reply); }
  });
  app.post('/deposits/:orderNumber/refund', { preHandler: requirePartsPermission(P.DEPOSIT_MANAGE) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req); const b = req.body as any;
      return reply.send(await deposits.refund({ tenantId, legalEntityId: requireLegalEntityId(b), orderNumber: (req.params as any).orderNumber, actor: actorOf(req), ...b }));
    } catch (e) { return handleError(e, reply); }
  });
  app.get('/deposits/abandoned-queue', { preHandler: requirePartsPermission(P.DEPOSIT_VIEW) }, async (req, reply) => {
    try { const q = req.query as any; return reply.send(await deposits.abandonedQueue(getTenantId(req), q.legalEntityId, q.asOfDate)); }
    catch (e) { return handleError(e, reply); }
  });
  app.post('/deposits/:orderNumber/escheat', { preHandler: requirePartsPermission(P.DEPOSIT_MANAGE) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req); const b = req.body as any;
      return reply.send(await deposits.escheat({ tenantId, legalEntityId: requireLegalEntityId(b), orderNumber: (req.params as any).orderNumber, actor: actorOf(req), ...b }));
    } catch (e) { return handleError(e, reply); }
  });
  app.get('/deposits/:orderNumber', { preHandler: requirePartsPermission(P.DEPOSIT_VIEW) }, async (req, reply) => {
    try {
      const legalEntityId = requireLegalEntityId(req.query as any);
      return reply.send(await deposits.get(getTenantId(req), legalEntityId, (req.params as any).orderNumber));
    } catch (e) { return handleError(e, reply); }
  });
  app.get('/deposits', { preHandler: requirePartsPermission(P.DEPOSIT_VIEW) }, async (req, reply) => {
    try { const q = req.query as any; return reply.send({ items: await deposits.list(getTenantId(req), q.legalEntityId, q.status) }); }
    catch (e) { return handleError(e, reply); }
  });

  // ── S071 OEM returns ─────────────────────────────────────────────────────
  app.post('/oem-return-program-config', { preHandler: requirePartsPermission(P.OEMRETURN_MANAGE) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req); const b = req.body as any;
      return reply.send(await oemReturns.setProgramConfig({ tenantId, legalEntityId: requireLegalEntityId(b), actor: actorOf(req), ...b }));
    } catch (e) { return handleError(e, reply); }
  });
  app.post('/oem-returns', { preHandler: requirePartsPermission(P.OEMRETURN_MANAGE) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req); const b = req.body as any;
      const result = await oemReturns.authorize({ tenantId, legalEntityId: requireLegalEntityId(b), actor: actorOf(req), ...b });
      return reply.status(result.idempotent ? 200 : 201).send(result);
    } catch (e) { return handleError(e, reply); }
  });
  app.post('/oem-returns/:returnAuthNumber/ship', { preHandler: requirePartsPermission(P.OEMRETURN_MANAGE) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req); const b = req.body as any;
      return reply.send(await oemReturns.ship({ tenantId, legalEntityId: requireLegalEntityId(b), returnAuthNumber: (req.params as any).returnAuthNumber, actor: actorOf(req), ...b }));
    } catch (e) { return handleError(e, reply); }
  });
  app.post('/oem-returns/:returnAuthNumber/credit', { preHandler: requirePartsPermission(P.OEMRETURN_MANAGE) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req); const b = req.body as any;
      return reply.send(await oemReturns.applyCredit({ tenantId, legalEntityId: requireLegalEntityId(b), returnAuthNumber: (req.params as any).returnAuthNumber, actor: actorOf(req), ...b }));
    } catch (e) { return handleError(e, reply); }
  });
  app.post('/oem-returns/:returnAuthNumber/disposition', { preHandler: requirePartsPermission(P.OEMRETURN_MANAGE) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req); const b = req.body as any;
      return reply.send(await oemReturns.disposition({ tenantId, legalEntityId: requireLegalEntityId(b), returnAuthNumber: (req.params as any).returnAuthNumber, actor: actorOf(req), ...b }));
    } catch (e) { return handleError(e, reply); }
  });
  app.get('/oem-returns/:returnAuthNumber', { preHandler: requirePartsPermission(P.OEMRETURN_VIEW) }, async (req, reply) => {
    try {
      const legalEntityId = requireLegalEntityId(req.query as any);
      return reply.send(await oemReturns.get(getTenantId(req), legalEntityId, (req.params as any).returnAuthNumber));
    } catch (e) { return handleError(e, reply); }
  });
  app.get('/oem-returns', { preHandler: requirePartsPermission(P.OEMRETURN_VIEW) }, async (req, reply) => {
    try { const q = req.query as any; return reply.send({ items: await oemReturns.list(getTenantId(req), q.legalEntityId) }); }
    catch (e) { return handleError(e, reply); }
  });

  // ── Account mapping (tenant-configurable, ACCOUNT_MAPPING_VALUES_PENDING) ─
  app.get('/account-mapping', { preHandler: requirePartsPermission(P.MAPPING_VIEW) }, async (req, reply) => {
    try { const q = req.query as any; return reply.send({ items: await mappings.listForEntity(getTenantId(req), q.legalEntityId) }); }
    catch (e) { return handleError(e, reply); }
  });
  app.post('/account-mapping', { preHandler: requirePartsPermission(P.MAPPING_MANAGE) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req); const b = req.body as any;
      return reply.send(await mappings.setAccountNumber(tenantId, b.legalEntityId, b.eventFamily, b.role, b.accountNumber, actorOf(req)));
    } catch (e) { return handleError(e, reply); }
  });

  // ── Exception queue (S021-aligned) ───────────────────────────────────────
  app.get('/exceptions', { preHandler: requirePartsPermission(P.EXCEPTION_VIEW) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req); const q = req.query as any;
      const items = await prisma.partsPostingException.findMany({ where: { tenantId, ...(q.status ? { status: q.status } : {}), ...(q.reasonCode ? { reasonCode: q.reasonCode } : {}) }, orderBy: { createdAt: 'desc' } });
      return reply.send({ items });
    } catch (e) { return handleError(e, reply); }
  });
  app.post('/exceptions/:id/resolve', { preHandler: requirePartsPermission(P.EXCEPTION_MANAGE) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req); const id = (req.params as any).id;
      const existing = await prisma.partsPostingException.findFirst({ where: { tenantId, id } });
      if (!existing) return reply.status(404).send({ error: 'NOT_FOUND' });
      const updated = await prisma.partsPostingException.update({ where: { id }, data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: actorOf(req) } });
      return reply.send(updated);
    } catch (e) { return handleError(e, reply); }
  });

  // ── Audit / lineage trail — mirrors tax-service's GET /audit/:entityType/
  // :entityId pattern and fixedops-service's equivalent, reading this
  // service's own local AuditOutboxEvent rows (written in-transaction with
  // every material action, before the async drain to audit-service).
  app.get('/audit/:docType/:docId', { preHandler: requirePartsPermission(P.MOVEMENT_VIEW) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req);
      const { docType, docId } = req.params as any;
      const items = await prisma.auditOutboxEvent.findMany({ where: { tenantId, docType, docId }, orderBy: { createdAt: 'asc' } });
      return reply.send({ items });
    } catch (e) { return handleError(e, reply); }
  });

  // Global filterable audit view (mandatory UI screen #12).
  app.get('/audit', { preHandler: requirePartsPermission(P.MOVEMENT_VIEW) }, async (req, reply) => {
    try {
      const tenantId = getTenantId(req);
      const q = req.query as any;
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
      return reply.send({ items });
    } catch (e) { return handleError(e, reply); }
  });
}
