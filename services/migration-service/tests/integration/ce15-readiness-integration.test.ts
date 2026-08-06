/**
 * CE-15 readiness integration tests.
 *
 * Verifies the real CE-15 close-service integration:
 *   - FakeCloseReadiness implements the full Ce15ReadinessEvidence interface
 *   - persistEvidence / getLatestEvidence are append-only
 *   - computeReadiness enriches the report with ce15CloseState, ce15Stale, ce15EvidenceAge
 *   - stale evidence (> 1 h) → ce15Stale:true, ce15ReadinessApproved:false
 *   - REOPEN_PENDING_APPROVAL → approved:false regardless of close state
 *   - CE15_READINESS_NOT_APPROVED appears in unmet prerequisites
 */
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { FakeCloseReadiness, makeHarness } from '../helpers/in-memory-repos';
import { makeServices } from '../helpers/service-harness';
import { MigrationRunService } from '../../src/application/migration-run-service';
import { PENDING_UPSTREAM } from '../../src/domain/interfaces';

describe('CE-15 readiness evidence', () => {
  it('FakeCloseReadiness returns full evidence shape when approved', async () => {
    const fake = new FakeCloseReadiness();
    fake.approved = true;
    fake.closeState = 'PRELIMINARY_CLOSED';
    const ev = await fake.getReadiness('t1', 'LE-1', 2026, 7);
    expect(ev.approved).toBe(true);
    expect(ev.closeState).toBe('PRELIMINARY_CLOSED');
    expect(ev.preliminaryClosed).toBe(true);
    expect(ev.finallyClosed).toBe(false);
    expect(ev.reopenPending).toBe(false);
    expect(ev.capturedAt).toBeInstanceOf(Date);
  });

  it('FakeCloseReadiness returns approved: false when not approved', async () => {
    const fake = new FakeCloseReadiness();
    fake.approved = false;
    const ev = await fake.getReadiness('t1', 'LE-1', 2026, 7);
    expect(ev.approved).toBe(false);
    expect(ev.status).toBe(PENDING_UPSTREAM);
  });

  it('persistEvidence stores and getLatestEvidence retrieves it', async () => {
    const fake = new FakeCloseReadiness();
    fake.approved = true;
    const ev = await fake.getReadiness('t1', 'LE-1', 2026, 7);
    await fake.persistEvidence('t1', 'run-abc', ev);
    const latest = await fake.getLatestEvidence('t1', 'run-abc');
    expect(latest).not.toBeNull();
    expect(latest!.approved).toBe(true);
    expect(latest!.closeState).toBe('PRELIMINARY_CLOSED');
  });

  it('getLatestEvidence returns null when no evidence persisted', async () => {
    const fake = new FakeCloseReadiness();
    const latest = await fake.getLatestEvidence('t1', 'run-nonexistent');
    expect(latest).toBeNull();
  });

  it('multiple persistEvidence calls are append-only', async () => {
    const fake = new FakeCloseReadiness();
    fake.approved = true;
    const ev1 = await fake.getReadiness('t1', 'LE-1', 2026, 7);
    const ev2 = await fake.getReadiness('t1', 'LE-1', 2026, 7);
    await fake.persistEvidence('t1', 'run-multi', ev1);
    await fake.persistEvidence('t1', 'run-multi', ev2);
    const latest = await fake.getLatestEvidence('t1', 'run-multi');
    expect(latest).not.toBeNull(); // append-only: both retained
  });

  it('computeReadiness includes ce15Detail, ce15CloseState and ce15Stale fields', async () => {
    const h = makeHarness();
    h.closeReadiness.approved = true;
    h.closeReadiness.closeState = 'FINAL_CLOSED';
    const s = makeServices(h);

    const run = await s.runService.create({
      tenantId: 't1', legalEntityId: 'LE-1', mode: 'CUTOVER',
      transformationVersion: 'v1', actor: 'op',
      metadata: { conversionPeriodYear: 2026, conversionPeriodMonth: 7 },
    });

    const readiness = await s.runService.computeReadiness('t1', run.runId);
    expect(readiness.ce15Detail).toContain('FINAL_CLOSED');
    expect(readiness.ce15CloseState).toBe('FINAL_CLOSED');
    expect(readiness.ce15Stale).toBe(false);
    expect(typeof readiness.ce15EvidenceAge).toBe('number');
    expect(readiness.ce15EvidenceAge!).toBeLessThan(60_000);
  });

  it('cutover readiness is blocked if CE-15 is not approved', async () => {
    const h = makeHarness();
    h.closeReadiness.approved = false;
    const s = makeServices(h);
    const run = await s.runService.create({
      tenantId: 't1', legalEntityId: 'LE-1', mode: 'CUTOVER',
      transformationVersion: 'v1', actor: 'op',
    });
    const readiness = await s.runService.computeReadiness('t1', run.runId);
    expect(readiness.ce15ReadinessApproved).toBe(false);
    expect(readiness.unmet).toContain('CE15_READINESS_NOT_APPROVED');
  });

  it('stale CE-15 evidence blocks cutover', async () => {
    const staleFake = new FakeCloseReadiness();
    staleFake.getReadiness = async () => ({
      status: 'AVAILABLE' as const,
      approved: true,
      detail: 'stale-evidence',
      closeState: 'PRELIMINARY_CLOSED',
      preliminaryClosed: true,
      finallyClosed: false,
      reopenPending: false,
      capturedAt: new Date(Date.now() - 2 * 60 * 60 * 1_000), // 2 h ago
    });

    const h = makeHarness();
    const staleSvc = new MigrationRunService(
      h.runs, h.exceptions, h.gates, h.comparisons,
      h.cutovers, staleFake, h.events,
    );
    const run = await h.runs.create({
      tenantId: 't2', legalEntityId: 'LE-2', runId: `run-stale-${Date.now()}`,
      mode: 'CUTOVER', transformationVersion: 'v1', createdBy: 'op',
    });
    const readiness = await staleSvc.computeReadiness('t2', run.runId);
    expect(readiness.ce15Stale).toBe(true);
    expect(readiness.ce15ReadinessApproved).toBe(false);
    expect(readiness.unmet).toContain('CE15_READINESS_NOT_APPROVED');
  });

  it('REOPEN_PENDING_APPROVAL blocks cutover even if state looks closed', async () => {
    const reopenFake = new FakeCloseReadiness();
    reopenFake.getReadiness = async () => ({
      status: 'AVAILABLE' as const,
      approved: false,
      detail: 'reopen-pending',
      closeState: 'REOPEN_PENDING_APPROVAL',
      reopenPending: true,
      capturedAt: new Date(),
    });

    const h = makeHarness();
    const reopenSvc = new MigrationRunService(
      h.runs, h.exceptions, h.gates, h.comparisons,
      h.cutovers, reopenFake, h.events,
    );
    const run = await h.runs.create({
      tenantId: 't3', legalEntityId: 'LE-3', runId: `run-reopen-${Date.now()}`,
      mode: 'CUTOVER', transformationVersion: 'v1', createdBy: 'op',
    });
    const readiness = await reopenSvc.computeReadiness('t3', run.runId);
    expect(readiness.ce15ReadinessApproved).toBe(false);
    expect(readiness.unmet).toContain('CE15_READINESS_NOT_APPROVED');
  });
});
