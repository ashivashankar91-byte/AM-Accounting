// @trace-cobol komdetail.cbl — INSERT path via JOURNAL_ENTRY_POSTED event
// Event handler: consumes JOURNAL_ENTRY_POSTED from RabbitMQ,
// writes ScheduleDetail if the journal entry is for a scheduled GL account.

import { injectable, inject } from 'tsyringe';
import { SCHEDULE_REPO_TOKEN, SCHEDULE_DETAIL_REPO_TOKEN } from './schedule-service';
import type { IScheduleRepository } from '../infrastructure/schedule-repository';
import type { IScheduleDetailRepository } from '../infrastructure/schedule-detail-repository';
import { OpenItemService, JournalEntryPostedEvent } from './open-item-service';

export type { JournalEntryPostedEvent };

@injectable()
export class ScheduleEventHandlers {
  constructor(
    @inject(SCHEDULE_REPO_TOKEN) private readonly scheduleRepo: IScheduleRepository,
    @inject(SCHEDULE_DETAIL_REPO_TOKEN) private readonly detailRepo: IScheduleDetailRepository,
    private readonly openItemService: OpenItemService,
  ) {}

  // -----------------------------------------------------------------------
  // Handle JOURNAL_ENTRY_POSTED
  // @trace-cobol komdetail.cbl 30000-INSERT / 33000-WRITE-RECORD
  // @wave S026 — delegates to OpenItemService.processPostingEvent(), which
  // atomically writes the ScheduleDetail row AND the corresponding
  // open-item-or-application row in one SERIALIZABLE transaction, keyed by
  // the event's own correlationId for per-line idempotency. This replaces
  // the old journalEntryId-only dedup, which silently dropped a second
  // schedule-relevant line on the same journal entry.
  // -----------------------------------------------------------------------
  async handleJournalEntryPosted(event: JournalEntryPostedEvent, correlationId: string): Promise<void> {
    if (!event.scheduleNumber) return;
    const outcome = await this.openItemService.processPostingEvent(event.tenantId, event, correlationId);
    if (outcome === 'SKIPPED_SCHEDULE_NOT_FOUND') {
      console.warn(
        `[schedule-service] JOURNAL_ENTRY_POSTED for unknown schedule ${event.scheduleNumber} (tenant ${event.tenantId}, entry ${event.journalEntryId}) — skipped.`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Handle GL_ACCOUNT_SCHEDULE_CHANGED
  // @trace-cobol schedmgr.cbl — when a GL account's schedule assignment changes,
  //   migrate all existing ScheduleDetail records from the old schedule to the new one.
  // Published by gl-service.updateAccount() when scheduleCode field changes.
  // -----------------------------------------------------------------------

  /**
   * Payload published by gl-service in the outbox when `scheduleCode` changes on a GL account.
   */
  async handleGLAccountScheduleChanged(event: {
    tenantId: string;
    glAccountId: string;
    glAccountCode: string;
    oldScheduleNumber: string | null;
    newScheduleNumber: string | null;
  }): Promise<void> {
    const { tenantId, glAccountCode, oldScheduleNumber, newScheduleNumber } = event;

    // Nothing to migrate if there was no prior schedule assignment
    if (!oldScheduleNumber) return;

    // Verify old schedule still exists (may have been deleted)
    const oldSchedule = await this.scheduleRepo.findById(tenantId, oldScheduleNumber);
    if (!oldSchedule) return;

    if (newScheduleNumber) {
      // Verify target schedule exists before migrating
      const newSchedule = await this.scheduleRepo.findById(tenantId, newScheduleNumber);
      if (!newSchedule) {
        console.warn(
          `[schedule-service] GL_ACCOUNT_SCHEDULE_CHANGED: target schedule ${newScheduleNumber} not found for GL ${glAccountCode} (tenant ${tenantId}). Migration skipped.`,
        );
        return;
      }
    }

    const migrated = await this.detailRepo.migrateByGLAccount(
      tenantId,
      glAccountCode,
      oldScheduleNumber,
      newScheduleNumber,
    );

    if (migrated > 0) {
      console.info(
        `[schedule-service] Migrated ${migrated} ScheduleDetail records for GL ${glAccountCode} from schedule ${oldScheduleNumber} → ${newScheduleNumber ?? '(none)'} (tenant ${tenantId}).`,
      );
    }
  }
}
