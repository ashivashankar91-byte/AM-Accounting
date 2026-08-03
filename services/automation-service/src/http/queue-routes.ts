import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { AutomationItemService } from '../application/automation-item-service';
import {
  attachAuth, handle, getTenantId, getLegalEntityId, optionalLegalEntityId, getActor,
  requirePermission, requireBody,
} from './route-helpers';
import { PERMS } from './permissions';

/**
 * CE-17 — The unified work queue.
 *
 * Every capability's output lands here in the same shape, so a reviewer's
 * habits transfer across all fourteen stories and no surface can invent a
 * gentler vocabulary for its own failures.
 */
export async function queueRoutes(app: FastifyInstance) {
  attachAuth(app);
  const items = () => container.resolve(AutomationItemService);

  app.get('/items', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, async () => {
      const rows = await items().list(getTenantId(req), {
        legalEntityId: optionalLegalEntityId(req),
        capabilityCode: req.query?.capabilityCode,
        state: req.query?.state,
        storyId: req.query?.storyId,
      });
      return { items: rows, total: rows.length };
    }));

  app.get('/items/:id', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => items().get(getTenantId(req), req.params.id)));

  // The review screen's evidence pane: sources, rule/model versions, the
  // policy trace, and every execution attempt in order.
  app.get('/items/:id/lineage', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => items().lineage(getTenantId(req), req.params.id)));

  // Re-runs the gates without acting on the result, so a reviewer can see
  // exactly what would happen — and why — before deciding.
  app.post('/items/:id/evaluate', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => items().evaluate(getTenantId(req), req.params.id, getLegalEntityId(req))));

  app.post('/items/:id/claim', { preHandler: requirePermission(PERMS.ITEM_APPROVE) }, async (req: any, reply) =>
    handle(reply, () => items().claim(getTenantId(req), req.params.id, getActor(req))));

  app.post('/items/:id/approve', { preHandler: requirePermission(PERMS.ITEM_APPROVE) }, async (req: any, reply) =>
    handle(reply, () => items().approve(getTenantId(req), req.params.id, getActor(req), (req.body as any)?.note)));

  app.post('/items/:id/reject', { preHandler: requirePermission(PERMS.ITEM_APPROVE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['reason']);
      return items().reject(getTenantId(req), req.params.id, getActor(req), body.reason);
    }));

  app.post('/items/:id/execute', { preHandler: requirePermission(PERMS.ITEM_EXECUTE) }, async (req: any, reply) =>
    handle(reply, () => items().execute(getTenantId(req), req.params.id, getLegalEntityId(req), getActor(req))));

  app.post('/items/:id/retry', { preHandler: requirePermission(PERMS.ITEM_EXECUTE) }, async (req: any, reply) =>
    handle(reply, () => items().retry(getTenantId(req), req.params.id, getLegalEntityId(req), getActor(req))));

  app.post('/items/:id/reverse', { preHandler: requirePermission(PERMS.ITEM_REVERSE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['reason']);
      return items().reverse(getTenantId(req), req.params.id, getLegalEntityId(req), getActor(req), body.reason);
    }));
}
