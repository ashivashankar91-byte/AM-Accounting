/**
 * @file test-audit-service.ts
 * @coverage fix(integration) Gap 4 — payroll audit inquiry, aggregating
 * real persisted OutboxEvent (PAYROLL_BATCH_POSTED/REVERSED source events,
 * carrying batchId/journalEntryId linkage) and PayrollSensitiveReadAudit
 * evidence. Proves filters and that no evidence is invented.
 */
import { describe, it, expect, vi } from 'vitest';
import { PayrollAuditService } from '../application/audit-service';

function makePrisma(overrides: { outbox?: any[]; reads?: any[] } = {}) {
  return {
    outboxEvent: { findMany: vi.fn().mockResolvedValue(overrides.outbox ?? []) },
    payrollSensitiveReadAudit: { findMany: vi.fn().mockResolvedValue(overrides.reads ?? []) },
  };
}

describe('PayrollAuditService', () => {
  it('returns real posted/reversed source-event evidence with journal linkage carried by the event itself', async () => {
    const prisma = makePrisma({
      outbox: [
        { id: 'evt-1', eventType: 'PAYROLL_BATCH_POSTED', createdAt: new Date('2026-08-01T00:00:00Z'), payload: { batchId: 'batch-1', journalEntryId: 'je-1', actor: 'poster-1' } },
      ],
    });
    const svc = new PayrollAuditService(prisma as any);
    const result = await svc.query('tenant-test' as any, {});
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('SOURCE_EVENT');
    expect(result[0].journalEntryId).toBe('je-1');
    expect(result[0].batchId).toBe('batch-1');
  });

  it('filters by batchId', async () => {
    const prisma = makePrisma({
      outbox: [
        { id: 'evt-1', eventType: 'PAYROLL_BATCH_POSTED', createdAt: new Date('2026-08-01T00:00:00Z'), payload: { batchId: 'batch-1' } },
        { id: 'evt-2', eventType: 'PAYROLL_BATCH_POSTED', createdAt: new Date('2026-08-02T00:00:00Z'), payload: { batchId: 'batch-2' } },
      ],
    });
    const svc = new PayrollAuditService(prisma as any);
    const result = await svc.query('tenant-test' as any, { batchId: 'batch-2' });
    expect(result).toHaveLength(1);
    expect(result[0].batchId).toBe('batch-2');
  });

  it('includes reversal linkage (reversalOfBatchId) from the real reversal event payload', async () => {
    const prisma = makePrisma({
      outbox: [
        { id: 'evt-2', eventType: 'PAYROLL_BATCH_REVERSED', createdAt: new Date('2026-08-02T00:00:00Z'), payload: { batchId: 'batch-1', reversalOfBatchId: 'batch-1', journalEntryId: 'je-2' } },
      ],
    });
    const svc = new PayrollAuditService(prisma as any);
    const result = await svc.query('tenant-test' as any, { action: 'PAYROLL_BATCH_REVERSED' });
    expect(result[0].reversalOfBatchId).toBe('batch-1');
  });

  it('includes sensitive-read audit evidence, filterable by employeeId', async () => {
    const prisma = makePrisma({
      reads: [{ id: 'read-1', employeeId: 'emp-1', readByUserId: 'user-1', surface: 'employee-detail', readAt: new Date('2026-08-01T00:00:00Z') }],
    });
    const svc = new PayrollAuditService(prisma as any);
    const result = await svc.query('tenant-test' as any, { employeeId: 'emp-1' });
    expect(result.some((r) => r.kind === 'SENSITIVE_READ' && r.employeeId === 'emp-1')).toBe(true);
  });

  it('never fabricates an employeeId on a batch-level source event (source events carry no employee-level detail)', async () => {
    const prisma = makePrisma({
      outbox: [{ id: 'evt-1', eventType: 'PAYROLL_BATCH_POSTED', createdAt: new Date(), payload: { batchId: 'batch-1' } }],
    });
    const svc = new PayrollAuditService(prisma as any);
    const result = await svc.query('tenant-test' as any, { employeeId: 'emp-1' });
    // filtering by employeeId excludes batch-level source events entirely rather than guessing a match
    expect(result.find((r) => r.kind === 'SOURCE_EVENT')).toBeUndefined();
  });

  // fix(integration) — audits the two highest-consequence configuration
  // mutations (statutory-source-mode change, rule-pack activation).
  it('surfaces a real PAYROLL_SOURCE_MODE_CHANGED configuration-change event', async () => {
    const prisma = makePrisma({
      outbox: [{ id: 'evt-cfg-1', eventType: 'PAYROLL_SOURCE_MODE_CHANGED', createdAt: new Date('2026-08-01T00:00:00Z'), payload: { previousMode: 'NOT_CONFIGURED', newMode: 'MANUAL_ATTESTED', actor: 'controller-1' } }],
    });
    const svc = new PayrollAuditService(prisma as any);
    const result = await svc.query('tenant-test' as any, {});
    expect(result[0].action).toBe('PAYROLL_SOURCE_MODE_CHANGED');
    expect(result[0].actor).toBe('controller-1');
  });

  it('surfaces a real PAYROLL_RULE_PACK_ACTIVATED configuration-change event', async () => {
    const prisma = makePrisma({
      outbox: [{ id: 'evt-cfg-2', eventType: 'PAYROLL_RULE_PACK_ACTIVATED', createdAt: new Date('2026-08-01T00:00:00Z'), payload: { versionId: 'v1', packKey: 'k', author: 'author-1', activatedBy: 'activator-1' } }],
    });
    const svc = new PayrollAuditService(prisma as any);
    const result = await svc.query('tenant-test' as any, { action: 'PAYROLL_RULE_PACK_ACTIVATED' });
    expect(result[0].evidence).toMatchObject({ packKey: 'k', author: 'author-1', activatedBy: 'activator-1' });
  });
});
