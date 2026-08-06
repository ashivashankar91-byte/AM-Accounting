// CE-15 reconciliation — period-readiness signal for close-service's
// UpstreamModuleClient. Exposes real OEM state so close-service can
// determine whether CE-14 is READY, NOT_READY, or blocking.
//
// Signal logic:
//   NOT_READY if any OemMatchSession is OPEN (undispositioned rows block
//             reconciliation of OEM receivables).
//   NOT_READY if any OemWarrantyChargebackLine disposition='PENDING'
//             (unresolved warranty/chargeback exception).
//   READY     otherwise.
//
// Auth: standard authMiddleware JWT (caller must present a valid SERVICE
// or USER token). x-tenant-id header is required.
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/oem-client';

export async function oemPeriodReadinessRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('AMACC_JWT_SECRET is required');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  app.get<{
    Querystring: { tenantId?: string; legalEntityId?: string; periodYear?: string; periodMonth?: string };
  }>('/period-readiness', async (request, reply) => {
    const tenantId = (request.headers['x-tenant-id'] as string | undefined)?.trim();
    if (!tenantId) return reply.status(400).send({ error: 'MISSING_TENANT', message: 'x-tenant-id required' });

    const { legalEntityId } = request.query;
    const prisma = new PrismaClient();
    const blockers: string[] = [];

    try {
      const openSessions = await prisma.oemMatchSession.count({
        where: { tenantId, status: 'OPEN' },
      });
      if (openSessions > 0) {
        blockers.push(`${openSessions} OEM match session(s) still OPEN — all rows must be dispositioned`);
      }

      const pendingWarranty = await prisma.oemWarrantyChargebackLine.count({
        where: { tenantId, disposition: 'PENDING' },
      });
      if (pendingWarranty > 0) {
        blockers.push(`${pendingWarranty} warranty/chargeback line(s) disposition=PENDING`);
      }
    } finally {
      await prisma.$disconnect();
    }

    const signal = blockers.length === 0 ? 'READY' : 'NOT_READY';
    return reply.status(200).send({ signal, blockers });
  });
}
