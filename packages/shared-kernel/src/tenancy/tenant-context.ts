import { AsyncLocalStorage } from 'async_hooks';

/**
 * R0 Stabilization Phase 5 (ADR-001): request-scoped tenant context, read by
 * the Prisma RLS middleware (rls-middleware.ts) so it knows which tenant to
 * SET for the current query without every call site threading tenantId
 * through explicitly. Populated once per request by tenantContextHook
 * (a Fastify preHandler, registered after authMiddleware/getTenantId).
 *
 * Named RlsTenantContext (not TenantContext) to avoid colliding with the
 * unrelated pre-existing `TenantContext` domain-shape interface in
 * src/types/index.ts.
 *
 * Uses AsyncLocalStorage.enterWith() rather than .run() — Fastify's hook
 * chain doesn't give middleware a "wrap the rest of the pipeline in a
 * callback" primitive, and enterWith() is Node's documented pattern for
 * exactly this case (see Node docs: "Using AsyncLocalStorage... without
 * .run()").
 */
const storage = new AsyncLocalStorage<string>();

export const RlsTenantContext = {
  set(tenantId: string): void {
    storage.enterWith(tenantId);
  },
  get(): string | undefined {
    return storage.getStore();
  },
};

/** Fastify preHandler: register AFTER authMiddleware / after tenantId is
 * resolved. Best-effort — if x-tenant-id is absent, leaves the context unset
 * so the RLS middleware's SET receives no tenant (queries then see no rows,
 * per the deny-by-default RLS policy design). */
export function tenantContextHook(request: any, _reply: any, done: () => void): void {
  const tenantId = (request.headers?.['x-tenant-id'] as string | undefined)?.trim();
  if (tenantId) RlsTenantContext.set(tenantId);
  done();
}
