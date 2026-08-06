import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware } from '@amacc/shared-kernel';
import { DemoService } from '../application/demo-service';
import { getTenantId, getActor, requireVehicleAccountingPermission, handleError, VEHICLE_ACCOUNTING_PERMISSIONS as PERM } from './security';

const ReclassSchema = z.object({ eventId: z.string().min(1), idempotencyKey: z.string().min(1).optional(), correlationId: z.string().min(1).optional(), actor: z.string().min(1).optional() });
const ApproveSchema = z.object({ approvedAmount: z.string().min(1), eventId: z.string().min(1), idempotencyKey: z.string().min(1).optional(), actor: z.string().min(1).optional() });
const RejectSchema = z.object({ reason: z.string().min(1), actor: z.string().min(1).optional() });
const ReverseSchema = z.object({ reason: z.string().min(1).max(500), actor: z.string().min(1).optional() });

export async function demoRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve(DemoService);

  // POST /units/:stockNumber/demo-reclass — S075 NEW -> DEMO ceremony.
  app.post('/units/:stockNumber/demo-reclass', { preHandler: requireVehicleAccountingPermission(PERM.UNIT_RECLASS) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { stockNumber } = request.params as { stockNumber: string };
      const body = ReclassSchema.parse(request.body ?? {});
      const result = await svc.reclass(tenantId, getActor(request, body), { ...body, stockNumber });
      return reply.status(result.idempotent ? 200 : 201).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /units/:stockNumber/demo-value-adjustment/preview — S075 preview-approve: compute proposal, nothing posts.
  app.post('/units/:stockNumber/demo-value-adjustment/preview', { preHandler: requireVehicleAccountingPermission(PERM.UNIT_RECLASS) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { stockNumber } = request.params as { stockNumber: string };
      const preview = await svc.previewAdjustment(tenantId, getActor(request, request.body), { stockNumber });
      return reply.status(201).send(preview);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /demo-value-adjustments/:id/approve — accountant approves the EXACT computed preview; posts.
  app.post('/demo-value-adjustments/:id/approve', { preHandler: requireVehicleAccountingPermission(PERM.DEMO_ADJUSTMENT_APPROVE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const body = ApproveSchema.parse(request.body ?? {});
      const result = await svc.approveAdjustment(tenantId, getActor(request, body), { adjustmentId: id, ...body });
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/demo-value-adjustments/:id/reject', { preHandler: requireVehicleAccountingPermission(PERM.DEMO_ADJUSTMENT_APPROVE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const body = RejectSchema.parse(request.body ?? {});
      const result = await svc.rejectAdjustment(tenantId, getActor(request, body), { adjustmentId: id, ...body });
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /demo-value-adjustments/:id/reverse — S218 symmetric reversal.
  app.post('/demo-value-adjustments/:id/reverse', { preHandler: requireVehicleAccountingPermission(PERM.DEMO_ADJUSTMENT_APPROVE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const body = ReverseSchema.parse(request.body ?? {});
      const result = await svc.reverseAdjustment(tenantId, getActor(request, body), { adjustmentId: id, ...body });
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/demo-value-adjustments', { preHandler: requireVehicleAccountingPermission(PERM.UNIT_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as Record<string, string | undefined>;
      const items = await svc.listAdjustments(tenantId, { stockNumber: q['stockNumber'], status: q['status'] });
      return reply.send({ items });
    } catch (err) {
      return handleError(err, reply);
    }
  });
}
