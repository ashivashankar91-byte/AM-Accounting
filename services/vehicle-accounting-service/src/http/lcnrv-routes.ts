import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware } from '@amacc/shared-kernel';
import { LcnrvService } from '../application/lcnrv-service';
import { getTenantId, getActor, requireVehicleAccountingPermission, handleError, VEHICLE_ACCOUNTING_PERMISSIONS as PERM } from './security';

const EvidenceSchema = z.object({
  marketValue: z.string().min(1),
  source: z.string().min(1),
  reference: z.string().optional(),
  note: z.string().optional(),
  actor: z.string().min(1).optional(),
});

const WriteDownSchema = z.object({
  evidenceId: z.string().min(1),
  reason: z.string().min(1),
  eventId: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
  actor: z.string().min(1).optional(),
});

export async function lcnrvRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve(LcnrvService);

  // POST /units/:stockNumber/lcnrv-evidence — S076 entered/imported market-value evidence.
  app.post('/units/:stockNumber/lcnrv-evidence', { preHandler: requireVehicleAccountingPermission(PERM.UNIT_WRITEDOWN) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { stockNumber } = request.params as { stockNumber: string };
      const body = EvidenceSchema.parse(request.body ?? {});
      const evidence = await svc.addMarketEvidence(tenantId, getActor(request, body), { ...body, stockNumber });
      return reply.status(201).send(evidence);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET /lcnrv/worklist — S076 aging/valuation worklist (book vs entered market data).
  app.get('/lcnrv/worklist', { preHandler: requireVehicleAccountingPermission(PERM.UNIT_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as Record<string, string | undefined>;
      const items = await svc.worklist(tenantId, { entityId: q['entityId'], status: q['status'] });
      return reply.send({ items });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /units/:stockNumber/lcnrv-writedown — S076 write-down ceremony (reason + threshold refusal).
  app.post('/units/:stockNumber/lcnrv-writedown', { preHandler: requireVehicleAccountingPermission(PERM.UNIT_WRITEDOWN) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { stockNumber } = request.params as { stockNumber: string };
      const body = WriteDownSchema.parse(request.body ?? {});
      const result = await svc.writeDown(tenantId, getActor(request, body), { ...body, stockNumber });
      const status = result.status === 'REFUSED' ? 422 : result.idempotent ? 200 : 201;
      return reply.status(status).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/lcnrv/write-downs', { preHandler: requireVehicleAccountingPermission(PERM.UNIT_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as Record<string, string | undefined>;
      const items = await svc.listWriteDowns(tenantId, { stockNumber: q['stockNumber'] });
      return reply.send({ items });
    } catch (err) {
      return handleError(err, reply);
    }
  });
}
