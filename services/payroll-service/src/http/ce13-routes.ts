// CE-13 — New HTTP surfaces added by the Payroll epic that don't belong to
// the existing employees/batches/GL-mapping/tax-rate route groups in
// routes.ts: tenant statutory-source configuration (S108), S025 rule-pack
// governance, clawback/chargeback (S110), accruals (S111), and the tech
// flag-hour bridge (S112).
//
// Mirrors the exact plugin-function shape commission-routes.ts already
// established (`export async function xRoutes(app, prisma)`, called
// directly from payrollRoutes() with the same resolved PrismaClient/tenant
// header helpers) rather than introducing a second routing convention.
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { asTenantId, TenantId } from '@amacc/shared-kernel';
import { container } from 'tsyringe';
import { PayrollRulePackService, RulePackActivationError, RulePackAuthorEqualsActivatorError } from '../application/rule-pack-service';
import { NonTestTenantRefusedError, Ce07RulePackRegistrationError, MissingBearerTokenError } from '../domain/errors';
import { PaymentHandoffService, PaymentHandoffNotFoundError, PaymentHandoffStateError, SettlementVerificationFailedError } from '../application/payment-handoff-service';
import { PayrollAuditService } from '../application/audit-service';

function getTenantId(request: any): TenantId {
  const tenantId = request.headers['x-tenant-id'] as string | undefined;
  if (!tenantId || tenantId.trim() === '') {
    const err: any = new Error('Missing required header: x-tenant-id');
    err.statusCode = 400;
    throw err;
  }
  return asTenantId(tenantId);
}

function getUserId(request: any): string {
  return (request as any).user?.sub ?? (request.headers['x-user-id'] as string) ?? 'system';
}

/** The real, forwarded bearer token of the authenticated caller — never this service's own service token — so CE-07's shadow rule-pack registration records/enforces the SAME real identity payroll's own SoD ceremony already established. Null for a call with no Authorization header (e.g. a bare service-to-service call), which the registrar then honestly refuses rather than silently skipping CE-07 registration. */
function getBearerToken(request: any): string | null {
  return (request.headers['authorization'] as string | undefined) ?? null;
}

function handleErr(reply: any, err: unknown) {
  const message = err instanceof Error ? err.message : 'Internal error';
  if (err instanceof RulePackAuthorEqualsActivatorError) return reply.status(403).send({ error: 'RULE_PACK_SOD_VIOLATION', message });
  if (err instanceof RulePackActivationError) return reply.status(422).send({ error: 'RULE_PACK_ACTIVATION_NOT_ELIGIBLE', message });
  if (err instanceof NonTestTenantRefusedError) return reply.status(403).send({ error: 'NON_TEST_TENANT_REFUSED', message });
  if (err instanceof PaymentHandoffNotFoundError) return reply.status(404).send({ error: err.code, message });
  if (err instanceof PaymentHandoffStateError) return reply.status(422).send({ error: err.code, message });
  if (err instanceof SettlementVerificationFailedError) return reply.status(422).send({ error: err.code, message });
  if (err instanceof Ce07RulePackRegistrationError) return reply.status(err.status).send({ error: err.code, message: err.message });
  if (err instanceof MissingBearerTokenError) return reply.status(err.status).send({ error: err.code, message: err.message });
  const statusCode = (err as any)?.statusCode ?? (message.includes('not found') ? 404 : 500);
  return reply.status(statusCode).send({ error: message });
}

export async function ce13Routes(app: FastifyInstance, prisma: any) {
  const rulePackSvc = container.resolve<PayrollRulePackService>(PayrollRulePackService as any);
  const paymentHandoffSvc = container.resolve<PaymentHandoffService>('PaymentHandoffService');
  const auditSvc = container.resolve<PayrollAuditService>('PayrollAuditService');

  // ── Tenant statutory-source configuration (S108) ──────────────────────────
  // fix(integration): entity-scoped, with fallback to the legacy tenant-wide
  // (legalEntityId null) row — mirrors PayrollService.findTenantConfig's
  // same convention. findFirst/manual upsert, not the native compound-key
  // helpers, since legalEntityId is nullable (see gl-mapping-repository.ts).
  app.get('/config/source-mode', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { legalEntityId } = request.query as { legalEntityId?: string };
      const config = legalEntityId
        ? (await (prisma as any).payrollTenantConfig.findFirst({ where: { tenantId, legalEntityId } })) ??
          (await (prisma as any).payrollTenantConfig.findFirst({ where: { tenantId, legalEntityId: null } }))
        : await (prisma as any).payrollTenantConfig.findFirst({ where: { tenantId, legalEntityId: null } });
      return reply.send({ payrollSourceMode: config?.payrollSourceMode ?? 'NOT_CONFIGURED', paymentHandoffMode: config?.paymentHandoffMode ?? 'NOT_CONFIGURED', updatedBy: config?.updatedBy ?? null, updatedAt: config?.updatedAt ?? null });
    } catch (err) { return handleErr(reply, err); }
  });

  app.put('/config/source-mode', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = z.object({
        legalEntityId: z.string().min(1).nullable().optional(),
        payrollSourceMode: z.enum(['NOT_CONFIGURED', 'MANUAL_ATTESTED', 'TEST_FIXTURE']),
      }).parse(request.body);
      const legalEntityId = body.legalEntityId ?? null;
      const existing = await (prisma as any).payrollTenantConfig.findFirst({ where: { tenantId, legalEntityId } });
      const previousMode = existing?.payrollSourceMode ?? 'NOT_CONFIGURED';
      const actor = getUserId(request);
      const config = existing
        ? await (prisma as any).payrollTenantConfig.update({
            where: { id: existing.id },
            data: { payrollSourceMode: body.payrollSourceMode, updatedBy: actor },
          })
        : await (prisma as any).payrollTenantConfig.create({
            data: { tenantId, legalEntityId, payrollSourceMode: body.payrollSourceMode, updatedBy: actor },
          });
      // fix(integration) — audit successful configuration changes: the
      // statutory-source boundary mode is the single highest-consequence
      // payroll config setting (governs whether withholding may ever be
      // silently estimated). Reuses the same outbox convention
      // PayrollAuditService already surfaces PAYROLL_BATCH_* events from —
      // never a second, parallel audit mechanism.
      await (prisma as any).outboxEvent.create({
        data: { eventType: 'PAYROLL_SOURCE_MODE_CHANGED', tenantId, payload: { legalEntityId, previousMode, newMode: body.payrollSourceMode, actor } as any },
      });
      return reply.send(config);
    } catch (err) { return handleErr(reply, err); }
  });

  // ── S025 rule-pack governance ──────────────────────────────────────────────
  const RulePackRowSchema = z.object({
    family: z.string().min(1),
    department: z.string().min(1),
    payComponent: z.string().min(1),
    glAccountCode: z.string().nullable(),
    isDebit: z.boolean(),
  });

  app.post('/rule-packs', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = z.object({ legalEntityId: z.string().min(1), packKey: z.string().min(1), rows: z.array(RulePackRowSchema) }).parse(request.body);
      const version = await rulePackSvc.createDraft(tenantId, body.legalEntityId, body.packKey, body.rows, getUserId(request), getBearerToken(request));
      return reply.status(201).send(version);
    } catch (err) { return handleErr(reply, err); }
  });

  app.get('/rule-packs', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { packKey, legalEntityId } = request.query as { packKey?: string; legalEntityId?: string };
      return reply.send(await rulePackSvc.listVersions(tenantId, packKey, legalEntityId));
    } catch (err) { return handleErr(reply, err); }
  });

  app.get('/rule-packs/:id/simulate', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      return reply.send(await rulePackSvc.simulate(tenantId, id));
    } catch (err) { return handleErr(reply, err); }
  });

  app.post('/rule-packs/:id/validate', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      return reply.send(await rulePackSvc.validate(tenantId, id, getBearerToken(request)));
    } catch (err) { return handleErr(reply, err); }
  });

  app.post('/rule-packs/:id/activate', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      return reply.send(await rulePackSvc.activate(tenantId, id, getUserId(request), getBearerToken(request)));
    } catch (err) { return handleErr(reply, err); }
  });

  // ── S110 clawback / chargeback ────────────────────────────────────────────
  const CreateClawbackSchema = z.object({
    legalEntityId: z.string().min(1),
    employeeId: z.string().min(1),
    dealId: z.string().min(1),
    originalCommissionRecordId: z.string().optional(),
    method: z.enum(['FUTURE_OFFSET', 'DIRECT_DEDUCTION', 'RECEIVABLE']),
    clawbackAmount: z.number().positive(),
    /** PUTR marker: real trigger is CE-12's deal-reversal event, not yet integrated on this branch. */
    sourceEventId: z.string().optional(),
    sourceEventType: z.string().optional(),
  });

  app.post('/clawbacks', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = CreateClawbackSchema.parse(request.body);
      const record = await (prisma as any).clawbackRecord.create({
        data: {
          tenantId,
          legalEntityId: body.legalEntityId,
          employeeId: body.employeeId,
          dealId: body.dealId,
          originalCommissionRecordId: body.originalCommissionRecordId ?? null,
          method: body.method,
          clawbackAmount: body.clawbackAmount,
          remainingPayable: body.clawbackAmount,
          receivableAmount: body.method === 'RECEIVABLE' ? body.clawbackAmount : 0,
          status: 'PENDING',
          sourceEventId: body.sourceEventId ?? null,
          sourceEventType: body.sourceEventType ?? 'MANUAL_ENTRY_PENDING_UPSTREAM_TECHNICAL_RECONCILIATION',
          createdBy: getUserId(request),
        },
      });
      return reply.status(201).send(record);
    } catch (err: any) {
      if (err?.code === 'P2002') return reply.status(409).send({ error: 'DUPLICATE_CLAWBACK', message: 'A clawback for this deal/employee/method already exists' });
      return handleErr(reply, err);
    }
  });

  app.get('/clawbacks', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { employeeId, status } = request.query as { employeeId?: string; status?: string };
      return reply.send(
        await (prisma as any).clawbackRecord.findMany({
          where: { tenantId, ...(employeeId && { employeeId }), ...(status && { status }) },
          orderBy: { createdAt: 'desc' },
        }),
      );
    } catch (err) { return handleErr(reply, err); }
  });

  app.post('/clawbacks/:id/resolve', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const record = await (prisma as any).clawbackRecord.updateMany({
        where: { id, tenantId },
        data: { status: 'RESOLVED', resolvedAt: new Date() },
      });
      if (record.count === 0) { const e: any = new Error(`Clawback ${id} not found`); e.statusCode = 404; throw e; }
      return reply.send({ id, status: 'RESOLVED' });
    } catch (err) { return handleErr(reply, err); }
  });

  // ── S111 accruals ──────────────────────────────────────────────────────────
  const CreateAccrualSchema = z.object({
    legalEntityId: z.string().min(1),
    periodYear: z.number().int(),
    periodMonth: z.number().int().min(1).max(12),
    accrualType: z.string().min(1),
    basisDescription: z.string().optional(),
    amount: z.number(),
    department: z.string().optional(),
  });

  app.post('/accruals', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = CreateAccrualSchema.parse(request.body);
      const entry = await (prisma as any).accrualEntry.create({
        data: { tenantId, ...body, status: 'PREVIEW', previewedBy: getUserId(request), createdBy: getUserId(request) },
      });
      return reply.status(201).send(entry);
    } catch (err: any) {
      if (err?.code === 'P2002') return reply.status(409).send({ error: 'DUPLICATE_ACCRUAL', message: 'An accrual already exists for this period/type/department' });
      return handleErr(reply, err);
    }
  });

  app.get('/accruals', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { periodYear, periodMonth, status } = request.query as { periodYear?: string; periodMonth?: string; status?: string };
      return reply.send(
        await (prisma as any).accrualEntry.findMany({
          where: {
            tenantId,
            ...(periodYear && { periodYear: Number(periodYear) }),
            ...(periodMonth && { periodMonth: Number(periodMonth) }),
            ...(status && { status }),
          },
          orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
        }),
      );
    } catch (err) { return handleErr(reply, err); }
  });

  app.post('/accruals/:id/approve', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const entry = await (prisma as any).accrualEntry.findFirst({ where: { id, tenantId } });
      if (!entry) { const e: any = new Error(`Accrual ${id} not found`); e.statusCode = 404; throw e; }
      if (entry.previewedBy === getUserId(request)) {
        const e: any = new Error('The preparer cannot also approve this accrual (self-approval denial).');
        e.statusCode = 403;
        throw e;
      }
      const updated = await (prisma as any).accrualEntry.update({
        where: { id },
        data: { status: 'APPROVED', approvedBy: getUserId(request), approvedAt: new Date() },
      });
      return reply.send(updated);
    } catch (err) { return handleErr(reply, err); }
  });

  // ── S112 tech flag-hour bridge ─────────────────────────────────────────────
  const CreateTechBridgeSchema = z.object({
    legalEntityId: z.string().min(1),
    employeeId: z.string().min(1),
    periodStart: z.string().transform((s) => new Date(s)),
    periodEnd: z.string().transform((s) => new Date(s)),
    flagHours: z.number().min(0),
    flagRate: z.number().min(0).optional(),
    guaranteeShortfall: z.number().min(0).optional(),
    /** PUTR marker: real trigger is CE-11's flag-hour event (S063), not yet integrated on this branch. */
    sourceEventId: z.string().optional(),
    sourceEventType: z.string().optional(),
  });

  app.post('/tech-bridge', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = CreateTechBridgeSchema.parse(request.body);
      const hasRate = body.flagRate != null;
      const earnings = hasRate ? Number(body.flagHours) * Number(body.flagRate) : 0;
      const entry = await (prisma as any).techFlagBridgeEntry.create({
        data: {
          tenantId,
          legalEntityId: body.legalEntityId,
          employeeId: body.employeeId,
          periodStart: body.periodStart,
          periodEnd: body.periodEnd,
          flagHours: body.flagHours,
          flagRate: body.flagRate ?? null,
          guaranteeShortfall: body.guaranteeShortfall ?? 0,
          earningsAmount: earnings,
          guaranteeTopUp: body.guaranteeShortfall ?? 0,
          reconciliationStatus: 'PENDING',
          // Deterministic refusal: without a configured flag rate, this is a
          // named RATE_GAP exception — never a silently-estimated amount.
          status: hasRate ? 'RATE_RESOLVED' : 'RATE_GAP',
          sourceEventId: body.sourceEventId ?? null,
          sourceEventType: body.sourceEventType ?? 'MANUAL_ENTRY_PENDING_UPSTREAM_TECHNICAL_RECONCILIATION',
          createdBy: getUserId(request),
        },
      });
      return reply.status(201).send(entry);
    } catch (err) { return handleErr(reply, err); }
  });

  app.get('/tech-bridge', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { employeeId, status } = request.query as { employeeId?: string; status?: string };
      return reply.send(
        await (prisma as any).techFlagBridgeEntry.findMany({
          where: { tenantId, ...(employeeId && { employeeId }), ...(status && { status }) },
          orderBy: { createdAt: 'desc' },
        }),
      );
    } catch (err) { return handleErr(reply, err); }
  });

  // ── fix(integration) Gap 2 — CE-09 payroll payment handoff ─────────────────
  app.get('/payment-handoffs', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { legalEntityId, status } = request.query as { legalEntityId?: string; status?: string };
      return reply.send(await paymentHandoffSvc.list(tenantId, { legalEntityId, status }));
    } catch (err) { return handleErr(reply, err); }
  });

  app.get('/payment-handoffs/:id', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      return reply.send(await paymentHandoffSvc.get(tenantId, id));
    } catch (err) { return handleErr(reply, err); }
  });

  app.get('/batches/:batchId/payment-handoff', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { batchId } = request.params as { batchId: string };
      const handoff = await paymentHandoffSvc.getByBatch(tenantId, batchId);
      if (!handoff) return reply.send({ status: 'NOT_CONFIGURED', payrollBatchId: batchId });
      return reply.send(handoff);
    } catch (err) { return handleErr(reply, err); }
  });

  app.post('/payment-handoffs/:id/transmit', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      return reply.send(await paymentHandoffSvc.markTransmissionPending(tenantId, id, getUserId(request)));
    } catch (err) { return handleErr(reply, err); }
  });

  app.post('/payment-handoffs/:id/settle', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const body = z.object({ settlementReference: z.string().min(1) }).parse(request.body);
      return reply.send(await paymentHandoffSvc.recordSettlement(tenantId, id, body.settlementReference, getUserId(request)));
    } catch (err) { return handleErr(reply, err); }
  });

  // ── fix(integration) Gap 4 — payroll.audit.view real enforcement point ─────
  app.get('/audit', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const query = request.query as Record<string, string | undefined>;
      const results = await auditSvc.query(tenantId, {
        legalEntityId: query.legalEntityId,
        batchId: query.batchId,
        employeeId: query.employeeId,
        action: query.action,
        actor: query.actor,
        fromDate: query.fromDate,
        toDate: query.toDate,
        limit: query.limit ? Number(query.limit) : undefined,
      });
      return reply.send({ items: results });
    } catch (err) { return handleErr(reply, err); }
  });
}
