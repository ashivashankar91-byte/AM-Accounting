/**
 * S054B — LIVE DATABASE integration tests for the Rule-Based Bank
 * Auto-Match engine. Skipped entirely unless LIVE_DATABASE_URL is set;
 * RLS-specific assertions additionally require LIVE_DATABASE_APP_ROLE_URL
 * (amacc_app, non-superuser, RLS-enforced).
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { PrismaClient } from '.prisma/recon-client';
import { ReconSessionService } from '../../src/application/recon-session-service';
import { AutoMatchService } from '../../src/application/auto-match-service';
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

describe.skipIf(!LIVE_DB_URL)('Live database — S054B rule-based bank auto-match: rule attribution, ambiguity-safety, RLS', () => {
  let prisma: PrismaClient;
  let sessionSvc: ReconSessionService;
  let autoMatch: AutoMatchService;

  const TENANT = `live-s054b-tenant-${randomUUID()}`;
  const ENTITY = randomUUID();

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();
    sessionSvc = new ReconSessionService(prisma as any, noopEvents, noopCashAdapter, noopAparAdapter);
    autoMatch = new AutoMatchService(prisma as any, sessionSvc);
  });

  afterAll(async () => {
    await (prisma as any).reconMatchSuggestion.deleteMany({ where: { tenantId: { startsWith: TENANT } } });
    await (prisma as any).reconMatchRule.deleteMany({ where: { tenantId: { startsWith: TENANT } } });
    await (prisma as any).reconBookItem.deleteMany({ where: { tenantId: { startsWith: TENANT } } });
    await (prisma as any).reconStatementLine.deleteMany({ where: { tenantId: { startsWith: TENANT } } });
    await (prisma as any).reconSession.deleteMany({ where: { tenantId: { startsWith: TENANT } } });
    await prisma.auditOutboxEvent.deleteMany({ where: { tenantId: { startsWith: TENANT } } });
    await prisma.$disconnect();
  });

  it('runs a real auto-match: unambiguous EXACT match auto-clears with rule attribution; ambiguous candidates become suggestions only; confirming a suggestion clears it and completion succeeds when in balance', async () => {
    const tenant = `${TENANT}-flow`;
    const rule = await autoMatch.createRule({
      tenantId: tenant, ruleType: 'AMOUNT_DATE_WINDOW', tier: 'EXACT',
      config: { amountToleranceCents: 0, dateWindowDays: 0 }, actor: 'live-controller-1',
    });

    const session = await sessionSvc.createSession({
      tenantId: tenant, entityId: ENTITY, bankAccountCode: 'OPERATING-LIVE-054B',
      periodStart: '2026-08-01', periodEnd: '2026-08-31',
      statementBeginningBalance: 0, statementEndingBalance: 200,
      idempotencyKey: randomUUID(), actor: 'live-controller-1',
    });

    // Unambiguous pair -> auto-clear.
    await sessionSvc.addStatementLine({ tenantId: tenant, sessionId: session.id, lineDate: '2026-08-05', description: 'Auto', amount: 100, source: 'IMPORTED', actor: 'live-controller-1' });
    await sessionSvc.addManualBookItem({ tenantId: tenant, sessionId: session.id, itemType: 'DEPOSIT', itemDate: '2026-08-05', description: 'Auto item', amount: 100, actor: 'live-controller-1' });

    // Ambiguous pair (two candidates, identical amount/date) -> suggestions only, never auto-cleared.
    await sessionSvc.addStatementLine({ tenantId: tenant, sessionId: session.id, lineDate: '2026-08-06', description: 'Ambiguous', amount: 50, source: 'IMPORTED', actor: 'live-controller-1' });
    await sessionSvc.addManualBookItem({ tenantId: tenant, sessionId: session.id, itemType: 'FEE', itemDate: '2026-08-06', description: 'Candidate A', amount: 50, actor: 'live-controller-1' });
    await sessionSvc.addManualBookItem({ tenantId: tenant, sessionId: session.id, itemType: 'FEE', itemDate: '2026-08-06', description: 'Candidate B', amount: 50, actor: 'live-controller-1' });

    const result = await autoMatch.runAutoMatch(tenant, session.id, 'auto-match-runner');
    expect(result.autoCleared).toBe(1);
    expect(result.suggested).toBe(2);

    const lines = await sessionSvc.listStatementLines(tenant, session.id);
    const autoLine = lines.find((l: any) => l.description === 'Auto')!;
    expect(autoLine.status).toBe('CLEARED');
    expect(autoLine.matchRuleId).toBe(rule.id);
    const ambiguousLine = lines.find((l: any) => l.description === 'Ambiguous')!;
    expect(ambiguousLine.status).toBe('UNMATCHED'); // AC: ambiguous candidates never auto-cleared

    const suggestions = await autoMatch.listSuggestions(tenant, session.id);
    expect(suggestions).toHaveLength(2);

    // Confirm one suggestion, reject the other — leaving the session in balance to complete.
    const confirmed = await autoMatch.confirmSuggestion(tenant, session.id, suggestions[0].id, 'reviewer-1');
    expect(confirmed.statementLine.status).toBe('CLEARED');
    expect(confirmed.statementLine.matchRuleId).toBe(rule.id);
    await autoMatch.rejectSuggestion(tenant, session.id, suggestions[1].id, 'reviewer-1');

    // 100 (auto-cleared) + 50 (Candidate A, confirmed) + 50 (Candidate B, still outstanding — rejected suggestion) = 200.
    const items = await sessionSvc.listBookItems(tenant, session.id);
    const total = items.reduce((sum: number, i: any) => sum + Number(i.amount), 0);
    expect(total).toBe(200);

    const completed = await sessionSvc.completeSession(tenant, session.id, 'live-controller-1');
    expect(completed.status).toBe('COMPLETED');
  });

  it('a rule scoped to one bank account never fires against a session on a different bank account (no cross-account leakage)', async () => {
    const tenant = `${TENANT}-scoped`;
    const rule = await autoMatch.createRule({
      tenantId: tenant, entityId: ENTITY, bankAccountCode: 'OPERATING-LIVE-054B-SCOPED',
      ruleType: 'AMOUNT_DATE_WINDOW', tier: 'EXACT', config: { amountToleranceCents: 0, dateWindowDays: 0 }, actor: 'live-controller-2',
    });

    const otherSession = await sessionSvc.createSession({
      tenantId: tenant, entityId: ENTITY, bankAccountCode: 'OPERATING-LIVE-054B-OTHER',
      periodStart: '2026-08-01', periodEnd: '2026-08-31',
      statementBeginningBalance: 0, statementEndingBalance: 100,
      idempotencyKey: randomUUID(), actor: 'live-controller-2',
    });
    await sessionSvc.addStatementLine({ tenantId: tenant, sessionId: otherSession.id, lineDate: '2026-08-05', description: 'Should not auto-clear', amount: 100, source: 'IMPORTED', actor: 'live-controller-2' });
    await sessionSvc.addManualBookItem({ tenantId: tenant, sessionId: otherSession.id, itemType: 'DEPOSIT', itemDate: '2026-08-05', description: 'Item', amount: 100, actor: 'live-controller-2' });

    const result = await autoMatch.runAutoMatch(tenant, otherSession.id, 'auto-match-runner');
    expect(result.autoCleared).toBe(0);
    expect(result.suggested).toBe(0);
    const lines = await sessionSvc.listStatementLines(tenant, otherSession.id);
    expect(lines[0].status).toBe('UNMATCHED');
    void rule;
  });

  it.skipIf(!APP_ROLE_DB_URL)('RLS positive+negative on recon_match_rule / recon_match_suggestion — Tenant A invisible to Tenant B under amacc_app', async () => {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: APP_ROLE_DB_URL });
    await client.connect();
    try {
      const rule = await autoMatch.createRule({
        tenantId: TENANT, ruleType: 'CHECK_NUMBER', tier: 'EXACT', config: {}, actor: 'live-controller-3',
      });
      const session = await sessionSvc.createSession({
        tenantId: TENANT, entityId: ENTITY, bankAccountCode: 'OPERATING-LIVE-054B-RLS',
        periodStart: '2026-08-01', periodEnd: '2026-08-31',
        statementBeginningBalance: 0, statementEndingBalance: 100,
        idempotencyKey: randomUUID(), actor: 'live-controller-3',
      });
      await sessionSvc.addStatementLine({ tenantId: TENANT, sessionId: session.id, lineDate: '2026-08-05', description: 'x', amount: 100, source: 'IMPORTED', externalRef: 'CHK-9', actor: 'live-controller-3' });
      await sessionSvc.addManualBookItem({ tenantId: TENANT, sessionId: session.id, itemType: 'DEPOSIT', itemDate: '2026-08-06', description: 'y', amount: 100, actor: 'live-controller-3' });
      await autoMatch.runAutoMatch(TENANT, session.id, 'auto-match-runner'); // 0 candidates (CHECK_NUMBER requires exact externalRef==sourceId, sourceId is null for manual) -> no suggestion created here
      // Create a suggestion directly so we have a row to test RLS against.
      const suggestion = await (prisma as any).reconMatchSuggestion.create({
        data: { id: randomUUID(), sessionId: session.id, tenantId: TENANT, statementLineId: (await sessionSvc.listStatementLines(TENANT, session.id))[0].id, bookItemId: (await sessionSvc.listBookItems(TENANT, session.id))[0].id, ruleId: rule.id, tier: 'EXACT', status: 'PENDING' },
      });

      await client.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT]);
      const ownRule = await client.query('SELECT id FROM recon_match_rule WHERE id = $1', [rule.id]);
      expect(ownRule.rowCount).toBe(1);
      const ownSuggestion = await client.query('SELECT id FROM recon_match_suggestion WHERE id = $1', [suggestion.id]);
      expect(ownSuggestion.rowCount).toBe(1);

      await client.query(`SELECT set_config('app.current_tenant_id', $1, false)`, ['a-completely-different-tenant']);
      const crossRule = await client.query('SELECT id FROM recon_match_rule WHERE id = $1', [rule.id]);
      expect(crossRule.rowCount).toBe(0);
      const crossSuggestion = await client.query('SELECT id FROM recon_match_suggestion WHERE id = $1', [suggestion.id]);
      expect(crossSuggestion.rowCount).toBe(0);

      await expect(
        client.query(
          `INSERT INTO recon_match_rule (id, tenant_id, rule_type, tier, config, priority, active, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [randomUUID(), TENANT, 'CHECK_NUMBER', 'EXACT', '{}', 100, true, 'forger'],
        ),
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
  });
});
