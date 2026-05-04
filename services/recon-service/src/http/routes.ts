import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { ReconService } from '../application/recon-service';
import { asTenantId, BankTransactionStatus, ReconStatus, authMiddleware } from '@amacc/shared-kernel';

function getTenantId(request: any) {
  const id = request.headers['x-tenant-id'] as string || 'tenant-kunes';
  return asTenantId(id);
}

const CreateReconSchema = z.object({
  accountName: z.string().min(1),
  reconDate: z.string().transform((s) => new Date(s)),
  glBalance: z.number(),
  bankBalance: z.number(),
});

const ImportTransactionsSchema = z.object({
  transactions: z.array(z.object({
    transactionDate: z.string().transform((s) => new Date(s)),
    description: z.string(),
    amount: z.number(),
  })).min(1),
});

const ManualMatchSchema = z.object({
  transactionId: z.string().uuid(),
  journalLineId: z.string().uuid(),
});

export async function reconRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'] ?? 'amacc-dev-secret-change-in-production';
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<ReconService>('ReconService');

  app.post('/', async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = CreateReconSchema.parse(request.body);
    const recon = await svc.createRecon(
      { ...body, tenantId, variance: body.glBalance - body.bankBalance, status: ReconStatus.OPEN, lockedBy: null, lockedAt: null },
      tenantId,
    );
    return reply.status(201).send(recon);
  });

  app.get('/', async (request, reply) => {
    const tenantId = getTenantId(request);
    return reply.send(await svc.getRecons(tenantId));
  });

  app.post('/:id/import', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const { transactions } = ImportTransactionsSchema.parse(request.body);
    const count = await svc.importTransactions(
      id, tenantId,
      transactions.map((t) => ({
        bankReconId: id, ...t,
        matchedJournalLineId: null,
        status: BankTransactionStatus.UNMATCHED,
      })),
    );
    return reply.send({ imported: count });
  });

  app.get('/:id/unmatched', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await svc.getUnmatched(id));
  });

  app.post('/:id/match-manual', async (request, reply) => {
    const body = ManualMatchSchema.parse(request.body);
    return reply.send(await svc.matchManual(body.transactionId, body.journalLineId));
  });

  app.post('/:id/complete', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    return reply.send(await svc.completeRecon(id, tenantId));
  });
}
