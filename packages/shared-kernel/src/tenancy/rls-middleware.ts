import { RlsTenantContext } from './tenant-context';

/**
 * R0 Stabilization Phase 5 (ADR-001): sets the `app.current_tenant_id`
 * Postgres session variable that every tenant-owned table's RLS policy
 * checks, before each query executes. This is the actual mechanism ADR-001
 * describes ("a session variable injected by a Prisma middleware before
 * every query") — never built until now.
 *
 * Uses Prisma's legacy `$use` middleware API (still supported in Prisma 5;
 * a `$extends`-based rewrite is a reasonable future migration, not required
 * for correctness here).
 *
 * Known limitation, disclosed rather than silently assumed away: this SET
 * and the query it precedes must land on the SAME physical connection for
 * RLS to apply to that query. Prisma's connection pool does not give an
 * ironclad guarantee of that for two separate sequential calls under high
 * concurrency — this is a widely-documented tradeoff of the SET-before-query
 * middleware pattern versus $transaction-wrapped `SET LOCAL`. It is
 * empirically verified against a real Postgres instance for this
 * environment's concurrency profile in LIVE_DATABASE_TEST_REPORT.md, not
 * merely assumed from the pattern's theory. A stronger guarantee (PgBouncer
 * session-pooling mode, or wrapping every call site in `$transaction`) is
 * documented as follow-up hardening, not claimed as already done.
 */
export function createTenantRlsMiddleware(prismaLike: { $executeRawUnsafe: (query: string, ...values: any[]) => Promise<any> }) {
  return async (params: { model?: string; action: string }, next: (params: any) => Promise<any>) => {
    // Raw queries (params.model undefined) are skipped — otherwise the
    // $executeRawUnsafe call below would itself re-enter this same $use
    // middleware (Prisma's legacy middleware wraps ALL client operations,
    // including its own raw-query methods), recursing without end. This was
    // never exercised by an actual booted service until Phase 8: the Phase 5
    // manual proof used a plain `pg` client (bypassing $use entirely), so the
    // infinite-recursion path went undetected until the first real
    // model-query triggered it here in production wiring.
    if (!params.model) return next(params);
    const tenantId = RlsTenantContext.get();
    // set_config(...) is a normal function call — its second argument is a
    // real bind parameter, not string-interpolated SQL (unlike the SET
    // command, which cannot take a placeholder for its value).
    await prismaLike.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', $1, false)`, tenantId ?? '');
    return next(params);
  };
}
