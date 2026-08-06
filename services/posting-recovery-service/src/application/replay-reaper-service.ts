import { randomUUID } from 'crypto';
import { inject, injectable } from 'tsyringe';
import type { PrismaClient } from '.prisma/posting-recovery-client';
import { appendAuditReference } from '../infrastructure/audit';

/**
 * CE-07 integration slice — resolves the crash/restart recovery limitation
 * disclosed in ReplayService's own doc comment and in
 * S021_CERTIFICATION_REPORT.md ("financially safe... but requires manual
 * operator intervention... No automatic reaper/timeout exists").
 *
 * The gap: ReplayService.replay() acquires REPLAY_IN_PROGRESS via an atomic
 * CAS before ever calling CH01. If the process crashes between that CAS and
 * the finalize `$transaction`, the case is left in REPLAY_IN_PROGRESS with
 * no attempt row and (previously) no timestamp to tell staleness apart from
 * a replay that is still genuinely in flight seconds ago.
 *
 * This is safe to reclaim automatically, not just flag for a human: CH01's
 * own (tenantId, eventId) idempotency (posting-engine-service.ts) means a
 * subsequent replay of the SAME event can never create a second journal
 * regardless of how many times the case cycles through REPLAY_IN_PROGRESS —
 * reclaiming a stale lock only ever risks a redundant, safely-idempotent
 * CH01 call on the next real replay attempt, never a duplicate posting.
 *
 * Mechanism: a single atomic `UPDATE ... WHERE status = 'REPLAY_IN_PROGRESS'
 * AND replay_lock_acquired_at < :threshold RETURNING *`. This does not need
 * a separate optimistic-concurrency read-then-CAS round trip the way
 * ReplayService.replay()'s initial acquisition does — Postgres re-evaluates
 * the WHERE clause per row as part of the single UPDATE statement, so a
 * legitimate in-flight replay's own row lock (held by its finalize
 * transaction) makes the reaper's UPDATE wait, then see the row no longer
 * matches (status already changed to RESOLVED/UNDER_REVIEW) — no separate
 * mutex or version check is required for this operation to be race-free.
 * `version` is still incremented for consistency with every other mutation
 * of this row.
 *
 * Scope boundary (deliberate, not an oversight): this service enforces
 * tenant isolation via RLS keyed on `app.current_tenant_id`
 * (createTenantRlsMiddleware), set per-request from the caller's own tenant
 * context — there is no wired cross-tenant bypass path in this codebase
 * today (the `amacc_rls_bypass` role is created and granted table
 * privileges by the RLS migration, but is never granted as a role
 * membership to the connecting `amacc_app` database user anywhere in this
 * repository — audit-service's own bootstrap comment already flags that gap
 * as "a real behavior change... a Product Owner decision point, not
 * silently absorbed"). Extending that shared bypass grant is a
 * security-relevant decision this integration does not make unilaterally.
 * `reapStaleReplays` therefore operates within the calling tenant's own RLS
 * context, exactly like every other write path in this service — call it
 * per-tenant, either from the exposed HTTP endpoint (an operator or an
 * external per-tenant scheduler) or by iterating known tenants at the
 * platform level. See README.md's "Crash/restart recovery" section for the
 * full disclosure.
 */
@injectable()
export class ReplayReaperService {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  /**
   * Reclaims every case in this tenant stuck in REPLAY_IN_PROGRESS whose
   * lock is older than `staleAfterMs` (default 5 minutes — long enough that
   * no genuine in-flight replay against a healthy coa-service should ever
   * be reclaimed out from under it; short enough that an operator or
   * scheduler polling every minute or two recovers promptly after a crash).
   */
  async reapStaleReplays(
    tenantId: string,
    actor: string,
    staleAfterMs = 5 * 60 * 1000,
    now: Date = new Date(),
  ): Promise<{ reapedCaseIds: string[] }> {
    const threshold = new Date(now.getTime() - staleAfterMs);

    const stale = await this.prisma.postingDeadLetter.findMany({
      where: { tenantId, status: 'REPLAY_IN_PROGRESS', replayLockAcquiredAt: { lt: threshold } },
      select: { id: true, version: true, attemptCount: true },
    });

    const reapedCaseIds: string[] = [];
    for (const c of stale) {
      const { count } = await this.prisma.postingDeadLetter.updateMany({
        where: { id: c.id, tenantId, status: 'REPLAY_IN_PROGRESS', replayLockAcquiredAt: { lt: threshold } },
        data: { status: 'AWAITING_CORRECTION', replayLockAcquiredAt: null, version: { increment: 1 }, attemptCount: { increment: 1 }, lastAttemptAt: now },
      });
      // count === 0 means a concurrent legitimate replay finished (or another
      // reaper pass already reclaimed it) between the findMany above and this
      // UPDATE — correctly skip it, nothing to reap.
      if (count !== 1) continue;

      const attemptNumber = c.attemptCount + 1;
      await this.prisma.$transaction(async (tx: any) => {
        await tx.postingReplayAttempt.create({
          data: {
            id: randomUUID(),
            tenantId,
            deadLetterId: c.id,
            attemptNumber,
            status: 'TIMED_OUT',
            requestedBy: actor,
            requestedAt: threshold,
            authorizedBy: actor,
            authorizedAt: threshold,
            startedAt: threshold,
            completedAt: now,
            resultMessage:
              `Replay lock reclaimed by the automatic reaper: this case was stuck in REPLAY_IN_PROGRESS with no ` +
              `completed attempt for longer than ${Math.round(staleAfterMs / 1000)}s, consistent with a process ` +
              `crash/restart between lock acquisition and replay completion. CH01's own idempotency guarantees no ` +
              `duplicate journal can result from this. Route back to READY_FOR_REPLAY after investigation to retry.`,
            resultingJournalReference: null,
          },
        });
        await tx.postingCaseTransition.create({
          data: {
            id: randomUUID(),
            tenantId,
            deadLetterId: c.id,
            fromStatus: 'REPLAY_IN_PROGRESS',
            toStatus: 'AWAITING_CORRECTION',
            reason: 'Stale replay lock reclaimed by automatic reaper (crash/restart recovery)',
            actor,
            occurredAt: now,
          },
        });
        await appendAuditReference(tx as any, {
          tenantId,
          deadLetterId: c.id,
          eventType: 'posting_recovery.replay_lock_reaped',
          actor,
          after: { attemptNumber, staleAfterMs, lockThreshold: threshold.toISOString() },
        });
      });

      reapedCaseIds.push(c.id);
    }

    return { reapedCaseIds };
  }
}
