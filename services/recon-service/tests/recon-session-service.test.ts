// S054A — application-service unit tests for ReconSessionService, using
// the in-memory fake Prisma client (no database). Covers: idempotent
// session creation, manual + imported statement lines, manual book items,
// adapter-degraded sync (mocked fetch), match/unmatch (never deletes),
// and the conservation-gated completion lock (including the named refusal
// when out of balance).
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { ReconSessionService } from '../src/application/recon-session-service';
import { CashServiceBookItemAdapter, AparServiceBookItemAdapter } from '../src/infrastructure/book-item-source-adapter';
import { ReconOutOfBalanceError, ReconSessionNotOpenError, ReconAlreadyClearedError, ReconNotClearedError } from '../src/domain/recon-session';
import { makeFakePrisma, makeFakeEvents, uuid } from './support/fake-prisma';

function makeService(cashAdapter?: any, aparAdapter?: any) {
  const prisma = makeFakePrisma();
  const events = makeFakeEvents();
  const svc = new ReconSessionService(
    prisma as any,
    events as any,
    cashAdapter ?? new CashServiceBookItemAdapter(),
    aparAdapter ?? new AparServiceBookItemAdapter(),
  );
  return { svc, prisma, events };
}

const TENANT = 'tenant-recon-unit-1';
const ENTITY = 'entity-recon-unit-1';

describe('ReconSessionService', () => {
  it('createSession is idempotent on (tenantId, idempotencyKey)', async () => {
    const { svc } = makeService();
    const key = uuid();
    const dto = {
      tenantId: TENANT, entityId: ENTITY, bankAccountCode: 'OPERATING-001',
      periodStart: '2026-08-01', periodEnd: '2026-08-31',
      statementBeginningBalance: 1000, statementEndingBalance: 2000,
      idempotencyKey: key, actor: 'controller-1',
    };
    const first = await svc.createSession(dto);
    const second = await svc.createSession(dto);
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it('rejects a session where periodStart is after periodEnd', async () => {
    const { svc } = makeService();
    await expect(svc.createSession({
      tenantId: TENANT, entityId: ENTITY, bankAccountCode: 'OPERATING-001',
      periodStart: '2026-08-31', periodEnd: '2026-08-01',
      statementBeginningBalance: 0, statementEndingBalance: 0,
      idempotencyKey: uuid(), actor: 'controller-1',
    })).rejects.toThrow('periodStart must be on or before periodEnd');
  });

  it('adds a manual statement line and an imported batch of statement lines, both while OPEN', async () => {
    const { svc } = makeService();
    const session = await svc.createSession({
      tenantId: TENANT, entityId: ENTITY, bankAccountCode: 'OPERATING-002',
      periodStart: '2026-08-01', periodEnd: '2026-08-31',
      statementBeginningBalance: 0, statementEndingBalance: 500,
      idempotencyKey: uuid(), actor: 'controller-1',
    });
    const manual = await svc.addStatementLine({
      tenantId: TENANT, sessionId: session.id, lineDate: '2026-08-05', description: 'Manual deposit line', amount: 300, source: 'MANUAL', actor: 'controller-1',
    });
    expect(manual.source).toBe('MANUAL');
    expect(manual.status).toBe('UNMATCHED');

    const imported = await svc.importStatementLines({
      tenantId: TENANT, sessionId: session.id, actor: 'controller-1',
      lines: [{ lineDate: '2026-08-10', description: 'Imported fee line', amount: 200 }],
    });
    expect(imported.imported).toBe(1);
    expect(imported.lines[0].source).toBe('IMPORTED');

    const lines = await svc.listStatementLines(TENANT, session.id);
    expect(lines).toHaveLength(2);
  });

  it('rejects adding statement lines or book items once the session is COMPLETED', async () => {
    const { svc } = makeService();
    const session = await svc.createSession({
      tenantId: TENANT, entityId: ENTITY, bankAccountCode: 'OPERATING-003',
      periodStart: '2026-08-01', periodEnd: '2026-08-31',
      statementBeginningBalance: 0, statementEndingBalance: 0,
      idempotencyKey: uuid(), actor: 'controller-1',
    });
    await svc.completeSession(TENANT, session.id, 'controller-1'); // 0 == 0, conservation holds trivially

    await expect(svc.addStatementLine({
      tenantId: TENANT, sessionId: session.id, lineDate: '2026-08-05', description: 'x', amount: 1, source: 'MANUAL', actor: 'controller-1',
    })).rejects.toThrow(ReconSessionNotOpenError);
    await expect(svc.addManualBookItem({
      tenantId: TENANT, sessionId: session.id, itemType: 'NSF', itemDate: '2026-08-05', description: 'x', amount: 1, actor: 'controller-1',
    })).rejects.toThrow(ReconSessionNotOpenError);
  });

  it('adds a manual NSF book item (no source-service model exists for NSF)', async () => {
    const { svc } = makeService();
    const session = await svc.createSession({
      tenantId: TENANT, entityId: ENTITY, bankAccountCode: 'OPERATING-004',
      periodStart: '2026-08-01', periodEnd: '2026-08-31',
      statementBeginningBalance: 0, statementEndingBalance: -50,
      idempotencyKey: uuid(), actor: 'controller-1',
    });
    const item = await svc.addManualBookItem({
      tenantId: TENANT, sessionId: session.id, itemType: 'NSF', itemDate: '2026-08-06', description: 'NSF returned check', amount: -50, actor: 'controller-1',
    });
    expect(item.itemType).toBe('NSF');
    expect(item.sourceService).toBe('MANUAL');
    expect(item.status).toBe('OUTSTANDING');
  });

  it('syncBookItems degrades truthfully to PENDING_SERVICE_INTEGRATION per-category when a source service is unreachable, and creates 0 items — never fabricates data', async () => {
    const unreachableCash = {
      syncDeposits: vi.fn(async () => ({ state: 'PENDING_SERVICE_INTEGRATION', items: [], note: 'cash-service unreachable' })),
      syncSweeps: vi.fn(async () => ({ state: 'PENDING_SERVICE_INTEGRATION', items: [], note: 'cash-service unreachable' })),
      syncSettlementFees: vi.fn(async () => ({ state: 'PENDING_SERVICE_INTEGRATION', items: [], note: 'cash-service unreachable' })),
    };
    const unreachableApar = {
      syncPayments: vi.fn(async () => ({ state: 'PENDING_SERVICE_INTEGRATION', items: [], note: 'apar-service unreachable' })),
    };
    const { svc } = makeService(unreachableCash, unreachableApar);
    const session = await svc.createSession({
      tenantId: TENANT, entityId: ENTITY, bankAccountCode: 'OPERATING-005',
      periodStart: '2026-08-01', periodEnd: '2026-08-31',
      statementBeginningBalance: 0, statementEndingBalance: 0,
      idempotencyKey: uuid(), actor: 'controller-1',
    });
    const result = await svc.syncBookItems(TENANT, session.id, 'controller-1');
    expect(result.CASH_SERVICE_DEPOSITS.state).toBe('PENDING_SERVICE_INTEGRATION');
    expect(result.CASH_SERVICE_DEPOSITS.created).toBe(0);
    expect(result.APAR_SERVICE_PAYMENTS.state).toBe('PENDING_SERVICE_INTEGRATION');
    expect(result.APAR_SERVICE_PAYMENTS.created).toBe(0);

    const items = await svc.listBookItems(TENANT, session.id);
    expect(items).toHaveLength(0);
  });

  it('syncBookItems creates book items idempotently (a second sync of the same source items creates 0 more)', async () => {
    const reachableCash = {
      syncDeposits: vi.fn(async () => ({
        state: 'OK', note: 'ok',
        items: [{ itemType: 'DEPOSIT', sourceId: 'dep-1', itemDate: '2026-08-05', description: 'Deposit 1', amount: '100.00' }],
      })),
      syncSweeps: vi.fn(async () => ({ state: 'OK', items: [], note: 'ok' })),
      syncSettlementFees: vi.fn(async () => ({ state: 'OK', items: [], note: 'ok' })),
    };
    const noPayments = { syncPayments: vi.fn(async () => ({ state: 'OK', items: [], note: 'ok' })) };
    const { svc } = makeService(reachableCash, noPayments);
    const session = await svc.createSession({
      tenantId: TENANT, entityId: ENTITY, bankAccountCode: 'OPERATING-006',
      periodStart: '2026-08-01', periodEnd: '2026-08-31',
      statementBeginningBalance: 0, statementEndingBalance: 100,
      idempotencyKey: uuid(), actor: 'controller-1',
    });
    const first = await svc.syncBookItems(TENANT, session.id, 'controller-1');
    expect(first.CASH_SERVICE_DEPOSITS.created).toBe(1);
    const second = await svc.syncBookItems(TENANT, session.id, 'controller-1');
    expect(second.CASH_SERVICE_DEPOSITS.created).toBe(0); // idempotent — same sourceId, no duplicate

    const items = await svc.listBookItems(TENANT, session.id);
    expect(items).toHaveLength(1);
  });

  it('matches a statement line to a book item — both flip to CLEARED and reference each other; neither is deleted', async () => {
    const { svc, prisma } = makeService();
    const session = await svc.createSession({
      tenantId: TENANT, entityId: ENTITY, bankAccountCode: 'OPERATING-007',
      periodStart: '2026-08-01', periodEnd: '2026-08-31',
      statementBeginningBalance: 0, statementEndingBalance: 100,
      idempotencyKey: uuid(), actor: 'controller-1',
    });
    const line = await svc.addStatementLine({
      tenantId: TENANT, sessionId: session.id, lineDate: '2026-08-05', description: 'Deposit', amount: 100, source: 'MANUAL', actor: 'controller-1',
    });
    const item = await svc.addManualBookItem({
      tenantId: TENANT, sessionId: session.id, itemType: 'DEPOSIT', itemDate: '2026-08-05', description: 'Deposit book item', amount: 100, actor: 'controller-1',
    });

    const result = await svc.matchLine({ tenantId: TENANT, sessionId: session.id, statementLineId: line.id, bookItemId: item.id, actor: 'controller-1' });
    expect(result.statementLine.status).toBe('CLEARED');
    expect(result.statementLine.clearedBookItemId).toBe(item.id);
    expect(result.bookItem.status).toBe('CLEARED');
    expect(result.bookItem.clearedStatementLineId).toBe(line.id);

    // Never deleted — both rows still present.
    expect(prisma._tables.reconStatementLine._rows).toHaveLength(1);
    expect(prisma._tables.reconBookItem._rows).toHaveLength(1);
  });

  it('rejects matching an already-CLEARED line or item', async () => {
    const { svc } = makeService();
    const session = await svc.createSession({
      tenantId: TENANT, entityId: ENTITY, bankAccountCode: 'OPERATING-008',
      periodStart: '2026-08-01', periodEnd: '2026-08-31',
      statementBeginningBalance: 0, statementEndingBalance: 200,
      idempotencyKey: uuid(), actor: 'controller-1',
    });
    const line = await svc.addStatementLine({ tenantId: TENANT, sessionId: session.id, lineDate: '2026-08-05', description: 'D', amount: 100, source: 'MANUAL', actor: 'controller-1' });
    const item1 = await svc.addManualBookItem({ tenantId: TENANT, sessionId: session.id, itemType: 'DEPOSIT', itemDate: '2026-08-05', description: 'D1', amount: 100, actor: 'controller-1' });
    const item2 = await svc.addManualBookItem({ tenantId: TENANT, sessionId: session.id, itemType: 'DEPOSIT', itemDate: '2026-08-05', description: 'D2', amount: 100, actor: 'controller-1' });
    await svc.matchLine({ tenantId: TENANT, sessionId: session.id, statementLineId: line.id, bookItemId: item1.id, actor: 'controller-1' });

    await expect(svc.matchLine({ tenantId: TENANT, sessionId: session.id, statementLineId: line.id, bookItemId: item2.id, actor: 'controller-1' }))
      .rejects.toThrow(ReconAlreadyClearedError);
  });

  it('unmatch reverts both sides to their pre-match status without deleting either row, and rejects unmatching a never-cleared line', async () => {
    const { svc, prisma } = makeService();
    const session = await svc.createSession({
      tenantId: TENANT, entityId: ENTITY, bankAccountCode: 'OPERATING-009',
      periodStart: '2026-08-01', periodEnd: '2026-08-31',
      statementBeginningBalance: 0, statementEndingBalance: 100,
      idempotencyKey: uuid(), actor: 'controller-1',
    });
    const line = await svc.addStatementLine({ tenantId: TENANT, sessionId: session.id, lineDate: '2026-08-05', description: 'D', amount: 100, source: 'MANUAL', actor: 'controller-1' });
    const item = await svc.addManualBookItem({ tenantId: TENANT, sessionId: session.id, itemType: 'DEPOSIT', itemDate: '2026-08-05', description: 'D', amount: 100, actor: 'controller-1' });
    await svc.matchLine({ tenantId: TENANT, sessionId: session.id, statementLineId: line.id, bookItemId: item.id, actor: 'controller-1' });

    await expect(svc.unmatchLine({ tenantId: TENANT, sessionId: session.id, statementLineId: 'nonexistent-line-should-404-not-unmatch', reason: 'x', actor: 'controller-1' }))
      .rejects.toThrow();

    const reverted = await svc.unmatchLine({ tenantId: TENANT, sessionId: session.id, statementLineId: line.id, reason: 'wrong match', actor: 'controller-1' });
    expect(reverted.status).toBe('UNMATCHED');
    expect(reverted.clearedBookItemId).toBeNull();

    const items = await svc.listBookItems(TENANT, session.id);
    expect(items[0].status).toBe('OUTSTANDING');
    expect(items[0].clearedStatementLineId).toBeNull();

    // Never deleted.
    expect(prisma._tables.reconStatementLine._rows).toHaveLength(1);
    expect(prisma._tables.reconBookItem._rows).toHaveLength(1);

    await expect(svc.unmatchLine({ tenantId: TENANT, sessionId: session.id, statementLineId: line.id, reason: 'again', actor: 'controller-1' }))
      .rejects.toThrow(ReconNotClearedError);
  });

  it('completeSession is idempotent, and refuses (named ReconOutOfBalanceError) when cleared+outstanding != statement ending balance', async () => {
    const { svc } = makeService();
    const session = await svc.createSession({
      tenantId: TENANT, entityId: ENTITY, bankAccountCode: 'OPERATING-010',
      periodStart: '2026-08-01', periodEnd: '2026-08-31',
      statementBeginningBalance: 0, statementEndingBalance: 100,
      idempotencyKey: uuid(), actor: 'controller-1',
    });
    // No book items yet -> 0 + 0 != 100 -> refused.
    await expect(svc.completeSession(TENANT, session.id, 'controller-1')).rejects.toThrow(ReconOutOfBalanceError);

    await svc.addManualBookItem({ tenantId: TENANT, sessionId: session.id, itemType: 'DEPOSIT', itemDate: '2026-08-05', description: 'D', amount: 100, actor: 'controller-1' });
    const completed = await svc.completeSession(TENANT, session.id, 'controller-1');
    expect(completed.status).toBe('COMPLETED');
    expect(completed.idempotent).toBe(false);

    const again = await svc.completeSession(TENANT, session.id, 'controller-1');
    expect(again.idempotent).toBe(true);
  });

  it('completion math is identical whether a book item is CLEARED (matched) or OUTSTANDING (unmatched) — both contribute to the sum', async () => {
    const { svc } = makeService();
    const session = await svc.createSession({
      tenantId: TENANT, entityId: ENTITY, bankAccountCode: 'OPERATING-011',
      periodStart: '2026-08-01', periodEnd: '2026-08-31',
      statementBeginningBalance: 0, statementEndingBalance: 300,
      idempotencyKey: uuid(), actor: 'controller-1',
    });
    const line = await svc.addStatementLine({ tenantId: TENANT, sessionId: session.id, lineDate: '2026-08-05', description: 'D', amount: 100, source: 'MANUAL', actor: 'controller-1' });
    const clearedItem = await svc.addManualBookItem({ tenantId: TENANT, sessionId: session.id, itemType: 'DEPOSIT', itemDate: '2026-08-05', description: 'Cleared', amount: 100, actor: 'controller-1' });
    await svc.addManualBookItem({ tenantId: TENANT, sessionId: session.id, itemType: 'DEPOSIT', itemDate: '2026-08-05', description: 'Outstanding', amount: 200, actor: 'controller-1' });
    await svc.matchLine({ tenantId: TENANT, sessionId: session.id, statementLineId: line.id, bookItemId: clearedItem.id, actor: 'controller-1' });

    const completed = await svc.completeSession(TENANT, session.id, 'controller-1');
    expect(completed.status).toBe('COMPLETED'); // 100 (cleared) + 200 (outstanding) = 300
  });
});
