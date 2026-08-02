import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import { ConfigService, ConfigNotFoundError, ConfigValidationError } from '../application/config-service';
import { ReserveService, ReserveValidationError, RemittanceNotFoundError, NoShortPayError, DuplicateDispositionError } from '../application/reserve-service';
import { RemitService, RemitValidationError, RemitRunNotFoundError } from '../application/remit-service';
import { CancellationService, CancellationValidationError, DuplicateCancellationError, CancellationNotFoundError } from '../application/cancellation-service';
import { DeferralService, DeferralValidationError, BookingNotFoundError, BatchNotFoundError, BatchNotPreviewError } from '../application/deferral-service';

// ── Permissions (S207 catalog: auth-service migration
// 20260802050000_extend_authz_catalog_ce12_fni_reserve) ────────────────────
export const FNI_RESERVE_PERMISSIONS = {
  REMITTANCE_PROCESS: 'fni_reserve.remittance.process',
  REMITTANCE_VIEW: 'fni_reserve.remittance.view',
  SHORTPAY_DISPOSITION: 'fni_reserve.shortpay.disposition',
  CHARGEBACK_DRAW: 'fni_reserve.chargeback.draw',
  CHARGEBACK_PREVIEW: 'fni_reserve.chargeback.preview',
  CHARGEBACK_VIEW: 'fni_reserve.chargeback.view',
  REMIT_RUN_EXECUTE: 'fni_reserve.remit_run.execute',
  REMIT_RUN_VIEW: 'fni_reserve.remit_run.view',
  RECONCILIATION_MANAGE: 'fni_reserve.reconciliation.manage',
  RECONCILIATION_VIEW: 'fni_reserve.reconciliation.view',
  CANCELLATION_PROCESS: 'fni_reserve.cancellation.process',
  CANCELLATION_PREVIEW: 'fni_reserve.cancellation.preview',
  CANCELLATION_VIEW: 'fni_reserve.cancellation.view',
  DEFERRAL_CONFIG_MANAGE: 'fni_reserve.deferral_config.manage',
  DEFERRAL_CONFIG_VIEW: 'fni_reserve.deferral_config.view',
  DEFERRAL_BOOKING_REGISTER: 'fni_reserve.deferral_booking.register',
  RECOGNITION_RUN_COMPUTE: 'fni_reserve.recognition_run.compute',
  RECOGNITION_RUN_APPROVE: 'fni_reserve.recognition_run.approve',
  RECOGNITION_RUN_VIEW: 'fni_reserve.recognition_run.view',
  LENDER_CONFIG_MANAGE: 'fni_reserve.lender_config.manage',
  LENDER_CONFIG_VIEW: 'fni_reserve.lender_config.view',
  PROVIDER_CONFIG_MANAGE: 'fni_reserve.provider_config.manage',
  PROVIDER_CONFIG_VIEW: 'fni_reserve.provider_config.view',
  SCHEDULE_MAPPING_MANAGE: 'fni_reserve.schedule_mapping.manage',
} as const;

function requireTenantId(request: any, reply: any): string | null {
  const id = request.headers['x-tenant-id'] as string | undefined;
  if (!id || !id.trim()) {
    reply.status(400).send({ error: 'Missing required header: x-tenant-id' });
    return null;
  }
  return id.trim();
}

function getActor(request: any): string {
  return (request.user?.sub as string | undefined) ?? 'unknown';
}

function handleError(err: unknown, reply: any): void {
  if (
    err instanceof ConfigValidationError ||
    err instanceof ReserveValidationError ||
    err instanceof RemitValidationError ||
    err instanceof CancellationValidationError ||
    err instanceof DeferralValidationError
  ) {
    reply.status(422).send({ error: (err as any).code, message: err.message });
    return;
  }
  if (
    err instanceof ConfigNotFoundError ||
    err instanceof RemittanceNotFoundError ||
    err instanceof RemitRunNotFoundError ||
    err instanceof CancellationNotFoundError ||
    err instanceof BookingNotFoundError ||
    err instanceof BatchNotFoundError
  ) {
    reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
    return;
  }
  if (err instanceof NoShortPayError || err instanceof BatchNotPreviewError) {
    reply.status(422).send({ error: err.name, message: err.message });
    return;
  }
  if (err instanceof DuplicateDispositionError || err instanceof DuplicateCancellationError) {
    reply.status(409).send({ error: err.name, message: err.message });
    return;
  }
  if (err instanceof z.ZodError) {
    reply.status(400).send({ error: 'VALIDATION_ERROR', issues: err.issues });
    return;
  }
  console.error('[fni-reserve-service] Unhandled error:', err);
  reply.status(500).send({ error: 'INTERNAL_SERVER_ERROR' });
}

const DecimalStr = z.string().regex(/^-?\d+(\.\d{1,2})?$/);
const IsoDate = z.string().min(1);

function parsePagination(query: any): { page: number; pageSize: number } {
  const page = Math.max(1, parseInt(query?.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query?.pageSize, 10) || 25));
  return { page, pageSize };
}

export async function fniReserveRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is not set.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const configSvc = container.resolve(ConfigService);
  const reserveSvc = container.resolve(ReserveService);
  const remitSvc = container.resolve(RemitService);
  const cancellationSvc = container.resolve(CancellationService);
  const deferralSvc = container.resolve(DeferralService);
  const authzClient = container.resolve<AuthzClient>('AuthzClient');
  const requirePermission = createAuthzGuard(authzClient, { getTenantId: (req) => req.headers['x-tenant-id'] as string });

  // ── Config: S091 lender program ─────────────────────────────────────────
  const LenderProgramConfigSchema = z.object({
    lenderProgramCode: z.string().min(1),
    lenderProgramName: z.string().min(1),
    chargebackReservePercent: z.string().regex(/^\d+(\.\d{1,2})?$/),
    effectiveFrom: IsoDate,
    effectiveTo: IsoDate.nullable().optional(),
  });

  app.post('/api/v1/fni-reserve/config/lender-programs', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.LENDER_CONFIG_MANAGE) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const body = LenderProgramConfigSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: body.error.issues });
    try {
      reply.status(201).send(await configSvc.createLenderProgramConfig(tenantId, body.data, getActor(req)));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/api/v1/fni-reserve/config/lender-programs', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.LENDER_CONFIG_VIEW) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      reply.send(await configSvc.listLenderProgramConfigs(tenantId));
    } catch (err) {
      handleError(err, reply);
    }
  });

  // ── Config: S093 provider program (pro-rata) ────────────────────────────
  const ProviderProgramConfigSchema = z.object({
    providerCode: z.string().min(1),
    productType: z.string().min(1),
    proRataTable: z.array(z.object({ monthsElapsed: z.number().int().nonnegative(), refundPercent: z.string().regex(/^\d+(\.\d{1,2})?$/) })).min(1),
    termMonths: z.number().int().positive(),
    effectiveFrom: IsoDate,
    effectiveTo: IsoDate.nullable().optional(),
  });

  app.post('/api/v1/fni-reserve/config/provider-programs', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.PROVIDER_CONFIG_MANAGE) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const body = ProviderProgramConfigSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: body.error.issues });
    try {
      reply.status(201).send(await configSvc.createProviderProgramConfig(tenantId, body.data, getActor(req)));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/api/v1/fni-reserve/config/provider-programs', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.PROVIDER_CONFIG_VIEW) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      reply.send(await configSvc.listProviderProgramConfigs(tenantId));
    } catch (err) {
      handleError(err, reply);
    }
  });

  // ── Config: S094 deferral mode ──────────────────────────────────────────
  const DeferralModeConfigSchema = z.object({
    productType: z.string().min(1),
    mode: z.enum(['AGENT', 'OBLIGOR']),
    earningPatternType: z.literal('STRAIGHT_LINE_MONTHS'),
    earningPatternMonths: z.number().int().positive().nullable().optional(),
    effectiveFrom: IsoDate,
    effectiveTo: IsoDate.nullable().optional(),
  });

  app.post('/api/v1/fni-reserve/config/deferral-mode', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.DEFERRAL_CONFIG_MANAGE) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const body = DeferralModeConfigSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: body.error.issues });
    try {
      reply.status(201).send(await configSvc.createDeferralModeConfig(tenantId, body.data, getActor(req)));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/api/v1/fni-reserve/config/deferral-mode', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.DEFERRAL_CONFIG_VIEW) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      reply.send(await configSvc.listDeferralModeConfigs(tenantId));
    } catch (err) {
      handleError(err, reply);
    }
  });

  // ── S094 CROSS-SERVICE CONTRACT — the endpoint deal-accounting-service's
  // rule pack conditions on to decide immediate (AGENT) vs deferred
  // (OBLIGOR) income recognition at deal-finalization time. See this
  // service's final delivery summary for the full documented contract.
  const DeferralModeQuerySchema = z.object({ productType: z.string().min(1), asOfDate: IsoDate });

  app.get('/api/v1/fni-reserve/deferral-mode', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.DEFERRAL_CONFIG_VIEW) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const q = DeferralModeQuerySchema.safeParse(req.query);
    if (!q.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: q.error.issues });
    try {
      const result = await configSvc.resolveDeferralMode(tenantId, q.data.productType, new Date(q.data.asOfDate));
      reply.send(result);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // ── Config: schedule-service mapping ─────────────────────────────────────
  const ScheduleMappingSchema = z.object({
    role: z.enum(['RESERVE_RECEIVABLE', 'PRODUCT_REMIT_LIABILITY', 'CHARGEBACK_RESERVE_LIABILITY', 'DEFERRED_INCOME_LIABILITY']),
    scheduleNumber: z.string().length(2),
    glAccountNumber: z.string().min(1),
  });

  app.post('/api/v1/fni-reserve/config/schedule-mapping', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.SCHEDULE_MAPPING_MANAGE) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const body = ScheduleMappingSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: body.error.issues });
    try {
      reply.status(201).send(await configSvc.setScheduleMapping(tenantId, body.data.role, body.data.scheduleNumber, body.data.glAccountNumber, getActor(req)));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/api/v1/fni-reserve/config/schedule-mapping', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.SCHEDULE_MAPPING_MANAGE) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      reply.send(await configSvc.listScheduleMappings(tenantId));
    } catch (err) {
      handleError(err, reply);
    }
  });

  // ── S091(a)/(b) — remittances ────────────────────────────────────────────
  const ProcessRemittanceSchema = z.object({
    dealNumber: z.string().min(1),
    lenderProgramCode: z.string().min(1),
    expectedAmount: DecimalStr,
    remittedAmount: DecimalStr,
    idempotencyKey: z.string().min(1),
    correlationId: z.string().optional(),
    businessDate: IsoDate.optional(),
  });

  app.post('/api/v1/fni-reserve/remittances', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.REMITTANCE_PROCESS) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const body = ProcessRemittanceSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: body.error.issues });
    try {
      const result = await reserveSvc.processRemittance(tenantId, { ...body.data, actor: getActor(req) });
      reply.status(201).send(result);
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/api/v1/fni-reserve/remittances', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.REMITTANCE_VIEW) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      reply.send(await reserveSvc.listRemittances(tenantId, (req.query as any)?.dealNumber));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/api/v1/fni-reserve/remittances/:id', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.REMITTANCE_VIEW) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      reply.send(await reserveSvc.getRemittance(tenantId, req.params.id));
    } catch (err) {
      handleError(err, reply);
    }
  });

  const DispositionSchema = z.object({
    dispositionType: z.enum(['WRITE_OFF_TO_EXPENSE', 'FLAG_FOR_FOLLOWUP']),
    reason: z.string().min(1).max(500),
    idempotencyKey: z.string().min(1),
  });

  app.post('/api/v1/fni-reserve/remittances/:id/disposition', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.SHORTPAY_DISPOSITION) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const body = DispositionSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: body.error.issues });
    try {
      reply.status(201).send(await reserveSvc.dispositionShortPay(tenantId, req.params.id, { ...body.data, actor: getActor(req) }));
    } catch (err) {
      handleError(err, reply);
    }
  });

  // ── S091(c) — actual chargeback (early payoff notice) ───────────────────
  const ChargebackNoticeSchema = z.object({
    dealNumber: z.string().min(1),
    lenderProgramCode: z.string().min(1),
    chargebackAmount: DecimalStr,
    idempotencyKey: z.string().min(1),
    correlationId: z.string().optional(),
    businessDate: IsoDate.optional(),
  });

  app.post('/api/v1/fni-reserve/chargebacks', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.CHARGEBACK_DRAW) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const body = ChargebackNoticeSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: body.error.issues });
    try {
      reply.status(201).send(await reserveSvc.processChargebackNotice(tenantId, { ...body.data, actor: getActor(req) }));
    } catch (err) {
      handleError(err, reply);
    }
  });

  // Dry-run preview — same request shape as POST /chargebacks, computes the
  // drawn-from-reserve/excess-to-expense split without posting anything
  // (mirrors POST /recognition-runs/preview's compute-then-approve pattern).
  app.post('/api/v1/fni-reserve/chargebacks/preview', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.CHARGEBACK_PREVIEW) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const body = ChargebackNoticeSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: body.error.issues });
    try {
      reply.status(200).send(await reserveSvc.previewChargebackNotice(tenantId, { ...body.data, actor: getActor(req) }));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/api/v1/fni-reserve/chargeback-reserve/tie-out', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.CHARGEBACK_VIEW) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      reply.send(await reserveSvc.tieOutChargebackReserve(tenantId, (req.query as any)?.lenderProgramCode));
    } catch (err) {
      handleError(err, reply);
    }
  });

  // Individual ChargebackReserveAccrual rows (real persisted rows, paginated) —
  // previously only the aggregated tie-out existed.
  app.get('/api/v1/fni-reserve/chargeback-reserve/accruals', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.CHARGEBACK_VIEW) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      const q = req.query as any;
      const { page, pageSize } = parsePagination(q);
      reply.send(await reserveSvc.listAccruals(tenantId, { dealNumber: q?.dealNumber, lenderProgramCode: q?.lenderProgramCode }, page, pageSize));
    } catch (err) {
      handleError(err, reply);
    }
  });

  // Individual ChargebackDraw rows (real persisted rows, paginated) —
  // previously the frontend kept a session-local list of POST responses
  // because no re-fetch endpoint existed.
  app.get('/api/v1/fni-reserve/chargeback-reserve/draws', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.CHARGEBACK_VIEW) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      const q = req.query as any;
      const { page, pageSize } = parsePagination(q);
      reply.send(await reserveSvc.listDraws(tenantId, { dealNumber: q?.dealNumber, lenderProgramCode: q?.lenderProgramCode }, page, pageSize));
    } catch (err) {
      handleError(err, reply);
    }
  });

  // ── S092 — remit liability tracking / remit runs / reconciliation ───────
  const RegisterRemitLiabilitySchema = z.object({
    dealNumber: z.string().min(1),
    productCode: z.string().min(1),
    providerCode: z.string().min(1),
    glAccountNumber: z.string().min(1),
    scheduleNumber: z.string().min(1),
    originalAmount: DecimalStr,
  });

  app.post('/api/v1/fni-reserve/remit-liability/register', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.REMIT_RUN_EXECUTE) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const body = RegisterRemitLiabilitySchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: body.error.issues });
    try {
      reply.status(201).send(await remitSvc.registerRemitLiability(tenantId, { ...body.data, actor: getActor(req) }));
    } catch (err) {
      handleError(err, reply);
    }
  });

  const ExecuteRemitRunSchema = z.object({
    providerCode: z.string().min(1),
    runDate: IsoDate,
    items: z.array(z.object({ dealNumber: z.string().min(1), productCode: z.string().min(1), amount: DecimalStr })).min(1),
    idempotencyKey: z.string().min(1),
    correlationId: z.string().optional(),
  });

  app.post('/api/v1/fni-reserve/remit-runs', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.REMIT_RUN_EXECUTE) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const body = ExecuteRemitRunSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: body.error.issues });
    try {
      reply.status(201).send(await remitSvc.executeRemitRun(tenantId, { ...body.data, actor: getActor(req) }));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/api/v1/fni-reserve/remit-runs', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.REMIT_RUN_VIEW) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      reply.send(await remitSvc.listRemitRuns(tenantId, (req.query as any)?.providerCode));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/api/v1/fni-reserve/remit-runs/:id', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.REMIT_RUN_VIEW) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      reply.send(await remitSvc.getRemitRun(tenantId, req.params.id));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/api/v1/fni-reserve/remit-liability/tie-out', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.REMIT_RUN_VIEW) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      reply.send(await remitSvc.tieOutRemitLiability(tenantId, (req.query as any)?.providerCode));
    } catch (err) {
      handleError(err, reply);
    }
  });

  const UploadStatementSchema = z.object({
    providerCode: z.string().min(1),
    statementDate: IsoDate,
    lines: z.array(z.object({ dealNumber: z.string().min(1), productCode: z.string().min(1), statementAmount: DecimalStr })).min(1),
  });

  app.post('/api/v1/fni-reserve/provider-statements', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.RECONCILIATION_MANAGE) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const body = UploadStatementSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: body.error.issues });
    try {
      reply.status(201).send(await remitSvc.uploadProviderStatement(tenantId, { ...body.data, actor: getActor(req) }));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/api/v1/fni-reserve/provider-statements', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.RECONCILIATION_VIEW) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      reply.send(await remitSvc.listReconciliations(tenantId, (req.query as any)?.providerCode));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/api/v1/fni-reserve/provider-statements/:id', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.RECONCILIATION_VIEW) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      const row = await remitSvc.getReconciliation(tenantId, req.params.id);
      if (!row) return reply.status(404).send({ error: 'NOT_FOUND' });
      reply.send(row);
    } catch (err) {
      handleError(err, reply);
    }
  });

  const ReviewVarianceSchema = z.object({ reviewNote: z.string().min(1).max(500) });

  app.post('/api/v1/fni-reserve/provider-statements/lines/:lineId/review', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.RECONCILIATION_MANAGE) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const body = ReviewVarianceSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: body.error.issues });
    try {
      reply.send(await remitSvc.reviewVarianceLine(tenantId, req.params.lineId, { ...body.data, actor: getActor(req) }));
    } catch (err) {
      handleError(err, reply);
    }
  });

  // ── S093 — product cancellations ─────────────────────────────────────────
  const RefundBasisSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('PROVIDER_QUOTE_PERCENT'), refundPercent: z.number().min(0).max(100) }),
    z.object({ kind: z.literal('PROVIDER_QUOTE_AMOUNT'), quoteTotalAmount: DecimalStr }),
    z.object({ kind: z.literal('CONFIG_PRORATA'), productType: z.string().min(1), providerCode: z.string().min(1), bookingDate: IsoDate }),
  ]);

  const ProcessCancellationSchema = z.object({
    dealNumber: z.string().min(1),
    productCode: z.string().min(1),
    cancellationSource: z.enum(['CUSTOMER', 'LENDER']),
    originalIncomeAmount: DecimalStr,
    originalRemitAmount: DecimalStr,
    refundBasis: RefundBasisSchema,
    chargebackTriggered: z.boolean().optional(),
    lenderProgramCode: z.string().optional(),
    chargebackAmount: DecimalStr.optional(),
    idempotencyKey: z.string().min(1),
    correlationId: z.string().optional(),
    businessDate: IsoDate.optional(),
  });

  app.post('/api/v1/fni-reserve/cancellations', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.CANCELLATION_PROCESS) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const body = ProcessCancellationSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: body.error.issues });
    try {
      reply.status(201).send(await cancellationSvc.processCancellation(tenantId, { ...(body.data as any), actor: getActor(req) }));
    } catch (err) {
      handleError(err, reply);
    }
  });

  // Dry-run preview — same request shape as POST /cancellations, computes
  // the three-leg breakdown (income-reversal/remit-adjustment/refund-payable)
  // without posting anything.
  app.post('/api/v1/fni-reserve/cancellations/preview', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.CANCELLATION_PREVIEW) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const body = ProcessCancellationSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: body.error.issues });
    try {
      reply.status(200).send(await cancellationSvc.previewCancellation(tenantId, { ...(body.data as any), actor: getActor(req) }));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/api/v1/fni-reserve/cancellations', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.CANCELLATION_VIEW) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      reply.send(await cancellationSvc.listCancellations(tenantId, (req.query as any)?.dealNumber));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/api/v1/fni-reserve/cancellations/:id', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.CANCELLATION_VIEW) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      reply.send(await cancellationSvc.getCancellation(tenantId, req.params.id));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/api/v1/fni-reserve/cancellations/lineage/:dealNumber', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.CANCELLATION_VIEW) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      reply.send(await cancellationSvc.getLineage(tenantId, req.params.dealNumber, (req.query as any)?.productCode));
    } catch (err) {
      handleError(err, reply);
    }
  });

  // ── S094 — deferral bookings + recognition runs ──────────────────────────
  const RegisterDeferralBookingSchema = z.object({
    dealNumber: z.string().min(1),
    productCode: z.string().min(1),
    productType: z.string().min(1),
    originalAmount: DecimalStr,
    bookingDate: IsoDate,
    idempotencyKey: z.string().min(1),
  });

  app.post('/api/v1/fni-reserve/deferral-bookings', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.DEFERRAL_BOOKING_REGISTER) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const body = RegisterDeferralBookingSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: body.error.issues });
    try {
      reply.status(201).send(await deferralSvc.registerBooking(tenantId, { ...body.data, actor: getActor(req) }));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/api/v1/fni-reserve/deferral-bookings', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.RECOGNITION_RUN_VIEW) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      reply.send(await deferralSvc.listBookings(tenantId, (req.query as any)?.status));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/api/v1/fni-reserve/deferral-bookings/:id', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.RECOGNITION_RUN_VIEW) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      reply.send(await deferralSvc.getBooking(tenantId, req.params.id));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/api/v1/fni-reserve/deferral-liability/tie-out', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.RECOGNITION_RUN_VIEW) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      reply.send(await deferralSvc.tieOutDeferralLiability(tenantId));
    } catch (err) {
      handleError(err, reply);
    }
  });

  const PreviewRunSchema = z.object({ asOfDate: IsoDate });

  app.post('/api/v1/fni-reserve/recognition-runs/preview', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.RECOGNITION_RUN_COMPUTE) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const body = PreviewRunSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: body.error.issues });
    try {
      reply.status(201).send(await deferralSvc.computeRecognitionRunPreview(tenantId, body.data.asOfDate, getActor(req)));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/api/v1/fni-reserve/recognition-runs', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.RECOGNITION_RUN_VIEW) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      reply.send(await deferralSvc.listBatches(tenantId, (req.query as any)?.status));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/api/v1/fni-reserve/recognition-runs/:id', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.RECOGNITION_RUN_VIEW) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      reply.send(await deferralSvc.getBatch(tenantId, req.params.id));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.post('/api/v1/fni-reserve/recognition-runs/:id/approve', { preHandler: requirePermission(FNI_RESERVE_PERMISSIONS.RECOGNITION_RUN_APPROVE) }, async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      reply.send(await deferralSvc.approveAndPost(tenantId, req.params.id, getActor(req)));
    } catch (err) {
      handleError(err, reply);
    }
  });
}
