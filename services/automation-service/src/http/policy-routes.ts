import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { PolicyGateService } from '../application/policy-gate-service';
import {
  attachAuth, handle, getTenantId, getLegalEntityId, getActor, requirePermission, requireBody,
} from './route-helpers';
import { PERMS } from './permissions';

/**
 * CE-17 — Policy-gate configuration.
 *
 * A policy version is authored, then activated by somebody else, then takes
 * effect on its effective date. Until then it governs nothing. An activated
 * version is immutable, which is what makes the trace on an executed item
 * mean something months later.
 */
export async function policyRoutes(app: FastifyInstance) {
  attachAuth(app);
  const policies = () => container.resolve(PolicyGateService);

  app.get('/policies', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, async () => {
      const items = await policies().list(getTenantId(req), getLegalEntityId(req), req.query?.capabilityCode);
      return { items, total: items.length };
    }));

  app.get('/policies/effective', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = req.query ?? {};
      if (!body.capabilityCode) {
        const e: any = new Error('capabilityCode query parameter is required'); e.statusCode = 400; throw e;
      }
      const gate = await policies().effectiveGate(getTenantId(req), getLegalEntityId(req), body.capabilityCode);
      return gate
        ? { configured: true, gate }
        : {
          configured: false,
          detail: 'No activated policy version is in effect for this capability. Until one is, the capability can only observe.',
        };
    }));

  app.post('/policies', { preHandler: requirePermission(PERMS.POLICY_AUTHOR) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['capabilityCode', 'policyVersion', 'effectiveDate']);
      return policies().save({
        ...body,
        tenantId: getTenantId(req),
        legalEntityId: getLegalEntityId(req),
        authoredBy: getActor(req),
      });
    }));

  app.post('/policies/:id/activate', { preHandler: requirePermission(PERMS.POLICY_ACTIVATE) }, async (req: any, reply) =>
    handle(reply, () => policies().activate({
      tenantId: getTenantId(req), id: req.params.id, activatedBy: getActor(req),
    })));
}
