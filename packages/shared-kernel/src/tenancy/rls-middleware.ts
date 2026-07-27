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

/**
 * Final-R0 Batch C defect fix: the middleware above sets `app.current_tenant_id`
 * on `prismaLike`'s own connection (drawn from the base client's pool). That is
 * NOT the same physical connection Prisma uses for an *interactive* transaction
 * (`prisma.$transaction(async (tx) => { ... })`) — interactive transactions are
 * pinned to one dedicated connection for their whole callback, acquired
 * separately from the pool the middleware's raw SET runs on. The documented
 * "known limitation" in the comment above was empirically verified only for
 * the batched-array `$transaction([...])` form (used by fiscal-service.ts,
 * where each promise is built on the base client and still goes through the
 * middleware normally) — NOT for the interactive-callback form, which was
 * found in Final-R0 Batch C live-gateway testing to deterministically violate
 * every RLS policy with a 42501 error (`app.current_tenant_id` is unset on the
 * transaction's own connection).
 *
 * Fix: call this helper as the FIRST statement inside every interactive
 * `$transaction(async (tx) => { ... })` callback, using `tx` itself (so the
 * SET lands on the transaction's own dedicated connection before any model
 * query runs on it).
 */
export async function setTenantContextOnConnection(
  txLike: { $executeRawUnsafe: (query: string, ...values: any[]) => Promise<any> },
  tenantId: string | null | undefined,
): Promise<void> {
  await txLike.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', $1, false)`, tenantId ?? '');
}

/**
 * S008 — sets the `app.current_actor` session variable the period-close and
 * posting-path DB triggers require (enforce_period_transition() /
 * enforce_period_postable(), see
 * services/coa-service/prisma/migrations/20260728010000_s008_period_close_control).
 *
 * Deliberately uses `is_local := true` (true `SET LOCAL` semantics,
 * automatically reset at transaction end regardless of commit/rollback) —
 * NOT the `false` (session-scoped) choice `setTenantContextOnConnection`
 * above makes. That existing choice is a disclosed, already-documented
 * limitation of the tenant-id GUC under connection pooling; this actor GUC
 * is more security-sensitive (an identity, not just a filter), so it
 * deliberately does not repeat that tradeoff — a stale actor value must
 * never be able to leak onto a different, unrelated transaction reusing the
 * same pooled physical connection.
 *
 * Call as the FIRST statement inside every interactive
 * `$transaction(async (tx) => { ... })` callback that may write to
 * fiscal_period or journal_entry, using `tx` itself (same call-site
 * convention as setTenantContextOnConnection).
 */
export async function setActorContextOnConnection(
  txLike: { $executeRawUnsafe: (query: string, ...values: any[]) => Promise<any> },
  actor: string | null | undefined,
): Promise<void> {
  await txLike.$executeRawUnsafe(`SELECT set_config('app.current_actor', $1, true)`, actor ?? '');
}
