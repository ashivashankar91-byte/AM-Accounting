// CE-15 reconciliation — period-readiness signal for close-service.
//
// Signal logic (CE-12 Vehicle/Deal/F&I):
//   NOT_READY if any Deal has status='DESKED' (deal not yet finalized —
//             cannot close the period with pending/uncommitted deals).
//   NOT_READY if any DealReviewCase has status='PENDING_REVIEW'
//             (deal exception unresolved — blocks close).
//   READY     otherwise.
//
// Period filter: applies when periodYear/periodMonth are supplied; filters
// deals by bookDate (or createdAt if bookDate absent) in the period.
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/deal-accounting-client';

export async function dealPeriodReadinessRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('AMACC_JWT_SECRET is required');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  app.get<{
    Querystring: { legalEntityId?: string; periodYear?: string; periodMonth?: string };
  }>('/period-readiness', async (request, reply) => {
    const tenantId = (request.headers['x-tenant-id'] as string | undefined)?.trim();
    if (!tenantId) return reply.status(400).send({ error: 'MISSING_TENANT', message: 'x-tenant-id required' });

    const { periodYear, periodMonth } = request.query;
    const blockers: string[] = [];
    const prisma = new PrismaClient();

    try {
      const dealWhere: Record<string, unknown> = { tenantId, status: 'DESKED' };
      const reviewWhere: Record<string, unknown> = { tenantId, status: 'PENDING_REVIEW' };

      if (periodYear && periodMonth) {
        const year = parseInt(periodYear, 10);
        const month = parseInt(periodMonth, 10);
        const periodStart = new Date(year, month - 1, 1);
        const periodEnd = new Date(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1);
        dealWhere['createdAt'] = { gte: periodStart, lt: periodEnd };
        reviewWhere['createdAt'] = { gte: periodStart, lt: periodEnd };
      }

      const deskedDeals = await prisma.deal.count({ where: dealWhere as any });
      if (deskedDeals > 0) {
        blockers.push(`${deskedDeals} deal(s) status=DESKED (not finalized)`);
      }

      const pendingReviews = await prisma.dealReviewCase.count({ where: reviewWhere as any });
      if (pendingReviews > 0) {
        blockers.push(`${pendingReviews} deal review case(s) PENDING_REVIEW`);
      }
    } finally {
      await prisma.$disconnect();
    }

    const signal = blockers.length === 0 ? 'READY' : 'NOT_READY';
    return reply.status(200).send({ signal, blockers });
  });
}
