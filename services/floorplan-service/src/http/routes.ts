import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import { LenderService } from '../application/lender-service';
import { FeedService } from '../application/feed-service';
import { MatchService } from '../application/match-service';
import { BreakService } from '../application/break-service';
import { TieOutService } from '../application/tie-out-service';
import { SotService } from '../application/sot-service';
import { InterestService } from '../application/interest-service';
import { CurtailmentService } from '../application/curtailment-service';
import { TenantConfigService } from '../application/tenant-config-service';
import {
  FloorplanValidationError,
  FloorplanNotFoundError,
  FeedNotConfiguredError,
  StagedRowImmutableError,
  AlreadyMatchedError,
  RowNotEligibleForPostingError,
  BreakAlreadyDispositionedError,
  ReversalReasonRequiredError,
} from '../domain/errors';

// ── Permission catalog — mirrors services/auth-service/prisma/migrations/
// 20260802030000_extend_authz_catalog_ce12_floorplan/migration.sql exactly
// (key-for-key). ────────────────────────────────────────────────────────
export const FLOORPLAN_PERMISSIONS = {
  FEED_VIEW: 'floorplan.feed.view',
  LENDER_MANAGE: 'floorplan.lender.manage',
  FEED_IMPORT: 'floorplan.feed.import',
  MATCH_VIEW: 'floorplan.match.view',
  MATCH_EXECUTE: 'floorplan.match.execute',
  BREAK_VIEW: 'floorplan.break.view',
  BREAK_DISPOSITION: 'floorplan.break.disposition',
  LIABILITY_VIEW: 'floorplan.liability.view',
  SOT_VIEW: 'floorplan.sot.view',
  SOT_ESCALATE: 'floorplan.sot.escalate',
  DELIVERY_ENTER: 'floorplan.delivery.enter',
  INTEREST_VIEW: 'floorplan.interest.view',
  INTEREST_ENTER: 'floorplan.interest.enter',
  CURTAILMENT_VIEW: 'floorplan.curtailment.view',
  CURTAILMENT_CONFIG: 'floorplan.curtailment.config',
  CURTAILMENT_PAY: 'floorplan.curtailment.pay',
  CONFIG_VIEW: 'floorplan.config.view',
  CONFIG_MANAGE: 'floorplan.config.manage',
} as const;

function getTenantId(request: any): string {
  const id = (request.headers['x-tenant-id'] as string | undefined)?.trim();
  if (!id) {
    const e: any = new Error('x-tenant-id header is required');
    e.statusCode = 400;
    throw e;
  }
  return id;
}

function getActor(request: any): string {
  return (request.user?.sub as string | undefined) ?? 'system';
}

function requirePermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
}

function handleError(error: unknown, reply: any) {
  if (error instanceof FloorplanNotFoundError) return reply.status(404).send({ error: error.code, message: error.message });
  if (error instanceof FeedNotConfiguredError) return reply.status(200).send({ error: error.code, message: error.message, manualEntryAvailable: true });
  if (
    error instanceof FloorplanValidationError ||
    error instanceof StagedRowImmutableError ||
    error instanceof AlreadyMatchedError ||
    error instanceof RowNotEligibleForPostingError ||
    error instanceof BreakAlreadyDispositionedError ||
    error instanceof ReversalReasonRequiredError
  ) {
    return reply.status(422).send({ error: (error as any).code, message: (error as Error).message });
  }
  if ((error as any)?.statusCode === 400) return reply.status(400).send({ error: 'BAD_REQUEST', message: (error as any).message });
  throw error;
}

export async function floorplanRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const lenderService = container.resolve(LenderService);
  const feedService = container.resolve(FeedService);
  const matchService = container.resolve(MatchService);
  const breakService = container.resolve(BreakService);
  const tieOutService = container.resolve(TieOutService);
  const sotService = container.resolve(SotService);
  const interestService = container.resolve(InterestService);
  const curtailmentService = container.resolve(CurtailmentService);
  const tenantConfigService = container.resolve(TenantConfigService);

  // ── S079 — Lender profiles / feed status / staged rows ─────────────────
  app.get('/lenders', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.FEED_VIEW) }, async (req, reply) => {
    try { return reply.send({ items: await lenderService.listLenders(getTenantId(req)) }); } catch (e) { return handleError(e, reply); }
  });

  app.get('/lenders/:lenderCode/feed-status', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.FEED_VIEW) }, async (req, reply) => {
    try { return reply.send(await lenderService.feedStatus(getTenantId(req), (req.params as any).lenderCode)); } catch (e) { return handleError(e, reply); }
  });

  app.put('/lenders/:lenderCode', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.LENDER_MANAGE) }, async (req, reply) => {
    try {
      const body = req.body as any;
      const row = await lenderService.upsertLenderProfile(getTenantId(req), { lenderCode: (req.params as any).lenderCode, lenderName: body.lenderName, adapterStatus: body.adapterStatus, adapterType: body.adapterType }, getActor(req));
      return reply.status(200).send(row);
    } catch (e) { return handleError(e, reply); }
  });

  app.post('/lenders/:lenderCode/import/feed', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.FEED_IMPORT) }, async (req, reply) => {
    try {
      const body = req.body as any;
      const result = await feedService.importFeedBatch(getTenantId(req), (req.params as any).lenderCode, { rows: body.rows, fixtureLabel: body.fixtureLabel }, getActor(req));
      return reply.status(201).send(result);
    } catch (e) { return handleError(e, reply); }
  });

  app.post('/lenders/:lenderCode/import/manual', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.FEED_IMPORT) }, async (req, reply) => {
    try {
      const body = req.body as any;
      const result = await feedService.importManualBatch(getTenantId(req), (req.params as any).lenderCode, { rows: body.rows, note: body.note }, getActor(req));
      return reply.status(201).send(result);
    } catch (e) { return handleError(e, reply); }
  });

  app.get('/import-batches', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.FEED_VIEW) }, async (req, reply) => {
    try { return reply.send({ items: await feedService.listImportBatches(getTenantId(req), (req.query as any).lenderCode) }); } catch (e) { return handleError(e, reply); }
  });

  app.get('/staged-rows', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.FEED_VIEW) }, async (req, reply) => {
    try { return reply.send({ items: await feedService.listStagedRows(getTenantId(req), req.query as any) }); } catch (e) { return handleError(e, reply); }
  });

  app.get('/staged-rows/:id', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.FEED_VIEW) }, async (req, reply) => {
    try { return reply.send(await feedService.getStagedRow(getTenantId(req), (req.params as any).id)); } catch (e) { return handleError(e, reply); }
  });

  app.post('/staged-rows/:id/supersede', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.FEED_IMPORT) }, async (req, reply) => {
    try {
      const body = req.body as any;
      const result = await feedService.supersedeRow(getTenantId(req), (req.params as any).id, body.replacement, getActor(req), body.note);
      return reply.status(201).send(result);
    } catch (e) { return handleError(e, reply); }
  });

  // ── S080 — VIN match, breaks, liability items, tie-out ─────────────────
  app.post('/staged-rows/:id/match', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.MATCH_EXECUTE) }, async (req, reply) => {
    try {
      const result = await matchService.matchRow(getTenantId(req), (req.params as any).id, getActor(req));
      return reply.status(200).send(result);
    } catch (e) { return handleError(e, reply); }
  });

  app.get('/matches', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.MATCH_VIEW) }, async (req, reply) => {
    try { return reply.send({ items: await matchService.listMatches(getTenantId(req), req.query as any) }); } catch (e) { return handleError(e, reply); }
  });

  app.get('/liability-items', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.LIABILITY_VIEW) }, async (req, reply) => {
    try { return reply.send({ items: await matchService.listLiabilityItems(getTenantId(req), req.query as any) }); } catch (e) { return handleError(e, reply); }
  });

  app.get('/liability-items/:id', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.LIABILITY_VIEW) }, async (req, reply) => {
    try { return reply.send(await matchService.getLiabilityItem(getTenantId(req), (req.params as any).id)); } catch (e) { return handleError(e, reply); }
  });

  app.get('/tie-out', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.LIABILITY_VIEW) }, async (req, reply) => {
    try { return reply.send(await tieOutService.computeTieOut(getTenantId(req), (req.query as any).lenderCode)); } catch (e) { return handleError(e, reply); }
  });

  app.post('/lenders/:lenderCode/breaks/scan', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.MATCH_EXECUTE) }, async (req, reply) => {
    try { return reply.send(await matchService.scanForWeHaveLenderDoesntBreaks(getTenantId(req), (req.params as any).lenderCode, getActor(req))); } catch (e) { return handleError(e, reply); }
  });

  app.get('/breaks', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.BREAK_VIEW) }, async (req, reply) => {
    try { return reply.send({ items: await breakService.listBreaks(getTenantId(req), req.query as any) }); } catch (e) { return handleError(e, reply); }
  });

  app.get('/breaks/:id', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.BREAK_VIEW) }, async (req, reply) => {
    try { return reply.send(await breakService.getBreak(getTenantId(req), (req.params as any).id)); } catch (e) { return handleError(e, reply); }
  });

  app.post('/breaks/:id/disposition', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.BREAK_DISPOSITION) }, async (req, reply) => {
    try {
      const body = req.body as any;
      const result = await breakService.dispositionBreak(getTenantId(req), (req.params as any).id, { action: body.action, reason: body.reason, idempotencyKey: body.idempotencyKey, deptCode: body.deptCode }, getActor(req));
      return reply.status(201).send(result);
    } catch (e) { return handleError(e, reply); }
  });

  // ── S081 — SOT monitor / delivery events ────────────────────────────────
  // Serves both the deal-accounting-service webhook contract (SERVICE-role
  // token, PENDING_UPSTREAM_TECHNICAL_RECONCILIATION — see sot-service.ts's
  // doc comment) and the human MANUAL_FIXTURE entry path (permission-gated).
  // createAuthzGuard bypasses the RBAC lookup entirely for role SERVICE, so
  // no separate route is needed for the two callers.
  app.post('/delivery-events', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.DELIVERY_ENTER) }, async (req, reply) => {
    try {
      const body = req.body as any;
      const result = await sotService.recordDeliveryEvent(getTenantId(req), { vin: body.vin, stockNumber: body.stockNumber, dealNumber: body.dealNumber, deliveredAt: body.deliveredAt, idempotencyKey: body.idempotencyKey, source: body.source ?? 'MANUAL_FIXTURE' }, getActor(req));
      return reply.status(201).send(result);
    } catch (e) { return handleError(e, reply); }
  });

  app.get('/sot/dashboard', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.SOT_VIEW) }, async (req, reply) => {
    try { return reply.send(await sotService.dashboard(getTenantId(req))); } catch (e) { return handleError(e, reply); }
  });

  app.get('/sot/exceptions', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.SOT_VIEW) }, async (req, reply) => {
    try { return reply.send({ items: await sotService.listExceptions(getTenantId(req), req.query as any) }); } catch (e) { return handleError(e, reply); }
  });

  app.get('/sot/aging', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.SOT_VIEW) }, async (req, reply) => {
    try { return reply.send({ items: await sotService.aging(getTenantId(req)) }); } catch (e) { return handleError(e, reply); }
  });

  app.get('/sot/exceptions/:id', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.SOT_VIEW) }, async (req, reply) => {
    try { return reply.send(await sotService.getException(getTenantId(req), (req.params as any).id)); } catch (e) { return handleError(e, reply); }
  });

  app.post('/sot/exceptions/:id/transition', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.SOT_ESCALATE) }, async (req, reply) => {
    try {
      const body = req.body as any;
      return reply.status(200).send(await sotService.manualTransition(getTenantId(req), (req.params as any).id, body.toState, body.reason, getActor(req)));
    } catch (e) { return handleError(e, reply); }
  });

  // ── S082 — Interest statements / accrual / curtailments ─────────────────
  app.post('/interest/statements', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.INTEREST_ENTER) }, async (req, reply) => {
    try {
      const body = req.body as any;
      const result = await interestService.enterStatement(getTenantId(req), { lenderCode: body.lenderCode, statementDate: body.statementDate, totalInterestAmount: body.totalInterestAmount, allocationBasis: body.allocationBasis, idempotencyKey: body.idempotencyKey }, getActor(req));
      return reply.status(201).send(result);
    } catch (e) { return handleError(e, reply); }
  });

  app.get('/interest/statements', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.INTEREST_VIEW) }, async (req, reply) => {
    try { return reply.send({ items: await interestService.listStatements(getTenantId(req), req.query as any) }); } catch (e) { return handleError(e, reply); }
  });

  app.get('/interest/statements/:id', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.INTEREST_VIEW) }, async (req, reply) => {
    try { return reply.send(await interestService.getStatement(getTenantId(req), (req.params as any).id)); } catch (e) { return handleError(e, reply); }
  });

  app.post('/interest/statements/:id/allocate', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.INTEREST_ENTER) }, async (req, reply) => {
    try { return reply.status(200).send({ items: await interestService.allocate(getTenantId(req), (req.params as any).id, getActor(req)) }); } catch (e) { return handleError(e, reply); }
  });

  app.post('/interest/statements/:id/post-accrual', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.INTEREST_ENTER) }, async (req, reply) => {
    try { return reply.status(200).send(await interestService.postAccrual(getTenantId(req), (req.params as any).id, getActor(req))); } catch (e) { return handleError(e, reply); }
  });

  app.post('/interest/statements/:id/reverse', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.INTEREST_ENTER) }, async (req, reply) => {
    try {
      const body = req.body as any;
      return reply.status(200).send(await interestService.reverseAccrual(getTenantId(req), (req.params as any).id, body.reason, getActor(req)));
    } catch (e) { return handleError(e, reply); }
  });

  app.post('/curtailment/schedules', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.CURTAILMENT_CONFIG) }, async (req, reply) => {
    try {
      const body = req.body as any;
      const result = await curtailmentService.configureSchedule(getTenantId(req), { lenderCode: body.lenderCode, intervalDays: body.intervalDays, curtailmentPercent: body.curtailmentPercent, effectiveFrom: body.effectiveFrom, effectiveTo: body.effectiveTo }, getActor(req));
      return reply.status(201).send(result);
    } catch (e) { return handleError(e, reply); }
  });

  app.get('/curtailment/schedules', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.CURTAILMENT_VIEW) }, async (req, reply) => {
    try { return reply.send({ items: await curtailmentService.listSchedules(getTenantId(req), (req.query as any).lenderCode) }); } catch (e) { return handleError(e, reply); }
  });

  app.post('/curtailment/payments', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.CURTAILMENT_PAY) }, async (req, reply) => {
    try {
      const body = req.body as any;
      const result = await curtailmentService.payCurtailment(getTenantId(req), { itemId: body.itemId, amount: body.amount, paidAt: body.paidAt, idempotencyKey: body.idempotencyKey }, getActor(req));
      return reply.status(201).send(result);
    } catch (e) { return handleError(e, reply); }
  });

  app.get('/curtailment/payments', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.CURTAILMENT_VIEW) }, async (req, reply) => {
    try { return reply.send({ items: await curtailmentService.listPayments(getTenantId(req), req.query as any) }); } catch (e) { return handleError(e, reply); }
  });

  // ── SAFE_CONFIGURATION — tenant config ──────────────────────────────────
  app.get('/config', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.CONFIG_VIEW) }, async (req, reply) => {
    try { return reply.send(await tenantConfigService.get(getTenantId(req))); } catch (e) { return handleError(e, reply); }
  });

  app.put('/config', { preHandler: requirePermission(FLOORPLAN_PERMISSIONS.CONFIG_MANAGE) }, async (req, reply) => {
    try {
      const body = req.body as any;
      return reply.status(200).send(await tenantConfigService.update(getTenantId(req), { sotGracePeriodDays: body.sotGracePeriodDays, defaultAllocationBasis: body.defaultAllocationBasis }, getActor(req)));
    } catch (e) { return handleError(e, reply); }
  });
}
