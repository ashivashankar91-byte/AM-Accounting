// CE-13 gap #1 (S109) — complete commission, draw and dispute lifecycle
// HTTP surface, backed by CommissionService (services layer, not ad-hoc
// inline Prisma logic). Mirrors ce13-routes.ts's plugin-function
// conventions (getTenantId/getUserId/handleErr, direct resolution of the
// tenant's PrismaClient) rather than a second convention.
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { TenantId, asTenantId } from '@amacc/shared-kernel';
import { PrismaClient } from '@prisma/client';
import {
  CommissionService,
  CommissionPlanNotFoundError,
  CommissionRecordNotFoundError,
  CommissionDisputeNotFoundError,
  CommissionDisputeAlreadyResolvedError,
  InvalidSplitRulesError,
} from '../application/commission-service';
import { SegregationOfDutiesError } from '../domain/errors';

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
  return (request as any).user?.sub ?? (request.headers['x-user-id'] as string) ?? 'commission-api';
}

function handleErr(reply: any, err: unknown) {
  const message = err instanceof Error ? err.message : 'Internal error';
  if (err instanceof CommissionPlanNotFoundError) return reply.status(404).send({ error: 'COMMISSION_PLAN_NOT_FOUND', message });
  if (err instanceof CommissionRecordNotFoundError) return reply.status(404).send({ error: 'COMMISSION_RECORD_NOT_FOUND', message });
  if (err instanceof CommissionDisputeNotFoundError) return reply.status(404).send({ error: 'COMMISSION_DISPUTE_NOT_FOUND', message });
  if (err instanceof CommissionDisputeAlreadyResolvedError) return reply.status(422).send({ error: 'COMMISSION_DISPUTE_ALREADY_RESOLVED', message });
  if (err instanceof InvalidSplitRulesError) return reply.status(422).send({ error: 'INVALID_SPLIT_RULES', message });
  if (err instanceof SegregationOfDutiesError) return reply.status(403).send({ error: 'SEGREGATION_OF_DUTIES_VIOLATION', message });
  const statusCode = (err as any)?.statusCode ?? (message.includes('not found') ? 404 : 500);
  return reply.status(statusCode).send({ error: message });
}

const SplitRuleSchema = z.object({ employeeId: z.string().min(1), sharePct: z.number().gt(0).lte(100) });

const CreateCommissionPlanSchema = z.object({
  employee_id: z.string().min(1),
  plan_type: z.enum(['FLAT', 'PERCENTAGE', 'TIERED']),
  department: z.string().min(1).optional(),
  flat_amount: z.number().optional(),
  percentage_rate: z.number().optional(),
  tiers: z.array(z.object({ threshold: z.number(), rate: z.number() })).optional(),
  split_rules: z.array(SplitRuleSchema).optional(),
  draw_amount: z.number().optional(),
  minimum_guarantee: z.number().optional(),
  chargeback_terms: z.object({ method: z.enum(['FULL', 'PRO_RATA']), floor: z.number().optional() }).optional(),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  is_active: z.boolean().default(true).optional(),
});

const CalculateCommissionSchema = z.object({
  deal_id: z.string().min(1),
  employee_id: z.string().min(1),
  deal_type: z.string().min(1),
  gross_profit: z.number().gt(0),
  deal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  deal_snapshot_ref: z.string().optional(),
});

export async function commissionRoutes(app: FastifyInstance, prisma: PrismaClient) {
  const svc = container.resolve<CommissionService>(CommissionService as any);

  // ── Plans ──────────────────────────────────────────────────────────────
  app.post<{ Body: z.infer<typeof CreateCommissionPlanSchema> }>('/commission-plans', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = CreateCommissionPlanSchema.parse(request.body);
      const plan = await svc.createPlan(tenantId, {
        employeeId: body.employee_id,
        planType: body.plan_type,
        department: body.department ?? null,
        flatAmount: body.flat_amount ?? null,
        percentageRate: body.percentage_rate ?? null,
        tiers: body.tiers ?? null,
        splitRules: body.split_rules ?? null,
        drawAmount: body.draw_amount ?? null,
        minimumGuarantee: body.minimum_guarantee ?? null,
        chargebackTerms: body.chargeback_terms ?? null,
        effectiveDate: body.effective_date,
        isActive: body.is_active ?? true,
      }, getUserId(request));
      return reply.status(201).send(serializePlan(plan));
    } catch (err) { return handleErr(reply, err); }
  });

  app.post('/commission-plans/:id/supersede', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const body = CreateCommissionPlanSchema.parse(request.body);
      const plan = await svc.supersedePlan(tenantId, id, {
        employeeId: body.employee_id,
        planType: body.plan_type,
        department: body.department ?? null,
        flatAmount: body.flat_amount ?? null,
        percentageRate: body.percentage_rate ?? null,
        tiers: body.tiers ?? null,
        splitRules: body.split_rules ?? null,
        drawAmount: body.draw_amount ?? null,
        minimumGuarantee: body.minimum_guarantee ?? null,
        chargebackTerms: body.chargeback_terms ?? null,
        effectiveDate: body.effective_date,
        isActive: true,
      }, getUserId(request));
      return reply.status(201).send(serializePlan(plan));
    } catch (err) { return handleErr(reply, err); }
  });

  app.get('/commission-plans', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { employeeId } = request.query as { employeeId?: string };
      const plans = await (prisma as any).commissionPlan.findMany({
        where: { tenantId, ...(employeeId && { employeeId }) },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send(plans.map(serializePlan));
    } catch (err) { return handleErr(reply, err); }
  });

  // ── Draw issuance ───────────────────────────────────────────────────────
  app.post('/commission-plans/:id/draws', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const body = z.object({ employeeId: z.string().min(1), amount: z.number().gt(0) }).parse(request.body);
      const record = await svc.issueDraw(tenantId, body.employeeId, id, body.amount, getUserId(request));
      return reply.status(201).send(record);
    } catch (err) { return handleErr(reply, err); }
  });

  // ── Calculate + splits + minimum guarantee ──────────────────────────────
  app.post<{ Body: z.infer<typeof CalculateCommissionSchema> }>('/commissions/calculate', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = CalculateCommissionSchema.parse(request.body);
      const result = await svc.calculateCommission(tenantId, {
        dealId: body.deal_id,
        employeeId: body.employee_id,
        dealType: body.deal_type,
        grossProfit: body.gross_profit,
        dealDate: body.deal_date,
        dealSnapshotRef: body.deal_snapshot_ref ?? null,
      }, getUserId(request));
      return reply.status(201).send({
        gross_commission: result.grossCommission,
        records: result.records.map(serializeRecord),
      });
    } catch (err) { return handleErr(reply, err); }
  });

  // ── Register / YTD ──────────────────────────────────────────────────────
  app.get('/commissions', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { employeeId, period, status } = request.query as { employeeId: string; period?: string; status?: string };
      const records = await svc.listByEmployee(tenantId, employeeId, period, status);
      const monthTotal = records
        .filter((r: any) => !period || (r.periodYear === Number(period.split('-')[0]) && r.periodMonth === Number(period.split('-')[1])))
        .reduce((sum: number, r: any) => sum + r.commissionAmount.toNumber(), 0);
      const year = period ? Number(period.split('-')[0]) : new Date().getFullYear();
      const ytdTotal = await svc.ytdTotal(tenantId, employeeId, year);
      return reply.send({
        employee_id: employeeId,
        period: period || 'ALL',
        commissions: records.map(serializeRecord),
        month_total: monthTotal,
        ytd_total: ytdTotal,
      });
    } catch (err) { return handleErr(reply, err); }
  });

  // ── Correction / reversal / paid status ─────────────────────────────────
  app.post('/commissions/:id/correct', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const body = z.object({ adjustedAmount: z.number(), reason: z.string().min(1) }).parse(request.body);
      const record = await svc.correctRecord(tenantId, id, body.adjustedAmount, body.reason, getUserId(request));
      return reply.send(serializeRecord(record));
    } catch (err) { return handleErr(reply, err); }
  });

  app.post('/commissions/:id/reverse', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const body = z.object({ reason: z.string().min(1) }).parse(request.body);
      const reversal = await svc.reverseRecord(tenantId, id, body.reason, getUserId(request));
      return reply.status(201).send(serializeRecord(reversal));
    } catch (err) { return handleErr(reply, err); }
  });

  app.post('/commissions/:id/mark-paid', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const record = await svc.markPaid(tenantId, id, getUserId(request));
      return reply.send(serializeRecord(record));
    } catch (err) { return handleErr(reply, err); }
  });

  // ── Chargeback linkage ───────────────────────────────────────────────────
  app.post('/commissions/:id/chargeback', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const body = z.object({ clawbackRecordId: z.string().min(1), amount: z.number().gt(0) }).parse(request.body);
      const record = await svc.applyChargeback(tenantId, id, body.clawbackRecordId, body.amount, getUserId(request));
      return reply.send(serializeRecord(record));
    } catch (err) { return handleErr(reply, err); }
  });

  // ── Disputes ──────────────────────────────────────────────────────────────
  app.post('/commissions/:id/disputes', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const body = z.object({ reason: z.string().min(1), adjustedAmount: z.number() }).parse(request.body);
      const dispute = await svc.createDispute(tenantId, id, body.reason, body.adjustedAmount, getUserId(request));
      return reply.status(201).send(dispute);
    } catch (err) { return handleErr(reply, err); }
  });

  app.get('/commission-disputes', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { commissionRecordId, status } = request.query as { commissionRecordId?: string; status?: string };
      return reply.send(await svc.listDisputes(tenantId, { commissionRecordId, status }));
    } catch (err) { return handleErr(reply, err); }
  });

  app.post('/commission-disputes/:id/resolve', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const body = z.object({ resolution: z.enum(['APPROVE_ADJUSTMENT', 'DENY']) }).parse(request.body);
      const dispute = await svc.resolveDispute(tenantId, id, body.resolution, getUserId(request));
      return reply.send(dispute);
    } catch (err) { return handleErr(reply, err); }
  });

  // ── Report ────────────────────────────────────────────────────────────────
  app.get('/commissions/report', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { period, department } = request.query as { period: string; department?: string };
      if (!period || !period.match(/^\d{4}-\d{2}$/)) {
        return reply.status(400).send({ error: 'INVALID_PERIOD', message: 'period must be in YYYY-MM format' });
      }
      const [year, month] = period.split('-').map(Number);
      const records = await (prisma as any).commissionRecord.findMany({
        where: { tenantId, periodYear: year, periodMonth: month },
        include: { plan: true },
      });
      const byEmployee: Record<string, any> = {};
      for (const r of records) {
        const key = r.splitEmployeeId ?? r.employeeId;
        if (!byEmployee[key]) {
          byEmployee[key] = {
            employee_id: key, department: r.plan?.department, deal_count: 0,
            gross_profit: 0, commission_accrued: 0, commission_paid: 0,
          };
        }
        byEmployee[key].deal_count += 1;
        byEmployee[key].gross_profit += r.grossProfit.toNumber();
        if (r.status === 'ACCRUED' || r.status === 'ADJUSTED') byEmployee[key].commission_accrued += r.commissionAmount.toNumber();
        else if (r.status === 'PAID') byEmployee[key].commission_paid += r.commissionAmount.toNumber();
      }
      const byDept: Record<string, any> = {};
      for (const emp of Object.values(byEmployee) as any[]) {
        if (!department || emp.department === department) {
          if (!byDept[emp.department]) byDept[emp.department] = { total_commission: 0, deal_count: 0 };
          byDept[emp.department].total_commission += emp.commission_accrued + emp.commission_paid;
          byDept[emp.department].deal_count += emp.deal_count;
        }
      }
      const grandTotal = Object.values(byDept).reduce((sum: number, d: any) => sum + d.total_commission, 0);
      return reply.send({
        period, report_date: new Date().toISOString(),
        by_employee: Object.values(byEmployee).filter((e: any) => !department || e.department === department),
        by_department: byDept, grand_total: grandTotal,
      });
    } catch (err) { return handleErr(reply, err); }
  });
}

function serializePlan(plan: any) {
  return {
    id: plan.id,
    employee_id: plan.employeeId,
    plan_type: plan.planType,
    department: plan.department,
    flat_amount: plan.flatAmount != null ? Number(plan.flatAmount) : null,
    percentage_rate: plan.percentageRate != null ? Number(plan.percentageRate) : null,
    tiers: plan.tiers ?? null,
    split_rules: plan.splitRules ?? null,
    draw_amount: plan.drawAmount != null ? Number(plan.drawAmount) : null,
    minimum_guarantee: plan.minimumGuarantee != null ? Number(plan.minimumGuarantee) : null,
    chargeback_terms: plan.chargebackTerms ?? null,
    version: plan.version,
    superseded_by: plan.supersededBy ?? null,
    effective_date: plan.effectiveDate.toISOString().substring(0, 10),
    is_active: plan.isActive,
    created_at: plan.createdAt.toISOString(),
  };
}

function serializeRecord(r: any) {
  return {
    id: r.id,
    employee_id: r.employeeId,
    split_employee_id: r.splitEmployeeId ?? null,
    deal_id: r.dealId,
    deal_type: r.dealType,
    gross_profit: Number(r.grossProfit),
    commission_amount: Number(r.commissionAmount),
    plan_id: r.planId,
    status: r.status,
    applied_to_draw: r.appliedToDraw,
    clawed_back_amount: Number(r.clawedBackAmount ?? 0),
    deal_snapshot_ref: r.dealSnapshotRef ?? null,
    journal_entry_id: r.journalEntryId,
    period_year: r.periodYear,
    period_month: r.periodMonth,
    created_at: r.createdAt.toISOString(),
  };
}
