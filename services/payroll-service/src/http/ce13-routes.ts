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
import { NonTestTenantRefusedError } from '../domain/errors';

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

function handleErr(reply: any, err: unknown) {
  const message = err instanceof Error ? err.message : 'Internal error';
  if (err instanceof RulePackAuthorEqualsActivatorError) return reply.status(403).send({ error: 'RULE_PACK_SOD_VIOLATION', message });
  if (err instanceof RulePackActivationError) return reply.status(422).send({ error: 'RULE_PACK_ACTIVATION_NOT_ELIGIBLE', message });
  if (err instanceof NonTestTenantRefusedError) return reply.status(403).send({ error: 'NON_TEST_TENANT_REFUSED', message });
  const statusCode = (err as any)?.statusCode ?? (message.includes('not found') ? 404 : 500);
  return reply.status(statusCode).send({ error: message });
}

export async function ce13Routes(app: FastifyInstance, prisma: any) {
  const rulePackSvc = container.resolve<PayrollRulePackService>(PayrollRulePackService as any);

  // ── Tenant statutory-source configuration (S108) ──────────────────────────
  app.get('/config/source-mode', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const config = await (prisma as any).payrollTenantConfig.findUnique({ where: { tenantId } });
      return reply.send({ payrollSourceMode: config?.payrollSourceMode ?? 'NOT_CONFIGURED', updatedBy: config?.updatedBy ?? null, updatedAt: config?.updatedAt ?? null });
    } catch (err) { return handleErr(reply, err); }
  });

  app.put('/config/source-mode', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = z.object({ payrollSourceMode: z.enum(['NOT_CONFIGURED', 'MANUAL_ATTESTED', 'TEST_FIXTURE']) }).parse(request.body);
      const config = await (prisma as any).payrollTenantConfig.upsert({
        where: { tenantId },
        update: { payrollSourceMode: body.payrollSourceMode, updatedBy: getUserId(request), updatedAt: new Date() },
        create: { tenantId, payrollSourceMode: body.payrollSourceMode, updatedBy: getUserId(request), updatedAt: new Date() },
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
      const body = z.object({ packKey: z.string().min(1), rows: z.array(RulePackRowSchema) }).parse(request.body);
      const version = await rulePackSvc.createDraft(tenantId, body.packKey, body.rows, getUserId(request));
      return reply.status(201).send(version);
    } catch (err) { return handleErr(reply, err); }
  });

  app.get('/rule-packs', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { packKey } = request.query as { packKey?: string };
      return reply.send(await rulePackSvc.listVersions(tenantId, packKey));
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
      return reply.send(await rulePackSvc.validate(tenantId, id));
    } catch (err) { return handleErr(reply, err); }
  });

  app.post('/rule-packs/:id/activate', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      return reply.send(await rulePackSvc.activate(tenantId, id, getUserId(request)));
    } catch (err) { return handleErr(reply, err); }
  });

  // ── S110 clawback / chargeback ────────────────────────────────────────────
  const CreateClawbackSchema = z.object({
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
}
