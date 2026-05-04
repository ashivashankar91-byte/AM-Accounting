import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CoAService } from '../application/coa-service';
import { asTenantId, DMSType, authMiddleware } from '@amacc/shared-kernel';

function getTenantId(request: any) {
  const id = request.headers['x-tenant-id'] as string || 'tenant-kunes';
  return asTenantId(id);
}

const LegacyMapSchema = z.object({
  dmsType: z.nativeEnum(DMSType),
  accounts: z.array(z.object({
    legacyCode: z.string().min(1),
    legacyName: z.string().min(1),
    dmsType: z.nativeEnum(DMSType),
  })),
});

export function coaRoutes(svc: CoAService) {
  return async function (app: FastifyInstance) {
    const JWT_SECRET = process.env['AMACC_JWT_SECRET'] ?? 'amacc-dev-secret-change-in-production';
    app.addHook('preHandler', authMiddleware(JWT_SECRET));

    // GET /coa/standard/:version — full standard CoA
    app.get('/standard/:version', async (request, reply) => {
      const { version } = request.params as { version: string };
      return reply.send(svc.getStandardCoA(version));
    });

    // GET /coa/standard — latest standard CoA
    app.get('/standard', async (_request, reply) => {
      return reply.send(svc.getStandardCoA());
    });

    // GET /coa/tenant/:tenantId — tenant-specific CoA
    app.get('/tenant/:tenantId', async (request, reply) => {
      const { tenantId } = request.params as { tenantId: string };
      return reply.send(svc.getTenantCoA(asTenantId(tenantId)));
    });

    // GET /coa/oem-mapping/:tenantId/:oem — GL → FS line mappings
    app.get('/oem-mapping/:tenantId/:oem', async (request, reply) => {
      const { tenantId, oem } = request.params as { tenantId: string; oem: string };
      return reply.send(svc.getOEMMapping(asTenantId(tenantId), oem as any));
    });

    // GET /coa/unmapped/:tenantId/:oem — accounts with no OEM mapping
    app.get('/unmapped/:tenantId/:oem', async (request, reply) => {
      const { tenantId, oem } = request.params as { tenantId: string; oem: string };
      return reply.send(svc.getUnmappedAccounts(asTenantId(tenantId), oem as any));
    });

    // POST /coa/legacy-map — map legacy GL to AMACC canonical
    app.post('/legacy-map', async (request, reply) => {
      const { dmsType, accounts } = LegacyMapSchema.parse(request.body);
      const tenantId = getTenantId(request);
      const result = svc.mapLegacyGL(accounts, dmsType, tenantId);
      return reply.send(result);
    });
  };
}
