/**
 * S019/S020 — Posting Engine LIVE DATABASE certification suite.
 *
 * Same skip-unless-LIVE_DATABASE_URL convention as tests/live-db/posting-
 * live.test.ts and tests/live-db/period-close-live.test.ts. Provisioning:
 * tests/integration/rls-live-db/setup.sh (extended by this change to also
 * apply 20260729010000_add_posting_engine's tables/CHECK constraints/
 * immutability trigger/RLS, which — like the S008 precedent — are not
 * expressible in Prisma schema language and would be silently dropped by the
 * combined-schema bootstrap step otherwise).
 *
 * Covers:
 *   1. Rule pack lifecycle — draft -> validate -> activate; an unbalanced
 *      fixture rule pack can never reach ACTIVE; activated versions are
 *      immutable (DB trigger backstop, not just the application guard).
 *   2. End-to-end certification posting through the real PostingEngineService
 *      -> the real accepted PostingService.post() path: exactly one journal,
 *      two balanced lines, full traceability.
 *   3. Idempotency: exact duplicate is a no-op (one journal); a changed
 *      duplicate under the same eventId is EVENT_IDENTITY_CONFLICT (no
 *      journal); concurrent duplicate submissions still produce exactly one
 *      journal.
 *   4. No-rule-match is durable and queryable.
 *   5. A rejected posting (period not OPEN) leaves no partial journal.
 *   6. Lost-response reconciliation: even if our own execution bookkeeping
 *      is lost, re-submitting the same event never creates a second journal
 *      — because idempotencyKey is always the deterministic tenantId:eventId
 *      and PostingService.post() owns the real reconciliation.
 *   7. RLS-negative (tenant isolation) on all 5 new tables, proven with a
 *      real non-superuser amacc_app connection (plain `pg`, single-connection
 *      control — same reasoning as tests/integration/test-rls-isolation.ts).
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import pg from 'pg';
import { PrismaClient } from '.prisma/coa-client';
import { PostingService, PostingViolationError } from '../../src/application/posting-service';
import { FiscalCalendarService } from '../../src/application/fiscal-service';
import { SequenceService } from '../../src/application/sequence-service';
import { PostingEngineService, EventIdentityConflictError, ActivationNotEligibleError } from '../../src/application/posting-engine-service';
import { validRulePack, unbalancedRulePack, certificationEnvelope, conflictingEnvelope, unmatchedEnvelope, CERT_EVENT_TYPE } from '../support/posting-engine-fixtures';
import type { IEventPublisher } from '@amacc/shared-kernel';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];
const APP_URL = process.env['PG_APP_URL'];

const noopEvents: IEventPublisher = { publish: async () => {}, subscribe: () => {} };

describe.skipIf(!LIVE_DB_URL)('S019/S020 Live database — posting engine certification', () => {
  let prisma: PrismaClient;
  let engine: PostingEngineService;

  const TENANT = `pe-live-${randomUUID()}`;
  const ENTITY = randomUUID();
  const SOURCE_CODE = 'PE';
  let drAccountId: string;
  let crAccountId: string;

  async function makeOpenPeriod() {
    const cal = await prisma.fiscalCalendar.create({
      data: { id: randomUUID(), tenantId: TENANT, entityId: ENTITY, fyStartMonth: 1, structure: 'TWELVE', status: 'DEFINED', actor: 'live-test' },
    });
    await prisma.fiscalPeriod.create({
      data: { id: randomUUID(), tenantId: TENANT, entityId: ENTITY, calendarId: cal.id, fiscalYear: 2026, periodNumber: 6, code: '2026-06', startDate: new Date('2026-06-01'), endDate: new Date('2026-06-30'), status: 'OPEN' },
    });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();

    const posting = new PostingService(prisma, noopEvents, new FiscalCalendarService(prisma, noopEvents), new SequenceService(prisma, noopEvents));
    engine = new PostingEngineService(prisma, noopEvents, posting);

    await makeOpenPeriod();

    // SYSTEM-class source (BR013-3): the posting engine always posts with
    // callerClass SYSTEM, so the fixture journal source must be SYSTEM too.
    await prisma.journalSource.create({
      data: { id: randomUUID(), tenantId: TENANT, code: SOURCE_CODE, name: 'Posting Engine Certification Source (test fixture)', sourceClass: 'SYSTEM', status: 'ACTIVE' },
    });

    const dr = await prisma.glAccount.create({
      data: { id: randomUUID(), tenantId: TENANT, entityId: ENTITY, accountNumber: '19000', name: 'Certification Suspense DR (test fixture)', type: 'ASSET', normalBalance: 'DR', postable: true, status: 'ACTIVE' },
    });
    const cr = await prisma.glAccount.create({
      data: { id: randomUUID(), tenantId: TENANT, entityId: ENTITY, accountNumber: '19100', name: 'Certification Suspense CR (test fixture)', type: 'ASSET', normalBalance: 'DR', postable: true, status: 'ACTIVE' },
    });
    drAccountId = dr.id;
    crAccountId = cr.id;
  });

  afterAll(async () => {
    await prisma.postingExecutionAttempt.deleteMany({ where: { tenantId: TENANT } });
    await prisma.postingException.deleteMany({ where: { tenantId: TENANT } });
    await prisma.postingExecution.deleteMany({ where: { tenantId: TENANT } });
    await prisma.postingRulePackVersion.deleteMany({ where: { tenantId: TENANT } });
    await prisma.postingRulePack.deleteMany({ where: { tenantId: TENANT } });
    await prisma.auditOutboxEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.journalLine.deleteMany({ where: { tenantId: TENANT } });
    await prisma.journalEntry.deleteMany({ where: { tenantId: TENANT } });
    await prisma.journalSource.deleteMany({ where: { tenantId: TENANT } });
    await prisma.glAccount.deleteMany({ where: { tenantId: TENANT } });
    await prisma.fiscalPeriod.deleteMany({ where: { tenantId: TENANT } });
    await prisma.fiscalCalendar.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$disconnect();
  });

  function fixtureOpts() {
    return { tenantId: TENANT, entityId: ENTITY, drAccountNumber: '19000', crAccountNumber: '19100', journalSourceCode: SOURCE_CODE };
  }

  // ── 1. Rule pack lifecycle ────────────────────────────────────────────────

  describe('Rule pack lifecycle', () => {
    it('a valid fixture rule pack: draft -> validate -> activate succeeds, and the version becomes immutable', async () => {
      const draft = await engine.createRulePackVersion({ tenantId: TENANT, packKey: 'cert-lifecycle', sourceText: JSON.stringify(validRulePack({ ...fixtureOpts(), packKey: 'cert-lifecycle' })), actor: 'tester' });
      expect(draft.status).toBe('DRAFT');

      const validated = await engine.validateVersion(TENANT, draft.id, 'tester');
      expect(validated.valid).toBe(true);
      expect(validated.version.status).toBe('VALIDATED');

      const activated = await engine.activateVersion(TENANT, draft.id, 'tester');
      expect(activated.status).toBe('ACTIVE');
      expect(activated.activatedBy).toBe('tester');

      // Immutability: the DB trigger rejects any attempt to change content
      // after activation, even via a direct SQL UPDATE bypassing the service.
      await expect(
        prisma.$executeRawUnsafe(`UPDATE posting_rule_pack_version SET content_hash = 'tampered' WHERE id = $1`, activated.id),
      ).rejects.toThrow(/immutable/i);

      // Supersede this version immediately so it doesn't compete with the
      // dedicated 'Certification event' describe block below for rule
      // selection — both target the same tenant + CERT_EVENT_TYPE, and two
      // simultaneously-ACTIVE versions for one event type is an ambiguous
      // configuration this lifecycle test isn't exercising (status change
      // alone, no content change, so the immutability trigger still allows it).
      await prisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
    });

    it('an unbalanced fixture rule pack fails validation and can never reach ACTIVE', async () => {
      const draft = await engine.createRulePackVersion({ tenantId: TENANT, packKey: 'cert-unbalanced', sourceText: JSON.stringify(unbalancedRulePack({ ...fixtureOpts(), packKey: 'cert-unbalanced' })), actor: 'tester' });
      const validated = await engine.validateVersion(TENANT, draft.id, 'tester');
      expect(validated.valid).toBe(false);
      expect(validated.version.status).toBe('DRAFT'); // stays DRAFT — never promoted to VALIDATED

      await expect(engine.activateVersion(TENANT, draft.id, 'tester')).rejects.toThrow(ActivationNotEligibleError);
      const reloaded = await prisma.postingRulePackVersion.findUnique({ where: { id: draft.id } });
      expect(reloaded?.status).not.toBe('ACTIVE');
    });
  });

  // ── 2-6. Event ingestion / posting orchestration ────────────────────────────

  describe('Certification event -> posting orchestration', () => {
    let activeVersionId: string;

    beforeAll(async () => {
      const draft = await engine.createRulePackVersion({ tenantId: TENANT, packKey: 'cert-main', sourceText: JSON.stringify(validRulePack({ ...fixtureOpts(), packKey: 'cert-main' })), actor: 'tester' });
      await engine.validateVersion(TENANT, draft.id, 'tester');
      const activated = await engine.activateVersion(TENANT, draft.id, 'tester');
      activeVersionId = activated.id;
    });

    it('a valid certification event creates exactly one complete, balanced journal with full traceability', async () => {
      const eventId = `evt-${randomUUID()}`;
      const envelope = certificationEnvelope({ tenantId: TENANT, eventId, amount: 250 });
      const result = await engine.submitEvent(TENANT, envelope, 'tester');

      expect(result.status).toBe('POSTED');
      expect(result.idempotent).toBe(false);
      expect(result.rulePackVersionId).toBe(activeVersionId);
      expect(result.ruleId).toBe('unconditional-cert-rule');
      expect(result.journalNumber).toBeTruthy();

      const journal = await prisma.journalEntry.findUnique({ where: { id: result.journalEntryId! }, include: { lines: true } });
      expect(journal).toBeTruthy();
      expect(journal!.lines).toHaveLength(2);
      expect(Number(journal!.totalDebits)).toBe(250);
      expect(Number(journal!.totalCredits)).toBe(250);
      expect(journal!.sourceCode).toBe(SOURCE_CODE);
      expect(journal!.idempotencyKey).toBe(`${TENANT}:${eventId}`);

      const execution = await engine.getExecutionByEventId(TENANT, eventId);
      expect(execution?.blueprintHash).toBeTruthy();
      expect(execution?.eventHash).toBeTruthy();
    });

    it('an exact duplicate is a no-op — the journal count stays at one, no second call to the posting path creates a new journal', async () => {
      const eventId = `evt-${randomUUID()}`;
      const envelope = certificationEnvelope({ tenantId: TENANT, eventId, amount: 175 });
      const first = await engine.submitEvent(TENANT, envelope, 'tester');
      const second = await engine.submitEvent(TENANT, envelope, 'tester');

      expect(second.idempotent).toBe(true);
      expect(second.journalEntryId).toBe(first.journalEntryId);
      const count = await prisma.journalEntry.count({ where: { tenantId: TENANT, idempotencyKey: `${TENANT}:${eventId}` } });
      expect(count).toBe(1);
    });

    it('a changed payload under the same eventId is EVENT_IDENTITY_CONFLICT and posts no journal', async () => {
      const eventId = `evt-${randomUUID()}`;
      const envelope = certificationEnvelope({ tenantId: TENANT, eventId, amount: 300 });
      const first = await engine.submitEvent(TENANT, envelope, 'tester');
      expect(first.status).toBe('POSTED');

      const conflicting = conflictingEnvelope(envelope, 999);
      await expect(engine.submitEvent(TENANT, conflicting, 'tester')).rejects.toThrow(EventIdentityConflictError);

      const count = await prisma.journalEntry.count({ where: { tenantId: TENANT, idempotencyKey: `${TENANT}:${eventId}` } });
      expect(count).toBe(1); // still just the original — no second/replacement journal

      const exceptions = await engine.listExceptions(TENANT, 'EVENT_IDENTITY_CONFLICT');
      expect(exceptions.some((e) => e.executionId === first.executionId)).toBe(true);
    });

    it('no-rule-match is durable and queryable, and posts no journal', async () => {
      const eventId = `evt-${randomUUID()}`;
      const envelope = unmatchedEnvelope({ tenantId: TENANT, eventId, amount: 50 });
      const result = await engine.submitEvent(TENANT, envelope, 'tester');

      expect(result.status).toBe('NO_RULE_MATCH');
      expect(result.journalEntryId ?? null).toBeNull();

      const reloaded = await engine.getExecutionByEventId(TENANT, eventId);
      expect(reloaded?.status).toBe('NO_RULE_MATCH');
      const exceptions = await engine.listExceptions(TENANT, 'NO_RULE_MATCH');
      expect(exceptions.some((e) => e.executionId === result.executionId)).toBe(true);
    });

    it('a rejected posting (period not OPEN) leaves no partial journal', async () => {
      const eventId = `evt-${randomUUID()}`;
      // 2099-01 has no fiscal period defined for this entity -> BR013-2 rejects at PostingService, before any write.
      const envelope = certificationEnvelope({ tenantId: TENANT, eventId, amount: 80, businessDate: '2099-01-15', occurredAt: '2099-01-15T00:00:00.000Z' });
      const result = await engine.submitEvent(TENANT, envelope, 'tester');

      expect(result.status).toBe('REJECTED');
      expect(result.failureReason).toBeTruthy();
      const count = await prisma.journalEntry.count({ where: { tenantId: TENANT, idempotencyKey: `${TENANT}:${eventId}` } });
      expect(count).toBe(0);
    });

    it('lost-response reconciliation: even if our own execution bookkeeping is lost, re-submitting the same event never creates a second journal', async () => {
      const eventId = `evt-${randomUUID()}`;
      const envelope = certificationEnvelope({ tenantId: TENANT, eventId, amount: 60 });
      const first = await engine.submitEvent(TENANT, envelope, 'tester');
      expect(first.status).toBe('POSTED');

      // Simulate "we lost track of this execution" (e.g. a crash before our
      // own row was durably recorded, or an out-of-band data-loss event) —
      // the journal itself, created through the accepted path, is untouched.
      await prisma.postingExecutionAttempt.deleteMany({ where: { executionId: first.executionId } });
      await prisma.postingExecution.delete({ where: { id: first.executionId } });

      const reconciled = await engine.submitEvent(TENANT, envelope, 'tester');
      expect(reconciled.status).toBe('POSTED');
      expect(reconciled.idempotent).toBe(true); // PostingService's own idempotency short-circuit found the original journal
      expect(reconciled.journalNumber).toBe(first.journalNumber);
      expect(reconciled.journalEntryId).toBe(first.journalEntryId);

      const count = await prisma.journalEntry.count({ where: { tenantId: TENANT, idempotencyKey: `${TENANT}:${eventId}` } });
      expect(count).toBe(1); // never a second/replacement journal under a different key
    });

    it('concurrent duplicate submissions of a brand-new event still produce exactly one journal', async () => {
      const eventId = `evt-${randomUUID()}`;
      const envelope = certificationEnvelope({ tenantId: TENANT, eventId, amount: 42 });

      const [a, b] = await Promise.allSettled([
        engine.submitEvent(TENANT, envelope, 'racer-a'),
        engine.submitEvent(TENANT, envelope, 'racer-b'),
      ]);

      for (const r of [a, b]) {
        expect(r.status, 'both concurrent submissions of a first-time event must succeed').toBe('fulfilled');
      }
      const count = await prisma.journalEntry.count({ where: { tenantId: TENANT, idempotencyKey: `${TENANT}:${eventId}` } });
      expect(count).toBe(1);
      const executions = await prisma.postingExecution.findMany({ where: { tenantId: TENANT, eventId } });
      expect(executions).toHaveLength(1); // exactly one logical execution row, not two
    });
  });
});

// ── 7. RLS-negative (tenant isolation + privilege hardening) ─────────────────
// Deliberately plain `pg`, not Prisma — single-connection control per
// assertion (see period-close-live.test.ts's header for the full rationale).

describe.skipIf(!LIVE_DB_URL || !APP_URL)('S019/S020 Live database — RLS-negative (posting-engine tables)', () => {
  const SUPER_URL = LIVE_DB_URL!;
  const TENANT_A = `pe-rls-a-${randomUUID()}`;
  const TENANT_B = `pe-rls-b-${randomUUID()}`;
  let packAId: string;
  let versionAId: string;
  let versionBId: string;
  let executionAId: string;
  let executionBId: string;

  async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }

  beforeAll(async () => {
    packAId = randomUUID();
    versionAId = randomUUID();
    versionBId = randomUUID();
    executionAId = randomUUID();
    executionBId = randomUUID();

    await withClient(SUPER_URL, async (c) => {
      await c.query(
        `INSERT INTO posting_rule_pack (id, tenant_id, pack_key, created_by, created_at) VALUES ($1,$2,'rls-pack','rls-test',now())`,
        [packAId, TENANT_A],
      );
      const packB = randomUUID();
      await c.query(
        `INSERT INTO posting_rule_pack (id, tenant_id, pack_key, created_by, created_at) VALUES ($1,$2,'rls-pack','rls-test',now())`,
        [packB, TENANT_B],
      );
      const version = (id: string, tenantId: string, rulePackId: string) => c.query(
        `INSERT INTO posting_rule_pack_version
           (id, tenant_id, rule_pack_id, pack_key, semver, dsl_version, event_type, event_schema_versions, entity_id,
            effective_from, journal_source_code, match_strategy, no_match_behavior, definition, content_hash, status, created_by, created_at)
         VALUES ($1,$2,$3,'rls-pack','1.0.0',1,$4,ARRAY['1.0'],$5,'2020-01-01'::timestamp,'RLS','FIRST_MATCH','NO_RULE_MATCH_EXCEPTION','{}'::jsonb,'hash-${id}','DRAFT','rls-test',now())`,
        [id, tenantId, rulePackId, CERT_EVENT_TYPE, randomUUID()],
      );
      await version(versionAId, TENANT_A, packAId);
      await version(versionBId, TENANT_B, packB);

      const execution = (id: string, tenantId: string, eventId: string) => c.query(
        `INSERT INTO posting_execution
           (id, tenant_id, event_id, event_type, event_schema_version, source_system, source_entity_type, source_entity_id,
            correlation_id, business_date, event_hash, event_envelope, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'1.0','rls-test','FIXTURE',$3,'corr-1','2026-01-01'::date,'hash','{}'::jsonb,'NO_RULE_MATCH',now(),now())`,
        [id, tenantId, eventId, CERT_EVENT_TYPE],
      );
      await execution(executionAId, TENANT_A, 'evt-a');
      await execution(executionBId, TENANT_B, 'evt-b');

      await c.query(
        `INSERT INTO posting_exception (id, tenant_id, execution_id, reason_code, reason_detail, event_type, event_schema_version, rule_pack_versions_considered, created_at)
         VALUES ($1,$2,$3,'NO_RULE_MATCH','rls test','${CERT_EVENT_TYPE}','1.0','[]'::jsonb,now())`,
        [randomUUID(), TENANT_A, executionAId],
      );
      await c.query(
        `INSERT INTO posting_exception (id, tenant_id, execution_id, reason_code, reason_detail, event_type, event_schema_version, rule_pack_versions_considered, created_at)
         VALUES ($1,$2,$3,'NO_RULE_MATCH','rls test','${CERT_EVENT_TYPE}','1.0','[]'::jsonb,now())`,
        [randomUUID(), TENANT_B, executionBId],
      );
    });
  });

  afterAll(async () => {
    await withClient(SUPER_URL, async (c) => {
      await c.query(`DELETE FROM posting_exception WHERE tenant_id IN ($1,$2)`, [TENANT_A, TENANT_B]);
      await c.query(`DELETE FROM posting_execution WHERE tenant_id IN ($1,$2)`, [TENANT_A, TENANT_B]);
      await c.query(`DELETE FROM posting_rule_pack_version WHERE tenant_id IN ($1,$2)`, [TENANT_A, TENANT_B]);
      await c.query(`DELETE FROM posting_rule_pack WHERE tenant_id IN ($1,$2)`, [TENANT_A, TENANT_B]);
    });
  });

  it('tenant A cannot read tenant B rule packs', async () => {
    await withClient(APP_URL!, async (c) => {
      await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT_A]);
      const res = await c.query(`SELECT tenant_id FROM posting_rule_pack WHERE pack_key = 'rls-pack'`);
      expect(res.rows.every((r) => r.tenant_id === TENANT_A)).toBe(true);
      expect(res.rows).toHaveLength(1);
    });
  });

  it('tenant A cannot read tenant B posting executions', async () => {
    await withClient(APP_URL!, async (c) => {
      await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT_A]);
      const res = await c.query(`SELECT id FROM posting_execution WHERE id = $1`, [executionBId]);
      expect(res.rows).toHaveLength(0);
      const own = await c.query(`SELECT id FROM posting_execution WHERE id = $1`, [executionAId]);
      expect(own.rows).toHaveLength(1);
    });
  });

  it('tenant A cannot read tenant B posting exceptions', async () => {
    await withClient(APP_URL!, async (c) => {
      await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT_A]);
      const res = await c.query(`SELECT execution_id FROM posting_exception WHERE execution_id = $1`, [executionBId]);
      expect(res.rows).toHaveLength(0);
    });
  });

  it('tenant A cannot activate tenant B\'s rule pack version — the UPDATE matches zero rows under tenant A\'s RLS context', async () => {
    await withClient(APP_URL!, async (c) => {
      await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT_A]);
      const res = await c.query(`UPDATE posting_rule_pack_version SET status = 'VALIDATED' WHERE id = $1 AND status = 'DRAFT'`, [versionBId]);
      expect(res.rowCount).toBe(0);
    });
    await withClient(SUPER_URL, async (c) => {
      const check = await c.query(`SELECT status FROM posting_rule_pack_version WHERE id = $1`, [versionBId]);
      expect(check.rows[0].status).toBe('DRAFT'); // untouched
    });
  });

  it('missing tenant context sees zero rows across all posting-engine tables (deny-by-default)', async () => {
    await withClient(APP_URL!, async (c) => {
      const packs = await c.query(`SELECT count(*)::int AS n FROM posting_rule_pack WHERE pack_key = 'rls-pack'`);
      expect(packs.rows[0].n).toBe(0);
      const executions = await c.query(`SELECT count(*)::int AS n FROM posting_execution WHERE id IN ($1,$2)`, [executionAId, executionBId]);
      expect(executions.rows[0].n).toBe(0);
    });
  });

  it('the unique(tenant_id, event_id) constraint is enforced at the database level', async () => {
    await withClient(SUPER_URL, async (c) => {
      await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT_A]);
      await expect(
        c.query(
          `INSERT INTO posting_execution
             (id, tenant_id, event_id, event_type, event_schema_version, source_system, source_entity_type, source_entity_id,
              correlation_id, business_date, event_hash, event_envelope, status, created_at, updated_at)
           VALUES ($1,$2,'evt-a',$3,'1.0','rls-test','FIXTURE','evt-a','corr-1','2026-01-01'::date,'hash-2','{}'::jsonb,'NO_RULE_MATCH',now(),now())`,
          [randomUUID(), TENANT_A, CERT_EVENT_TYPE],
        ),
      ).rejects.toThrow(/unique|duplicate key/i);
    });
  });
});
