import pino from 'pino';

const logger = pino({ name: 'auto-post-job' });

export interface AutoPostJobDependencies {
  prisma: any;
  glService: any;
}

export class AutoPostJob {
  constructor(private deps: AutoPostJobDependencies) {}

  async execute(tenantId: string): Promise<{ posted: number; failed: number; total: number }> {
    try {
      // Step 1: Find all sources with auto_post=true
      const autoPostSources = await this.deps.prisma.glSource.findMany({
        where: { tenantId, autoPost: true, isActive: true },
      });

      const sourceCodes = autoPostSources.map((s: any) => s.sourceCode);
      if (sourceCodes.length === 0) {
        logger.debug({ tenantId }, 'No auto-post sources configured');
        return { posted: 0, failed: 0, total: 0 };
      }

      // Step 2: Find DRAFT journal entries for these sources
      const drafts = await this.deps.prisma.journalEntry.findMany({
        where: {
          tenantId,
          status: 'DRAFT',
          source: { in: sourceCodes },
        },
        orderBy: { createdAt: 'asc' },
        take: 100, // Limit batch size
      });

      if (drafts.length === 0) {
        logger.debug({ tenantId, sourceCodes }, 'No DRAFT entries found for auto-post sources');
        return { posted: 0, failed: 0, total: 0 };
      }

      // Step 3: Post each entry through the full pipeline
      let posted = 0;
      let failed = 0;

      for (const entry of drafts) {
        try {
          // Move to PENDING_REVIEW then POSTED
          await this.deps.glService.approveJournalEntry(
            entry.id,
            tenantId as any,
            'AUTO_POST_JOB'
          );
          posted++;
          logger.info({ entryId: entry.id, tenantId }, 'Auto-posted journal entry');
        } catch (err: any) {
          failed++;
          logger.error(
            { entryId: entry.id, tenantId, error: err.message },
            'Auto-post failed for journal entry'
          );
        }
      }

      return { posted, failed, total: drafts.length };
    } catch (err: any) {
      logger.error({ tenantId, error: err.message }, 'Auto-post job execution failed');
      throw err;
    }
  }
}
