/**
 * @test G-08b — GL_ACCOUNT_SCHEDULE_CHANGED event handler
 * @cobol-origin schedmgr.cbl — migration of schedule detail records when GL account is reassigned
 */

import { describe, it, expect, vi } from 'vitest';
import { ScheduleEventHandlers } from '../application/event-handlers';

function makeScheduleRepo(schedule: any = { scheduleNumber: '01' }) {
  return { findById: vi.fn().mockResolvedValue(schedule) };
}

function makeDetailRepo() {
  return {
    migrateByGLAccount: vi.fn().mockResolvedValue(5),
    findByJournalEntryId: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
  };
}

describe('ScheduleEventHandlers.handleGLAccountScheduleChanged (G-08b)', () => {
  it('migrates detail records from old schedule to new schedule', async () => {
    const scheduleRepo = {
      findById: vi.fn().mockResolvedValue({ scheduleNumber: '01' })
        .mockResolvedValueOnce({ scheduleNumber: '01' })   // old schedule exists
        .mockResolvedValueOnce({ scheduleNumber: '02' }),  // new schedule exists
    };
    const detailRepo = makeDetailRepo();
    const handler = new ScheduleEventHandlers(scheduleRepo as any, detailRepo as any);

    await handler.handleGLAccountScheduleChanged({
      tenantId: 'tenant-test',
      glAccountId: 'acct-uuid',
      glAccountCode: '4000',
      oldScheduleNumber: '01',
      newScheduleNumber: '02',
    });

    expect(detailRepo.migrateByGLAccount).toHaveBeenCalledWith(
      'tenant-test', '4000', '01', '02',
    );
  });

  it('does nothing when oldScheduleNumber is null (GL had no prior schedule)', async () => {
    const scheduleRepo = makeScheduleRepo();
    const detailRepo = makeDetailRepo();
    const handler = new ScheduleEventHandlers(scheduleRepo as any, detailRepo as any);

    await handler.handleGLAccountScheduleChanged({
      tenantId: 'tenant-test',
      glAccountId: 'acct-uuid',
      glAccountCode: '4000',
      oldScheduleNumber: null,
      newScheduleNumber: '02',
    });

    expect(detailRepo.migrateByGLAccount).not.toHaveBeenCalled();
  });

  it('skips migration when old schedule no longer exists (already deleted)', async () => {
    const scheduleRepo = { findById: vi.fn().mockResolvedValue(null) };
    const detailRepo = makeDetailRepo();
    const handler = new ScheduleEventHandlers(scheduleRepo as any, detailRepo as any);

    await handler.handleGLAccountScheduleChanged({
      tenantId: 'tenant-test',
      glAccountId: 'acct-uuid',
      glAccountCode: '4000',
      oldScheduleNumber: '01',
      newScheduleNumber: '02',
    });

    expect(detailRepo.migrateByGLAccount).not.toHaveBeenCalled();
  });

  it('skips migration when new schedule does not exist (logs warning, no throw)', async () => {
    const scheduleRepo = {
      findById: vi.fn()
        .mockResolvedValueOnce({ scheduleNumber: '01' }) // old exists
        .mockResolvedValueOnce(null),                    // new does not exist
    };
    const detailRepo = makeDetailRepo();
    const handler = new ScheduleEventHandlers(scheduleRepo as any, detailRepo as any);

    await handler.handleGLAccountScheduleChanged({
      tenantId: 'tenant-test',
      glAccountId: 'acct-uuid',
      glAccountCode: '4000',
      oldScheduleNumber: '01',
      newScheduleNumber: '99',
    });

    expect(detailRepo.migrateByGLAccount).not.toHaveBeenCalled();
  });

  it('passes null newScheduleNumber through to repo (GL no longer has a schedule)', async () => {
    const scheduleRepo = { findById: vi.fn().mockResolvedValue({ scheduleNumber: '01' }) };
    const detailRepo = makeDetailRepo();
    const handler = new ScheduleEventHandlers(scheduleRepo as any, detailRepo as any);

    await handler.handleGLAccountScheduleChanged({
      tenantId: 'tenant-test',
      glAccountId: 'acct-uuid',
      glAccountCode: '4000',
      oldScheduleNumber: '01',
      newScheduleNumber: null,
    });

    // migrateByGLAccount returns 0 for null target (no-op per implementation)
    expect(detailRepo.migrateByGLAccount).toHaveBeenCalledWith('tenant-test', '4000', '01', null);
  });
});
