import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { AutomationCapabilityService } from '../application/capability-service';
import { AutomationHealthService } from '../application/health-service';
import {
  attachAuth, handle, getTenantId, getLegalEntityId, getActor,
  requirePermission, requireBody, parseIntOr,
} from './route-helpers';
import { PERMS } from './permissions';

/**
 * CE-17 — Capability, authority and health surfaces.
 *
 * These endpoints are the command centre's spine: what exists, what authority
 * it holds, who granted it, who activated it, and how it has behaved.
 */
export async function capabilityRoutes(app: FastifyInstance) {
  attachAuth(app);

  const capabilities = () => container.resolve(AutomationCapabilityService);
  const health = () => container.resolve(AutomationHealthService);

  // All 14 capabilities, always — unconfigured ones report NOT_CONFIGURED
  // rather than being omitted, so the grid can never look shorter than the epic.
  app.get('/capabilities', { preHandler: requirePermission(PERMS.READ) }, async (req, reply) =>
    handle(reply, async () => {
      const items = await capabilities().list(getTenantId(req), getLegalEntityId(req));
      return { items, total: items.length };
    }));

  app.get('/capabilities/:id', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => capabilities().get(getTenantId(req), req.params.id)));

  app.post('/capabilities', { preHandler: requirePermission(PERMS.CAPABILITY_CONFIGURE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['capabilityCode']);
      return capabilities().create({
        tenantId: getTenantId(req),
        legalEntityId: getLegalEntityId(req),
        capabilityCode: body.capabilityCode,
        baselineEvidenceRef: body.baselineEvidenceRef ?? null,
        actor: getActor(req),
      });
    }));

  app.post('/capabilities/:id/grants', { preHandler: requirePermission(PERMS.AUTHORITY_GRANT) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['toAuthority']);
      return capabilities().grant({
        tenantId: getTenantId(req),
        id: req.params.id,
        toAuthority: body.toAuthority,
        grantedBy: getActor(req),
        evidenceRefs: body.evidenceRefs ?? [],
      });
    }));

  // Activation is a separate permission on purpose: the ceremony is only real
  // if the grantor cannot also perform it.
  app.post('/capabilities/:id/activate', { preHandler: requirePermission(PERMS.AUTHORITY_ACTIVATE) }, async (req: any, reply) =>
    handle(reply, () => capabilities().activateGrant({
      tenantId: getTenantId(req),
      id: req.params.id,
      grantId: (req.body as any)?.grantId,
      activatedBy: getActor(req),
    })));

  app.post('/capabilities/:id/suspend', { preHandler: requirePermission(PERMS.SUSPEND) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['reason']);
      return capabilities().suspend({
        tenantId: getTenantId(req), id: req.params.id, actor: getActor(req), reason: body.reason,
      });
    }));

  app.post('/emergency-stop', { preHandler: requirePermission(PERMS.SUSPEND) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['reason']);
      return capabilities().emergencyStop({
        tenantId: getTenantId(req),
        legalEntityId: getLegalEntityId(req),
        actor: getActor(req),
        reason: body.reason,
      });
    }));

  app.get('/overview', { preHandler: requirePermission(PERMS.READ) }, async (req, reply) =>
    handle(reply, () => health().overview(getTenantId(req), getLegalEntityId(req))));

  app.get('/health-metrics', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => health().metrics(
      getTenantId(req), getLegalEntityId(req),
      req.query?.capabilityCode, parseIntOr(req.query?.days, 30),
    )));

  app.get('/versions', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => health().versions(getTenantId(req), req.query?.capabilityCode)));

  app.get('/versions/:id', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => health().version(getTenantId(req), req.params.id)));

  app.post('/versions', { preHandler: requirePermission(PERMS.CAPABILITY_CONFIGURE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['capabilityCode', 'versionTag', 'versionType']);
      return health().recordVersion({ ...body, tenantId: getTenantId(req), deployedBy: getActor(req) });
    }));
}
