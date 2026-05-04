// @trace-cobol schedup.cbl, komdetail.cbl, schedmgr.cbl
// Domain errors for the Schedule sub-system

export class ScheduleNotFoundError extends Error {
  constructor(scheduleNumber: string) {
    super(`Schedule not found: ${scheduleNumber}`);
    this.name = 'ScheduleNotFoundError';
  }
}

export class ScheduleDetailNotFoundError extends Error {
  constructor(detailId: string) {
    super(`Schedule detail not found: ${detailId}`);
    this.name = 'ScheduleDetailNotFoundError';
  }
}

// @trace-cobol schedup.cbl EDT-SCHEDUP-SD-TITLE "ERR: Schedule Name required."
export class ScheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleValidationError';
  }
}

// @trace-cobol schedmgr.cbl 3000-FAILURE — incompatible type change
export class IncompatibleTypeChangeError extends Error {
  constructor(fromType: number, toType: number) {
    super(
      `Schedule type change from ${fromType} to ${toType} is not allowed. ` +
        'Data conversion requires programmer intervention.',
    );
    this.name = 'IncompatibleTypeChangeError';
  }
}

// @trace-cobol schedup.cbl C56357 — invalid purge code for type
export class InvalidPurgeCodeError extends Error {
  constructor(scheduleType: number, purgeCode: number) {
    super(`EOM purge code ${purgeCode} is not valid for schedule type ${scheduleType}`);
    this.name = 'InvalidPurgeCodeError';
  }
}

// @trace-cobol schedup.cbl — duplicate GL accounts
export class DuplicateGlAccountError extends Error {
  constructor(acctNo: string) {
    super(`Cannot save schedule with duplicate account numbers: ${acctNo}`);
    this.name = 'DuplicateGlAccountError';
  }
}

// @trace-cobol schedup.cbl — multiple accounts on single-account types
export class MultipleAccountsNotAllowedError extends Error {
  constructor(scheduleType: number) {
    super(
      `Multiple account numbers only allowed on schedule types 1 & 3. ` +
        `Schedule type ${scheduleType} allows only one account.`,
    );
    this.name = 'MultipleAccountsNotAllowedError';
  }
}

// @trace-cobol schedup.cbl EDT-SCHEDUP-SD-TITLE — no accounts
export class NoAccountsError extends Error {
  constructor() {
    super('Cannot save schedule with no account numbers.');
    this.name = 'NoAccountsError';
  }
}

// @trace-cobol komdetail.cbl L22002 — record lock timeout
export class RecordLockError extends Error {
  readonly scheduleNumber: string;
  constructor(scheduleNumber: string) {
    super(`Schedule detail record is locked for schedule ${scheduleNumber}`);
    this.name = 'RecordLockError';
    this.scheduleNumber = scheduleNumber;
  }
}

// @trace-cobol schedprn.cbl — user does not have schedule access
export class ScheduleAccessDeniedError extends Error {
  constructor(userId: string, scheduleNumber: string) {
    super(`User ${userId} does not have access to schedule ${scheduleNumber}`);
    this.name = 'ScheduleAccessDeniedError';
  }
}

// EOM purge still has pending events in the outbox
// @trace-cobol wave-3-schedule-subsystem.md note 3 — ACCT_100 prerequisite check
export class PendingEventsError extends Error {
  constructor(tenantId: string) {
    super(
      `Cannot purge schedules for tenant ${tenantId}: pending JOURNAL_ENTRY_POSTED events have not been processed. Retry after event queue is empty.`,
    );
    this.name = 'PendingEventsError';
  }
}
