import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { PrismaClient } from '.prisma/revenue-client';
import { authMiddleware } from '@amacc/shared-kernel';

// ── ASC 606 Five-Step Model ──────────────────────────
// Step 1: Identify the contract with a customer
// Step 2: Identify performance obligations in the contract
// Step 3: Determine the transaction price
// Step 4: Allocate the transaction price to performance obligations
// Step 5: Recognize revenue when (or as) performance obligations are satisfied

const CreateContractSchema = z.object({
  dealNumber: z.string().min(1),
  productType: z.string().min(1),
  customerName: z.string().optional(),
  totalValue: z.number().positive(),
  transactionPrice: z.number().positive().optional(),
  variableConsideration: z.number().min(0).optional(),
  startDate: z.string(),
  endDate: z.string(),
  recognitionMethod: z.enum(['STRAIGHT_LINE', 'OUTPUT', 'INPUT']).default('STRAIGHT_LINE'),
  obligations: z.array(z.object({
    description: z.string(),
    obligationType: z.enum(['OVER_TIME', 'POINT_IN_TIME']).default('OVER_TIME'),
    standaloneSellingPrice: z.number().positive(),
    satisfactionMethod: z.enum(['STRAIGHT_LINE', 'OUTPUT', 'INPUT']).default('STRAIGHT_LINE'),
  })).optional(),
});

const ModifyContractSchema = z.object({
  modificationType: z.enum(['PROSPECTIVE', 'CUMULATIVE_CATCH_UP', 'SEPARATE_CONTRACT']),
  newTotalValue: z.number().positive().optional(),
  newEndDate: z.string().optional(),
  reason: z.string().min(1),
});

export function revenueRoutes(prisma: PrismaClient): FastifyPluginAsync {
  return async (app) => {
    const JWT_SECRET = process.env['AMACC_JWT_SECRET'] ?? 'amacc-dev-secret-change-in-production';
    app.addHook('preHandler', authMiddleware(JWT_SECRET));

    // ── Step 1: Identify contract ─────────────────────
    app.post('/contracts', async (request, reply) => {
      const tenantId = (request.headers['x-tenant-id'] as string) || 'tenant-kunes';
      const body = CreateContractSchema.parse(request.body);
      const transactionPrice = body.transactionPrice ?? body.totalValue;

      const contract = await prisma.revenueContract.create({
        data: {
          tenantId,
          dealNumber: body.dealNumber,
          productType: body.productType,
          customerName: body.customerName,
          totalValue: body.totalValue,
          transactionPrice,
          variableConsideration: body.variableConsideration ?? 0,
          startDate: new Date(body.startDate),
          endDate: new Date(body.endDate),
          recognitionMethod: body.recognitionMethod,
          asc606Step: 'STEP1_IDENTIFIED',
        },
      });

      // Step 2: Auto-create performance obligations if provided
      if (body.obligations && body.obligations.length > 0) {
        const totalSSP = body.obligations.reduce((sum, o) => sum + o.standaloneSellingPrice, 0);
        for (const ob of body.obligations) {
          // Step 4: Allocate transaction price proportionally based on SSP
          const allocatedPrice = totalSSP > 0
            ? Math.round((ob.standaloneSellingPrice / totalSSP) * transactionPrice * 100) / 100
            : transactionPrice / body.obligations.length;

          await prisma.performanceObligation.create({
            data: {
              contractId: contract.id,
              description: ob.description,
              obligationType: ob.obligationType,
              standaloneSellingPrice: ob.standaloneSellingPrice,
              allocatedPrice,
              satisfactionMethod: ob.satisfactionMethod,
            },
          });
        }
        await prisma.revenueContract.update({
          where: { id: contract.id },
          data: { asc606Step: 'STEP4_ALLOCATED' },
        });
      }

      // Generate schedule lines (Step 5 preparation)
      const start = new Date(body.startDate);
      const end = new Date(body.endDate);
      const months = Math.max(1, (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()));
      const monthlyAmount = Math.round((transactionPrice / months) * 100) / 100;

      for (let i = 0; i < months; i++) {
        const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
        const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        await prisma.revenueScheduleLine.create({
          data: { contractId: contract.id, period, scheduledAmount: monthlyAmount },
        });
      }

      await prisma.revenueContract.update({
        where: { id: contract.id },
        data: { asc606Step: body.obligations?.length ? 'STEP5_SCHEDULED' : 'STEP3_PRICED' },
      });

      const full = await prisma.revenueContract.findUnique({
        where: { id: contract.id },
        include: { scheduleLines: true, obligations: true },
      });
      return reply.status(201).send(full);
    });

    // ── List contracts ────────────────────────────────
    app.get('/contracts', async (request) => {
      const tenantId = (request.headers['x-tenant-id'] as string) || 'tenant-kunes';
      return prisma.revenueContract.findMany({
        where: { tenantId },
        include: { scheduleLines: true, obligations: true },
        orderBy: { createdAt: 'desc' },
      });
    });

    // ── Get contract detail ───────────────────────────
    app.get('/contracts/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const contract = await prisma.revenueContract.findUnique({
        where: { id },
        include: { scheduleLines: { orderBy: { period: 'asc' } }, obligations: true },
      });
      if (!contract) return reply.status(404).send({ error: 'Contract not found' });
      return contract;
    });

    // ── Step 2 explicit: Add performance obligations ──
    app.post('/contracts/:id/obligations', async (request, reply) => {
      const { id } = request.params as { id: string };
      const contract = await prisma.revenueContract.findUnique({ where: { id }, include: { obligations: true } });
      if (!contract) return reply.status(404).send({ error: 'Contract not found' });

      const body = z.object({
        obligations: z.array(z.object({
          description: z.string(),
          obligationType: z.enum(['OVER_TIME', 'POINT_IN_TIME']).default('OVER_TIME'),
          standaloneSellingPrice: z.number().positive(),
          satisfactionMethod: z.enum(['STRAIGHT_LINE', 'OUTPUT', 'INPUT']).default('STRAIGHT_LINE'),
        })).min(1),
      }).parse(request.body);

      const allSSP = [
        ...contract.obligations.map(o => o.standaloneSellingPrice),
        ...body.obligations.map(o => o.standaloneSellingPrice),
      ];
      const totalSSP = allSSP.reduce((sum, ssp) => sum + ssp, 0);
      const txPrice = contract.transactionPrice ?? contract.totalValue;

      for (const ob of body.obligations) {
        const allocatedPrice = Math.round((ob.standaloneSellingPrice / totalSSP) * txPrice * 100) / 100;
        await prisma.performanceObligation.create({
          data: {
            contractId: id,
            description: ob.description,
            obligationType: ob.obligationType,
            standaloneSellingPrice: ob.standaloneSellingPrice,
            allocatedPrice,
            satisfactionMethod: ob.satisfactionMethod,
          },
        });
      }

      // Re-allocate existing obligations
      for (const existing of contract.obligations) {
        const allocatedPrice = Math.round((existing.standaloneSellingPrice / totalSSP) * txPrice * 100) / 100;
        await prisma.performanceObligation.update({
          where: { id: existing.id },
          data: { allocatedPrice },
        });
      }

      await prisma.revenueContract.update({ where: { id }, data: { asc606Step: 'STEP4_ALLOCATED' } });
      return prisma.revenueContract.findUnique({ where: { id }, include: { obligations: true, scheduleLines: true } });
    });

    // ── Step 5: Recognise revenue for a period ────────
    app.post('/contracts/:id/recognise', async (request, reply) => {
      const { id } = request.params as { id: string };
      const { period } = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) }).parse(request.body);

      const lines = await prisma.revenueScheduleLine.findMany({
        where: { contractId: id, period, status: 'PENDING' },
      });
      if (lines.length === 0) return reply.status(400).send({ error: `No pending schedule lines for period ${period}` });

      let totalRecognised = 0;
      for (const line of lines) {
        await prisma.revenueScheduleLine.update({
          where: { id: line.id },
          data: { recognisedAmount: line.scheduledAmount, status: 'RECOGNISED' },
        });
        totalRecognised += line.scheduledAmount;
      }

      // Check if all lines are recognised
      const allLines = await prisma.revenueScheduleLine.findMany({ where: { contractId: id } });
      const allRecognised = allLines.every(l => l.status === 'RECOGNISED');
      if (allRecognised) {
        await prisma.performanceObligation.updateMany({
          where: { contractId: id, status: { not: 'SATISFIED' } },
          data: { status: 'SATISFIED', satisfiedAt: new Date() },
        });
        await prisma.revenueContract.update({ where: { id }, data: { status: 'COMPLETED' } });
      }

      return { contractId: id, period, recognisedAmount: totalRecognised, linesRecognised: lines.length, contractCompleted: allRecognised };
    });

    // ── Contract modification (ASC 606-20) ────────────
    app.post('/contracts/:id/modify', async (request, reply) => {
      const { id } = request.params as { id: string };
      const tenantId = (request.headers['x-tenant-id'] as string) || 'tenant-kunes';
      const body = ModifyContractSchema.parse(request.body);

      const contract = await prisma.revenueContract.findUnique({
        where: { id },
        include: { obligations: true, scheduleLines: true },
      });
      if (!contract) return reply.status(404).send({ error: 'Contract not found' });

      if (body.modificationType === 'SEPARATE_CONTRACT') {
        const newContract = await prisma.revenueContract.create({
          data: {
            tenantId,
            dealNumber: `${contract.dealNumber}-MOD`,
            productType: contract.productType,
            customerName: contract.customerName,
            totalValue: body.newTotalValue ?? 0,
            transactionPrice: body.newTotalValue ?? 0,
            startDate: new Date(),
            endDate: body.newEndDate ? new Date(body.newEndDate) : contract.endDate,
            recognitionMethod: contract.recognitionMethod,
            originalContractId: id,
            modificationType: 'SEPARATE_CONTRACT',
            asc606Step: 'STEP1_IDENTIFIED',
          },
        });
        return reply.status(201).send({ modification: 'SEPARATE_CONTRACT', newContractId: newContract.id, originalContractId: id });
      }

      if (body.modificationType === 'PROSPECTIVE') {
        const pendingLines = contract.scheduleLines.filter(l => l.status === 'PENDING');
        const alreadyRecognised = contract.scheduleLines
          .filter(l => l.status === 'RECOGNISED')
          .reduce((sum, l) => sum + l.recognisedAmount, 0);
        const newTotal = body.newTotalValue ?? contract.totalValue;
        const remaining = newTotal - alreadyRecognised;
        const perLine = pendingLines.length > 0 ? Math.round((remaining / pendingLines.length) * 100) / 100 : 0;

        for (const line of pendingLines) {
          await prisma.revenueScheduleLine.update({ where: { id: line.id }, data: { scheduledAmount: perLine } });
        }
        await prisma.revenueContract.update({ where: { id }, data: { totalValue: newTotal, transactionPrice: newTotal, modificationType: 'PROSPECTIVE' } });
        return { modification: 'PROSPECTIVE', contractId: id, newTotal, remaining, perLineAmount: perLine, pendingPeriods: pendingLines.length };
      }

      if (body.modificationType === 'CUMULATIVE_CATCH_UP') {
        const newTotal = body.newTotalValue ?? contract.totalValue;
        const allLines = contract.scheduleLines;
        const newPerLine = allLines.length > 0 ? Math.round((newTotal / allLines.length) * 100) / 100 : 0;
        let cumulativeAdjustment = 0;

        for (const line of allLines) {
          if (line.status === 'RECOGNISED') {
            cumulativeAdjustment += newPerLine - line.recognisedAmount;
            await prisma.revenueScheduleLine.update({ where: { id: line.id }, data: { scheduledAmount: newPerLine, recognisedAmount: newPerLine } });
          } else {
            await prisma.revenueScheduleLine.update({ where: { id: line.id }, data: { scheduledAmount: newPerLine } });
          }
        }
        await prisma.revenueContract.update({ where: { id }, data: { totalValue: newTotal, transactionPrice: newTotal, modificationType: 'CUMULATIVE_CATCH_UP' } });
        return { modification: 'CUMULATIVE_CATCH_UP', contractId: id, newTotal, cumulativeAdjustment, newPerLineAmount: newPerLine };
      }

      return reply.status(400).send({ error: 'Unknown modification type' });
    });

    // ── ASC 606 Disclosure Report ─────────────────────
    app.get('/disclosure', async (request) => {
      const tenantId = (request.headers['x-tenant-id'] as string) || 'tenant-kunes';
      const { period } = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(request.query);

      const contracts = await prisma.revenueContract.findMany({
        where: { tenantId },
        include: { obligations: true, scheduleLines: true },
      });

      const revenueByType: Record<string, number> = {};
      const revenueByMethod: Record<string, number> = {};
      let totalDeferred = 0;
      let totalRecognised = 0;
      let activeContracts = 0;
      let completedContracts = 0;

      for (const c of contracts) {
        if (c.status === 'ACTIVE') activeContracts++;
        if (c.status === 'COMPLETED') completedContracts++;
        for (const line of c.scheduleLines) {
          if (period && line.period !== period) continue;
          if (line.status === 'RECOGNISED') {
            totalRecognised += line.recognisedAmount;
            revenueByType[c.productType] = (revenueByType[c.productType] ?? 0) + line.recognisedAmount;
            revenueByMethod[c.recognitionMethod] = (revenueByMethod[c.recognitionMethod] ?? 0) + line.recognisedAmount;
          } else {
            totalDeferred += line.scheduledAmount;
          }
        }
      }

      const allObligations = contracts.flatMap(c => c.obligations);
      const unsatisfied = allObligations.filter(o => o.status !== 'SATISFIED');
      const totalRemainingObligations = unsatisfied.reduce((sum, o) => sum + o.allocatedPrice, 0);
      const totalVariableConsideration = contracts.reduce((sum, c) => sum + (c.variableConsideration ?? 0), 0);

      return {
        tenantId,
        period: period ?? 'ALL',
        disaggregation: { byProductType: revenueByType, byRecognitionMethod: revenueByMethod },
        remainingPerformanceObligations: { count: unsatisfied.length, totalAllocatedValue: totalRemainingObligations },
        contractBalances: { totalRecognised, totalDeferred, activeContracts, completedContracts },
        variableConsideration: { totalEstimated: totalVariableConsideration },
        totalContracts: contracts.length,
      };
    });

    // ── Deferred revenue balance ──────────────────────
    app.get('/deferred-balance', async (request) => {
      const tenantId = (request.headers['x-tenant-id'] as string) || 'tenant-kunes';
      const result = await prisma.revenueScheduleLine.aggregate({
        where: { contract: { tenantId }, status: 'PENDING' },
        _sum: { scheduledAmount: true },
        _count: true,
      });
      const thisMonth = new Date();
      const currentPeriod = `${thisMonth.getFullYear()}-${String(thisMonth.getMonth() + 1).padStart(2, '0')}`;
      const thisMonthLines = await prisma.revenueScheduleLine.aggregate({
        where: { contract: { tenantId }, period: currentPeriod },
        _sum: { scheduledAmount: true },
      });
      return {
        totalDeferred: result._sum.scheduledAmount ?? 0,
        pendingLines: result._count,
        thisMonthRecognition: thisMonthLines._sum.scheduledAmount ?? 0,
      };
    });

    // ── Schedule for a contract ───────────────────────
    app.get('/contracts/:id/schedule', async (request, reply) => {
      const { id } = request.params as { id: string };
      const lines = await prisma.revenueScheduleLine.findMany({
        where: { contractId: id },
        orderBy: { period: 'asc' },
      });
      if (lines.length === 0) return reply.status(404).send({ error: 'No schedule found' });
      return lines;
    });
  };
}
