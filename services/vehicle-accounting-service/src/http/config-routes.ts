import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware } from '@amacc/shared-kernel';
import { VehicleAccountingConfigService } from '../application/config-service';
import { getTenantId, getActor, requireVehicleAccountingPermission, handleError, VEHICLE_ACCOUNTING_PERMISSIONS as PERM } from './security';

const PackPolicySchema = z.object({
  entityId: z.string().min(1),
  packRole: z.enum(['PACK_INCOME', 'HOLDBACK_CLEARING']),
  packBasis: z.enum(['FLAT', 'PERCENT_OF_INVOICE']),
  packAmount: z.string().optional(),
  packPercentBp: z.number().int().positive().optional(),
  actor: z.string().min(1).optional(),
});

const DemoBasisSchema = z.object({
  entityId: z.string().min(1),
  percentPerPeriodBp: z.number().int().positive(),
  periodLengthDays: z.number().int().positive().optional(),
  actor: z.string().min(1).optional(),
});

const LcnrvThresholdSchema = z.object({
  entityId: z.string().min(1),
  maxWriteDownAmount: z.string().min(1),
  actor: z.string().min(1).optional(),
});

export async function configRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve(VehicleAccountingConfigService);

  app.put('/config/pack-policy', { preHandler: requireVehicleAccountingPermission(PERM.CONFIG_MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = PackPolicySchema.parse(request.body ?? {});
      const row = await svc.upsertPackPolicy(tenantId, getActor(request, body), body);
      return reply.status(200).send(row);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/config/pack-policy', { preHandler: requireVehicleAccountingPermission(PERM.UNIT_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { entityId } = request.query as { entityId?: string };
      if (!entityId) return reply.status(400).send({ error: 'BAD_REQUEST', message: 'query param "entityId" is required' });
      return reply.send(await svc.getPackPolicy(tenantId, entityId));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.put('/config/demo-depreciation-basis', { preHandler: requireVehicleAccountingPermission(PERM.CONFIG_MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = DemoBasisSchema.parse(request.body ?? {});
      const row = await svc.upsertDemoDepreciationBasis(tenantId, getActor(request, body), body);
      return reply.status(200).send(row);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/config/demo-depreciation-basis', { preHandler: requireVehicleAccountingPermission(PERM.UNIT_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { entityId } = request.query as { entityId?: string };
      if (!entityId) return reply.status(400).send({ error: 'BAD_REQUEST', message: 'query param "entityId" is required' });
      return reply.send(await svc.getDemoDepreciationBasis(tenantId, entityId));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.put('/config/lcnrv-threshold', { preHandler: requireVehicleAccountingPermission(PERM.CONFIG_MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = LcnrvThresholdSchema.parse(request.body ?? {});
      const row = await svc.upsertLcnrvThreshold(tenantId, getActor(request, body), body);
      return reply.status(200).send(row);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/config/lcnrv-threshold', { preHandler: requireVehicleAccountingPermission(PERM.UNIT_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { entityId } = request.query as { entityId?: string };
      if (!entityId) return reply.status(400).send({ error: 'BAD_REQUEST', message: 'query param "entityId" is required' });
      return reply.send(await svc.getLcnrvThreshold(tenantId, entityId));
    } catch (err) {
      return handleError(err, reply);
    }
  });
}
