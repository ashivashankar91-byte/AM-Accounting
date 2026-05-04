/**
 * @module AgentReviewTimeoutJob
 *
 * @trace-architecture-decision Auto-approve timeout
 *   If agent-gl has not reviewed a PENDING_REVIEW entry within AGENT_REVIEW_TIMEOUT_SECONDS
 *   (default: 30), the entry auto-transitions to POSTED via the full GLService.approveJournalEntry
 *   path. This ensures period balances, history transactions, and outbox events (including
 *   JOURNAL_ENTRY_POSTED for schedule-service) are all written correctly — not just the status flag.
 *
 * @why-needed If agent-gl or the Claude API is unavailable, journals submitted for review
 *   would be stuck in PENDING_REVIEW indefinitely. Dealers cannot operate without posting.
 *   The timeout ensures the system degrades gracefully rather than halting.
 *
 * @fix The original implementation only updated status='POSTED' directly in the DB, bypassing
 *   all ledger writes (period balances, history transactions, outbox events). This caused
 *   period balances to be missing for auto-timed-out entries and schedule-service details
 *   to never be created. Calling approveJournalEntry() fixes all of this atomically.
 */

import { PrismaClient } from '.prisma/gl-client';
import { asTenantId } from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'agent-timeout' });

/**
 * Timeout in seconds before a PENDING_REVIEW entry is auto-approved.
 * Configurable via AGENT_REVIEW_TIMEOUT_SECONDS. Default: 30.
 */
export const AGENT_REVIEW_TIMEOUT_SECONDS = parseInt(
  process.env['AGENT_REVIEW_TIMEOUT_SECONDS'] ?? '30',
  10,
);

export class AgentReviewTimeoutJob {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly glService: {
      approveJournalEntry(id: string, tenantId: any, approverId: string): Promise<any>;
    },
  ) {}

  /**
   * Check for timed-out PENDING_REVIEW entries and auto-approve them via the full
   * GLService posting path (period balances + history transactions + outbox events).
   * Returns count of entries auto-approved.
   */
  async run(): Promise<number> {
    const cutoff = new Date(Date.now() - AGENT_REVIEW_TIMEOUT_SECONDS * 1000);

    const timedOut = await this.prisma.journalEntry.findMany({
      where: {
        status: 'PENDING_REVIEW',
        agentReviewed: false,
        createdAt: { lt: cutoff },
      },
      select: { id: true, tenantId: true, createdAt: true },
    });

    if (timedOut.length === 0) return 0;

    const now = new Date();
    let approved = 0;

    for (const entry of timedOut) {
      try {
        const ageSeconds = Math.round((now.getTime() - entry.createdAt.getTime()) / 1000);
        await this.glService.approveJournalEntry(
          entry.id,
          asTenantId(entry.tenantId),
          'AUTO_TIMEOUT',
        );
        logger.warn(
          {
            entryId: entry.id,
            tenantId: entry.tenantId,
            ageSeconds,
            timeoutSeconds: AGENT_REVIEW_TIMEOUT_SECONDS,
          },
          'Auto-approved journal entry via full posting logic: agent review timeout exceeded',
        );
        approved++;
      } catch (err) {
        logger.error({ err, entryId: entry.id }, 'Failed to auto-approve timed-out entry');
      }
    }

    return approved;
  }

  /**
   * Start polling on an interval. Returns the timer handle so the caller can clear it.
   * @param intervalMs Polling interval in milliseconds. Default: 10_000 (10s).
   */
  startPolling(intervalMs = 10_000): ReturnType<typeof setInterval> {
    logger.info(
      { timeoutSeconds: AGENT_REVIEW_TIMEOUT_SECONDS, intervalMs },
      'AgentReviewTimeoutJob started',
    );
    return setInterval(() => {
      this.run().catch((err) => logger.error({ err }, 'AgentReviewTimeoutJob poll error'));
    }, intervalMs);
  }
}
