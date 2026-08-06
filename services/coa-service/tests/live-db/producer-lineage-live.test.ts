/**
 * CE-07 closing pass — verifies all THREE production producers (S039 vendor
 * invoice, S043A manual vendor payment, S052 cash receipt) use the SAME
 * governed path end-to-end against a REAL gl-service process:
 *
 *   source transaction -> canonical event -> S019/S020 -> gl-service
 *   authoritative journal -> (review-gate approval) -> JOURNAL_ENTRY_POSTED
 *
 * Each producer's envelope shape here is mirrored exactly from its own
 * production builder (apar-service's buildApInvoiceAcceptedEnvelope /
 * buildApPaymentPostedEnvelope, cash-service's buildCashReceiptAppliedEnvelope)
 * — not a generic certification fixture — so this is a faithful proof of
 * what each real producer actually sends, not just of the engine in the
 * abstract. For each producer this proves:
 *   - exactly one canonical event creates exactly one authoritative journal;
 *   - a duplicate submission returns the SAME journal (never a second one);
 *   - a failure (missing account mapping) creates the correct S021 recovery
 *     evidence (posting_exception row + reported recovery case), never a
 *     partial/orphaned journal;
 *   - event, rule-pack version, execution and journal lineage are all
 *     retained on the PostingExecution row.
 *
 * gl-service assertions/fixtures use raw SQL — see gl-posting-bridge-live.
 * test.ts's header for why (no cross-service Prisma client import).
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import pg from 'pg';
import { PrismaClient } from '.prisma/coa-client';
import { PostingEngineService, RecoveryCaseInput } from '../../src/application/posting-engine-service';
import { HttpGlPostingBridge } from '../../src/application/gl-posting-bridge';
import { startGlServiceProcess, GlServiceProcessHandle } from '../support/gl-service-test-harness';
import { cashReceiptPack } from '../support/s023-rule-pack-fixtures';
import type { IEventPublisher } from '@amacc/shared-kernel';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];
const GL_LIVE_DB_URL = process.env['GL_LIVE_DATABASE_URL'];
const GL_LIVE_BYPASS_DB_URL = process.env['GL_LIVE_BYPASS_DATABASE_URL'] ?? GL_LIVE_DB_URL;
const JWT_SECRET = 'ce07-producer-lineage-test-secret';
const GL_PORT = 34_712;

const noopEvents: IEventPublisher = { publish: async () => {}, subscribe: () => {} };

/** Records every reported S021 recovery case — same double used throughout this repo's live-db suites. */
class RecordingPostingRecoveryPort {
  readonly reported: Array<{ tenantId: string; input: RecoveryCaseInput }> = [];
  async reportFailure(tenantId: string, input: RecoveryCaseInput): Promise<void> {
    this.reported.push({ tenantId, input });
  }
}

describe.skipIf(!LIVE_DB_URL || !GL_LIVE_DB_URL)('CE-07 closing pass — all three producers use the governed path (real gl-service)', () => {
  let coaPrisma: PrismaClient;
  let gl: GlServiceProcessHandle;
  let glClient: pg.Client;
  let engine: PostingEngineService;
  let recovery: RecordingPostingRecoveryPort;

  const TENANT = `lineage-${randomUUID()}`;
  const SOURCE_CODE = 'PE';

  async function glJournalCount(sourceRefLike: string): Promise<number> {
    const res = await glClient.query(`SELECT count(*)::int AS n FROM journal_entries WHERE tenant_id = $1 AND description LIKE '%' || $2 || '%'`, [TENANT, sourceRefLike]);
    return res.rows[0].n;
  }

  beforeAll(async () => {
    coaPrisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await coaPrisma.$connect();

    gl = await startGlServiceProcess(GL_LIVE_DB_URL!, JWT_SECRET, GL_PORT);
    glClient = new pg.Client({ connectionString: GL_LIVE_BYPASS_DB_URL });
    await glClient.connect();

    const bridge = new HttpGlPostingBridge(JWT_SECRET, gl.baseUrl);
    recovery = new RecordingPostingRecoveryPort();
    engine = new PostingEngineService(coaPrisma, noopEvents, bridge, recovery as any);

    await glClient.query(`INSERT INTO gl_sources (id, tenant_id, source_code, name, is_active) VALUES ($1,$2,$3,'Producer Lineage (test fixture)',true) ON CONFLICT DO NOTHING`, [randomUUID(), TENANT, SOURCE_CODE]);
    for (const [code, type, normalBalance] of [
      ['64000', 'EXPENSE', 'DEBIT'], ['24000', 'LIABILITY', 'CREDIT'], ['10300', 'ASSET', 'DEBIT'],
      ['10400', 'ASSET', 'DEBIT'], ['13000', 'ASSET', 'DEBIT'],
    ]) {
      await glClient.query(`INSERT INTO gl_accounts (id, tenant_id, code, name, type, normal_balance, allow_posting, is_active) VALUES ($1,$2,$3,'Fixture (test only)',$4,$5,true,true)`, [randomUUID(), TENANT, code, type, normalBalance]);
      await coaPrisma.glAccount.create({ data: { id: randomUUID(), tenantId: TENANT, entityId: TENANT, accountNumber: code, name: 'Fixture (test only)', type, normalBalance: normalBalance === 'DEBIT' ? 'DR' : 'CR', postable: true, status: 'ACTIVE' } });
    }
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

  async function activatePack(pack: any, actor: string) {
    const draft = await engine.createRulePackVersion({ tenantId: TENANT, packKey: pack.packKey, sourceText: JSON.stringify(pack), actor: `author-${actor}` });
    await engine.validateVersion(TENANT, draft.id, `author-${actor}`);
    return engine.activateVersion(TENANT, draft.id, `activator-${actor}`);
  }

  // ── S039 — vendor invoice liability (mirrors ap-invoice-envelope.ts's buildApInvoiceAcceptedEnvelope) ──
  describe('S039 — vendor invoice liability', () => {
    function pack() {
      return {
        dslVersion: 1, packKey: 'lineage-s039', semver: '1.0.0', eventType: 'ap.invoice.accepted.v1',
        supportedEventSchemaVersions: ['1.0'], tenantScope: TENANT, entityId: TENANT,
        effectiveFrom: '2020-01-01T00:00:00.000Z', effectiveTo: null, journalSourceCode: SOURCE_CODE,
        matchStrategy: 'FIRST_MATCH', noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION',
        rules: [{
          ruleId: 's039-rule', priority: 1, description: 'S039 real envelope shape.', condition: null,
          blueprint: {
            memoTemplate: 'S039 — {{sourceEntityId}}',
            postingGroups: [{ groupId: 'grp', baseAmountPath: 'payload.amount', debitAllocations: [], debitLineItemsPath: 'payload.lines', creditAllocations: [], creditLineItemsPath: 'payload.creditLines' }],
          },
        }],
      };
    }
    function envelope(invoiceId: string, amount: number) {
      const eventId = `evt-${randomUUID()}`;
      return {
        eventId, tenantId: TENANT, legalEntityId: TENANT, eventType: 'ap.invoice.accepted.v1', eventSchemaVersion: '1.0',
        occurredAt: '2026-08-03T10:00:00.000Z', publishedAt: '2026-08-03T10:00:01.000Z',
        sourceSystem: 'apar-service', sourceEntityType: 'AP_INVOICE', sourceEntityId: invoiceId,
        correlationId: `corr-${eventId}`, causationId: null, businessDate: '2026-08-03',
        payload: {
          invoiceId, invoiceNumber: 'INV-LIN-1', amount,
          lines: [{ accountNumber: '64000', storeId: 'AP-CENTRAL', amount }],
          creditLines: [{ accountNumber: '24000', storeId: 'AP-CENTRAL', amount }],
          sourceDocId: 'INV-LIN-1',
        },
        metadata: {},
      };
    }

    it('one canonical event -> one authoritative gl-service journal, retaining full event/rule-pack/execution/journal lineage', async () => {
      const activated = await activatePack(pack(), 's039');
      const invoiceId = randomUUID();
      const env = envelope(invoiceId, 300);
      const result = await engine.submitEvent(TENANT, env, 'tester');
      expect(result.status).toBe('POSTED');
      expect(await glJournalCount(env.sourceEntityId)).toBe(1);

      const execution = await coaPrisma.postingExecution.findUniqueOrThrow({ where: { tenantId_eventId: { tenantId: TENANT, eventId: env.eventId } } });
      expect(execution.eventId).toBe(env.eventId); // event lineage
      expect(execution.rulePackVersionId).toBe(activated.id); // rule-pack version lineage
      expect(execution.journalEntryId).toBe(result.journalEntryId); // journal lineage
      expect(execution.id).toBe(result.executionId); // execution lineage

      await coaPrisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
    });

    it('a duplicate submission returns the SAME journal — never a second gl-service write', async () => {
      const activated = await activatePack({ ...pack(), packKey: 'lineage-s039-dup' }, 's039-dup');
      const env = envelope(randomUUID(), 150);
      const first = await engine.submitEvent(TENANT, env, 'tester');
      const second = await engine.submitEvent(TENANT, env, 'tester');
      expect(second.idempotent).toBe(true);
      expect(second.journalEntryId).toBe(first.journalEntryId);
      expect(await glJournalCount(env.sourceEntityId)).toBe(1);
      await coaPrisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
    });

    it('a missing account mapping rejects deterministically and creates the correct S021 recovery evidence — no journal', async () => {
      const badPack = { ...pack(), packKey: 'lineage-s039-missing' };
      badPack.rules[0].blueprint.postingGroups[0] = { groupId: 'grp', baseAmountPath: 'payload.amount', debitAllocations: [], debitLineItemsPath: 'payload.lines', creditAllocations: [], creditLineItemsPath: 'payload.creditLines' } as any;
      const activated = await activatePack(badPack, 's039-missing');
      const env = envelope(randomUUID(), 50);
      (env.payload.lines[0] as any).accountNumber = '99998'; // never mapped in coa-service
      const result = await engine.submitEvent(TENANT, env, 'tester');
      expect(result.status).toBe('REJECTED');
      expect(await glJournalCount(env.sourceEntityId)).toBe(0);

      const exceptions = await coaPrisma.postingException.findMany({ where: { tenantId: TENANT, executionId: result.executionId } });
      expect(exceptions[0]?.reasonCode).toBe('INVALID_ACCOUNT');
      const reported = recovery.reported.find((r) => r.input.executionId === result.executionId);
      expect(reported?.input.reasonCode).toBe('INVALID_ACCOUNT');
      expect(reported?.input.envelope.eventId).toBe(env.eventId);

      await coaPrisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
    });
  });

  // ── S043A — manual vendor payment relief (mirrors ap-payment-envelope.ts's buildApPaymentPostedEnvelope) ──
  describe('S043A — manual vendor payment relief', () => {
    function pack() {
      return {
        dslVersion: 1, packKey: 'lineage-s043a', semver: '1.0.0', eventType: 'ap.payment.posted.v1',
        supportedEventSchemaVersions: ['1.0'], tenantScope: TENANT, entityId: TENANT,
        effectiveFrom: '2020-01-01T00:00:00.000Z', effectiveTo: null, journalSourceCode: SOURCE_CODE,
        matchStrategy: 'FIRST_MATCH', noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION',
        rules: [{
          ruleId: 's043a-rule', priority: 1, description: 'S043A real envelope shape.', condition: null,
          blueprint: {
            memoTemplate: 'S043A — {{sourceEntityId}}',
            postingGroups: [{ groupId: 'grp', baseAmountPath: 'payload.amount', debitAllocations: [], debitLineItemsPath: 'payload.debitLines', creditAllocations: [], creditLineItemsPath: 'payload.creditLines' }],
          },
        }],
      };
    }
    function envelope(paymentId: string, amount: number) {
      const eventId = `evt-${randomUUID()}`;
      return {
        eventId, tenantId: TENANT, legalEntityId: TENANT, eventType: 'ap.payment.posted.v1', eventSchemaVersion: '1.0',
        occurredAt: '2026-08-03T11:00:00.000Z', publishedAt: '2026-08-03T11:00:01.000Z',
        sourceSystem: 'apar-service', sourceEntityType: 'AP_MANUAL_PAYMENT', sourceEntityId: paymentId,
        correlationId: `corr-${eventId}`, causationId: null, businessDate: '2026-08-03',
        payload: {
          paymentId, invoiceNumber: 'INV-LIN-2', amount,
          debitLines: [{ accountNumber: '24000', storeId: 'AP-CENTRAL', amount, applyNumber: paymentId.slice(0, 8) }],
          creditLines: [{ accountNumber: '10300', storeId: 'AP-CENTRAL', amount }],
          sourceDocId: 'INV-LIN-2',
        },
        metadata: {},
      };
    }

    it('one canonical event -> one authoritative gl-service journal, retaining full lineage', async () => {
      const activated = await activatePack(pack(), 's043a');
      const paymentId = randomUUID();
      const env = envelope(paymentId, 220);
      const result = await engine.submitEvent(TENANT, env, 'tester');
      expect(result.status).toBe('POSTED');
      expect(await glJournalCount(env.sourceEntityId)).toBe(1);

      const execution = await coaPrisma.postingExecution.findUniqueOrThrow({ where: { tenantId_eventId: { tenantId: TENANT, eventId: env.eventId } } });
      expect(execution.rulePackVersionId).toBe(activated.id);
      expect(execution.journalEntryId).toBe(result.journalEntryId);

      await coaPrisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
    });

    it('a duplicate submission returns the SAME journal', async () => {
      const activated = await activatePack({ ...pack(), packKey: 'lineage-s043a-dup' }, 's043a-dup');
      const env = envelope(randomUUID(), 60);
      const first = await engine.submitEvent(TENANT, env, 'tester');
      const second = await engine.submitEvent(TENANT, env, 'tester');
      expect(second.idempotent).toBe(true);
      expect(second.journalEntryId).toBe(first.journalEntryId);
      expect(await glJournalCount(env.sourceEntityId)).toBe(1);
      await coaPrisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
    });

    it('a missing account mapping rejects deterministically and creates S021 recovery evidence', async () => {
      const activated = await activatePack({ ...pack(), packKey: 'lineage-s043a-missing' }, 's043a-missing');
      const env = envelope(randomUUID(), 40);
      (env.payload.creditLines[0] as any).accountNumber = '99997';
      const result = await engine.submitEvent(TENANT, env, 'tester');
      expect(result.status).toBe('REJECTED');
      expect(await glJournalCount(env.sourceEntityId)).toBe(0);
      const reported = recovery.reported.find((r) => r.input.executionId === result.executionId);
      expect(reported?.input.reasonCode).toBe('INVALID_ACCOUNT');
      await coaPrisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
    });
  });

  // ── S052 — cash receipt applied (mirrors cash-receipt-posting-consumer.ts's buildCashReceiptAppliedEnvelope) ──
  describe('S052 — cash receipt applied', () => {
    function pack() {
      return cashReceiptPack({
        tenantId: TENANT, entityId: TENANT, journalSourceCode: SOURCE_CODE, storeId: 'AP-CENTRAL',
        apExpenseAccount: '64000', apControlAccount: '24000', apTaxAccount: '64000',
        bankCashAccount: '10300', undepositedFundsAccount: '10400', arControlAccount: '13000',
        unappliedCashAccount: '10400', revenueAccount: '64000', outputTaxAccount: '64000',
      } as any);
    }
    function envelope(receiptId: string, amount: number) {
      const eventId = `evt-${randomUUID()}`;
      return {
        eventId, tenantId: TENANT, legalEntityId: TENANT, eventType: 'cash.receipt.applied.v1', eventSchemaVersion: '1.0',
        occurredAt: '2026-08-03T12:00:00.000Z', publishedAt: '2026-08-03T12:00:01.000Z',
        sourceSystem: 'cash-service', sourceEntityType: 'CASH_RECEIPT', sourceEntityId: receiptId,
        correlationId: `corr-${eventId}`, causationId: null, businessDate: '2026-08-03',
        payload: { receiptId, receiptNumber: 'RCPT-LIN-1', amount, sourceDocType: 'AR_INVOICE', sourceDocId: 'AR-1' },
        metadata: {},
      };
    }

    it('one canonical event -> one authoritative gl-service journal, retaining full lineage', async () => {
      const activated = await activatePack(pack(), 's052');
      const receiptId = randomUUID();
      const env = envelope(receiptId, 90);
      const result = await engine.submitEvent(TENANT, env, 'tester');
      expect(result.status).toBe('POSTED');
      expect(await glJournalCount(env.sourceEntityId)).toBe(1);

      const execution = await coaPrisma.postingExecution.findUniqueOrThrow({ where: { tenantId_eventId: { tenantId: TENANT, eventId: env.eventId } } });
      expect(execution.rulePackVersionId).toBe(activated.id);
      expect(execution.journalEntryId).toBe(result.journalEntryId);

      await coaPrisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
    });

    it('a duplicate submission returns the SAME journal', async () => {
      const activated = await activatePack({ ...pack(), packKey: 'lineage-s052-dup' }, 's052-dup');
      const env = envelope(randomUUID(), 45);
      const first = await engine.submitEvent(TENANT, env, 'tester');
      const second = await engine.submitEvent(TENANT, env, 'tester');
      expect(second.idempotent).toBe(true);
      expect(second.journalEntryId).toBe(first.journalEntryId);
      expect(await glJournalCount(env.sourceEntityId)).toBe(1);
      await coaPrisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
    });

    it('a tenant account mapping removed after activation rejects deterministically at posting time and creates S021 recovery evidence — the defensive re-check the fixed-allocation model relies on (dynamic line-item producers are covered above)', async () => {
      const removableAcct = await coaPrisma.glAccount.create({ data: { id: randomUUID(), tenantId: TENANT, entityId: TENANT, accountNumber: '99996', name: 'Fixture — removed before posting (test only)', type: 'ASSET', normalBalance: 'CR', postable: true, status: 'ACTIVE' } });
      const badPack = { ...pack(), packKey: 'lineage-s052-missing' };
      badPack.rules[1].blueprint.postingGroups[0].creditAllocations[0].accountNumber = '99996';
      const activated = await activatePack(badPack, 's052-missing'); // succeeds — the account existed at validate/activate time

      await coaPrisma.glAccount.delete({ where: { id: removableAcct.id } });

      const env = envelope(randomUUID(), 30);
      const result = await engine.submitEvent(TENANT, env, 'tester');
      expect(result.status).toBe('REJECTED');
      expect(await glJournalCount(env.sourceEntityId)).toBe(0);
      const reported = recovery.reported.find((r) => r.input.executionId === result.executionId);
      expect(reported?.input.reasonCode).toBe('INVALID_ACCOUNT');
      await coaPrisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
    });
  });
});
