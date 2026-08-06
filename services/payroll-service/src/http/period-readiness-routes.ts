// CE-15 reconciliation — period-readiness signal for close-service.
//
// Signal logic:
//   NOT_READY if any PayrollBatch for this legalEntityId is in status
//             DRAFT or VALIDATED (not yet posted) whose pay period
//             overlaps with the requested close period.
//   READY     otherwise.
//
// Period filter: the batch's payPeriodEnd falls within [periodStart, periodEnd).
// If periodYear/periodMonth are absent, checks all unposted batches.
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/payroll-client';

export async function payrollPeriodReadinessRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('AMACC_JWT_SECRET is required');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  app.get<{
    Querystring: { legalEntityId?: string; periodYear?: string; periodMonth?: string };
  }>('/period-readiness', async (request, reply) => {
    const tenantId = (request.headers['x-tenant-id'] as string | undefined)?.trim();
    if (!tenantId) return reply.status(400).send({ error: 'MISSING_TENANT', message: 'x-tenant-id required' });

    const { legalEntityId, periodYear, periodMonth } = request.query;
    const blockers: string[] = [];

    const where: Record<string, unknown> = {
      tenantId,
      status: { in: ['DRAFT', 'VALIDATED'] },
    };
    if (legalEntityId) where['legalEntityId'] = legalEntityId;

    if (periodYear && periodMonth) {
      const year = parseInt(periodYear, 10);
      const month = parseInt(periodMonth, 10);
      const periodStart = new Date(year, month - 1, 1);
      const periodEnd = new Date(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1);
      // Overlap: batch's payPeriodEnd >= periodStart AND payPeriodStart < periodEnd
      where['payPeriodEnd'] = { gte: periodStart };
      where['payPeriodStart'] = { lt: periodEnd };
    }

    const prisma = new PrismaClient();
    try {
      const unposted = await prisma.payrollBatch.count({ where: where as any });
      if (unposted > 0) {
        blockers.push(`${unposted} payroll batch(es) in DRAFT/VALIDATED status for the period`);
      }
    } finally {
      await prisma.$disconnect();
    }

    const signal = blockers.length === 0 ? 'READY' : 'NOT_READY';
    return reply.status(200).send({ signal, blockers });
  });
}
