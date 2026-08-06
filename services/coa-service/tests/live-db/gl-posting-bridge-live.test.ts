/**
 * CE-07 (single authoritative ledger decision) — REAL, end-to-end proof that
 * the posting engine posts through gl-service's own existing, certified
 * posting door (never a second GL implementation, never coa-service's own
 * PostingService for rule-engine-driven events). Spawns a REAL gl-service
 * process (see support/gl-service-test-harness.ts) — no mocks of
 * gl-service's own application code; gl-service assertions/fixtures use raw
 * SQL (via `pg`) against gl-service's own tables, avoiding the need to
 * cross-import gl-service's generated Prisma client (which lives only in
 * gl-service's own node_modules, not the workspace root).
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import pg from 'pg';
import { PrismaClient } from '.prisma/coa-client';
import { PostingEngineService } from '../../src/application/posting-engine-service';
import { HttpGlPostingBridge } from '../../src/application/gl-posting-bridge';
import { startGlServiceProcess, GlServiceProcessHandle } from '../support/gl-service-test-harness';
import { apInvoiceLiabilityPack } from '../support/s023-rule-pack-fixtures';
import { certificationEnvelope } from '../support/posting-engine-fixtures';
import { createServiceToken } from '@amacc/shared-kernel';
import type { IEventPublisher } from '@amacc/shared-kernel';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];
const GL_LIVE_DB_URL = process.env['GL_LIVE_DATABASE_URL'];
// This test's raw `pg` client only sets up fixtures and reads back rows
// across tenants for assertions — it is deliberately RLS-bypass (same
// role gl-service's own migrations already grant BYPASSRLS to), never a
// stand-in for how gl-service itself connects (which stays tenant-scoped
// via GL_LIVE_DATABASE_URL/createTenantRlsMiddleware, unmodified).
const GL_LIVE_BYPASS_DB_URL = process.env['GL_LIVE_BYPASS_DATABASE_URL'] ?? GL_LIVE_DB_URL;
const JWT_SECRET = 'ce07-single-ledger-test-secret';
const GL_PORT = 34_710;

const noopEvents: IEventPublisher = { publish: async () => {}, subscribe: () => {} };
const noopRecovery = { reportFailure: async () => {} };

describe.skipIf(!LIVE_DB_URL || !GL_LIVE_DB_URL)('CE-07 single authoritative ledger — GL posting bridge', () => {
  let coaPrisma: PrismaClient;
  let gl: GlServiceProcessHandle;
  let glClient: pg.Client;
  let engine: PostingEngineService;
  let bridge: HttpGlPostingBridge;

  const TENANT = `ledger-${randomUUID()}`;
  const SOURCE_CODE = 'PE';
  let expenseAcctId: string;
  let apControlAcctId: string;

  async function glCountJournals(sourceEntityId: string): Promise<number> {
    const res = await glClient.query(`SELECT count(*)::int AS n FROM journal_entries WHERE tenant_id = $1 AND description LIKE '%' || $2 || '%'`, [TENANT, sourceEntityId]);
    return res.rows[0].n;
  }

  beforeAll(async () => {
    coaPrisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await coaPrisma.$connect();

    gl = await startGlServiceProcess(GL_LIVE_DB_URL!, JWT_SECRET, GL_PORT);
    glClient = new pg.Client({ connectionString: GL_LIVE_BYPASS_DB_URL });
    await glClient.connect();

    bridge = new HttpGlPostingBridge(JWT_SECRET, gl.baseUrl);
    engine = new PostingEngineService(coaPrisma, noopEvents, bridge, noopRecovery as any);

    expenseAcctId = randomUUID();
    apControlAcctId = randomUUID();
    await glClient.query(`INSERT INTO gl_sources (id, tenant_id, source_code, name, is_active) VALUES ($1,$2,$3,'Posting Engine (test fixture)',true) ON CONFLICT DO NOTHING`, [randomUUID(), TENANT, SOURCE_CODE]);
    await glClient.query(`INSERT INTO gl_accounts (id, tenant_id, code, name, type, normal_balance, allow_posting, is_active) VALUES ($1,$2,'60000','Fixture Expense (test only)','EXPENSE','DEBIT',true,true)`, [expenseAcctId, TENANT]);
    await glClient.query(`INSERT INTO gl_accounts (id, tenant_id, code, name, type, normal_balance, allow_posting, is_active) VALUES ($1,$2,'21000','Fixture AP Control (test only)','LIABILITY','CREDIT',true,true)`, [apControlAcctId, TENANT]);

    // coa-service's OWN glAccount rows — a SEPARATE table from gl-service's
    // (independent ids, no crosswalk between them). The engine only uses
    // this table to prove the account NUMBER exists before ever calling the
    // bridge (INVALID_ACCOUNT pre-check); the bridge itself sends that
    // account NUMBER ("accountCode") to gl-service, which resolves it
    // against ITS OWN gl_accounts table — so these two rows' ids never need
    // to match the gl-service rows created above, only their account codes do.
    await coaPrisma.glAccount.create({ data: { id: randomUUID(), tenantId: TENANT, entityId: TENANT, accountNumber: '60000', name: 'Fixture Expense (test only)', type: 'EXPENSE', normalBalance: 'DR', postable: true, status: 'ACTIVE' } });
    await coaPrisma.glAccount.create({ data: { id: randomUUID(), tenantId: TENANT, entityId: TENANT, accountNumber: '21000', name: 'Fixture AP Control (test only)', type: 'LIABILITY', normalBalance: 'CR', postable: true, status: 'ACTIVE' } });
  }, 30_000);

  afterAll(async () => {
    await gl?.close();
    await glClient?.end();
    await coaPrisma.postingExecutionReplay.deleteMany({ where: { tenantId: TENANT } });
    await coaPrisma.postingExecutionAttempt.deleteMany({ where: { tenantId: TENANT } });
    await coaPrisma.postingException.deleteMany({ where: { tenantId: TENANT } });
    await coaPrisma.postingExecution.deleteMany({ where: { tenantId: TENANT } });
    await coaPrisma.postingRulePackVersion.deleteMany({ where: { tenantId: TENANT } });
    await coaPrisma.postingRulePack.deleteMany({ where: { tenantId: TENANT } });
    await coaPrisma.auditOutboxEvent.deleteMany({ where: { tenantId: TENANT } });
    await coaPrisma.glAccount.deleteMany({ where: { tenantId: TENANT } });
    await coaPrisma.$disconnect();
  }, 15_000);

  it('a rule-engine posting creates the authoritative journal in gl-service\'s OWN ledger — never coa-service\'s own journal_entry table', async () => {
    const pack = apInvoiceLiabilityPack({ tenantId: TENANT, entityId: TENANT, journalSourceCode: SOURCE_CODE, apExpenseAccount: '60000', apControlAccount: '21000' } as any);
    const draft = await engine.createRulePackVersion({ tenantId: TENANT, packKey: pack.packKey, sourceText: JSON.stringify(pack), actor: 'author-ledger' });
    await engine.validateVersion(TENANT, draft.id, 'author-ledger');
    const activated = await engine.activateVersion(TENANT, draft.id, 'activator-ledger');
    expect(activated.status).toBe('ACTIVE');

    const eventId = `evt-${randomUUID()}`;
    const envelope = { ...certificationEnvelope({ tenantId: TENANT, entityId: TENANT, eventId, amount: 500 }), eventType: pack.eventType };
    const result = await engine.submitEvent(TENANT, envelope, 'tester');

    expect(result.status).toBe('POSTED');
    expect(result.journalEntryId).toBeTruthy();

    const je = await glClient.query(`SELECT id, tenant_id, status FROM journal_entries WHERE id = $1`, [result.journalEntryId]);
    expect(je.rows).toHaveLength(1);
    expect(je.rows[0].tenant_id).toBe(TENANT);
    expect(je.rows[0].status).toBe('PENDING_REVIEW'); // bridge never auto-approves — the existing review gate is untouched

    const lines = await glClient.query(`SELECT gl_account_id, debit, credit FROM journal_lines WHERE journal_entry_id = $1`, [result.journalEntryId]);
    expect(lines.rows).toHaveLength(2);
    expect(Number(lines.rows.find((l) => l.gl_account_id === expenseAcctId)?.debit)).toBe(500);
    expect(Number(lines.rows.find((l) => l.gl_account_id === apControlAcctId)?.credit)).toBe(500);

    // coa-service's OWN journal_entry table has NO row for this event — it is not a second ledger.
    const coaJournalCount = await coaPrisma.journalEntry.count({ where: { tenantId: TENANT, idempotencyKey: `${TENANT}:${eventId}` } });
    expect(coaJournalCount).toBe(0);

    await coaPrisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
  });

  it('duplicate submission returns the SAME authoritative gl-service journal — no second journal created', async () => {
    const pack = { ...apInvoiceLiabilityPack({ tenantId: TENANT, entityId: TENANT, journalSourceCode: SOURCE_CODE, apExpenseAccount: '60000', apControlAccount: '21000' } as any), packKey: 'dup-pack' };
    const draft = await engine.createRulePackVersion({ tenantId: TENANT, packKey: 'dup-pack', sourceText: JSON.stringify(pack), actor: 'author-dup' });
    await engine.validateVersion(TENANT, draft.id, 'author-dup');
    const activated = await engine.activateVersion(TENANT, draft.id, 'activator-dup');

    const eventId = `evt-${randomUUID()}`;
    const envelope = { ...certificationEnvelope({ tenantId: TENANT, entityId: TENANT, eventId, amount: 250 }), eventType: pack.eventType };
    const first = await engine.submitEvent(TENANT, envelope, 'tester');
    expect(first.status).toBe('POSTED');

    const second = await engine.submitEvent(TENANT, envelope, 'tester');
    expect(second.status).toBe('POSTED');
    expect(second.idempotent).toBe(true);
    expect(second.journalEntryId).toBe(first.journalEntryId);

    expect(await glCountJournals(envelope.sourceEntityId)).toBe(1);

    await coaPrisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
  });

  it('concurrent duplicate submissions of a brand-new event still produce exactly one authoritative gl-service journal', async () => {
    const pack = { ...apInvoiceLiabilityPack({ tenantId: TENANT, entityId: TENANT, journalSourceCode: SOURCE_CODE, apExpenseAccount: '60000', apControlAccount: '21000' } as any), packKey: 'race-pack' };
    const draft = await engine.createRulePackVersion({ tenantId: TENANT, packKey: 'race-pack', sourceText: JSON.stringify(pack), actor: 'author-race' });
    await engine.validateVersion(TENANT, draft.id, 'author-race');
    const activated = await engine.activateVersion(TENANT, draft.id, 'activator-race');

    const eventId = `evt-${randomUUID()}`;
    const envelope = { ...certificationEnvelope({ tenantId: TENANT, entityId: TENANT, eventId, amount: 42 }), eventType: pack.eventType };

    const [a, b] = await Promise.allSettled([
      engine.submitEvent(TENANT, envelope, 'racer-a'),
      engine.submitEvent(TENANT, envelope, 'racer-b'),
    ]);
    for (const r of [a, b]) expect(r.status).toBe('fulfilled');

    expect(await glCountJournals(envelope.sourceEntityId)).toBe(1); // never two authoritative journals from a race

    await coaPrisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
  });

  it('an authorized reviewer approving the journal (simulating the existing agent-review gate, untouched by the bridge) posts it and emits JOURNAL_ENTRY_POSTED', async () => {
    const pack = { ...apInvoiceLiabilityPack({ tenantId: TENANT, entityId: TENANT, journalSourceCode: SOURCE_CODE, apExpenseAccount: '60000', apControlAccount: '21000' } as any), packKey: 'schedule-pack' };
    const draft = await engine.createRulePackVersion({ tenantId: TENANT, packKey: 'schedule-pack', sourceText: JSON.stringify(pack), actor: 'author-sched' });
    await engine.validateVersion(TENANT, draft.id, 'author-sched');
    const activated = await engine.activateVersion(TENANT, draft.id, 'activator-sched');

    const eventId = `evt-${randomUUID()}`;
    const envelope = { ...certificationEnvelope({ tenantId: TENANT, entityId: TENANT, eventId, amount: 77 }), eventType: pack.eventType };
    const result = await engine.submitEvent(TENANT, envelope, 'tester');
    expect(result.status).toBe('POSTED');

    const submittedEvent = await glClient.query(`SELECT * FROM outbox_events WHERE tenant_id = $1 AND event_type = 'JOURNAL_ENTRY_SUBMITTED' ORDER BY created_at DESC LIMIT 1`, [TENANT]);
    expect(submittedEvent.rows).toHaveLength(1); // emitted by the bridge's own submit-for-review step

    // This calls gl-service's REAL /approve endpoint — an authorized
    // reviewer completing the SAME, untouched agent-review gate every
    // other producer already goes through. The bridge itself never does this.
    const approveRes = await fetch(`${gl.baseUrl}/api/v1/gl/journal-entries/${result.journalEntryId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT, Authorization: `Bearer ${createServiceToken('test-reviewer-harness', JWT_SECRET)}`, 'x-user-id': 'reviewer-1' },
      body: '{}',
    });
    expect(approveRes.ok).toBe(true);
    const approved = await approveRes.json();
    expect(approved.status).toBe('POSTED');

    const postedEvent = await glClient.query(`SELECT * FROM outbox_events WHERE tenant_id = $1 AND event_type = 'JOURNAL_ENTRY_POSTED' ORDER BY created_at DESC LIMIT 1`, [TENANT]);
    expect(postedEvent.rows).toHaveLength(1); // the real, unmodified gl-service approval path — schedule-service subscribes to exactly this event

    await coaPrisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
  });

  it('missing a gl-service account mapping rejects deterministically — no gl-service journal created', async () => {
    const pack = { ...apInvoiceLiabilityPack({ tenantId: TENANT, entityId: TENANT, journalSourceCode: SOURCE_CODE, apExpenseAccount: '60000', apControlAccount: '99999' } as any), packKey: 'missing-pack' };
    await coaPrisma.glAccount.create({ data: { id: randomUUID(), tenantId: TENANT, entityId: TENANT, accountNumber: '99999', name: 'Fixture — exists in coa-service only (test only)', type: 'LIABILITY', normalBalance: 'CR', postable: true, status: 'ACTIVE' } });
    const draft = await engine.createRulePackVersion({ tenantId: TENANT, packKey: 'missing-pack', sourceText: JSON.stringify(pack), actor: 'author-missing' });
    await engine.validateVersion(TENANT, draft.id, 'author-missing');
    const activated = await engine.activateVersion(TENANT, draft.id, 'activator-missing');

    const eventId = `evt-${randomUUID()}`;
    const envelope = { ...certificationEnvelope({ tenantId: TENANT, entityId: TENANT, eventId, amount: 10 }), eventType: pack.eventType };
    const result = await engine.submitEvent(TENANT, envelope, 'tester');

    expect(result.status).toBe('REJECTED');
    expect(await glCountJournals(envelope.sourceEntityId)).toBe(0);

    await coaPrisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
  });

  // ── CE-07 closing pass — authoritative GL idempotency at the BRIDGE/HTTP boundary ──
  // (services/gl-service's own repository-level guarantee is proven directly,
  // independent of the bridge, in gl-service's own
  // tests/journal-entry-idempotency.live.test.ts — these tests instead prove
  // the bridge correctly PASSES THROUGH an idempotencyKey end-to-end over
  // real HTTP, and correctly handles the submit-for-review race its own
  // doc-comment describes.)
  describe('authoritative GL idempotency — bridge/HTTP boundary', () => {
    it('calling the bridge twice with the SAME idempotencyKey (simulating a lost-response crash-retry) returns the SAME journal — never a second gl-service journal', async () => {
      const key = `bridge-retry-${randomUUID()}`;
      const req = {
        tenantId: TENANT, businessDate: '2026-08-03', journalSourceCode: SOURCE_CODE,
        description: `Bridge idempotency retry fixture — ${key}`,
        idempotencyKey: key,
        lines: [
          { accountCode: '60000', debit: 250, credit: 0, storeId: 'CERT-STORE-1' },
          { accountCode: '21000', debit: 0, credit: 250, storeId: 'CERT-STORE-1' },
        ],
      };
      const first = await bridge.post(req);
      expect(first.status).toBe('PENDING_REVIEW'); // submitted for review, never auto-approved

      const second = await bridge.post(req);
      expect(second.journalEntryId).toBe(first.journalEntryId);
      expect(second.status).toBe('PENDING_REVIEW');

      const count = await glClient.query(`SELECT count(*)::int AS n FROM journal_entries WHERE tenant_id = $1 AND idempotency_key = $2`, [TENANT, key]);
      expect(count.rows[0].n).toBe(1);
    });

    it('concurrent duplicate bridge.post() calls with the SAME idempotencyKey — including a race on the submit-for-review step itself — create exactly one gl-service journal and never throw', async () => {
      const key = `bridge-race-${randomUUID()}`;
      const req = {
        tenantId: TENANT, businessDate: '2026-08-03', journalSourceCode: SOURCE_CODE,
        description: `Bridge idempotency race fixture — ${key}`,
        idempotencyKey: key,
        lines: [
          { accountCode: '60000', debit: 175, credit: 0, storeId: 'CERT-STORE-1' },
          { accountCode: '21000', debit: 0, credit: 175, storeId: 'CERT-STORE-1' },
        ],
      };
      const results = await Promise.allSettled([bridge.post(req), bridge.post(req), bridge.post(req)]);
      for (const r of results) expect(r.status, 'every concurrent bridge call for one idempotencyKey must resolve successfully, never throw').toBe('fulfilled');

      const ids = new Set(
        results.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled').map((r) => r.value.journalEntryId),
      );
      expect(ids.size).toBe(1);

      const count = await glClient.query(`SELECT count(*)::int AS n FROM journal_entries WHERE tenant_id = $1 AND idempotency_key = $2`, [TENANT, key]);
      expect(count.rows[0].n).toBe(1);
    });
  });
});
