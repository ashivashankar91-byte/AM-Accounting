// @trace-cobol komdetail.cbl — INSERT path via JOURNAL_ENTRY_POSTED event
// Event handler: consumes JOURNAL_ENTRY_POSTED from RabbitMQ,
// writes ScheduleDetail if the journal entry is for a scheduled GL account.

import { injectable, inject } from 'tsyringe';
import { Prisma } from '.prisma/schedule-client';
import { SCHEDULE_REPO_TOKEN, SCHEDULE_DETAIL_REPO_TOKEN } from './schedule-service';
import type { IScheduleRepository } from '../infrastructure/schedule-repository';
import type { IScheduleDetailRepository } from '../infrastructure/schedule-detail-repository';

// -----------------------------------------------------------------------
// Event payload published by gl-service after a journal entry is committed
// gl-service includes scheduleNumber (from glAccount.scheduleNumber field)
// @trace-cobol komdetail.cbl INSERT — the eventual-consistency bridge
// -----------------------------------------------------------------------
export interface JournalEntryPostedEvent {
  tenantId: string;
  journalEntryId: string;
  glAccountNumber: string;
  scheduleNumber: string | null;  // null = GL not linked to any schedule
  controlNumber: string;
  amount: string;                 // string repr of Decimal to avoid float loss
  referenceNumber?: string;
  journalSource: string;
  transactionDate: string;        // ISO date string
  description?: string;
}

@injectable()
export class ScheduleEventHandlers {
  constructor(
    @inject(SCHEDULE_REPO_TOKEN) private readonly scheduleRepo: IScheduleRepository,
    @inject(SCHEDULE_DETAIL_REPO_TOKEN) private readonly detailRepo: IScheduleDetailRepository,
  ) {}

  // -----------------------------------------------------------------------
  // Handle JOURNAL_ENTRY_POSTED
  // @trace-cobol komdetail.cbl 30000-INSERT / 33000-WRITE-RECORD
  // If scheduleNumber is null → skip (GL not scheduled)
  // Idempotent: check journalEntryId uniqueness before writing
  // -----------------------------------------------------------------------
  async handleJournalEntryPosted(event: JournalEntryPostedEvent): Promise<void> {
    if (!event.scheduleNumber) return;

    // Verify schedule still exists
    const schedule = await this.scheduleRepo.findById(event.tenantId, event.scheduleNumber);
    if (!schedule) {
      // Schedule may have been deleted after GL was linked — skip silently
      return;
    }

    // Idempotency guard — check if we already processed this journal entry
    const existing = await this.detailRepo.findByJournalEntryId(
      event.tenantId,
      event.journalEntryId,
    );
    if (existing.length > 0) return; // already processed

    await this.detailRepo.create(event.tenantId, {
      scheduleNumber: event.scheduleNumber,
      controlNumber: event.controlNumber,
      amount: new Prisma.Decimal(event.amount),
      referenceNumber: event.referenceNumber,
      journalSource: event.journalSource,
      transactionDate: new Date(event.transactionDate),
      glAccountNumber: event.glAccountNumber,
      description: event.description,
      isBalanceForward: false,
      journalEntryId: event.journalEntryId,
    });
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
