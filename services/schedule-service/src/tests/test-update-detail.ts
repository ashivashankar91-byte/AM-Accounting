/**
 * @test G-03 / G-08a — schedule-service updateDetail and updateDetailApplyNumber
 * @cobol-origin komdetail.cbl REPLACE-DETAIL paragraph; schedup.cbl EDT-DETAIL validations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScheduleApplicationService } from '../application/schedule-service';
import {
  ScheduleDetailNotFoundError,
  ScheduleNotFoundError,
  ScheduleValidationError,
} from '../domain/errors';

// ── Minimal mock factories ───────────────────────────────────────────────────

function makeSchedule(scheduleNumber = '01') {
  return { scheduleNumber, tenantId: 'tenant-test', title: 'Test', scheduleType: 1, eomPurgeType: 1, glAccountNumbers: ['4000'] };
}

function makeDetail(overrides: Partial<any> = {}): any {
  return {
    id: 'detail-1',
    scheduleNumber: '01',
    tenantId: 'tenant-test',
    controlNumber: 'CN100',
    amount: '100.00',
    journalEntryId: null,
    isBalanceForward: false,
    transactionDate: new Date('2026-01-15'),
    applyCd: null,
    applyNumber: null,
    ...overrides,
  };
}

function makeRepos(detailOverrides: Partial<any> = {}, scheduleOverrides: Partial<any> = {}) {
  const scheduleRepo = {
    findById: vi.fn().mockResolvedValue(makeSchedule()),
    ...scheduleOverrides,
  };
  const detailRepo = {
    findById: vi.fn().mockResolvedValue(makeDetail()),
    update: vi.fn().mockImplementation((_tid, _id, dto) => Promise.resolve({ ...makeDetail(), ...dto })),
    ...detailOverrides,
  };
  const permissionRepo = { findByUser: vi.fn().mockResolvedValue([]) };
  const eventPublisher = { publish: vi.fn() };
  return { scheduleRepo, detailRepo, permissionRepo, eventPublisher };
}

// ── G-03: updateDetail — 6 validation guards ────────────────────────────────

describe('ScheduleApplicationService.updateDetail (G-03)', () => {
  it('V-1: throws ScheduleNotFoundError when schedule does not exist', async () => {
    const repos = makeRepos({}, { findById: vi.fn().mockResolvedValue(null) });
    const svc = new ScheduleApplicationService(
      repos.scheduleRepo as any,
      repos.detailRepo as any,
      repos.permissionRepo as any,
      repos.eventPublisher as any,
    );
    await expect(svc.updateDetail('tenant-test', '99', 'detail-1', { description: 'x' }))
      .rejects.toBeInstanceOf(ScheduleNotFoundError);
  });

  it('V-2: throws ScheduleDetailNotFoundError when detail does not belong to named schedule', async () => {
    const repos = makeRepos({ findById: vi.fn().mockResolvedValue(makeDetail({ scheduleNumber: '02' })) });
    const svc = new ScheduleApplicationService(
      repos.scheduleRepo as any,
      repos.detailRepo as any,
      repos.permissionRepo as any,
      repos.eventPublisher as any,
    );
    await expect(svc.updateDetail('tenant-test', '01', 'detail-1', { description: 'x' }))
      .rejects.toBeInstanceOf(ScheduleDetailNotFoundError);
  });

  it('V-3: throws ScheduleValidationError when changing amount on journal-originated detail', async () => {
    const repos = makeRepos({
      findById: vi.fn().mockResolvedValue(makeDetail({ journalEntryId: 'je-abc' })),
    });
    const svc = new ScheduleApplicationService(
      repos.scheduleRepo as any,
      repos.detailRepo as any,
      repos.permissionRepo as any,
      repos.eventPublisher as any,
    );
    await expect(svc.updateDetail('tenant-test', '01', 'detail-1', { amount: '200.00' }))
      .rejects.toBeInstanceOf(ScheduleValidationError);
  });

  it('V-4: throws ScheduleValidationError for invalid journal source code format', async () => {
    const repos = makeRepos();
    const svc = new ScheduleApplicationService(
      repos.scheduleRepo as any,
      repos.detailRepo as any,
      repos.permissionRepo as any,
      repos.eventPublisher as any,
    );
    // Source code too long (>2 chars)
    await expect(svc.updateDetail('tenant-test', '01', 'detail-1', { journalSource: 'ABC' }))
      .rejects.toBeInstanceOf(ScheduleValidationError);
  });

  it('V-5: throws ScheduleValidationError when transactionDate is in the future', async () => {
    const repos = makeRepos();
    const svc = new ScheduleApplicationService(
      repos.scheduleRepo as any,
      repos.detailRepo as any,
      repos.permissionRepo as any,
      repos.eventPublisher as any,
    );
    const futureDate = new Date(Date.now() + 86_400_000 * 30);
    await expect(svc.updateDetail('tenant-test', '01', 'detail-1', { transactionDate: futureDate }))
      .rejects.toBeInstanceOf(ScheduleValidationError);
  });

  it('V-6: throws ScheduleValidationError when updating aging fields on non-balance-forward record', async () => {
    const repos = makeRepos({ findById: vi.fn().mockResolvedValue(makeDetail({ isBalanceForward: false })) });
    const svc = new ScheduleApplicationService(
      repos.scheduleRepo as any,
      repos.detailRepo as any,
      repos.permissionRepo as any,
      repos.eventPublisher as any,
    );
    await expect(svc.updateDetail('tenant-test', '01', 'detail-1', { balanceCurrent: '50.00' }))
      .rejects.toBeInstanceOf(ScheduleValidationError);
  });

  it('Passes validation and calls detailRepo.update for a normal edit', async () => {
    const repos = makeRepos();
    const svc = new ScheduleApplicationService(
      repos.scheduleRepo as any,
      repos.detailRepo as any,
      repos.permissionRepo as any,
      repos.eventPublisher as any,
    );
    const result = await svc.updateDetail('tenant-test', '01', 'detail-1', { description: 'Updated' });
    expect(repos.detailRepo.update).toHaveBeenCalledWith('tenant-test', 'detail-1', { description: 'Updated' });
    expect(result).toBeDefined();
  });

  it('Allows amount update when detail has no journalEntryId', async () => {
    const repos = makeRepos({ findById: vi.fn().mockResolvedValue(makeDetail({ journalEntryId: null })) });
    const svc = new ScheduleApplicationService(
      repos.scheduleRepo as any,
      repos.detailRepo as any,
      repos.permissionRepo as any,
      repos.eventPublisher as any,
    );
    const result = await svc.updateDetail('tenant-test', '01', 'detail-1', { amount: '200.00' });
    expect(repos.detailRepo.update).toHaveBeenCalledWith('tenant-test', 'detail-1', { amount: '200.00' });
    expect(result).toBeDefined();
  });

  it('Allows aging field update on balance-forward records', async () => {
    const repos = makeRepos({ findById: vi.fn().mockResolvedValue(makeDetail({ isBalanceForward: true })) });
    const svc = new ScheduleApplicationService(
      repos.scheduleRepo as any,
      repos.detailRepo as any,
      repos.permissionRepo as any,
      repos.eventPublisher as any,
    );
    await svc.updateDetail('tenant-test', '01', 'detail-1', { balanceCurrent: '50.00', balanceOver30: '25.00' });
    expect(repos.detailRepo.update).toHaveBeenCalledWith(
      'tenant-test', 'detail-1',
      { balanceCurrent: '50.00', balanceOver30: '25.00' },
    );
  });
});

// ── G-08a: updateDetailApplyNumber ──────────────────────────────────────────

describe('ScheduleApplicationService.updateDetailApplyNumber (G-08a)', () => {
  it('sets applyNumber and applyCd on detail record', async () => {
    const repos = makeRepos();
    const svc = new ScheduleApplicationService(
      repos.scheduleRepo as any,
      repos.detailRepo as any,
      repos.permissionRepo as any,
      repos.eventPublisher as any,
    );
    await svc.updateDetailApplyNumber('tenant-test', '01', 'detail-1', 'AP100', 'A');
    expect(repos.detailRepo.update).toHaveBeenCalledWith(
      'tenant-test', 'detail-1', { applyNumber: 'AP100', applyCd: 'A' },
    );
  });

  it('clears applyNumber (set to null)', async () => {
    const repos = makeRepos({ findById: vi.fn().mockResolvedValue(makeDetail({ applyNumber: 'AP100', applyCd: 'A' })) });
    const svc = new ScheduleApplicationService(
      repos.scheduleRepo as any,
      repos.detailRepo as any,
      repos.permissionRepo as any,
      repos.eventPublisher as any,
    );
    await svc.updateDetailApplyNumber('tenant-test', '01', 'detail-1', null, null);
    expect(repos.detailRepo.update).toHaveBeenCalledWith(
      'tenant-test', 'detail-1', { applyNumber: null, applyCd: null },
    );
  });

  it('throws ScheduleDetailNotFoundError when detail not in schedule', async () => {
    const repos = makeRepos({ findById: vi.fn().mockResolvedValue(makeDetail({ scheduleNumber: '99' })) });
    const svc = new ScheduleApplicationService(
      repos.scheduleRepo as any,
      repos.detailRepo as any,
      repos.permissionRepo as any,
      repos.eventPublisher as any,
    );
    await expect(svc.updateDetailApplyNumber('tenant-test', '01', 'detail-1', 'AP100', 'A'))
      .rejects.toBeInstanceOf(ScheduleDetailNotFoundError);
  });
});
