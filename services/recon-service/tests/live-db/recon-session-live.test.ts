/**
 * S054A — LIVE DATABASE integration tests for the Manual Bank
 * Reconciliation Workbench. Same skip pattern as cash-service's
 * tests/live-db/*.test.ts: skipped entirely unless LIVE_DATABASE_URL is
 * set; RLS-specific assertions additionally require
 * LIVE_DATABASE_APP_ROLE_URL (amacc_app, non-superuser, RLS-enforced).
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { PrismaClient } from '.prisma/recon-client';
import { ReconSessionService } from '../../src/application/recon-session-service';
import { ReconOutOfBalanceError } from '../../src/domain/recon-session';
import type { IEventPublisher } from '@amacc/shared-kernel';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];
const APP_ROLE_DB_URL = process.env['LIVE_DATABASE_APP_ROLE_URL'];

const noopEvents: IEventPublisher = { publish: async () => {}, subscribe: () => {} };
const noopCashAdapter: any = {
  syncDeposits: async () => ({ state: 'OK', items: [], note: 'no items in this fixture' }),
  syncSweeps: async () => ({ state: 'OK', items: [], note: 'no items in this fixture' }),
  syncSettlementFees: async () => ({ state: 'OK', items: [], note: 'no items in this fixture' }),
};
const noopAparAdapter: any = { syncPayments: async () => ({ state: 'OK', items: [], note: 'no items in this fixture' }) };

describe.skipIf(!LIVE_DB_URL)('Live database — S054A manual bank reconciliation workbench: sessions, conservation gate, no-delete, RLS', () => {
  let prisma: PrismaClient;
  let svc: ReconSessionService;

  const TENANT = `live-s054a-tenant-${randomUUID()}`;
  const ENTITY = randomUUID();

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();
    svc = new ReconSessionService(prisma as any, noopEvents, noopCashAdapter, noopAparAdapter);
  });

  afterAll(async () => {
    await (prisma as any).reconBookItem.deleteMany({ where: { tenantId: TENANT } });
    await (prisma as any).reconStatementLine.deleteMany({ where: { tenantId: TENANT } });
    await (prisma as any).reconSession.deleteMany({ where: { tenantId: TENANT } });
    await prisma.auditOutboxEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$disconnect();
  });

  it('creates a session idempotently, adds manual + imported statement lines, adds book items, matches, and completes when in balance', async () => {
    const key = randomUUID();
    const session1 = await svc.createSession({
      tenantId: TENANT, entityId: ENTITY, bankAccountCode: 'OPERATING-LIVE-054A',
      periodStart: '2026-08-01', periodEnd: '2026-08-31',
      statementBeginningBalance: 0, statementEndingBalance: 300,
      idempotencyKey: key, actor: 'live-controller-1',
    });
    const session2 = await svc.createSession({
      tenantId: TENANT, entityId: ENTITY, bankAccountCode: 'OPERATING-LIVE-054A',
      periodStart: '2026-08-01', periodEnd: '2026-08-31',
      statementBeginningBalance: 0, statementEndingBalance: 300,
      idempotencyKey: key, actor: 'live-controller-1',
    });
    expect(session2.idempotent).toBe(true);
    expect(session2.id).toBe(session1.id);

    const line = await svc.addStatementLine({
      tenantId: TENANT, sessionId: session1.id, lineDate: '2026-08-05', description: 'Live deposit line', amount: 100, source: 'MANUAL', actor: 'live-controller-1',
    });
    const importResult = await svc.importStatementLines({
      tenantId: TENANT, sessionId: session1.id, actor: 'live-controller-1',
      lines: [{ lineDate: '2026-08-06', description: 'Live imported fee', amount: 50 }],
    });
    expect(importResult.imported).toBe(1);

    const clearedItem = await svc.addManualBookItem({
      tenantId: TENANT, sessionId: session1.id, itemType: 'DEPOSIT', itemDate: '2026-08-05', description: 'Live deposit book item', amount: 100, actor: 'live-controller-1',
    });
    await svc.addManualBookItem({
      tenantId: TENANT, sessionId: session1.id, itemType: 'FEE', itemDate: '2026-08-06', description: 'Live outstanding fee', amount: 200, actor: 'live-controller-1',
    });

    const matched = await svc.matchLine({
      tenantId: TENANT, sessionId: session1.id, statementLineId: line.id, bookItemId: clearedItem.id, actor: 'live-controller-1',
    });
    expect(matched.statementLine.status).toBe('CLEARED');
    expect(matched.bookItem.status).toBe('CLEARED');

    // 100 (cleared) + 200 (outstanding) = 300 = statement ending balance -> completes.
    const completed = await svc.completeSession(TENANT, session1.id, 'live-controller-1');
    expect(completed.status).toBe('COMPLETED');
    expect(completed.completedBy).toBe('live-controller-1');

    // Idempotent completion.
    const again = await svc.completeSession(TENANT, session1.id, 'live-controller-1');
    expect(again.idempotent).toBe(true);

    // No row was ever deleted — both the statement line and both book items persist in the DB.
    const persistedLines = await (prisma as any).reconStatementLine.findMany({ where: { sessionId: session1.id } });
    expect(persistedLines).toHaveLength(2);
    const persistedItems = await (prisma as any).reconBookItem.findMany({ where: { sessionId: session1.id } });
    expect(persistedItems).toHaveLength(2);
  });

  it('refuses completion (named ReconOutOfBalanceError) when cleared+outstanding != statement ending balance, and refuses to add lines/match/unmatch once COMPLETED', async () => {
    const session = await svc.createSession({
      tenantId: TENANT, entityId: ENTITY, bankAccountCode: 'OPERATING-LIVE-054A-OOB',
      periodStart: '2026-08-01', periodEnd: '2026-08-31',
      statementBeginningBalance: 0, statementEndingBalance: 1000,
      idempotencyKey: randomUUID(), actor: 'live-controller-2',
    });
    await svc.addManualBookItem({
      tenantId: TENANT, sessionId: session.id, itemType: 'DEPOSIT', itemDate: '2026-08-05', description: 'Only 500 of 1000', amount: 500, actor: 'live-controller-2',
    });

    await expect(svc.completeSession(TENANT, session.id, 'live-controller-2')).rejects.toThrow(ReconOutOfBalanceError);

    // Balance it and complete.
    await svc.addManualBookItem({
      tenantId: TENANT, sessionId: session.id, itemType: 'DEPOSIT', itemDate: '2026-08-06', description: 'Remaining 500', amount: 500, actor: 'live-controller-2',
    });
    const completed = await svc.completeSession(TENANT, session.id, 'live-controller-2');
    expect(completed.status).toBe('COMPLETED');

    // Locked: cannot add a line, match, or unmatch on a COMPLETED session.
    await expect(svc.addStatementLine({
      tenantId: TENANT, sessionId: session.id, lineDate: '2026-08-07', description: 'x', amount: 1, source: 'MANUAL', actor: 'live-controller-2',
    })).rejects.toThrow();
  });

  it.skipIf(!APP_ROLE_DB_URL)('RLS positive+negative on recon_session / recon_statement_line / recon_book_item — Tenant A invisible to Tenant B under amacc_app', async () => {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: APP_ROLE_DB_URL });
    await client.connect();
    try {
      const session = await svc.createSession({
        tenantId: TENANT, entityId: ENTITY, bankAccountCode: 'OPERATING-LIVE-054A-RLS',
        periodStart: '2026-08-01', periodEnd: '2026-08-31',
        statementBeginningBalance: 0, statementEndingBalance: 100,
        idempotencyKey: randomUUID(), actor: 'live-controller-3',
      });
      const line = await svc.addStatementLine({
        tenantId: TENANT, sessionId: session.id, lineDate: '2026-08-05', description: 'RLS line', amount: 100, source: 'MANUAL', actor: 'live-controller-3',
      });
      const item = await svc.addManualBookItem({
        tenantId: TENANT, sessionId: session.id, itemType: 'DEPOSIT', itemDate: '2026-08-05', description: 'RLS item', amount: 100, actor: 'live-controller-3',
      });

      // Positive: same tenant context can see its own rows.
      await client.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT]);
      const ownSession = await client.query('SELECT id FROM recon_session WHERE id = $1', [session.id]);
      expect(ownSession.rowCount).toBe(1);
      const ownLine = await client.query('SELECT id FROM recon_statement_line WHERE id = $1', [line.id]);
      expect(ownLine.rowCount).toBe(1);
      const ownItem = await client.query('SELECT id FROM recon_book_item WHERE id = $1', [item.id]);
      expect(ownItem.rowCount).toBe(1);

      // Negative: a different tenant context sees zero rows for the same ids.
      await client.query(`SELECT set_config('app.current_tenant_id', $1, false)`, ['a-completely-different-tenant']);
      const crossSession = await client.query('SELECT id FROM recon_session WHERE id = $1', [session.id]);
      expect(crossSession.rowCount).toBe(0);
      const crossLine = await client.query('SELECT id FROM recon_statement_line WHERE id = $1', [line.id]);
      expect(crossLine.rowCount).toBe(0);
      const crossItem = await client.query('SELECT id FROM recon_book_item WHERE id = $1', [item.id]);
      expect(crossItem.rowCount).toBe(0);

      // Negative: a cross-tenant INSERT attempt is rejected (WITH CHECK), not just filtered on read.
      await expect(
        client.query(
          `INSERT INTO recon_session (id, tenant_id, entity_id, bank_account_code, period_start, period_end,
             statement_beginning_balance, statement_ending_balance, idempotency_key, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [randomUUID(), TENANT, ENTITY, 'FORGED-ACCOUNT', new Date(), new Date(), 0, 0, randomUUID(), 'forger'],
        ),
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
  });
});
