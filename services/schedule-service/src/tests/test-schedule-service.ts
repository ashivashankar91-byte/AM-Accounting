/**
 * @test-suite ScheduleApplicationService — Schedule Sub-System (Wave 3)
 *
 * @cobol-ancestry
 *   schedup.cbl   — Schedule master CRUD + GL orchestration
 *   komdetail.cbl — Schedule detail CRUD (file-pipe protocol)
 *   schedmgr.cbl  — GL linkage management
 *   schedprn.cbl  — Report generation
 *   schedsec.cbl  — Per-user security
 *
 * @proves
 *   - Create schedule with valid type/purge combinations succeeds
 *   - Create schedule with invalid purge code for type throws InvalidPurgeCodeError
 *   - Create schedule with multiple GL accounts on type 2/4/5 throws MultipleAccountsNotAllowedError
 *   - Create schedule with duplicate GL accounts throws DuplicateGlAccountError
 *   - Create schedule with blank title throws ScheduleValidationError
 *   - Update schedule with incompatible type change throws IncompatibleTypeChangeError
 *   - Update schedule with compatible type change (2→4) succeeds
 *   - Delete schedule cascades detail deletion and publishes SCHEDULE_DELETED event
 *   - Purge type 1 creates balance-forward record and deletes originals
 *   - Purge type 2 deletes records dated on/before closeDate
 *   - Purge type 3 deletes control numbers where SUM(amount) = 0
 *   - Purge type 5 deletes apply-to entries where SUM(amount) = 0
 *   - Purge type 7 deletes all records
 *   - Report generation returns DETAIL format with lines
 *   - Report generation returns SUMMARY format (no lines)
 *   - Report date warning when latest transaction > cutoff
 *   - Permission canUserAccess returns true/false from repository
 *   - replaceUserAccess replaces all permissions atomically
 *   - JOURNAL_ENTRY_POSTED event handler creates detail when scheduleNumber non-null
 *   - JOURNAL_ENTRY_POSTED event handler no-ops when scheduleNumber is null
 *   - Get schedule — not found throws ScheduleNotFoundError
 *   - List details with filter passes filters to repository
 *   - Delete single detail — not found throws ScheduleDetailNotFoundError
 *   - Preview purge returns summary without mutations
 *   - Security check: canAccess returns false for denied user
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '.prisma/schedule-client';
import {
  ScheduleApplicationService,
} from '../application/schedule-service';
import {
  ScheduleNotFoundError,
  ScheduleDetailNotFoundError,
  ScheduleValidationError,
  IncompatibleTypeChangeError,
  InvalidPurgeCodeError,
  DuplicateGlAccountError,
  MultipleAccountsNotAllowedError,
} from '../domain/errors';
import { ScheduleEventHandlers } from '../application/event-handlers';

// ── Helpers ───────────────────────────────────────────────────────────────────

function dec(n: number | string) {
  return new Prisma.Decimal(n);
}

function makeSchedule(overrides: Partial<any> = {}): any {
  return {
    id: 'sch-01',
    tenantId: 'tenant-acme',
    scheduleNumber: '01',
    title: 'Accounts Receivable',
    reportSequence: 'C',
    scheduleType: 1,
    glAccountNumbers: ['1200'],
    eomPurgeType: 1,
    controlNameDisplay: '',
    ...overrides,
  };
}

function makeDetail(overrides: Partial<any> = {}): any {
  return {
    id: 'det-001',
    tenantId: 'tenant-acme',
    scheduleNumber: '01',
    controlNumber: 'CTRL001',
    amount: dec('100.00'),
    referenceNumber: null,
    journalSource: 'AJ',
    transactionDate: new Date('2025-03-15'),
    glAccountNumber: '1200',
    description: null,
    isBalanceForward: false,
    balanceCurrent: null,
    balanceOver30: null,
    balanceOver60: null,
    balanceOver90: null,
    applyNumber: null,
    applyCd: null,
    journalEntryId: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// ── Mock factories ─────────────────────────────────────────────────────────────

function makeScheduleRepo(overrides: Partial<any> = {}) {
  return {
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation((_t, dto) => Promise.resolve(makeSchedule(dto))),
    update: vi.fn().mockImplementation((_t, _n, dto) => Promise.resolve(makeSchedule(dto))),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeDetailRepo(overrides: Partial<any> = {}) {
  return {
    create: vi.fn().mockImplementation((_t, dto) => Promise.resolve(makeDetail(dto))),
    findById: vi.fn().mockResolvedValue(null),
    findBySchedule: vi.fn().mockResolvedValue([]),
    findByControlNumber: vi.fn().mockResolvedValue([]),
    findByJournalEntryId: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockImplementation((_t, id, dto) => Promise.resolve(makeDetail({ id, ...dto }))),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteBySchedule: vi.fn().mockResolvedValue(0),
    deleteByControlNumber: vi.fn().mockResolvedValue(0),
    deleteByApplyNumber: vi.fn().mockResolvedValue(0),
    deleteByScheduleBeforeDate: vi.fn().mockResolvedValue(0),
    summarizeByControlNumber: vi.fn().mockResolvedValue([]),
    summarizeByApplyNumber: vi.fn().mockResolvedValue([]),
    countBySchedule: vi.fn().mockResolvedValue(0),
    countPurgeable: vi.fn().mockResolvedValue(0),
    findLatestTransactionDate: vi.fn().mockResolvedValue(null),
    migrateByGLAccount: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

function makePermissionRepo(overrides: Partial<any> = {}) {
  return {
    canUserAccess: vi.fn().mockResolvedValue(false),
    getUserAccessMap: vi.fn().mockResolvedValue({}),
    replaceUserAccess: vi.fn().mockResolvedValue(undefined),
    deleteUserAccess: vi.fn().mockResolvedValue(undefined),
    listUsersWithAccess: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeEventPublisher() {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function makeSvc(scheduleRepo?: any, detailRepo?: any, permRepo?: any, eventPub?: any) {
  return new ScheduleApplicationService(
    scheduleRepo ?? makeScheduleRepo(),
    detailRepo ?? makeDetailRepo(),
    permRepo ?? makePermissionRepo(),
    eventPub ?? makeEventPublisher(),
  );
}

const TENANT = 'tenant-acme';

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ScheduleApplicationService — Schedule CRUD', () => {
  it('creates a schedule with valid type 1 and purge code 1', async () => {
    const repo = makeScheduleRepo({ create: vi.fn().mockResolvedValue(makeSchedule()) });
    const svc = makeSvc(repo);
    await expect(
      svc.createSchedule(TENANT, {
        scheduleNumber: '01',
        title: 'AR Aging',
        scheduleType: 1,
        glAccountNumbers: ['1200'],
        eomPurgeType: 1,
      } as any),
    ).resolves.toBeDefined();
    expect(repo.create).toHaveBeenCalledOnce();
  });

  it('throws InvalidPurgeCodeError for type 1 with purge code 2', async () => {
    const svc = makeSvc();
    await expect(
      svc.createSchedule(TENANT, {
        scheduleNumber: '01',
        title: 'AR',
        scheduleType: 1,
        glAccountNumbers: ['1200'],
        eomPurgeType: 2,
      } as any),
    ).rejects.toBeInstanceOf(InvalidPurgeCodeError);
  });

  it('throws MultipleAccountsNotAllowedError for type 2 with 2 GL accounts', async () => {
    const svc = makeSvc();
    await expect(
      svc.createSchedule(TENANT, {
        scheduleNumber: '02',
        title: 'Floor Plan',
        scheduleType: 2,
        glAccountNumbers: ['2100', '2200'],
        eomPurgeType: 2,
      } as any),
    ).rejects.toBeInstanceOf(MultipleAccountsNotAllowedError);
  });

  it('throws DuplicateGlAccountError for duplicate GL accounts', async () => {
    const svc = makeSvc();
    await expect(
      svc.createSchedule(TENANT, {
        scheduleNumber: '01',
        title: 'AR',
        scheduleType: 1,
        glAccountNumbers: ['1200', '1200'],
        eomPurgeType: 1,
      } as any),
    ).rejects.toBeInstanceOf(DuplicateGlAccountError);
  });

  it('throws ScheduleValidationError for blank title', async () => {
    const svc = makeSvc();
    await expect(
      svc.createSchedule(TENANT, {
        scheduleNumber: '01',
        title: '   ',
        scheduleType: 1,
        glAccountNumbers: ['1200'],
        eomPurgeType: 1,
      } as any),
    ).rejects.toBeInstanceOf(ScheduleValidationError);
  });

  it('throws IncompatibleTypeChangeError for type 1 → 2 change', async () => {
    const repo = makeScheduleRepo({ findById: vi.fn().mockResolvedValue(makeSchedule({ scheduleType: 1 })) });
    const svc = makeSvc(repo);
    await expect(
      svc.updateSchedule(TENANT, '01', { scheduleType: 2 } as any),
    ).rejects.toBeInstanceOf(IncompatibleTypeChangeError);
  });

  it('allows compatible type change 2 → 4', async () => {
    const repo = makeScheduleRepo({
      findById: vi.fn().mockResolvedValue(makeSchedule({ scheduleType: 2, glAccountNumbers: ['2100'] })),
      update: vi.fn().mockResolvedValue(makeSchedule({ scheduleType: 4 })),
    });
    const svc = makeSvc(repo);
    await expect(
      svc.updateSchedule(TENANT, '01', { scheduleType: 4 } as any),
    ).resolves.toBeDefined();
  });

  it('throws ScheduleNotFoundError for missing schedule', async () => {
    const svc = makeSvc();
    await expect(svc.getSchedule(TENANT, '99')).rejects.toBeInstanceOf(ScheduleNotFoundError);
  });

  it('delete cascades detail deletion and publishes SCHEDULE_DELETED', async () => {
    const existing = makeSchedule({ glAccountNumbers: ['1200'] });
    const schedRepo = makeScheduleRepo({
      findById: vi.fn().mockResolvedValue(existing),
      delete: vi.fn().mockResolvedValue(undefined),
    });
    const detRepo = makeDetailRepo({ deleteBySchedule: vi.fn().mockResolvedValue(5) });
    const eventPub = makeEventPublisher();
    const svc = makeSvc(schedRepo, detRepo, undefined, eventPub);
    await svc.deleteSchedule(TENANT, '01');
    expect(detRepo.deleteBySchedule).toHaveBeenCalledWith(TENANT, '01');
    expect(eventPub.publish).toHaveBeenCalledWith('SCHEDULE_DELETED', expect.objectContaining({ scheduleNumber: '01' }));
  });
});

describe('ScheduleApplicationService — Purge', () => {
  it('purge type 1 creates one balance-forward per (controlNumber, glAccountNumber) combination', async () => {
    const closeDate = new Date('2025-03-31');
    // 3 detail records: 2 GL accounts for CTRL001, 1 GL account for CTRL002
    const details = [
      makeDetail({ controlNumber: 'CTRL001', glAccountNumber: '1200', amount: dec('100.00') }),
      makeDetail({ id: 'det-002', controlNumber: 'CTRL001', glAccountNumber: '1300', amount: dec('200.00') }),
      makeDetail({ id: 'det-003', controlNumber: 'CTRL002', glAccountNumber: '1200', amount: dec('50.00') }),
    ];
    const schedRepo = makeScheduleRepo({
      findAll: vi.fn().mockResolvedValue([makeSchedule({ eomPurgeType: 1 })]),
    });
    const detRepo = makeDetailRepo({
      findBySchedule: vi.fn().mockResolvedValue(details),
      create: vi.fn().mockResolvedValue(makeDetail({ isBalanceForward: true })),
      deleteByScheduleBeforeDate: vi.fn().mockResolvedValue(3),
    });
    const svc = makeSvc(schedRepo, detRepo);
    const summary = await svc.purgeAll({ tenantId: TENANT, closeDate, eomCloseId: 'close-1' });
    // Must create 3 BF records (one per distinct key), NOT 2 (one per control number)
    expect(detRepo.create).toHaveBeenCalledTimes(3);
    expect(summary.balanceForwardsCreated).toBe(3);
  });

  it('purge type 1 creates balance-forward and deletes originals', async () => {
    const closeDate = new Date('2025-03-31');
    const details = [
      makeDetail({ controlNumber: 'CTRL001', amount: dec('100.00'), transactionDate: new Date('2025-03-10') }),
      makeDetail({ id: 'det-002', controlNumber: 'CTRL001', amount: dec('50.00'), transactionDate: new Date('2025-03-20') }),
    ];
    const schedRepo = makeScheduleRepo({
      findAll: vi.fn().mockResolvedValue([makeSchedule({ eomPurgeType: 1 })]),
    });
    const detRepo = makeDetailRepo({
      findBySchedule: vi.fn().mockResolvedValue(details),
      create: vi.fn().mockResolvedValue(makeDetail({ isBalanceForward: true })),
      deleteByScheduleBeforeDate: vi.fn().mockResolvedValue(2),
    });
    const svc = makeSvc(schedRepo, detRepo);
    const summary = await svc.purgeAll({ tenantId: TENANT, closeDate, eomCloseId: 'close-1' });
    expect(detRepo.create).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ isBalanceForward: true, controlNumber: 'CTRL001' }),
    );
    expect(detRepo.deleteByScheduleBeforeDate).toHaveBeenCalledWith(TENANT, '01', closeDate, false);
    expect(summary.balanceForwardsCreated).toBe(1);
  });

  it('purge type 2 deletes records before closeDate', async () => {
    const closeDate = new Date('2025-03-31');
    const details = [makeDetail(), makeDetail({ id: 'det-002' })];
    const schedRepo = makeScheduleRepo({
      findAll: vi.fn().mockResolvedValue([makeSchedule({ eomPurgeType: 2 })]),
    });
    const detRepo = makeDetailRepo({
      findBySchedule: vi.fn().mockResolvedValue(details),
      deleteByScheduleBeforeDate: vi.fn().mockResolvedValue(2),
    });
    const svc = makeSvc(schedRepo, detRepo);
    const summary = await svc.purgeAll({ tenantId: TENANT, closeDate, eomCloseId: 'close-1' });
    expect(detRepo.deleteByScheduleBeforeDate).toHaveBeenCalledWith(TENANT, '01', closeDate, true);
    expect(summary.detailsDeleted).toBe(2);
  });

  it('purge type 3 deletes control numbers with zero balance', async () => {
    const schedRepo = makeScheduleRepo({
      findAll: vi.fn().mockResolvedValue([makeSchedule({ eomPurgeType: 3 })]),
    });
    const detRepo = makeDetailRepo({
      summarizeByControlNumber: vi.fn().mockResolvedValue([
        { controlNumber: 'CTRL001', totalAmount: '0.00', transactionCount: 2 },
        { controlNumber: 'CTRL002', totalAmount: '50.00', transactionCount: 1 },
      ]),
      deleteByControlNumber: vi.fn().mockResolvedValue(2),
    });
    const svc = makeSvc(schedRepo, detRepo);
    await svc.purgeAll({ tenantId: TENANT, closeDate: new Date(), eomCloseId: 'c' });
    expect(detRepo.deleteByControlNumber).toHaveBeenCalledWith(TENANT, '01', 'CTRL001');
    expect(detRepo.deleteByControlNumber).not.toHaveBeenCalledWith(TENANT, '01', 'CTRL002');
  });

  it('purge type 5 deletes apply-to entries with zero balance', async () => {
    const schedRepo = makeScheduleRepo({
      findAll: vi.fn().mockResolvedValue([makeSchedule({ eomPurgeType: 5, glAccountNumbers: ['2100'] })]),
    });
    const detRepo = makeDetailRepo({
      summarizeByApplyNumber: vi.fn().mockResolvedValue([
        { applyNumber: 'INV001', totalAmount: '0.00', transactionCount: 2 },
        { applyNumber: 'INV002', totalAmount: '200.00', transactionCount: 1 },
      ]),
      deleteByApplyNumber: vi.fn().mockResolvedValue(2),
    });
    const svc = makeSvc(schedRepo, detRepo);
    await svc.purgeAll({ tenantId: TENANT, closeDate: new Date(), eomCloseId: 'c' });
    expect(detRepo.deleteByApplyNumber).toHaveBeenCalledWith(TENANT, '01', 'INV001');
    expect(detRepo.deleteByApplyNumber).not.toHaveBeenCalledWith(TENANT, '01', 'INV002');
  });

  it('purge type 7 deletes all records', async () => {
    const schedRepo = makeScheduleRepo({
      findAll: vi.fn().mockResolvedValue([makeSchedule({ eomPurgeType: 7 })]),
    });
    const detRepo = makeDetailRepo({
      countBySchedule: vi.fn().mockResolvedValue(15),
      deleteBySchedule: vi.fn().mockResolvedValue(15),
    });
    const svc = makeSvc(schedRepo, detRepo);
    const summary = await svc.purgeAll({ tenantId: TENANT, closeDate: new Date(), eomCloseId: 'c' });
    expect(detRepo.deleteBySchedule).toHaveBeenCalledWith(TENANT, '01');
    expect(summary.detailsDeleted).toBe(15);
  });

  it('previewPurge returns per-schedule breakdown without mutations', async () => {
    const schedules = [
      makeSchedule({ scheduleNumber: '01', title: 'AR', eomPurgeType: 1 }),
      makeSchedule({ scheduleNumber: '02', title: 'Floor Plan', eomPurgeType: 2, glAccountNumbers: ['2100'] }),
    ];
    // Type 1: 2 details across 2 (controlNumber, glAccountNumber) combos → 2 BF records to create
    const type1Details = [
      makeDetail({ controlNumber: 'CTRL001', glAccountNumber: '1200' }),
      makeDetail({ id: 'det-002', controlNumber: 'CTRL001', glAccountNumber: '1300' }),
    ];
    const schedRepo = makeScheduleRepo({ findAll: vi.fn().mockResolvedValue(schedules) });
    const detRepo = makeDetailRepo({
      findBySchedule: vi.fn().mockResolvedValue(type1Details),
      countPurgeable: vi.fn().mockResolvedValue(5), // for type 2
    });
    const svc = makeSvc(schedRepo, detRepo);
    const summary = await svc.previewPurge(TENANT, new Date());
    // No mutations
    expect(detRepo.deleteBySchedule).not.toHaveBeenCalled();
    expect(detRepo.deleteByScheduleBeforeDate).not.toHaveBeenCalled();
    expect(detRepo.create).not.toHaveBeenCalled();
    // Breakdown present
    expect(summary.preview).toHaveLength(2);
    const type1Entry = summary.preview!.find((p) => p.scheduleNumber === '01');
    expect(type1Entry?.recordsToDelete).toBe(2);
    expect(type1Entry?.balanceForwardsToCreate).toBe(2); // 2 distinct (ctrl, gl) keys
    expect(type1Entry?.netRecordChange).toBe(0);
    const type2Entry = summary.preview!.find((p) => p.scheduleNumber === '02');
    expect(type2Entry?.recordsToDelete).toBe(5);
    expect(type2Entry?.balanceForwardsToCreate).toBe(0);
    expect(type2Entry?.netRecordChange).toBe(-5);
  });
});

describe('ScheduleApplicationService — Report', () => {
  it('generates DETAIL report with lines', async () => {
    const detail = makeDetail();
    const schedRepo = makeScheduleRepo({
      findAll: vi.fn().mockResolvedValue([makeSchedule()]),
    });
    const detRepo = makeDetailRepo({
      findBySchedule: vi.fn().mockResolvedValue([detail]),
      findLatestTransactionDate: vi.fn().mockResolvedValue(new Date('2025-03-15')),
    });
    const permRepo = makePermissionRepo({ canUserAccess: vi.fn().mockResolvedValue(true) });
    const svc = makeSvc(schedRepo, detRepo, permRepo);
    const report = await svc.generateReport({
      tenantId: TENANT, userId: 'user1', format: 'DETAIL',
      includeZeroBalance: true, cutoffDate: new Date('2025-03-31'),
    });
    expect(report.sections).toHaveLength(1);
    expect(report.sections[0].lines).toHaveLength(1);
  });

  it('generates SUMMARY report with no lines', async () => {
    const schedRepo = makeScheduleRepo({
      findAll: vi.fn().mockResolvedValue([makeSchedule()]),
    });
    const detRepo = makeDetailRepo({
      findBySchedule: vi.fn().mockResolvedValue([makeDetail()]),
      findLatestTransactionDate: vi.fn().mockResolvedValue(null),
    });
    const permRepo = makePermissionRepo({ canUserAccess: vi.fn().mockResolvedValue(true) });
    const svc = makeSvc(schedRepo, detRepo, permRepo);
    const report = await svc.generateReport({
      tenantId: TENANT, userId: 'user1', format: 'SUMMARY',
      includeZeroBalance: true, cutoffDate: new Date('2025-03-31'),
    });
    expect(report.sections[0].lines).toHaveLength(0);
    expect(report.sections[0].controlTotals).toHaveLength(1);
  });

  it('sets hasDateWarning when latest transaction is after cutoffDate', async () => {
    const cutoff = new Date('2025-02-28');
    const latest = new Date('2025-03-15');
    const schedRepo = makeScheduleRepo({
      findAll: vi.fn().mockResolvedValue([makeSchedule()]),
    });
    const detRepo = makeDetailRepo({
      findBySchedule: vi.fn().mockResolvedValue([makeDetail({ transactionDate: latest })]),
      findLatestTransactionDate: vi.fn().mockResolvedValue(latest),
    });
    const permRepo = makePermissionRepo({ canUserAccess: vi.fn().mockResolvedValue(true) });
    const svc = makeSvc(schedRepo, detRepo, permRepo);
    const report = await svc.generateReport({
      tenantId: TENANT, userId: 'user1', format: 'SUMMARY',
      includeZeroBalance: true, cutoffDate: cutoff,
    });
    expect(report.sections[0].hasDateWarning).toBe(true);
  });
});

describe('ScheduleApplicationService — Security', () => {
  it('canUserAccess returns false for denied user', async () => {
    const permRepo = makePermissionRepo({ canUserAccess: vi.fn().mockResolvedValue(false) });
    const svc = makeSvc(undefined, undefined, permRepo);
    const result = await svc.checkUserAccess(TENANT, 'user1', '01');
    expect(result).toBe(false);
  });

  it('replaceUserAccess delegates to repo atomically', async () => {
    const permRepo = makePermissionRepo({ replaceUserAccess: vi.fn().mockResolvedValue(undefined) });
    const svc = makeSvc(undefined, undefined, permRepo);
    await svc.setUserPermissions(TENANT, 'user1', { '01': true, '02': false });
    expect(permRepo.replaceUserAccess).toHaveBeenCalledWith(
      TENANT, 'user1', { '01': true, '02': false },
    );
  });
});

describe('ScheduleEventHandlers — JOURNAL_ENTRY_POSTED', () => {
  const baseEvent = {
    tenantId: TENANT,
    journalEntryId: 'je-001',
    glAccountNumber: '1200',
    scheduleNumber: '01',
    controlNumber: 'CTRL001',
    amount: '150.00',
    journalSource: 'AJ',
    transactionDate: '2025-03-15T00:00:00.000Z',
  };

  it('creates detail when scheduleNumber is non-null', async () => {
    const schedRepo = makeScheduleRepo({ findById: vi.fn().mockResolvedValue(makeSchedule()) });
    const detRepo = makeDetailRepo({ findByJournalEntryId: vi.fn().mockResolvedValue([]) });
    const handler = new ScheduleEventHandlers(schedRepo, detRepo);
    await handler.handleJournalEntryPosted(baseEvent);
    expect(detRepo.create).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ journalEntryId: 'je-001', scheduleNumber: '01' }),
    );
  });

  it('no-ops when scheduleNumber is null', async () => {
    const detRepo = makeDetailRepo();
    const handler = new ScheduleEventHandlers(makeScheduleRepo(), detRepo);
    await handler.handleJournalEntryPosted({ ...baseEvent, scheduleNumber: null });
    expect(detRepo.create).not.toHaveBeenCalled();
  });

  it('is idempotent — skips duplicate journalEntryId', async () => {
    const schedRepo = makeScheduleRepo({ findById: vi.fn().mockResolvedValue(makeSchedule()) });
    const detRepo = makeDetailRepo({
      findByJournalEntryId: vi.fn().mockResolvedValue([makeDetail()]),
    });
    const handler = new ScheduleEventHandlers(schedRepo, detRepo);
    await handler.handleJournalEntryPosted(baseEvent);
    expect(detRepo.create).not.toHaveBeenCalled();
  });

  it('no-ops when schedule no longer exists', async () => {
    const schedRepo = makeScheduleRepo({ findById: vi.fn().mockResolvedValue(null) });
    const detRepo = makeDetailRepo();
    const handler = new ScheduleEventHandlers(schedRepo, detRepo);
    await handler.handleJournalEntryPosted(baseEvent);
    expect(detRepo.create).not.toHaveBeenCalled();
  });
});

describe('ScheduleApplicationService — Detail CRUD', () => {
  it('listDetails passes filters to repository', async () => {
    const schedRepo = makeScheduleRepo({ findById: vi.fn().mockResolvedValue(makeSchedule()) });
    const detRepo = makeDetailRepo({ findBySchedule: vi.fn().mockResolvedValue([]) });
    const svc = makeSvc(schedRepo, detRepo);
    const filters = { controlNumber: 'CTRL001', includeBalanceForward: false };
    await svc.listDetails(TENANT, '01', filters as any);
    expect(detRepo.findBySchedule).toHaveBeenCalledWith(TENANT, '01', filters);
  });

  it('deleteDetail throws ScheduleDetailNotFoundError when detail not on schedule', async () => {
    const schedRepo = makeScheduleRepo({ findById: vi.fn().mockResolvedValue(makeSchedule()) });
    const detRepo = makeDetailRepo({
      findById: vi.fn().mockResolvedValue(makeDetail({ scheduleNumber: '02' })),
    });
    const svc = makeSvc(schedRepo, detRepo);
    await expect(svc.deleteDetail(TENANT, '01', 'det-001')).rejects.toBeInstanceOf(
      ScheduleDetailNotFoundError,
    );
  });
});
