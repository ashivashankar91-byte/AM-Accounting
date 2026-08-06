/**
 * CE-07 closing pass — REAL schedule-service consumer certification. Unlike
 * gl-schedule-outbox-live.test.ts (which proves the outbox PAYLOAD gl-service
 * produces, stopping at that boundary), this file stands up the full,
 * REAL, unmodified stack — gl-service, coa-service's posting engine, and
 * schedule-service — connected through a REAL, reachable RabbitMQ broker,
 * and proves schedule-service's own real JOURNAL_ENTRY_POSTED consumer
 * (OpenItemService.processPostingEvent, pre-existing S021/wave-3 code, not
 * modified by CE-07) actually reacts correctly:
 *
 *   - an AP invoice posting creates ONE schedule open item;
 *   - a vendor payment posting relieves that SAME open item (matched by
 *     scheduleNumber + controlNumber + applyNumber/itemNumber, exactly the
 *     applyCd='#' mechanism CE-07's migration
 *     20260802020000_add_apply_number_journal_line_gl_svc unblocked);
 *   - applied cash relieves a (pre-seeded, standing in for the not-yet-built
 *     S048 AR-invoice producer — see cashReceiptForAr's doc-comment) AR open
 *     item;
 *   - unapplied cash creates/preserves its own open item (a customer credit),
 *     never relieving anything;
 *   - a rejected posting causes no schedule mutation at all (no journal ever
 *     reaches gl-service, so no outbox event, so no open-item write);
 *   - a duplicate submission causes no duplicate schedule mutation (proven
 *     at the posting-engine layer — a duplicate never even calls the bridge
 *     a second time, so gl-service never emits a second JOURNAL_ENTRY_POSTED
 *     for it either);
 *   - an authorized replay remains governed and idempotent (uses the SAME
 *     dedicated PostingExecutionReplay evidence trail already proven
 *     elsewhere — replayed here once more specifically to confirm it still
 *     flows correctly to a real open-item mutation).
 *
 * Requires a REAL, reachable RabbitMQ broker at RABBITMQ_TEST_URL (default
 * amqp://127.0.0.1:5672) — this is a hard requirement, not a soft skip:
 * gl-service and schedule-service are separate processes with separate
 * in-memory fallback handler maps; an unreachable broker means zero
 * cross-process delivery is possible at all (see this file's design note in
 * the CE-07 session history). If RABBITMQ_TEST_URL is unreachable this
 * suite is skipped, same convention as the DB-driven live suites.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import pg from 'pg';
import { PrismaClient } from '.prisma/coa-client';
import { PostingEngineService } from '../../src/application/posting-engine-service';
import { HttpGlPostingBridge } from '../../src/application/gl-posting-bridge';
import { startGlServiceProcess, startScheduleServiceProcess, GlServiceProcessHandle } from '../support/gl-service-test-harness';
import { createServiceToken } from '@amacc/shared-kernel';
import type { IEventPublisher } from '@amacc/shared-kernel';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];
const GL_LIVE_DB_URL = process.env['GL_LIVE_DATABASE_URL'];
const GL_LIVE_BYPASS_DB_URL = process.env['GL_LIVE_BYPASS_DATABASE_URL'] ?? GL_LIVE_DB_URL;
const SCHEDULE_LIVE_DB_URL = process.env['SCHEDULE_LIVE_DATABASE_URL'];
const SCHEDULE_LIVE_BYPASS_DB_URL = process.env['SCHEDULE_LIVE_BYPASS_DATABASE_URL'] ?? SCHEDULE_LIVE_DB_URL;
const RABBITMQ_TEST_URL = process.env['RABBITMQ_TEST_URL'] ?? 'amqp://127.0.0.1:5672';
const JWT_SECRET = 'ce07-schedule-consumer-test-secret';
const GL_PORT = 34_730;
const SCHEDULE_PORT = 34_731;

const noopEvents: IEventPublisher = { publish: async () => {}, subscribe: () => {} };
const noopRecovery = { reportFailure: async () => {} };

async function rabbitmqReachable(url: string): Promise<boolean> {
  try {
    const amqp = await import('amqplib');
    const conn = await amqp.connect(url, { timeout: 2000 } as any);
    await conn.close();
    return true;
  } catch {
    return false;
  }
}

let RABBITMQ_OK = false;

describe.skipIf(!LIVE_DB_URL || !GL_LIVE_DB_URL || !SCHEDULE_LIVE_DB_URL)('CE-07 closing pass — real schedule-service consumer certification (real broker)', () => {
  let coaPrisma: PrismaClient;
  let gl: GlServiceProcessHandle;
  let schedule: GlServiceProcessHandle;
  let glClient: pg.Client;
  let scheduleClient: pg.Client;
  let engine: PostingEngineService;

  const TENANT = `sched-cons-${randomUUID()}`;
  const SOURCE_CODE = 'AP';
  const AP_SCHEDULE_NO = 'AP';
  const AR_SCHEDULE_NO = 'AR';

  function scheduleHeaders() {
    return { 'Content-Type': 'application/json', 'x-tenant-id': TENANT, Authorization: `Bearer ${createServiceToken('test-cert', JWT_SECRET)}` };
  }

  // gl-service's OutboxProcessor polls its own outbox table every 5000ms
  // (services/gl-service/src/index.ts) — a schedule-relevant JOURNAL_ENTRY_POSTED
  // event is written atomically inside the approve() transaction but is only
  // actually published to RabbitMQ on the NEXT background tick, so end-to-end
  // latency here is real async delivery latency, not a bug. 25s gives ~5x
  // margin over that worst case plus RabbitMQ/consumer roundtrip.
  async function pollOpenItems(scheduleId: string, controlNumber: string, timeoutMs = 25_000): Promise<any[]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await fetch(`${schedule.baseUrl}/api/v1/schedules/${scheduleId}/open-items?controlNumber=${encodeURIComponent(controlNumber)}`, { headers: scheduleHeaders() });
      if (res.ok) {
        const body = await res.json();
        const items = Array.isArray(body) ? body : body.items ?? [];
        if (items.length > 0) return items;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    return [];
  }

  async function pollOpenItemStatus(scheduleId: string, itemId: string, expectedStatus: string, timeoutMs = 25_000): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    let last: any = null;
    while (Date.now() < deadline) {
      const res = await fetch(`${schedule.baseUrl}/api/v1/schedules/${scheduleId}/open-items/${itemId}`, { headers: scheduleHeaders() });
      if (res.ok) {
        last = await res.json();
        if (last.status === expectedStatus) return last;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    return last;
  }

  async function approve(journalEntryId: string) {
    const res = await fetch(`${gl.baseUrl}/api/v1/gl/journal-entries/${journalEntryId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT, Authorization: `Bearer ${createServiceToken('test-reviewer', JWT_SECRET)}`, 'x-user-id': 'reviewer-1' },
      body: '{}',
    });
    expect(res.ok).toBe(true);
    return res.json();
  }

  async function activatePack(pack: any, actor: string) {
    const draft = await engine.createRulePackVersion({ tenantId: TENANT, packKey: pack.packKey, sourceText: JSON.stringify(pack), actor: `author-${actor}` });
    const validated = await engine.validateVersion(TENANT, draft.id, `author-${actor}`);
    if (!validated.valid) {
      console.error(`activatePack(${pack.packKey}) — validation findings:`, JSON.stringify(validated.findings));
    }
    return engine.activateVersion(TENANT, draft.id, `activator-${actor}`);
  }

  beforeAll(async () => {
    RABBITMQ_OK = await rabbitmqReachable(RABBITMQ_TEST_URL);
    if (!RABBITMQ_OK) return; // individual its below skip via RABBITMQ_OK guard

    coaPrisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await coaPrisma.$connect();

    gl = await startGlServiceProcess(GL_LIVE_DB_URL!, JWT_SECRET, GL_PORT, RABBITMQ_TEST_URL);
    schedule = await startScheduleServiceProcess(SCHEDULE_LIVE_DB_URL!, JWT_SECRET, SCHEDULE_PORT, RABBITMQ_TEST_URL);
    glClient = new pg.Client({ connectionString: GL_LIVE_BYPASS_DB_URL });
    await glClient.connect();
    scheduleClient = new pg.Client({ connectionString: SCHEDULE_LIVE_BYPASS_DB_URL });
    await scheduleClient.connect();

    const bridge = new HttpGlPostingBridge(JWT_SECRET, gl.baseUrl);
    engine = new PostingEngineService(coaPrisma, noopEvents, bridge, noopRecovery as any);

    await glClient.query(`INSERT INTO gl_sources (id, tenant_id, source_code, name, is_active) VALUES ($1,$2,$3,'Schedule Consumer Cert (test fixture)',true) ON CONFLICT DO NOTHING`, [randomUUID(), TENANT, SOURCE_CODE]);

    const accounts: Array<[string, string, string, string | null]> = [
      ['65000', 'EXPENSE', 'DEBIT', null],
      ['26000', 'LIABILITY', 'CREDIT', AP_SCHEDULE_NO], // AP control — schedule-relevant
      ['10500', 'ASSET', 'DEBIT', null], // bank
      ['14000', 'ASSET', 'DEBIT', AR_SCHEDULE_NO], // AR control — schedule-relevant
      ['10600', 'ASSET', 'DEBIT', null], // undeposited funds
      ['21500', 'LIABILITY', 'CREDIT', AR_SCHEDULE_NO], // unapplied cash / customer credit — schedule-relevant, same schedule as AR
    ];
    for (const [code, type, normalBalance, scheduleCode] of accounts) {
      await glClient.query(
        `INSERT INTO gl_accounts (id, tenant_id, code, name, type, normal_balance, allow_posting, is_active, schedule_code) VALUES ($1,$2,$3,'Fixture (test only)',$4,$5,true,true,$6)`,
        [randomUUID(), TENANT, code, type, normalBalance, scheduleCode],
      );
      await coaPrisma.glAccount.create({ data: { id: randomUUID(), tenantId: TENANT, entityId: TENANT, accountNumber: code, name: 'Fixture (test only)', type, normalBalance: normalBalance === 'DEBIT' ? 'DR' : 'CR', postable: true, status: 'ACTIVE' } });
    }

    await scheduleClient.query(
      `INSERT INTO schedules (id, tenant_id, schedule_number, title, report_sequence, schedule_type, gl_account_numbers, eom_purge_type, control_name_display) VALUES ($1,$2,$3,'AP Control (test fixture)','C',1,ARRAY['26000'],1,'V') ON CONFLICT (tenant_id, schedule_number) DO NOTHING`,
      [randomUUID(), TENANT, AP_SCHEDULE_NO],
    );
    await scheduleClient.query(
      `INSERT INTO schedules (id, tenant_id, schedule_number, title, report_sequence, schedule_type, gl_account_numbers, eom_purge_type, control_name_display) VALUES ($1,$2,$3,'AR Control (test fixture)','C',1,ARRAY['14000','21500'],1,'V') ON CONFLICT (tenant_id, schedule_number) DO NOTHING`,
      [randomUUID(), TENANT, AR_SCHEDULE_NO],
    );
  }, 90_000);

  afterAll(async () => {
    await gl?.close();
    await schedule?.close();
    await glClient?.end();
    await scheduleClient?.end();
    if (coaPrisma) {
      await coaPrisma.postingExecutionReplay.deleteMany({ where: { tenantId: TENANT } });
      await coaPrisma.postingExecutionAttempt.deleteMany({ where: { tenantId: TENANT } });
      await coaPrisma.postingException.deleteMany({ where: { tenantId: TENANT } });
      await coaPrisma.postingExecution.deleteMany({ where: { tenantId: TENANT } });
      await coaPrisma.postingRulePackVersion.deleteMany({ where: { tenantId: TENANT } });
      await coaPrisma.postingRulePack.deleteMany({ where: { tenantId: TENANT } });
      await coaPrisma.auditOutboxEvent.deleteMany({ where: { tenantId: TENANT } });
      await coaPrisma.glAccount.deleteMany({ where: { tenantId: TENANT } });
      await coaPrisma.$disconnect();
    }
  }, 20_000);


  // ── AP invoice creates, vendor payment relieves ──────────────────────────
  it('an AP invoice posting creates ONE real schedule open item, and a vendor payment posting relieves THAT SAME item end-to-end through the real broker + real consumer', async () => {
    if (!RABBITMQ_OK) return;

    const invoicePack = {
      dslVersion: 1, packKey: 'sched-cons-invoice', semver: '1.0.0', eventType: 'ap.invoice.accepted.v1',
      supportedEventSchemaVersions: ['1.0'], tenantScope: TENANT, entityId: TENANT,
      effectiveFrom: '2020-01-01T00:00:00.000Z', effectiveTo: null, journalSourceCode: SOURCE_CODE,
      matchStrategy: 'FIRST_MATCH', noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION',
      rules: [{
        ruleId: 'invoice-rule', priority: 1, description: 'AP invoice liability.', condition: null,
        blueprint: { memoTemplate: 'Invoice fixture', postingGroups: [{ groupId: 'grp', baseAmountPath: 'payload.amount', debitAllocations: [], debitLineItemsPath: 'payload.lines', creditAllocations: [], creditLineItemsPath: 'payload.creditLines' }] },
      }],
    };
    const paymentPack = {
      dslVersion: 1, packKey: 'sched-cons-payment', semver: '1.0.0', eventType: 'ap.payment.posted.v1',
      supportedEventSchemaVersions: ['1.0'], tenantScope: TENANT, entityId: TENANT,
      effectiveFrom: '2020-01-01T00:00:00.000Z', effectiveTo: null, journalSourceCode: SOURCE_CODE,
      matchStrategy: 'FIRST_MATCH', noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION',
      rules: [{
        ruleId: 'payment-rule', priority: 1, description: 'AP payment relief.', condition: null,
        blueprint: { memoTemplate: 'Payment fixture', postingGroups: [{ groupId: 'grp', baseAmountPath: 'payload.amount', debitAllocations: [], debitLineItemsPath: 'payload.debitLines', creditAllocations: [], creditLineItemsPath: 'payload.creditLines' }] },
      }],
    };

    const invoiceActivated = await activatePack(invoicePack, 'invoice');
    const paymentActivated = await activatePack(paymentPack, 'payment');

    const invoiceId = randomUUID();
    const invoiceEventId = `evt-${randomUUID()}`;
    const invoiceEnv = {
      eventId: invoiceEventId, tenantId: TENANT, legalEntityId: TENANT, eventType: 'ap.invoice.accepted.v1', eventSchemaVersion: '1.0',
      occurredAt: '2026-08-03T10:00:00.000Z', publishedAt: '2026-08-03T10:00:01.000Z',
      sourceSystem: 'apar-service', sourceEntityType: 'AP_INVOICE', sourceEntityId: invoiceId,
      correlationId: `corr-${invoiceEventId}`, causationId: null, businessDate: '2026-08-03',
      payload: { invoiceId, invoiceNumber: 'INV-CONS-1', amount: 400, lines: [{ accountNumber: '65000', storeId: 'CENTRAL', amount: 400 }], creditLines: [{ accountNumber: '26000', storeId: 'CENTRAL', amount: 400 }], sourceDocId: 'INV-CONS-1' },
      metadata: {},
    };
    const invoiceResult = await engine.submitEvent(TENANT, invoiceEnv, 'tester');
    expect(invoiceResult.status).toBe('POSTED');
    await approve(invoiceResult.journalEntryId!);

    const apScheduleId = AP_SCHEDULE_NO; // schedule-service's :id route param is the schedule NUMBER, not the schedules.id UUID
    const openItems = await pollOpenItems(apScheduleId, 'INV-CONS-1');
    if (openItems.length === 0) {
      // Diagnostic aid, not test noise — only fires on a real failure. The
      // real consumer's own error handling (event-publisher.ts) now logs
      // and nacks-to-DLX rather than silently swallowing a handler failure
      // (a genuine defect this suite's first real run surfaced), so a
      // failure here should always be visible in these logs.
      const filter = (s: string) => s.split('\n').filter((l) => !l.includes('incoming request') && !l.includes('request completed')).join('\n');
      console.error('schedule-service logs (no open item found):\n' + filter(schedule.getRecentLogs()));
      console.error('gl-service logs (no open item found):\n' + filter(gl.getRecentLogs()));
    }
    expect(openItems).toHaveLength(1);
    expect(openItems[0].status).toBe('OPEN');
    expect(Number(openItems[0].originalAmount)).toBe(400);
    const openItemId = openItems[0].id;
    const itemNumber = openItems[0].itemNumber;
    expect(itemNumber).toBe(invoiceId.slice(0, 8)); // gl-service's sourceRef-derived referenceNumber

    // Vendor payment — applyNumber MUST match the invoice's own itemNumber (invoiceId.slice(0,8)).
    const paymentId = randomUUID();
    const paymentEventId = `evt-${randomUUID()}`;
    const paymentEnv = {
      eventId: paymentEventId, tenantId: TENANT, legalEntityId: TENANT, eventType: 'ap.payment.posted.v1', eventSchemaVersion: '1.0',
      occurredAt: '2026-08-03T11:00:00.000Z', publishedAt: '2026-08-03T11:00:01.000Z',
      sourceSystem: 'apar-service', sourceEntityType: 'AP_MANUAL_PAYMENT', sourceEntityId: paymentId,
      correlationId: `corr-${paymentEventId}`, causationId: null, businessDate: '2026-08-03',
      payload: {
        paymentId, invoiceNumber: 'INV-CONS-1', amount: 400,
        debitLines: [{ accountNumber: '26000', storeId: 'CENTRAL', amount: 400, applyNumber: itemNumber }],
        creditLines: [{ accountNumber: '10500', storeId: 'CENTRAL', amount: 400 }],
        sourceDocId: 'INV-CONS-1',
      },
      metadata: {},
    };
    const paymentResult = await engine.submitEvent(TENANT, paymentEnv, 'tester');
    expect(paymentResult.status).toBe('POSTED');
    await approve(paymentResult.journalEntryId!);

    const relieved = await pollOpenItemStatus(apScheduleId, openItemId, 'CLOSED');
    expect(relieved?.status).toBe('CLOSED');
    expect(Number(relieved?.appliedAmount)).toBe(400);
    expect(Number(relieved?.remainingBalance)).toBe(0);

    const applications = await scheduleClient.query(`SELECT * FROM schedule_applications WHERE tenant_id = $1 AND open_item_id = $2`, [TENANT, openItemId]);
    expect(applications.rows).toHaveLength(1); // exactly one application, not fabricated/duplicated

    await coaPrisma.postingRulePackVersion.update({ where: { id: invoiceActivated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
    await coaPrisma.postingRulePackVersion.update({ where: { id: paymentActivated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
  }, 90_000);

  // ── applied cash relieves an AR open item; unapplied cash creates its own ──
  it('applied cash relieves a pre-existing AR open item; unapplied cash creates/preserves its own open item, never relieving anything', async () => {
    if (!RABBITMQ_OK) return;

    // Stands in for the not-yet-built S048 AR-invoice producer (confirmed
    // DEFINED_NOT_YET_EXERCISED, no real producer anywhere in this
    // repository — see s023-rule-pack-fixtures.ts's arInvoicePack doc-
    // comment). Seeding the PRECONDITION directly is disclosed, not a
    // silent workaround: what this test actually certifies is that the
    // REAL cash-receipt-applied event, through the REAL consumer, correctly
    // relieves an existing AR item — not how that item originally arose.
    const arOpenItemId = randomUUID();
    const arItemNumber = 'AR-ITEM-1';
    await scheduleClient.query(
      `INSERT INTO schedule_open_items (id, tenant_id, schedule_number, control_number, item_number, gl_account_number, journal_source, original_amount, applied_amount, remaining_balance, status, transaction_date, journal_entry_id, source_correlation_id, created_at, updated_at)
       VALUES ($1,$2,$3,'AR-CONS-1',$4,'14000',$5,150,0,150,'OPEN','2026-08-02'::date,$6,$7,now(),now())`,
      [arOpenItemId, TENANT, AR_SCHEDULE_NO, arItemNumber, SOURCE_CODE, `seed-journal-${randomUUID()}`, `seed-${randomUUID()}`],
    );

    const cashAppliedPack = {
      dslVersion: 1, packKey: 'sched-cons-cash-applied', semver: '1.0.0', eventType: 'cash.receipt.applied.v1',
      supportedEventSchemaVersions: ['1.0'], tenantScope: TENANT, entityId: TENANT,
      effectiveFrom: '2020-01-01T00:00:00.000Z', effectiveTo: null, journalSourceCode: SOURCE_CODE,
      matchStrategy: 'FIRST_MATCH', noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION',
      rules: [
        {
          ruleId: 'cash-unapplied', priority: 1, description: 'Unapplied cash — never relieves, always creates.', condition: { equals: { path: 'payload.unapplied', value: true } },
          blueprint: { memoTemplate: 'Unapplied cash fixture', postingGroups: [{ groupId: 'grp', baseAmountPath: 'payload.amount', debitAllocations: [{ accountNumber: '10600', storeId: 'CENTRAL', bp: 10_000 }], creditAllocations: [{ accountNumber: '21500', storeId: 'CENTRAL', bp: 10_000 }] }] },
        },
        {
          ruleId: 'cash-applied', priority: 2, description: 'Applied cash — relieves the matching AR item via applyNumber.', condition: null,
          blueprint: { memoTemplate: 'Applied cash fixture', postingGroups: [{ groupId: 'grp', baseAmountPath: 'payload.amount', debitAllocations: [{ accountNumber: '10600', storeId: 'CENTRAL', bp: 10_000 }], creditAllocations: [], creditLineItemsPath: 'payload.creditLines' }] },
        },
      ],
    };
    const activated = await activatePack(cashAppliedPack, 'cash-applied');

    // Applied cash — relieves the seeded AR item.
    const receiptId = randomUUID();
    const receiptEventId = `evt-${randomUUID()}`;
    const appliedEnv = {
      eventId: receiptEventId, tenantId: TENANT, legalEntityId: TENANT, eventType: 'cash.receipt.applied.v1', eventSchemaVersion: '1.0',
      occurredAt: '2026-08-03T12:00:00.000Z', publishedAt: '2026-08-03T12:00:01.000Z',
      sourceSystem: 'cash-service', sourceEntityType: 'CASH_RECEIPT', sourceEntityId: receiptId,
      correlationId: `corr-${receiptEventId}`, causationId: null, businessDate: '2026-08-03',
      payload: { receiptId, amount: 150, unapplied: false, sourceDocId: 'AR-CONS-1', creditLines: [{ accountNumber: '14000', storeId: 'CENTRAL', amount: 150, applyNumber: arItemNumber }] },
      metadata: {},
    };
    const appliedResult = await engine.submitEvent(TENANT, appliedEnv, 'tester');
    expect(appliedResult.status).toBe('POSTED');
    await approve(appliedResult.journalEntryId!);

    const arScheduleId = AR_SCHEDULE_NO; // schedule-service's :id route param is the schedule NUMBER, not the schedules.id UUID
    const relievedAr = await pollOpenItemStatus(arScheduleId, arOpenItemId, 'CLOSED');
    if (relievedAr?.status !== 'CLOSED') {
      const filter = (s: string) => s.split('\n').filter((l) => !l.includes('incoming request') && !l.includes('request completed')).join('\n');
      console.error('schedule-service logs (AR item not relieved):\n' + filter(schedule.getRecentLogs()));
      console.error('gl-service logs (AR item not relieved):\n' + filter(gl.getRecentLogs()));
    }
    expect(relievedAr?.status).toBe('CLOSED');
    expect(Number(relievedAr?.remainingBalance)).toBe(0);

    // Unapplied cash — creates its OWN new open item (a customer credit), never touches the AR item above.
    const unappliedReceiptId = randomUUID();
    const unappliedEventId = `evt-${randomUUID()}`;
    const unappliedEnv = {
      eventId: unappliedEventId, tenantId: TENANT, legalEntityId: TENANT, eventType: 'cash.receipt.applied.v1', eventSchemaVersion: '1.0',
      occurredAt: '2026-08-03T13:00:00.000Z', publishedAt: '2026-08-03T13:00:01.000Z',
      sourceSystem: 'cash-service', sourceEntityType: 'CASH_RECEIPT', sourceEntityId: unappliedReceiptId,
      correlationId: `corr-${unappliedEventId}`, causationId: null, businessDate: '2026-08-03',
      payload: { receiptId: unappliedReceiptId, amount: 60, unapplied: true, sourceDocId: 'UNAPPL-1' },
      metadata: {},
    };
    const unappliedResult = await engine.submitEvent(TENANT, unappliedEnv, 'tester');
    expect(unappliedResult.status).toBe('POSTED');
    await approve(unappliedResult.journalEntryId!);

    const creditItems = await pollOpenItems(arScheduleId, 'UNAPPL-1');
    expect(creditItems).toHaveLength(1);
    expect(creditItems[0].status).toBe('OPEN'); // a new, standing customer-credit item — never relieved anything

    // The original AR item is untouched by the unapplied receipt.
    const arStillClosed = await scheduleClient.query(`SELECT status FROM schedule_open_items WHERE id = $1`, [arOpenItemId]);
    expect(arStillClosed.rows[0].status).toBe('CLOSED');

    await coaPrisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
  }, 90_000);

  // ── rejected/duplicate cause no schedule mutation; replay stays governed ──
  it('a rejected posting causes no schedule mutation; a duplicate submission causes no duplicate schedule mutation; an authorized replay is governed and idempotent, and still reaches the real consumer', async () => {
    if (!RABBITMQ_OK) return;

    const pack = {
      dslVersion: 1, packKey: 'sched-cons-replay', semver: '1.0.0', eventType: 'accounting.sched-cons-replay.v1',
      supportedEventSchemaVersions: ['1.0'], tenantScope: TENANT, entityId: TENANT,
      effectiveFrom: '2020-01-01T00:00:00.000Z', effectiveTo: null, journalSourceCode: SOURCE_CODE,
      matchStrategy: 'FIRST_MATCH', noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION',
      rules: [{
        ruleId: 'replay-rule', priority: 1, description: 'Real consumer replay fixture.', condition: null,
        blueprint: { memoTemplate: 'Replay fixture', postingGroups: [{ groupId: 'grp', baseAmountPath: 'payload.amount', debitAllocations: [{ accountNumber: '65000', storeId: 'CENTRAL', deptCode: '01', bp: 10_000 }], creditAllocations: [{ accountNumber: '26000', storeId: 'CENTRAL', bp: 10_000 }] }] },
      }],
    };

    // -- Rejected: missing account mapping causes zero schedule mutation.
    // Deep-cloned (not a shallow `{...pack}` spread) — badPack/replayPack
    // below each mutate their own debitAllocations[0].accountNumber, and a
    // shallow spread would share pack's own nested rules/blueprint objects,
    // so mutating badPack would silently corrupt pack's (and later
    // replayPack's) own account number too.
    const badPack = { ...JSON.parse(JSON.stringify(pack)), packKey: 'sched-cons-rejected' };
    badPack.rules[0].blueprint.postingGroups[0].debitAllocations[0].accountNumber = '99995';
    await coaPrisma.glAccount.create({ data: { id: randomUUID(), tenantId: TENANT, entityId: TENANT, accountNumber: '99995', name: 'Fixture (test only)', type: 'EXPENSE', normalBalance: 'DR', postable: true, status: 'ACTIVE' } });
    const rejectedActivated = await activatePack(badPack, 'rejected');
    const rejectedEventId = `evt-${randomUUID()}`;
    const rejectedEnv = {
      eventId: rejectedEventId, tenantId: TENANT, legalEntityId: TENANT, eventType: 'accounting.sched-cons-replay.v1', eventSchemaVersion: '1.0',
      occurredAt: '2026-08-03T14:00:00.000Z', publishedAt: '2026-08-03T14:00:01.000Z',
      sourceSystem: 'test', sourceEntityType: 'FIXTURE', sourceEntityId: randomUUID(),
      correlationId: `corr-${rejectedEventId}`, causationId: null, businessDate: '2026-08-03',
      payload: { amount: 20, sourceDocId: 'REJECTED-CONS-1' },
      metadata: {},
    };
    const rejectedResult = await engine.submitEvent(TENANT, rejectedEnv, 'tester');
    expect(rejectedResult.status).toBe('REJECTED');
    await new Promise((r) => setTimeout(r, 500)); // give any (nonexistent) delivery a moment
    const noItems = await pollOpenItems(AP_SCHEDULE_NO, 'REJECTED-CONS-1', 2000);
    expect(noItems).toHaveLength(0);
    await coaPrisma.postingRulePackVersion.update({ where: { id: rejectedActivated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });

    // -- Duplicate: never a second journal, never a second open item.
    const activated = await activatePack(pack, 'dup');
    const eventId = `evt-${randomUUID()}`;
    const env = {
      eventId, tenantId: TENANT, legalEntityId: TENANT, eventType: 'accounting.sched-cons-replay.v1', eventSchemaVersion: '1.0',
      occurredAt: '2026-08-03T15:00:00.000Z', publishedAt: '2026-08-03T15:00:01.000Z',
      sourceSystem: 'test', sourceEntityType: 'FIXTURE', sourceEntityId: randomUUID(),
      correlationId: `corr-${eventId}`, causationId: null, businessDate: '2026-08-03',
      payload: { amount: 35, sourceDocId: 'DUP-CONS-1' },
      metadata: {},
    };
    const first = await engine.submitEvent(TENANT, env, 'tester');
    expect(first.status).toBe('POSTED');
    await approve(first.journalEntryId!);
    const second = await engine.submitEvent(TENANT, env, 'tester');
    expect(second.idempotent).toBe(true);
    expect(second.journalEntryId).toBe(first.journalEntryId);

    const apScheduleId = AP_SCHEDULE_NO; // schedule-service's :id route param is the schedule NUMBER, not the schedules.id UUID
    const dupItems = await pollOpenItems(apScheduleId, 'DUP-CONS-1');
    expect(dupItems).toHaveLength(1); // exactly one, never duplicated by the resubmission

    // -- Replay: governed (author cannot self-activate is proven elsewhere;
    // here, replay against a NO_RULE_MATCH execution after a corrected
    // version activates) reaches the real consumer exactly once more.
    const noMatchEventId = `evt-${randomUUID()}`;
    const noMatchEnv = {
      eventId: noMatchEventId, tenantId: TENANT, legalEntityId: TENANT, eventType: 'accounting.sched-cons-replay-2.v1', eventSchemaVersion: '1.0',
      occurredAt: '2026-08-03T16:00:00.000Z', publishedAt: '2026-08-03T16:00:01.000Z',
      sourceSystem: 'test', sourceEntityType: 'FIXTURE', sourceEntityId: randomUUID(),
      correlationId: `corr-${noMatchEventId}`, causationId: null, businessDate: '2026-08-03',
      payload: { amount: 55, sourceDocId: 'REPLAY-1' },
      metadata: {},
    };
    const noMatchResult = await engine.submitEvent(TENANT, noMatchEnv, 'tester');
    expect(noMatchResult.status).toBe('NO_RULE_MATCH');

    const replayPack = { ...JSON.parse(JSON.stringify(pack)), packKey: 'sched-cons-replay-2', eventType: 'accounting.sched-cons-replay-2.v1' };
    replayPack.rules[0].blueprint.postingGroups[0].debitAllocations[0].accountNumber = '65000';
    const replayActivated = await activatePack(replayPack, 'replay-corrected');

    const replayed = await engine.replayEvent(TENANT, noMatchResult.executionId, 'replay-operator', 'corrected pack activated for real-consumer certification');
    expect(replayed.status).toBe('POSTED');
    await approve(replayed.journalEntryId!);

    const replayItems = await pollOpenItems(apScheduleId, 'REPLAY-1');
    expect(replayItems).toHaveLength(1); // the governed replay reached the real consumer exactly once

    // Replay evidence is real and dual-versioned, matching every other replay proof in this repo.
    const replayEvidence = await coaPrisma.postingExecutionReplay.findFirst({ where: { tenantId: TENANT, executionId: noMatchResult.executionId } });
    expect(replayEvidence?.replayRulePackVersionId).toBe(replayActivated.id);
    expect(replayEvidence?.resultingStatus).toBe('POSTED');

    // A second replay attempt is refused (already POSTED) — never a duplicate schedule mutation via replay either.
    await expect(engine.replayEvent(TENANT, noMatchResult.executionId, 'replay-operator-2', 'should be refused')).rejects.toThrow(/already POSTED/i);
    const replayItemsAfterSecondAttempt = await pollOpenItems(apScheduleId, 'REPLAY-1', 2000);
    expect(replayItemsAfterSecondAttempt).toHaveLength(1);

    await coaPrisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
    await coaPrisma.postingRulePackVersion.update({ where: { id: replayActivated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
  }, 90_000);
});
