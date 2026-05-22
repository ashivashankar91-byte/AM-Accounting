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

const RegisterUnitSchema = z.object({
  vin: z.string().length(17),
  lender_id: z.string().min(1),
  advance_amount: z.number().gt(0),
  interest_rate: z.number().gt(0).lt(1),
  floor_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gl_liability_account_id: z.string().uuid(),
  gl_interest_account_id: z.string().uuid(),
  curtailment_schedule: z.record(z.any()).optional(),
  // S5-06: Vehicle base
  vehicle_condition: z.enum(['NEW', 'USED', 'DEMO', 'CPO']).optional(),
  vehicle_type: z.string().max(20).optional(),
  acquisition_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  total_cost: z.number().optional(),
  // S5-07: Cost components
  invoice_cost: z.number().optional(),
  pack_amount: z.number().optional(),
  holdback_amount: z.number().optional(),
  factory_rebate: z.number().optional(),
  freight_amount: z.number().optional(),
  prep_charges: z.number().optional(),
  recon_costs: z.number().optional(),
  accrued_floor_plan_interest: z.number().optional(),
  // S5-08: Vehicle identity
  vehicle_year: z.number().int().optional(),
  vehicle_make: z.string().max(30).optional(),
  vehicle_model: z.string().max(30).optional(),
  vehicle_trim: z.string().max(30).optional(),
  vehicle_status: z.enum(['IN_STOCK', 'SOLD', 'IN_TRANSIT', 'HOLD']).optional(),
});

const ListUnitsSchema = z.object({
  status: z.string().optional(),
  lender_id: z.string().optional(),
});

const AccrueInterestSchema = z.object({
  as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const PayoffUnitSchema = z.object({
  sale_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sale_amount: z.number().gt(0),
  deal_id: z.string().optional(),
});

const AgingReportSchema = z.object({
  as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lender_id: z.string().optional(),
});

export async function floorPlanRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // POST /api/v1/gl/floor-plan/units — Register floored unit
  app.post<{ Body: z.infer<typeof RegisterUnitSchema> }>(
    '/floor-plan/units',
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const body = RegisterUnitSchema.parse(request.body);

      // Validate GL accounts exist
      const liabilityAccount = await prisma.gLAccount.findFirst({
        where: { id: body.gl_liability_account_id, tenantId },
      });
      if (!liabilityAccount) {
        return reply.status(400).send({
          error: 'GL_ACCOUNT_NOT_FOUND',
          message: `Liability GL account ${body.gl_liability_account_id} not found`,
        });
      }

      const interestAccount = await prisma.gLAccount.findFirst({
        where: { id: body.gl_interest_account_id, tenantId },
      });
      if (!interestAccount) {
        return reply.status(400).send({
          error: 'GL_ACCOUNT_NOT_FOUND',
          message: `Interest GL account ${body.gl_interest_account_id} not found`,
        });
      }

      try {
        const unit = await (prisma as any).floorPlanUnit.create({
          data: {
            tenantId,
            vin: body.vin,
            lenderId: body.lender_id,
            advanceAmount: new Decimal(body.advance_amount.toString()),
            currentBalance: new Decimal(body.advance_amount.toString()),
            interestRate: new Decimal(body.interest_rate.toString()),
            floorDate: new Date(body.floor_date),
            glLiabilityAccountId: body.gl_liability_account_id,
            glInterestAccountId: body.gl_interest_account_id,
            curtailmentSchedule: body.curtailment_schedule || null,
            status: 'ACTIVE',
            accruedInterest: new Decimal('0.00'),
          },
        });

        return reply.status(201).send({
          id: unit.id,
          vin: unit.vin,
          lender_id: unit.lenderId,
          advance_amount: Number(unit.advanceAmount),
          current_balance: Number(unit.currentBalance),
          interest_rate: Number(unit.interestRate),
          floor_date: unit.floorDate.toISOString().substring(0, 10),
          status: unit.status,
          accrued_interest: 0,
          created_at: unit.createdAt.toISOString(),
        });
      } catch (e: any) {
        if (e.code === 'P2002') {
          return reply.status(409).send({
            error: 'DUPLICATE_VIN',
            message: `VIN ${body.vin} is already floored for this tenant`,
          });
        }
        throw e;
      }
    },
  );

  // GET /api/v1/gl/floor-plan/units — List floored units
  app.get<{ Querystring: z.infer<typeof ListUnitsSchema> }>(
    '/floor-plan/units',
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const { status, lender_id } = request.query as any;

      const where: any = { tenantId };
      if (status) where.status = status;
      if (lender_id) where.lenderId = lender_id;

      const units = await (prisma as any).floorPlanUnit.findMany({
        where,
        orderBy: { floorDate: 'asc' },
      });

      const totalBalance = units.reduce((sum: number, u: any) => sum + u.currentBalance.toNumber(), 0);

      return reply.send({
        units: units.map((u: any) => ({
          id: u.id,
          vin: u.vin,
          lender_id: u.lenderId,
          advance_amount: Number(u.advanceAmount),
          current_balance: Number(u.currentBalance),
          accrued_interest: Number(u.accruedInterest),
          days_on_floor: Math.floor((Date.now() - u.floorDate.getTime()) / (1000 * 60 * 60 * 24)),
          status: u.status,
        })),
        total_balance: totalBalance,
      });
    },
  );

  // POST /api/v1/gl/floor-plan/accrue-interest — Daily interest accrual
  app.post<{ Body: z.infer<typeof AccrueInterestSchema> }>(
    '/floor-plan/accrue-interest',
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const body = AccrueInterestSchema.parse(request.body);
      const asOfDate = new Date(body.as_of_date);

      const units = await (prisma as any).floorPlanUnit.findMany({
        where: { tenantId, status: 'ACTIVE' },
      });

      const journalEntries: any[] = [];
      let totalDailyInterest = 0;

      for (const unit of units) {
        // Calculate daily interest = balance * (rate / 365)
        const dailyInterest = new Decimal(unit.currentBalance.toString())
          .times(unit.interestRate)
          .dividedBy(365)
          .toDP(2);

        totalDailyInterest += dailyInterest.toNumber();

        // Update accrued interest
        const newAccrued = unit.accruedInterest.plus(dailyInterest);
        await (prisma as any).floorPlanUnit.update({
          where: { id: unit.id },
          data: { accruedInterest: newAccrued },
        });

        journalEntries.push({
          entry_id: `je-fp-interest-${unit.id}`,
          lender: unit.lenderId,
          debit_account: unit.glInterestAccountId,
          credit_account: unit.glLiabilityAccountId,
          amount: dailyInterest.toNumber(),
        });
      }

      return reply.status(200).send({
        status: 'SUCCESS',
        units_processed: units.length,
        total_daily_interest: totalDailyInterest,
        journal_entries_created: journalEntries,
        job_executed_at: new Date().toISOString(),
      });
    },
  );

  // POST /api/v1/gl/floor-plan/payoff/:unitId — Payoff floored unit
  app.post<{ Params: { unitId: string }; Body: z.infer<typeof PayoffUnitSchema> }>(
    '/floor-plan/payoff/:unitId',
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const { unitId } = request.params;
      const body = PayoffUnitSchema.parse(request.body);

      const unit = await (prisma as any).floorPlanUnit.findFirst({
        where: { id: unitId, tenantId },
      });

      if (!unit) {
        return reply.status(404).send({
          error: 'UNIT_NOT_FOUND',
          message: `Floor plan unit ${unitId} not found`,
        });
      }

      // Calculate final payoff amount (advance + accrued interest)
      const payoffAmount = unit.currentBalance.plus(unit.accruedInterest);

      // Update unit status
      const updated = await (prisma as any).floorPlanUnit.update({
        where: { id: unitId },
        data: {
          status: 'PAID_OFF',
          payoffDate: new Date(body.sale_date),
          currentBalance: new Decimal('0.00'),
          accruedInterest: new Decimal('0.00'),
        },
      });

      // TODO: Create GL payoff entry: DR Floor Plan Payable, CR Bank/Cash
      const glEntry = {
        entry_id: `je-fp-payoff-${unitId}`,
        debit_account: unit.glLiabilityAccountId,
        credit_account: 'bank-account-tbd',
        amount: payoffAmount.toNumber(),
      };

      return reply.status(200).send({
        unit_id: unitId,
        status: updated.status,
        payoff_amount: payoffAmount.toNumber(),
        journal_entry_id: glEntry.entry_id,
        payoff_check_scheduled: true,
        payoff_check_id: `check-${unitId}`,
      });
    },
  );

  // GET /api/v1/gl/floor-plan/aging-report — Floor plan aging report
  app.get<{ Querystring: z.infer<typeof AgingReportSchema> }>(
    '/floor-plan/aging-report',
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const { as_of_date, lender_id } = request.query as any;

      const asOfDate = as_of_date ? new Date(as_of_date) : new Date();

      const where: any = { tenantId, status: 'ACTIVE' };
      if (lender_id) where.lenderId = lender_id;

      const units = await (prisma as any).floorPlanUnit.findMany({
        where,
        orderBy: { lenderId: 'asc', floorDate: 'asc' },
      });

      // Group by lender
      const byLender: Record<string, any> = {};
      for (const unit of units) {
        if (!byLender[unit.lenderId]) {
          byLender[unit.lenderId] = {
            lender_id: unit.lenderId,
            lender_name: unit.lenderId.replace('lender-', '').toUpperCase(),
            units: [],
            subtotal_advance: 0,
            subtotal_interest: 0,
          };
        }

        const daysOnFloor = Math.floor((asOfDate.getTime() - unit.floorDate.getTime()) / (1000 * 60 * 60 * 24));

        byLender[unit.lenderId].units.push({
          vin: unit.vin,
          vehicle_make_model: `Vehicle ${unit.vin.substring(0, 8)}`,
          advance_amount: Number(unit.advanceAmount),
          accrued_interest: Number(unit.accruedInterest),
          days_on_floor: daysOnFloor,
          status: unit.status,
        });

        byLender[unit.lenderId].subtotal_advance += unit.advanceAmount.toNumber();
        byLender[unit.lenderId].subtotal_interest += unit.accruedInterest.toNumber();
      }

      const lenderArray = Object.values(byLender);
      const grandTotalAdvance = lenderArray.reduce((sum: number, l: any) => sum + l.subtotal_advance, 0);
      const grandTotalInterest = lenderArray.reduce((sum: number, l: any) => sum + l.subtotal_interest, 0);

      return reply.send({
        as_of_date: asOfDate.toISOString().substring(0, 10),
        by_lender: lenderArray,
        grand_total_advance: grandTotalAdvance,
        grand_total_interest: grandTotalInterest,
      });
    },
  );
}
