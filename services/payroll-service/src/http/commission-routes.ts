import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TenantId, asTenantId } from '@amacc/shared-kernel';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

function getTenantId(request: any): TenantId {
  const tenantId = request.headers['x-tenant-id'] as string | undefined;
  if (!tenantId || tenantId.trim() === '') {
    const err: any = new Error('Missing required header: x-tenant-id');
    err.statusCode = 400;
    throw err;
  }
  return asTenantId(tenantId);
}

const CreateCommissionPlanSchema = z.object({
  employee_id: z.string().min(1),
  plan_type: z.enum(['FLAT', 'PERCENTAGE', 'TIERED']),
  department: z.string().min(1),
  flat_amount: z.number().optional(),
  percentage_rate: z.number().optional(),
  tiers: z.array(z.object({ threshold: z.number(), rate: z.number() })).optional(),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  is_active: z.boolean().default(true).optional(),
});

const CalculateCommissionSchema = z.object({
  deal_id: z.string().min(1),
  employee_id: z.string().min(1),
  deal_type: z.string().min(1),
  gross_profit: z.number().gt(0),
  deal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const ListCommissionsSchema = z.object({
  employeeId: z.string().min(1),
  period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  status: z.string().optional(),
});

const CommissionReportSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  department: z.string().optional(),
});

function calculateTieredCommission(tiers: any[], grossProfit: number): number {
  if (!tiers || tiers.length === 0) return 0;

  let commission = 0;
  const sortedTiers = [...tiers].sort((a, b) => a.threshold - b.threshold);

  for (let i = 0; i < sortedTiers.length; i++) {
    const currentTier = sortedTiers[i];
    const nextThreshold = sortedTiers[i + 1]?.threshold ?? Infinity;
    const tierStart = currentTier.threshold;
    const tierEnd = Math.min(nextThreshold, grossProfit);

    if (tierStart < grossProfit) {
      const tierAmount = Math.max(0, tierEnd - tierStart);
      commission += tierAmount * currentTier.rate;
    }
  }

  return commission;
}

export async function commissionRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // POST /api/v1/payroll/commission-plans — Create commission plan
  app.post<{ Body: z.infer<typeof CreateCommissionPlanSchema> }>(
    '/commission-plans',
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const body = CreateCommissionPlanSchema.parse(request.body);

      const createData: any = {
        tenantId,
        employeeId: body.employee_id,
        planType: body.plan_type,
        department: body.department,
        effectiveDate: new Date(body.effective_date),
        isActive: body.is_active ?? true,
      };

      if (body.flat_amount !== undefined) {
        createData.flatAmount = new Decimal(body.flat_amount.toString());
      }
      if (body.percentage_rate !== undefined) {
        createData.percentageRate = new Decimal(body.percentage_rate.toString());
      }
      if (body.tiers !== undefined) {
        createData.tiers = body.tiers;
      }

      const plan = await (prisma as any).commissionPlan.create({
        data: createData,
      });

      return reply.status(201).send({
        id: plan.id,
        employee_id: plan.employeeId,
        plan_type: plan.planType,
        department: plan.department,
        flat_amount: plan.flatAmount ? Number(plan.flatAmount) : null,
        percentage_rate: plan.percentageRate ? Number(plan.percentageRate) : null,
        tiers: plan.tiers,
        effective_date: plan.effectiveDate.toISOString().substring(0, 10),
        is_active: plan.isActive,
        created_at: plan.createdAt.toISOString(),
      });
    },
  );

  // POST /api/v1/payroll/commissions/calculate — Calculate and accrue commission
  app.post<{ Body: z.infer<typeof CalculateCommissionSchema> }>(
    '/commissions/calculate',
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const body = CalculateCommissionSchema.parse(request.body);
      const userId = (request as any).user?.sub ?? (request.headers['x-user-id'] as string) ?? 'commission-api';

      // Get active commission plan for employee
      const plan = await (prisma as any).commissionPlan.findFirst({
        where: {
          tenantId,
          employeeId: body.employee_id,
          isActive: true,
          effectiveDate: { lte: new Date(body.deal_date) },
        },
        orderBy: { effectiveDate: 'desc' },
      });

      if (!plan) {
        return reply.status(400).send({
          error: 'NO_COMMISSION_PLAN',
          message: `No active commission plan found for employee ${body.employee_id}`,
        });
      }

      // Calculate commission based on plan type
      let commissionAmount = 0;

      if (plan.planType === 'FLAT') {
        commissionAmount = Number(plan.flatAmount || 0);
      } else if (plan.planType === 'PERCENTAGE') {
        commissionAmount = body.gross_profit * (Number(plan.percentageRate) / 100);
      } else if (plan.planType === 'TIERED') {
        commissionAmount = calculateTieredCommission(plan.tiers || [], body.gross_profit);
      }

      // Round to 2 decimal places
      commissionAmount = Math.round(commissionAmount * 100) / 100;

      // Parse period from deal_date
      const dealDate = new Date(body.deal_date);
      const periodYear = dealDate.getFullYear();
      const periodMonth = dealDate.getMonth() + 1;

      // Create commission record
      const record = await (prisma as any).commissionRecord.create({
        data: {
          tenantId,
          employeeId: body.employee_id,
          dealId: body.deal_id,
          dealType: body.deal_type,
          grossProfit: new Decimal(body.gross_profit.toString()),
          commissionAmount: new Decimal(commissionAmount.toString()),
          planId: plan.id,
          status: 'ACCRUED',
          journalEntryId: null, // TODO: Create GL journal entry
          periodYear,
          periodMonth,
          createdBy: userId,
        },
      });

      // TODO: Create GL journal entry via GL service
      // DR Commission Expense, CR Commission Payable

      return reply.status(201).send({
        commission_record_id: record.id,
        employee_id: record.employeeId,
        deal_id: record.dealId,
        commission_amount: Number(record.commissionAmount),
        plan_id: record.planId,
        status: record.status,
        journal_entry_id: record.journalEntryId,
        journal_entry_status: record.journalEntryId ? 'POSTED' : null,
      });
    },
  );

  // GET /api/v1/payroll/commissions — List commissions by employee/period
  app.get<{ Querystring: z.infer<typeof ListCommissionsSchema> }>(
    '/commissions',
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const { employeeId, period, status } = request.query as any;

      const where: any = { tenantId, employeeId };

      if (period) {
        const [year, month] = period.split('-').map(Number);
        where.periodYear = year;
        where.periodMonth = month;
      }

      if (status) where.status = status;

      const records = await (prisma as any).commissionRecord.findMany({
        where,
        include: { plan: true },
        orderBy: { createdAt: 'desc' },
      });

      // Calculate totals
      const monthTotal = records
        .filter((r: any) => !period || (r.periodYear === parseInt(period.split('-')[0]) && r.periodMonth === parseInt(period.split('-')[1])))
        .reduce((sum: number, r: any) => sum + r.commissionAmount.toNumber(), 0);

      const ytdTotal = records.reduce((sum: number, r: any) => sum + r.commissionAmount.toNumber(), 0);

      return reply.send({
        employee_id: employeeId,
        period: period || 'ALL',
        commissions: records.map((r: any) => ({
          id: r.id,
          deal_id: r.dealId,
          deal_type: r.dealType,
          gross_profit: Number(r.grossProfit),
          commission_amount: Number(r.commissionAmount),
          status: r.status,
          plan_rate: r.plan?.percentageRate ? Number(r.plan.percentageRate) : null,
          created_at: r.createdAt.toISOString(),
        })),
        month_total: monthTotal,
        ytd_total: ytdTotal,
      });
    },
  );

  // GET /api/v1/payroll/commissions/report — Commission summary report
  app.get<{ Querystring: z.infer<typeof CommissionReportSchema> }>(
    '/commissions/report',
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const { period, department } = request.query as any;

      if (!period || !period.match(/^\d{4}-\d{2}$/)) {
        return reply.status(400).send({
          error: 'INVALID_PERIOD',
          message: 'period must be in YYYY-MM format',
        });
      }

      const [year, month] = period.split('-').map(Number);

      const records = await (prisma as any).commissionRecord.findMany({
        where: {
          tenantId,
          periodYear: year,
          periodMonth: month,
        },
        include: { plan: true },
      });

      // Aggregate by employee
      const byEmployee: Record<string, any> = {};
      for (const r of records) {
        const key = r.employeeId;
        if (!byEmployee[key]) {
          byEmployee[key] = {
            employee_id: r.employeeId,
            employee_name: `Employee ${r.employeeId}`,
            department: r.plan?.department,
            deal_count: 0,
            gross_profit: 0,
            commission_accrued: 0,
            commission_paid: 0,
            plan_rate: r.plan?.percentageRate ? Number(r.plan.percentageRate) + '%' : 'FLAT',
          };
        }

        byEmployee[key].deal_count += 1;
        byEmployee[key].gross_profit += r.grossProfit.toNumber();
        if (r.status === 'ACCRUED' || r.status === 'ADJUSTED') {
          byEmployee[key].commission_accrued += r.commissionAmount.toNumber();
        } else if (r.status === 'PAID') {
          byEmployee[key].commission_paid += r.commissionAmount.toNumber();
        }
      }

      const byDept: Record<string, any> = {};
      for (const emp of Object.values(byEmployee) as any[]) {
        if (!department || emp.department === department) {
          if (!byDept[emp.department]) {
            byDept[emp.department] = { total_commission: 0, deal_count: 0 };
          }
          byDept[emp.department].total_commission += emp.commission_accrued + emp.commission_paid;
          byDept[emp.department].deal_count += emp.deal_count;
        }
      }

      const grandTotal = Object.values(byDept).reduce((sum: number, d: any) => sum + d.total_commission, 0);

      return reply.send({
        period,
        report_date: new Date().toISOString(),
        by_employee: Object.values(byEmployee).filter(
          (e: any) => !department || e.department === department,
        ),
        by_department: byDept,
        grand_total: grandTotal,
      });
    },
  );
}
