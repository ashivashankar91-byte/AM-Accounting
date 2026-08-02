// Concurrency guard for this service's "upsert a row keyed by a natural/
// idempotency key, then do more writes in the same transaction" pattern.
//
// Empirically found via a live-db test (tests/live-db/vehicle-unit-service-
// live.test.ts's concurrent-stock-in race): even `tx.model.upsert({...,
// update: {}})` — Postgres's native INSERT ... ON CONFLICT DO UPDATE, which
// is supposed to be race-safe by construction — can still surface a P2002
// unique-constraint error when two overlapping Prisma INTERACTIVE
// transactions (`$transaction(async (tx) => {...})`, which stay open across
// multiple awaited statements, not a single auto-committed statement) race
// on the same conflict target. This is a real, reproduced-against-a-live-
// Postgres-instance finding, not a theoretical concern — the original
// create()+catch(P2002)+tx.findUnique() idiom this replaced fails
// differently but just as badly (Postgres error 25P02, "current
// transaction is aborted", because a query error inside an interactive
// transaction poisons the WHOLE transaction, so a reconciliation query in
// the same catch block also fails).
//
// Fix: retry the ENTIRE transaction callback (a fresh `$transaction` call,
// a fresh connection, no poisoned state) after a P2002. By the second
// attempt the other transaction has settled (committed or rolled back), so
// the retry's upsert deterministically resolves against the now-visible
// state — either it wins cleanly, or it sees the winner's committed row and
// the update:{} branch is a true no-op read. Bounded (default 3 attempts)
// so a genuine, non-transient constraint problem still surfaces as an
// error rather than looping forever.
export async function withP2002Retry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (err?.code !== 'P2002' || attempt === maxAttempts) throw err;
      // Small jittered backoff — gives the winning transaction time to
      // commit before this retry re-evaluates the same conflict target.
      await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 15));
    }
  }
  throw lastErr;
}
