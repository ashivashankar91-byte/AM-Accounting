/**
 * CE-07 Requirement E (schedule/open-item proof) — REAL, end-to-end proof
 * that the posting engine's dynamic line-item DSL (debitLineItemsPath/
 * creditLineItemsPath, applyNumber) correctly drives gl-service's own
 * schedule-relevant outbox emission, using the EXACT payload shapes
 * apar-service's real producers build (ap-invoice-envelope.ts,
 * ap-payment-envelope.ts) — not simplified test fixtures.
 *
 * SCOPE (disclosed): this proves the chain from the posting engine through
 * gl-service's own `journal_entries` -> `outbox_events` (JOURNAL_ENTRY_POSTED
 * with scheduleNumber/applyNumber/applyCd) — the exact boundary gl-service
 * hands off to schedule-service. It does NOT spin up schedule-service or a
 * real RabbitMQ broker to prove the consumer side reacts correctly — that
 * consumer logic (OpenItemService.processPostingEvent) is pre-existing,
 * unmodified S021/wave-3 code already covered by schedule-service's own
 * tests/live-db/open-item-live.test.ts. What CE-07 actually changed (the
 * gl-service JournalLine.applyNumber gap — see migration
 * 20260802020000_add_apply_number_journal_line_gl_svc — and the posting
 * engine's new debitLineItemsPath/creditLineItemsPath/applyNumber DSL) is
 * what this file proves directly, at its real boundary.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import pg from 'pg';
import { PrismaClient } from '.prisma/coa-client';
import { PostingEngineService } from '../../src/application/posting-engine-service';
import { HttpGlPostingBridge } from '../../src/application/gl-posting-bridge';
import { startGlServiceProcess, GlServiceProcessHandle } from '../support/gl-service-test-harness';
import { createServiceToken } from '@amacc/shared-kernel';
import type { IEventPublisher } from '@amacc/shared-kernel';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];
const GL_LIVE_DB_URL = process.env['GL_LIVE_DATABASE_URL'];
const GL_LIVE_BYPASS_DB_URL = process.env['GL_LIVE_BYPASS_DATABASE_URL'] ?? GL_LIVE_DB_URL;
const JWT_SECRET = 'ce07-schedule-outbox-test-secret';
const GL_PORT = 34_711;

const noopEvents: IEventPublisher = { publish: async () => {}, subscribe: () => {} };
const noopRecovery = { reportFailure: async () => {} };

describe.skipIf(!LIVE_DB_URL || !GL_LIVE_DB_URL)('CE-07 Requirement E — schedule-relevant outbox emission through the real posting engine + gl-service', () => {
  let coaPrisma: PrismaClient;
  let gl: GlServiceProcessHandle;
  let glClient: pg.Client;
  let engine: PostingEngineService;

  const TENANT = `sched-${randomUUID()}`;
  const SOURCE_CODE = 'AP';
  let expenseAcctId: string;
  let apControlAcctId: string;
  let bankAcctId: string;

  async function approve(journalEntryId: string) {
    const res = await fetch(`${gl.baseUrl}/api/v1/gl/journal-entries/${journalEntryId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT, Authorization: `Bearer ${createServiceToken('test-reviewer', JWT_SECRET)}`, 'x-user-id': 'reviewer-1' },
      body: '{}',
    });
    expect(res.ok).toBe(true);
    return res.json();
  }

  // gl-service's approveJournalEntry() stamps every schedule-relevant outbox
  // row's correlation_id from a FRESH crypto.randomUUID() generated during
  // approval (gl-service.ts's approveJournalEntry, unrelated to the posting
  // engine's own envelope/eventId) — so rows are identified by
  // payload.journalEntryId instead, which IS the stable, known id.
  async function scheduleOutboxRowsForJournal(journalEntryId: string) {
    const res = await glClient.query(`SELECT payload FROM outbox_events WHERE tenant_id = $1 AND event_type = 'JOURNAL_ENTRY_POSTED' AND payload->>'journalEntryId' = $2 ORDER BY created_at ASC`, [TENANT, journalEntryId]);
    return res.rows.map((r) => r.payload);
  }

  beforeAll(async () => {
    coaPrisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await coaPrisma.$connect();

    gl = await startGlServiceProcess(GL_LIVE_DB_URL!, JWT_SECRET, GL_PORT);
    glClient = new pg.Client({ connectionString: GL_LIVE_BYPASS_DB_URL });
    await glClient.connect();

    const bridge = new HttpGlPostingBridge(JWT_SECRET, gl.baseUrl);
    engine = new PostingEngineService(coaPrisma, noopEvents, bridge, noopRecovery as any);

    expenseAcctId = randomUUID();
    apControlAcctId = randomUUID();
    bankAcctId = randomUUID();
    await glClient.query(`INSERT INTO gl_sources (id, tenant_id, source_code, name, is_active) VALUES ($1,$2,$3,'AP (test fixture)',true) ON CONFLICT DO NOTHING`, [randomUUID(), TENANT, SOURCE_CODE]);
    // Expense account: no scheduleCode — never schedule-relevant.
    await glClient.query(`INSERT INTO gl_accounts (id, tenant_id, code, name, type, normal_balance, allow_posting, is_active) VALUES ($1,$2,'63000','Fixture Expense (test only)','EXPENSE','DEBIT',true,true)`, [expenseAcctId, TENANT]);
    // AP control account: scheduleCode='AP' — schedule-relevant (creates/relieves open items).
    await glClient.query(`INSERT INTO gl_accounts (id, tenant_id, code, name, type, normal_balance, allow_posting, is_active, schedule_code) VALUES ($1,$2,'23000','Fixture AP Control (test only)','LIABILITY','CREDIT',true,true,'AP')`, [apControlAcctId, TENANT]);
    // Bank account: no scheduleCode — a cash deposit/payment side that never creates its own open item.
    await glClient.query(`INSERT INTO gl_accounts (id, tenant_id, code, name, type, normal_balance, allow_posting, is_active) VALUES ($1,$2,'10100','Fixture Bank (test only)','ASSET','DEBIT',true,true)`, [bankAcctId, TENANT]);

    await coaPrisma.glAccount.create({ data: { id: randomUUID(), tenantId: TENANT, entityId: TENANT, accountNumber: '63000', name: 'Fixture Expense (test only)', type: 'EXPENSE', normalBalance: 'DR', postable: true, status: 'ACTIVE' } });
    await coaPrisma.glAccount.create({ data: { id: randomUUID(), tenantId: TENANT, entityId: TENANT, accountNumber: '23000', name: 'Fixture AP Control (test only)', type: 'LIABILITY', normalBalance: 'CR', postable: true, status: 'ACTIVE' } });
    await coaPrisma.glAccount.create({ data: { id: randomUUID(), tenantId: TENANT, entityId: TENANT, accountNumber: '10100', name: 'Fixture Bank (test only)', type: 'ASSET', normalBalance: 'DR', postable: true, status: 'ACTIVE' } });
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

  // Mirrors ap-invoice-envelope.ts's buildApInvoiceAcceptedEnvelope's payload shape exactly.
  function apInvoiceLiabilityPack() {
    return {
      dslVersion: 1, packKey: 'sched-ap-invoice-liability', semver: '1.0.0', eventType: 'ap.invoice.accepted.v1',
      supportedEventSchemaVersions: ['1.0'], tenantScope: TENANT, entityId: TENANT,
      effectiveFrom: '2020-01-01T00:00:00.000Z', effectiveTo: null, journalSourceCode: SOURCE_CODE,
      matchStrategy: 'FIRST_MATCH', noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION',
      rules: [{
        ruleId: 'ap-invoice-liability', priority: 1, description: 'AP invoice liability — real apar-service payload shape.', condition: null,
        blueprint: {
          memoTemplate: 'AP invoice liability — {{sourceEntityId}}',
          postingGroups: [{
            groupId: 'liability', baseAmountPath: 'payload.amount',
            debitAllocations: [], debitLineItemsPath: 'payload.lines',
            creditAllocations: [], creditLineItemsPath: 'payload.creditLines',
          }],
        },
      }],
    };
  }

  // Mirrors ap-payment-envelope.ts's buildApPaymentPostedEnvelope's payload shape exactly.
  function apPaymentReliefPack(packKey = 'sched-ap-payment-relief') {
    return {
      dslVersion: 1, packKey, semver: '1.0.0', eventType: 'ap.payment.posted.v1',
      supportedEventSchemaVersions: ['1.0'], tenantScope: TENANT, entityId: TENANT,
      effectiveFrom: '2020-01-01T00:00:00.000Z', effectiveTo: null, journalSourceCode: SOURCE_CODE,
      matchStrategy: 'FIRST_MATCH', noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION',
      rules: [{
        ruleId: 'ap-payment-relief', priority: 1, description: 'AP payment relief — real apar-service payload shape.', condition: null,
        blueprint: {
          memoTemplate: 'AP payment relief — {{sourceEntityId}}',
          postingGroups: [{
            groupId: 'relief', baseAmountPath: 'payload.amount',
            debitAllocations: [], debitLineItemsPath: 'payload.debitLines',
            creditAllocations: [], creditLineItemsPath: 'payload.creditLines',
          }],
        },
      }],
    };
  }

  async function activatePack(pack: any, actor: string) {
    const draft = await engine.createRulePackVersion({ tenantId: TENANT, packKey: pack.packKey, sourceText: JSON.stringify(pack), actor: `author-${actor}` });
    await engine.validateVersion(TENANT, draft.id, `author-${actor}`);
    return engine.activateVersion(TENANT, draft.id, `activator-${actor}`);
  }

  it('an AP invoice liability posting (new open item, no applyNumber) emits a schedule-relevant outbox event for the AP control line only', async () => {
    const activated = await activatePack(apInvoiceLiabilityPack(), 'inv');

    const invoiceId = randomUUID();
    const eventId = `evt-${randomUUID()}`;
    const envelope = {
      eventId, tenantId: TENANT, legalEntityId: TENANT, eventType: 'ap.invoice.accepted.v1', eventSchemaVersion: '1.0',
      occurredAt: '2026-06-15T10:00:00.000Z', publishedAt: '2026-06-15T10:00:01.000Z',
      sourceSystem: 'apar-service', sourceEntityType: 'AP_INVOICE', sourceEntityId: invoiceId,
      correlationId: `corr-${eventId}`, causationId: null, businessDate: '2026-06-15',
      payload: {
        invoiceId, invoiceNumber: 'INV-SCHED-1', amount: 500,
        lines: [{ accountNumber: '63000', storeId: 'AP-CENTRAL', amount: 500 }],
        creditLines: [{ accountNumber: '23000', storeId: 'AP-CENTRAL', amount: 500 }],
        sourceDocId: 'INV-SCHED-1',
      },
      metadata: {},
    };
    const result = await engine.submitEvent(TENANT, envelope, 'tester');
    expect(result.status).toBe('POSTED');

    const approved = await approve(result.journalEntryId!);
    expect((approved as any).status).toBe('POSTED');

    const rows = await scheduleOutboxRowsForJournal(result.journalEntryId!);
    // Exactly one schedule-relevant line (the AP control credit) — the expense debit line's account has no scheduleCode.
    expect(rows).toHaveLength(1);
    expect(rows[0].scheduleNumber).toBe('AP');
    expect(rows[0].glAccountNumber).toBe('23000');
    expect(Number(rows[0].amount)).toBe(-500); // gl-service's netAmount = debit - credit; this line is a pure credit
    expect(rows[0].applyNumber).toBeNull(); // new open item — never a relief
    expect(rows[0].applyCd).toBeNull();
    expect(rows[0].referenceNumber).toBe(invoiceId.slice(0, 8)); // itemNumber schedule-service will assign to the new open item

    await coaPrisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
  });

  it('an AP payment relief posting (applyNumber set) emits a schedule-relevant outbox event carrying applyCd=# and the matching applyNumber — never on the bank credit line', async () => {
    const activated = await activatePack(apPaymentReliefPack(), 'pay');

    const invoiceId = randomUUID(); // simulates the original invoice this payment relieves
    const paymentId = randomUUID();
    const eventId = `evt-${randomUUID()}`;
    const envelope = {
      eventId, tenantId: TENANT, legalEntityId: TENANT, eventType: 'ap.payment.posted.v1', eventSchemaVersion: '1.0',
      occurredAt: '2026-06-20T10:00:00.000Z', publishedAt: '2026-06-20T10:00:01.000Z',
      sourceSystem: 'apar-service', sourceEntityType: 'AP_MANUAL_PAYMENT', sourceEntityId: paymentId,
      correlationId: `corr-${eventId}`, causationId: null, businessDate: '2026-06-20',
      payload: {
        paymentId, invoiceNumber: 'INV-SCHED-1', amount: 500,
        debitLines: [{ accountNumber: '23000', storeId: 'AP-CENTRAL', amount: 500, applyNumber: invoiceId.slice(0, 8) }],
        creditLines: [{ accountNumber: '10100', storeId: 'AP-CENTRAL', amount: 500 }],
        sourceDocId: 'INV-SCHED-1',
      },
      metadata: {},
    };
    const result = await engine.submitEvent(TENANT, envelope, 'tester');
    expect(result.status).toBe('POSTED');

    const approved = await approve(result.journalEntryId!);
    expect((approved as any).status).toBe('POSTED');

    const rows = await scheduleOutboxRowsForJournal(result.journalEntryId!);
    // Exactly one schedule-relevant line (the AP control debit) — the bank credit line's account has no scheduleCode.
    expect(rows).toHaveLength(1);
    expect(rows[0].scheduleNumber).toBe('AP');
    expect(rows[0].glAccountNumber).toBe('23000');
    expect(rows[0].applyCd).toBe('#'); // relief, never a new item
    expect(rows[0].applyNumber).toBe(invoiceId.slice(0, 8)); // matches the original invoice's itemNumber exactly

    await coaPrisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
  });

  it('a posting with no schedule-relevant accounts (e.g. a cash deposit between two non-scheduled accounts) emits no outbox event at all', async () => {
    const bankAcct2Id = randomUUID();
    await glClient.query(`INSERT INTO gl_accounts (id, tenant_id, code, name, type, normal_balance, allow_posting, is_active) VALUES ($1,$2,'10200','Fixture Undeposited Funds (test only)','ASSET','DEBIT',true,true)`, [bankAcct2Id, TENANT]);
    await coaPrisma.glAccount.create({ data: { id: randomUUID(), tenantId: TENANT, entityId: TENANT, accountNumber: '10200', name: 'Fixture Undeposited Funds (test only)', type: 'ASSET', normalBalance: 'DR', postable: true, status: 'ACTIVE' } });

    const pack = {
      dslVersion: 1, packKey: 'sched-cash-deposit', semver: '1.0.0', eventType: 'cash.deposit.posted.v1',
      supportedEventSchemaVersions: ['1.0'], tenantScope: TENANT, entityId: TENANT,
      effectiveFrom: '2020-01-01T00:00:00.000Z', effectiveTo: null, journalSourceCode: SOURCE_CODE,
      matchStrategy: 'FIRST_MATCH', noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION',
      rules: [{
        ruleId: 'cash-deposit', priority: 1, description: 'Cash deposit — settles undeposited funds against the bank. Never a schedule-relevant line.', condition: null,
        blueprint: {
          memoTemplate: 'Cash deposit — {{sourceEntityId}}',
          postingGroups: [{
            groupId: 'deposit', baseAmountPath: 'payload.amount',
            debitAllocations: [{ accountNumber: '10100', storeId: 'AP-CENTRAL', bp: 10_000 }],
            creditAllocations: [{ accountNumber: '10200', storeId: 'AP-CENTRAL', bp: 10_000 }],
          }],
        },
      }],
    };
    const activated = await activatePack(pack, 'deposit');

    const eventId = `evt-${randomUUID()}`;
    const envelope = {
      eventId, tenantId: TENANT, legalEntityId: TENANT, eventType: 'cash.deposit.posted.v1', eventSchemaVersion: '1.0',
      occurredAt: '2026-06-21T10:00:00.000Z', publishedAt: '2026-06-21T10:00:01.000Z',
      sourceSystem: 'cash-service', sourceEntityType: 'CASH_DEPOSIT', sourceEntityId: randomUUID(),
      correlationId: `corr-${eventId}`, causationId: null, businessDate: '2026-06-21',
      payload: { amount: 200 },
      metadata: {},
    };
    const result = await engine.submitEvent(TENANT, envelope, 'tester');
    expect(result.status).toBe('POSTED');
    await approve(result.journalEntryId!);

    const rows = await scheduleOutboxRowsForJournal(result.journalEntryId!);
    expect(rows).toHaveLength(0); // neither line's account has a scheduleCode — no open item created

    await coaPrisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
  });

  it('a rejected posting (missing account mapping) causes no schedule mutation — zero outbox rows, zero gl-service journals', async () => {
    const pack = {
      dslVersion: 1, packKey: 'sched-missing-account', semver: '1.0.0', eventType: 'ap.invoice.rejected-fixture.v1',
      supportedEventSchemaVersions: ['1.0'], tenantScope: TENANT, entityId: TENANT,
      effectiveFrom: '2020-01-01T00:00:00.000Z', effectiveTo: null, journalSourceCode: SOURCE_CODE,
      matchStrategy: 'FIRST_MATCH', noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION',
      rules: [{
        ruleId: 'missing-account', priority: 1, description: 'References an account with no coa-service mapping — must reject before ever reaching gl-service.', condition: null,
        blueprint: {
          memoTemplate: 'Missing-account fixture — {{sourceEntityId}}',
          postingGroups: [{
            groupId: 'grp', baseAmountPath: 'payload.amount',
            debitAllocations: [{ accountNumber: '99999', storeId: 'AP-CENTRAL', bp: 10_000 }],
            creditAllocations: [{ accountNumber: '23000', storeId: 'AP-CENTRAL', bp: 10_000 }],
          }],
        },
      }],
    };
    await coaPrisma.glAccount.create({ data: { id: randomUUID(), tenantId: TENANT, entityId: TENANT, accountNumber: '99999', name: 'Fixture — exists in coa-service only (test only)', type: 'ASSET', normalBalance: 'DR', postable: true, status: 'ACTIVE' } });
    const draft = await engine.createRulePackVersion({ tenantId: TENANT, packKey: 'sched-missing-account', sourceText: JSON.stringify(pack), actor: 'author-missing' });
    await engine.validateVersion(TENANT, draft.id, 'author-missing');
    const activated = await engine.activateVersion(TENANT, draft.id, 'activator-missing');

    const eventId = `evt-${randomUUID()}`;
    const envelope = {
      eventId, tenantId: TENANT, legalEntityId: TENANT, eventType: 'ap.invoice.rejected-fixture.v1', eventSchemaVersion: '1.0',
      occurredAt: '2026-06-22T10:00:00.000Z', publishedAt: '2026-06-22T10:00:01.000Z',
      sourceSystem: 'apar-service', sourceEntityType: 'AP_INVOICE', sourceEntityId: randomUUID(),
      correlationId: `corr-${eventId}`, causationId: null, businessDate: '2026-06-22',
      payload: { amount: 75 },
      metadata: {},
    };
    const result = await engine.submitEvent(TENANT, envelope, 'tester');
    expect(result.status).toBe('REJECTED');
    expect(result.journalEntryId ?? null).toBeNull(); // never reached the bridge — no gl-service journal, no outbox row possible

    const journalCount = await glClient.query(`SELECT count(*)::int AS n FROM journal_entries WHERE tenant_id = $1 AND description LIKE '%' || $2 || '%'`, [TENANT, envelope.sourceEntityId]);
    expect(journalCount.rows[0].n).toBe(0);

    await coaPrisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
  });

  it('resubmitting the SAME payment event twice never creates a second schedule-relevant outbox row', async () => {
    const activated = await activatePack(apPaymentReliefPack('sched-ap-payment-relief-dup'), 'pay-dup');

    const invoiceId = randomUUID();
    const paymentId = randomUUID();
    const eventId = `evt-${randomUUID()}`;
    const envelope = {
      eventId, tenantId: TENANT, legalEntityId: TENANT, eventType: 'ap.payment.posted.v1', eventSchemaVersion: '1.0',
      occurredAt: '2026-06-23T10:00:00.000Z', publishedAt: '2026-06-23T10:00:01.000Z',
      sourceSystem: 'apar-service', sourceEntityType: 'AP_MANUAL_PAYMENT', sourceEntityId: paymentId,
      correlationId: `corr-${eventId}`, causationId: null, businessDate: '2026-06-23',
      payload: {
        paymentId, invoiceNumber: 'INV-SCHED-DUP', amount: 90,
        debitLines: [{ accountNumber: '23000', storeId: 'AP-CENTRAL', amount: 90, applyNumber: invoiceId.slice(0, 8) }],
        creditLines: [{ accountNumber: '10100', storeId: 'AP-CENTRAL', amount: 90 }],
        sourceDocId: 'INV-SCHED-DUP',
      },
      metadata: {},
    };
    const first = await engine.submitEvent(TENANT, envelope, 'tester');
    expect(first.status).toBe('POSTED');
    await approve(first.journalEntryId!);

    const second = await engine.submitEvent(TENANT, envelope, 'tester');
    expect(second.idempotent).toBe(true);
    expect(second.journalEntryId).toBe(first.journalEntryId);

    const rows = await scheduleOutboxRowsForJournal(first.journalEntryId!);
    expect(rows).toHaveLength(1); // never a second relief event for the same payment

    await coaPrisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
  });
});
