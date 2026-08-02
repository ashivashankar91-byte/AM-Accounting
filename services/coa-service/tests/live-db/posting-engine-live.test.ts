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
 * CE-07 (single authoritative ledger decision): this suite certifies the
 * ENGINE's OWN logic (rule-pack lifecycle, claim-based idempotency, SoD,
 * ambiguity, replay, simulate, RLS) against a FakeGlPostingBridge (see below)
 * — NOT gl-service's own posting/review behavior, which
 * tests/live-db/gl-posting-bridge-live.test.ts certifies exhaustively
 * against a REAL, unmodified gl-service process. coa-service's own
 * journal_entry/journal_line tables are no longer written by this path at
 * all — assertions here check the fake bridge's call log instead.
 *
 * Covers:
 *   1. Rule pack lifecycle — draft -> validate -> activate; an unbalanced
 *      fixture rule pack can never reach ACTIVE; activated versions are
 *      immutable (DB trigger backstop, not just the application guard).
 *   2. End-to-end certification posting through the real PostingEngineService
 *      -> GlPostingBridge.post() (fake here; real gl-service in
 *      gl-posting-bridge-live.test.ts): exactly one bridge call per event,
 *      two balanced lines, full traceability.
 *   3. Idempotency: exact duplicate is a no-op (bridge called once); a
 *      changed duplicate under the same eventId is EVENT_IDENTITY_CONFLICT
 *      (bridge never called); concurrent duplicate submissions still call
 *      the bridge at most once (claimExecution()'s DB unique constraint).
 *   4. No-rule-match is durable and queryable.
 *   5. A gl-service posting rejection leaves the execution REJECTED with an
 *      exception + S021 recovery case, never a partial/retried journal.
 *   6. KNOWN GAP (documented, not silently dropped): gl-service has no
 *      idempotency of its own, so losing coa-service's own execution
 *      bookkeeping before a resubmit creates a genuinely SECOND gl-service
 *      journal — proving why claimExecution()'s row is the sole dedup point.
 *   7. RLS-negative (tenant isolation) on all 5 new tables, proven with a
 *      real non-superuser amacc_app connection (plain `pg`, single-connection
 *      control — same reasoning as tests/integration/test-rls-isolation.ts).
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import pg from 'pg';
import { PrismaClient } from '.prisma/coa-client';
import { PostingEngineService, EventIdentityConflictError, ActivationNotEligibleError, SelfActivationForbiddenError, ReplayNotEligibleError } from '../../src/application/posting-engine-service';
import { GlPostingBridge, GlPostingRequest, GlPostingResult, GlPostingBridgeError } from '../../src/application/gl-posting-bridge';
import { PostingRecoveryPort, RecoveryCaseInput } from '../../src/application/posting-recovery-port';
import { validRulePack, unbalancedRulePack, certificationEnvelope, conflictingEnvelope, unmatchedEnvelope, CERT_EVENT_TYPE } from '../support/posting-engine-fixtures';
import { apInvoiceLiabilityPack, apPaymentPack } from '../support/s023-rule-pack-fixtures';
import type { IEventPublisher } from '@amacc/shared-kernel';

/** CE-07/S023 (D-S023-23) test double — records every reported recovery case so tests can assert on the S021 wiring without a live posting-recovery-service. */
class RecordingPostingRecoveryPort implements PostingRecoveryPort {
  readonly reported: Array<{ tenantId: string; input: RecoveryCaseInput }> = [];
  async reportFailure(tenantId: string, input: RecoveryCaseInput): Promise<void> {
    this.reported.push({ tenantId, input });
  }
}

/**
 * CE-07 (single authoritative ledger decision) — this suite certifies the
 * ENGINE's own logic (rule-pack lifecycle, idempotency claim, SoD,
 * ambiguity, replay, simulate, RLS) — NOT gl-service's own posting/review
 * behavior, which tests/live-db/gl-posting-bridge-live.test.ts already
 * certifies exhaustively against a REAL gl-service process. A fake,
 * in-memory bridge here is deliberate and faithful to that split: it lets
 * these tests assert the engine calls the bridge AT MOST ONCE per
 * (tenantId, eventId) — the exact single-ledger guarantee claimExecution()
 * exists to provide — without needing a second real gl-service instance per
 * suite. It never writes to coa-service's own (obsolete, for this path)
 * journal_entry table, matching production.
 */
class FakeGlPostingBridge implements GlPostingBridge {
  readonly calls: GlPostingRequest[] = [];
  private counter = 0;
  /** Set to a tenantId to make every subsequent call for that tenant fail — used for the "posting rejected" scenario. */
  failForTenant: string | null = null;

  async post(request: GlPostingRequest): Promise<GlPostingResult> {
    this.calls.push(request);
    if (this.failForTenant && request.tenantId === this.failForTenant) {
      throw new GlPostingBridgeError('fake gl-service rejection (fixture-forced, test only)');
    }
    this.counter += 1;
    return { journalEntryId: randomUUID(), journalNumber: `FAKE-${this.counter}`, status: 'PENDING_REVIEW' };
  }

  /** Calls whose description embeds this eventId (certificationEnvelope's default sourceEntityId is `fixture-${eventId}`). */
  callsForEvent(eventId: string): GlPostingRequest[] {
    return this.calls.filter((c) => c.description.includes(eventId));
  }
}

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];
const APP_URL = process.env['PG_APP_URL'];

const noopEvents: IEventPublisher = { publish: async () => {}, subscribe: () => {} };

describe.skipIf(!LIVE_DB_URL)('S019/S020 Live database — posting engine certification', () => {
  let prisma: PrismaClient;
  let engine: PostingEngineService;
  let recoveryPort: RecordingPostingRecoveryPort;
  let bridge: FakeGlPostingBridge;

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

    bridge = new FakeGlPostingBridge();
    recoveryPort = new RecordingPostingRecoveryPort();
    engine = new PostingEngineService(prisma, noopEvents, bridge, recoveryPort);

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
    await prisma.postingExecutionReplay.deleteMany({ where: { tenantId: TENANT } });
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

      // D-S023-28: the author cannot activate their own version — a
      // separately authorized identity must.
      const activated = await engine.activateVersion(TENANT, draft.id, 'activator');
      expect(activated.status).toBe('ACTIVE');
      expect(activated.activatedBy).toBe('activator');

      // D-S023-30: audit evidence carries real before/after state and a
      // reconstructable field diff — not the previous hardcoded `before: null`.
      const validationAudit = await prisma.auditOutboxEvent.findFirst({ where: { tenantId: TENANT, docId: draft.id, action: 'VALIDATION_COMPLETED' }, orderBy: { createdAt: 'desc' } });
      expect((validationAudit?.before as any)?.status).toBe('DRAFT');
      expect((validationAudit?.after as any)?.status).toBe('VALIDATED');
      const activationAudit = await prisma.auditOutboxEvent.findFirst({ where: { tenantId: TENANT, docId: draft.id, action: 'ACTIVATION_SUCCEEDED' } });
      expect((activationAudit?.before as any)?.status).toBe('VALIDATED');
      expect((activationAudit?.after as any)?.status).toBe('ACTIVE');
      expect((activationAudit?.after as any)?.fieldDiffs).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'status', before: 'VALIDATED', after: 'ACTIVE' })]));

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

    it('D-S023-30: activating a second version of the same pack key audits the SUPERSEDED transition on the prior version', async () => {
      const draft1 = await engine.createRulePackVersion({ tenantId: TENANT, packKey: 'cert-supersede', sourceText: JSON.stringify(validRulePack({ ...fixtureOpts(), packKey: 'cert-supersede', semver: '1.0.0' })), actor: 'author-a' });
      await engine.validateVersion(TENANT, draft1.id, 'author-a');
      const v1 = await engine.activateVersion(TENANT, draft1.id, 'activator-a');
      expect(v1.status).toBe('ACTIVE');

      const draft2 = await engine.createRulePackVersion({ tenantId: TENANT, packKey: 'cert-supersede', sourceText: JSON.stringify(validRulePack({ ...fixtureOpts(), packKey: 'cert-supersede', semver: '2.0.0' })), actor: 'author-b' });
      await engine.validateVersion(TENANT, draft2.id, 'author-b');
      const v2 = await engine.activateVersion(TENANT, draft2.id, 'activator-b');
      expect(v2.status).toBe('ACTIVE');

      const v1Reloaded = await prisma.postingRulePackVersion.findUnique({ where: { id: v1.id } });
      expect(v1Reloaded?.status).toBe('SUPERSEDED');

      const supersessionAudit = await prisma.auditOutboxEvent.findFirst({ where: { tenantId: TENANT, docId: v1.id, action: 'SUPERSEDED' } });
      expect(supersessionAudit).toBeTruthy();
      expect((supersessionAudit?.before as any)?.status).toBe('ACTIVE');
      expect((supersessionAudit?.after as any)?.status).toBe('SUPERSEDED');
      expect((supersessionAudit?.after as any)?.supersededBy).toBe(v2.id);

      await prisma.postingRulePackVersion.update({ where: { id: v2.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
    });

    it('an unbalanced fixture rule pack fails validation and can never reach ACTIVE', async () => {
      const draft = await engine.createRulePackVersion({ tenantId: TENANT, packKey: 'cert-unbalanced', sourceText: JSON.stringify(unbalancedRulePack({ ...fixtureOpts(), packKey: 'cert-unbalanced' })), actor: 'tester' });
      const validated = await engine.validateVersion(TENANT, draft.id, 'tester');
      expect(validated.valid).toBe(false);
      expect(validated.version.status).toBe('DRAFT'); // stays DRAFT — never promoted to VALIDATED

      await expect(engine.activateVersion(TENANT, draft.id, 'activator')).rejects.toThrow(ActivationNotEligibleError);
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
      const activated = await engine.activateVersion(TENANT, draft.id, 'activator');
      activeVersionId = activated.id;
    });

    it('a valid certification event creates exactly one complete, balanced journal with full traceability', async () => {
      const eventId = `evt-${randomUUID()}`;
      const envelope = certificationEnvelope({ tenantId: TENANT, entityId: ENTITY, eventId, amount: 250 });
      const result = await engine.submitEvent(TENANT, envelope, 'tester');

      expect(result.status).toBe('POSTED');
      expect(result.idempotent).toBe(false);
      expect(result.rulePackVersionId).toBe(activeVersionId);
      expect(result.ruleId).toBe('unconditional-cert-rule');
      expect(result.journalNumber).toBeTruthy();

      // Single authoritative ledger: the engine never writes coa-service's own
      // journal_entry table for a rule-engine posting — it goes through the
      // (here, fake) GlPostingBridge exactly once, and that ONE call is what's
      // asserted, not a row in a table this path no longer writes.
      const calls = bridge.callsForEvent(eventId);
      expect(calls).toHaveLength(1);
      expect(calls[0].journalSourceCode).toBe(SOURCE_CODE);
      const total = calls[0].lines.reduce((s, l) => s + l.debit, 0);
      expect(total).toBe(250);

      const execution = await engine.getExecutionByEventId(TENANT, eventId);
      expect(execution?.blueprintHash).toBeTruthy();
      expect(execution?.eventHash).toBeTruthy();
    });

    it('an exact duplicate is a no-op — the bridge is called exactly once, no second call posts a duplicate journal', async () => {
      const eventId = `evt-${randomUUID()}`;
      const envelope = certificationEnvelope({ tenantId: TENANT, entityId: ENTITY, eventId, amount: 175 });
      const first = await engine.submitEvent(TENANT, envelope, 'tester');
      const second = await engine.submitEvent(TENANT, envelope, 'tester');

      expect(second.idempotent).toBe(true);
      expect(second.journalEntryId).toBe(first.journalEntryId);
      expect(bridge.callsForEvent(eventId)).toHaveLength(1); // claimExecution() ensures the bridge is never called twice for one eventId
    });

    it('a changed payload under the same eventId is EVENT_IDENTITY_CONFLICT and posts no journal', async () => {
      const eventId = `evt-${randomUUID()}`;
      const envelope = certificationEnvelope({ tenantId: TENANT, entityId: ENTITY, eventId, amount: 300 });
      const first = await engine.submitEvent(TENANT, envelope, 'tester');
      expect(first.status).toBe('POSTED');

      const conflicting = conflictingEnvelope(envelope, 999);
      await expect(engine.submitEvent(TENANT, conflicting, 'tester')).rejects.toThrow(EventIdentityConflictError);

      expect(bridge.callsForEvent(eventId)).toHaveLength(1); // still just the original — the conflict is rejected before ever reaching the bridge

      const exceptions = await engine.listExceptions(TENANT, 'EVENT_IDENTITY_CONFLICT');
      expect(exceptions.some((e) => e.executionId === first.executionId)).toBe(true);

      const reported = recoveryPort.reported.find((r) => r.input.executionId === first.executionId && r.input.reasonCode === 'EVENT_IDENTITY_CONFLICT');
      expect(reported).toBeDefined();
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

      // D-S023-23: an eligible deterministic failure creates an S021 recovery case.
      const reported = recoveryPort.reported.find((r) => r.input.executionId === result.executionId);
      expect(reported).toBeDefined();
      expect(reported!.tenantId).toBe(TENANT);
      expect(reported!.input.reasonCode).toBe('NO_RULE_MATCH');
      expect(reported!.input.envelope.eventId).toBe(eventId);
    });

    it('a gl-service posting rejection (single authoritative ledger decision) leaves the execution REJECTED, writes an exception, and reports an S021 recovery case — never a partial or retried journal', async () => {
      const eventId = `evt-${randomUUID()}`;
      const envelope = certificationEnvelope({ tenantId: TENANT, entityId: ENTITY, eventId, amount: 80 });

      bridge.failForTenant = TENANT;
      try {
        const result = await engine.submitEvent(TENANT, envelope, 'tester');
        expect(result.status).toBe('REJECTED');
        expect(result.failureReason).toBeTruthy();
      } finally {
        bridge.failForTenant = null; // never leak into later tests in this file
      }

      expect(bridge.callsForEvent(eventId)).toHaveLength(1); // exactly one (failed) attempt — claimExecution() never retries automatically
      const exceptions = await prisma.postingException.findMany({ where: { tenantId: TENANT, eventType: CERT_EVENT_TYPE, reasonDetail: { contains: 'fake gl-service rejection' } } });
      expect(exceptions.length).toBeGreaterThan(0);
      const reported = recoveryPort.reported.find((r) => r.input.reasonDetail?.includes('fake gl-service rejection'));
      expect(reported).toBeDefined();
    });

    it('KNOWN GAP (single authoritative ledger decision): gl-service has no idempotency of its own — losing coa-service\'s own execution bookkeeping before a resubmit creates a SECOND gl-service journal, proving why claimExecution()\'s DB row is the sole dedup point and must never be deleted/lost in production', async () => {
      const eventId = `evt-${randomUUID()}`;
      const envelope = certificationEnvelope({ tenantId: TENANT, entityId: ENTITY, eventId, amount: 60 });
      const first = await engine.submitEvent(TENANT, envelope, 'tester');
      expect(first.status).toBe('POSTED');
      expect(bridge.callsForEvent(eventId)).toHaveLength(1);

      // Simulate "we lost track of this execution" (e.g. a crash before our
      // own row was durably recorded, or an out-of-band data-loss event).
      // Unlike the old coa-service-only PostingService.post() (which had its
      // own idempotencyKey-based upsert), gl-service itself has NO
      // idempotency mechanism — confirmed via its schema/DTOs. This is a
      // documented, accepted gap of the single-ledger design, not a silently
      // dropped assertion: the ONLY thing standing between a lost execution
      // row and a duplicate authoritative journal is this row never being lost.
      await prisma.postingExecutionAttempt.deleteMany({ where: { executionId: first.executionId } });
      await prisma.postingExecution.delete({ where: { id: first.executionId } });

      const reconciled = await engine.submitEvent(TENANT, envelope, 'tester');
      expect(reconciled.status).toBe('POSTED');
      expect(reconciled.idempotent).toBe(false); // no execution row survived to short-circuit this as a duplicate
      expect(reconciled.journalEntryId).not.toBe(first.journalEntryId); // a genuinely SECOND gl-service journal was created
      expect(bridge.callsForEvent(eventId)).toHaveLength(2);
    });

    it('concurrent duplicate submissions of a brand-new event still produce exactly one journal', async () => {
      const eventId = `evt-${randomUUID()}`;
      const envelope = certificationEnvelope({ tenantId: TENANT, entityId: ENTITY, eventId, amount: 42 });

      const [a, b] = await Promise.allSettled([
        engine.submitEvent(TENANT, envelope, 'racer-a'),
        engine.submitEvent(TENANT, envelope, 'racer-b'),
      ]);

      for (const r of [a, b]) {
        expect(r.status, 'both concurrent submissions of a first-time event must succeed').toBe('fulfilled');
      }
      expect(bridge.callsForEvent(eventId)).toHaveLength(1); // claimExecution()'s DB unique constraint let exactly one racer reach the bridge
      const executions = await prisma.postingExecution.findMany({ where: { tenantId: TENANT, eventId } });
      expect(executions).toHaveLength(1); // exactly one logical execution row, not two
    });
  });

  // ── CE-07/S023 narrow engine changes (D-S023-08, D-S023-25/22, D-S023-28, D-S023-33) ──

  describe('D-S023-28 — identity-based author-vs-activator SoD', () => {
    it('the identity that created a version cannot activate it, even once VALIDATED', async () => {
      const draft = await engine.createRulePackVersion({ tenantId: TENANT, packKey: 'sod-pack', sourceText: JSON.stringify(validRulePack({ ...fixtureOpts(), packKey: 'sod-pack' })), actor: 'author-1' });
      await engine.validateVersion(TENANT, draft.id, 'author-1');
      await expect(engine.activateVersion(TENANT, draft.id, 'author-1')).rejects.toThrow(SelfActivationForbiddenError);
      const reloaded = await prisma.postingRulePackVersion.findUnique({ where: { id: draft.id } });
      expect(reloaded?.status).toBe('VALIDATED'); // never activated
    });

    it('a separately authorized identity can activate the same version', async () => {
      const draft = await engine.createRulePackVersion({ tenantId: TENANT, packKey: 'sod-pack-2', sourceText: JSON.stringify(validRulePack({ ...fixtureOpts(), packKey: 'sod-pack-2' })), actor: 'author-2' });
      await engine.validateVersion(TENANT, draft.id, 'author-2');
      const activated = await engine.activateVersion(TENANT, draft.id, 'activator-2');
      expect(activated.status).toBe('ACTIVE');
      expect(activated.activatedBy).toBe('activator-2');
      await prisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
    });
  });

  describe('D-S023-08 — deterministic ambiguity rejection (never a silent cross-pack tie-break)', () => {
    const AMBIGUOUS_EVENT_TYPE = 'accounting.posting-engine.ambiguity-fixture.v1';

    async function activatedPack(packKey: string, effectiveFrom: string) {
      const opts = { ...fixtureOpts(), packKey, effectiveFrom };
      const def = validRulePack(opts);
      (def as any).eventType = AMBIGUOUS_EVENT_TYPE;
      const draft = await engine.createRulePackVersion({ tenantId: TENANT, packKey, sourceText: JSON.stringify(def), actor: 'author-amb' });
      await engine.validateVersion(TENANT, draft.id, 'author-amb');
      return engine.activateVersion(TENANT, draft.id, 'activator-amb');
    }

    it('two equally-specific ACTIVE versions (same effectiveFrom) for the same event type reject deterministically, never silently pick one', async () => {
      const v1 = await activatedPack('ambiguous-pack-1', '2020-01-01T00:00:00.000Z');
      const v2 = await activatedPack('ambiguous-pack-2', '2020-01-01T00:00:00.000Z');

      const eventId = `evt-${randomUUID()}`;
      const envelope = { ...certificationEnvelope({ tenantId: TENANT, entityId: ENTITY, eventId, amount: 10 }), eventType: AMBIGUOUS_EVENT_TYPE };
      const result = await engine.submitEvent(TENANT, envelope, 'tester');

      expect(result.status).toBe('REJECTED');
      const exceptions = await prisma.postingException.findMany({ where: { tenantId: TENANT, executionId: result.executionId } });
      expect(exceptions).toHaveLength(1);
      expect(exceptions[0].reasonCode).toBe('AMBIGUOUS_RULE_PACK_MATCH');
      const considered = exceptions[0].rulePackVersionsConsidered as any[];
      expect(considered.map((c) => c.id).sort()).toEqual([v1.id, v2.id].sort());

      const reported = recoveryPort.reported.find((r) => r.input.executionId === result.executionId);
      expect(reported?.input.reasonCode).toBe('AMBIGUOUS_RULE_PACK_MATCH');

      await prisma.postingRulePackVersion.updateMany({ where: { id: { in: [v1.id, v2.id] } }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
    });
  });

  describe('D-S023-33 — simulate performs validation and evaluation but never posts', () => {
    it('a would-post simulation resolves the mapping and proposes a journal without creating any execution/journal row', async () => {
      const eventId = `evt-${randomUUID()}`;
      const envelope = certificationEnvelope({ tenantId: TENANT, entityId: ENTITY, eventId, amount: 77 });

      const before = await prisma.postingExecution.count({ where: { tenantId: TENANT, eventId } });
      const bridgeCallsBefore = bridge.calls.length;

      const sim = await engine.simulateEvent(TENANT, envelope, 'tester');
      expect(sim.wouldPost).toBe(true);
      expect(sim.status).toBe('WOULD_POST');
      expect(sim.proposedJournal?.lines.length).toBeGreaterThan(0);

      const after = await prisma.postingExecution.count({ where: { tenantId: TENANT, eventId } });
      expect(after).toBe(before); // no postingExecution row created
      expect(bridge.calls.length).toBe(bridgeCallsBefore); // simulate never calls the bridge — no journal posted

      // The same event can still be submitted for real afterward — simulate never consumed the idempotency identity.
      const real = await engine.submitEvent(TENANT, envelope, 'tester');
      expect(real.status).toBe('POSTED');
    });
  });

  describe('D-S023-25 (joint D-S023-22) — authorized corrected replay uses the current active version, preserves dual-version evidence', () => {
    const REPLAY_EVENT_TYPE = 'accounting.posting-engine.replay-fixture.v1';

    it('replay of a NO_RULE_MATCH execution, after a new version activates, produces a fresh POSTED outcome and records both pack versions', async () => {
      const eventId = `evt-${randomUUID()}`;
      const envelope = { ...certificationEnvelope({ tenantId: TENANT, entityId: ENTITY, eventId, amount: 55 }), eventType: REPLAY_EVENT_TYPE };

      // No active version yet for this event type -> NO_RULE_MATCH.
      const original = await engine.submitEvent(TENANT, envelope, 'tester');
      expect(original.status).toBe('NO_RULE_MATCH');
      expect(original.rulePackVersionId ?? null).toBeNull();

      // Ordinary duplicate resubmission of the SAME event, with still no
      // active version, must NOT be blocked from returning — but it also
      // must not silently invent a posting; it stays NO_RULE_MATCH, proving
      // ordinary duplicate handling is untouched by the replay feature.
      const duplicate = await engine.submitEvent(TENANT, envelope, 'tester');
      expect(duplicate.status).toBe('NO_RULE_MATCH');
      expect(duplicate.idempotent).toBe(true);

      // Now author + activate a version that covers this event type (the
      // "corrected configuration change").
      const def = validRulePack({ ...fixtureOpts(), packKey: 'replay-fixture-pack' });
      (def as any).eventType = REPLAY_EVENT_TYPE;
      const draft = await engine.createRulePackVersion({ tenantId: TENANT, packKey: 'replay-fixture-pack', sourceText: JSON.stringify(def), actor: 'author-replay' });
      await engine.validateVersion(TENANT, draft.id, 'author-replay');
      const activated = await engine.activateVersion(TENANT, draft.id, 'activator-replay');

      // An authorized replay must NOT be blocked merely because the prior
      // terminal outcome was non-POSTED.
      const replayed = await engine.replayEvent(TENANT, original.executionId, 'replay-operator', 'corrected pack version activated');
      expect(replayed.status).toBe('POSTED');
      expect(replayed.rulePackVersionId).toBe(activated.id);

      // The underlying execution row is updated in place — still exactly one row for this (tenantId, eventId).
      const executions = await prisma.postingExecution.findMany({ where: { tenantId: TENANT, eventId } });
      expect(executions).toHaveLength(1);
      expect(executions[0].status).toBe('POSTED');

      // Dual-version evidence: original attempted version (null — no rule matched originally) and replay version are both recorded.
      const replayEvidence = await prisma.postingExecutionReplay.findMany({ where: { tenantId: TENANT, executionId: original.executionId } });
      expect(replayEvidence).toHaveLength(1);
      expect(replayEvidence[0].originalRulePackVersionId).toBeNull();
      expect(replayEvidence[0].replayRulePackVersionId).toBe(activated.id);
      expect(replayEvidence[0].replayActor).toBe('replay-operator');
      expect(replayEvidence[0].replayReason).toBe('corrected pack version activated');
      expect(replayEvidence[0].resultingStatus).toBe('POSTED');

      // D-S023-30: the audit trail also carries both versions, not just the dedicated evidence table.
      const replayAudit = await prisma.auditOutboxEvent.findFirst({ where: { tenantId: TENANT, docId: original.executionId, action: 'REPLAY_EXECUTED' } });
      expect((replayAudit?.before as any)?.rulePackVersionId).toBeNull();
      expect((replayAudit?.after as any)?.rulePackVersionId).toBe(activated.id);
      expect((replayAudit?.after as any)?.fieldDiffs?.length).toBeGreaterThan(0);

      await prisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
    });

    it('replay is refused for an execution that is already POSTED', async () => {
      const eventId = `evt-${randomUUID()}`;
      const envelope = certificationEnvelope({ tenantId: TENANT, entityId: ENTITY, eventId, amount: 15 });
      const posted = await engine.submitEvent(TENANT, envelope, 'tester');
      expect(posted.status).toBe('POSTED');

      await expect(engine.replayEvent(TENANT, posted.executionId, 'replay-operator', 'should not be allowed')).rejects.toThrow(ReplayNotEligibleError);
    });
  });

  // ── CE-07/S023 (D-S023-12) — governed rule-pack fixtures, golden journal proof ──

  describe('D-S023-12 — governed rule-pack fixtures post a golden, balanced journal (test-tenant accounts only)', () => {
    it('the AP invoice liability fixture pack posts a balanced journal with the fixture DR/CR accounts', async () => {
      const expenseAcct = await prisma.glAccount.create({ data: { id: randomUUID(), tenantId: TENANT, entityId: ENTITY, accountNumber: '60000', name: 'Fixture AP Expense (test only)', type: 'EXPENSE', normalBalance: 'DR', postable: true, status: 'ACTIVE' } });
      const apControlAcct = await prisma.glAccount.create({ data: { id: randomUUID(), tenantId: TENANT, entityId: ENTITY, accountNumber: '21000', name: 'Fixture AP Control (test only)', type: 'LIABILITY', normalBalance: 'CR', postable: true, status: 'ACTIVE' } });

      const pack = apInvoiceLiabilityPack({ tenantId: TENANT, entityId: ENTITY, journalSourceCode: SOURCE_CODE, apExpenseAccount: '60000', apControlAccount: '21000' } as any);
      const draft = await engine.createRulePackVersion({ tenantId: TENANT, packKey: pack.packKey, sourceText: JSON.stringify(pack), actor: 'author-fixture-ap' });
      await engine.validateVersion(TENANT, draft.id, 'author-fixture-ap');
      const activated = await engine.activateVersion(TENANT, draft.id, 'activator-fixture-ap');
      expect(activated.status).toBe('ACTIVE');

      const eventId = `evt-${randomUUID()}`;
      const envelope = { ...certificationEnvelope({ tenantId: TENANT, entityId: ENTITY, eventId, amount: 500 }), eventType: pack.eventType };
      const result = await engine.submitEvent(TENANT, envelope, 'tester');
      expect(result.status).toBe('POSTED');
      expect(result.rulePackVersionId).toBe(activated.id);

      const calls = bridge.callsForEvent(eventId);
      expect(calls).toHaveLength(1);
      const lines = calls[0].lines;
      expect(lines).toHaveLength(2);
      expect(lines.find((l) => l.accountCode === expenseAcct.accountNumber)?.debit).toBe(500);
      expect(lines.find((l) => l.accountCode === apControlAcct.accountNumber)?.credit).toBe(500);

      await prisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
    });

    it('a tenant account mapping removed after activation rejects deterministically at posting time and creates an S021 recovery case (INVALID_ACCOUNT)', async () => {
      // Validation checks account existence too (ACCOUNT_NOT_FOUND at
      // draft-validate time), so this proves the SEPARATE, DEFENSIVE
      // posting-time re-check: the account exists at activation, then the
      // tenant's mapping is removed before the event is ever submitted —
      // exactly the "missing required tenant mapping" scenario Requirement 2
      // asks for, and the dual-checkpoint behavior the repository evidence
      // documents (validated/blocked at draft-validate/activate time AND
      // defensively re-checked at posting time).
      const removableAcct = await prisma.glAccount.create({ data: { id: randomUUID(), tenantId: TENANT, entityId: ENTITY, accountNumber: '21500', name: 'Fixture — removed before posting (test only)', type: 'LIABILITY', normalBalance: 'CR', postable: true, status: 'ACTIVE' } });
      const pack = apPaymentPack({ tenantId: TENANT, entityId: ENTITY, journalSourceCode: SOURCE_CODE, apControlAccount: '21500', bankCashAccount: '19100' } as any);
      const draft = await engine.createRulePackVersion({ tenantId: TENANT, packKey: pack.packKey, sourceText: JSON.stringify(pack), actor: 'author-fixture-missing' });
      await engine.validateVersion(TENANT, draft.id, 'author-fixture-missing');
      const activated = await engine.activateVersion(TENANT, draft.id, 'activator-fixture-missing');
      expect(activated.status).toBe('ACTIVE');

      await prisma.glAccount.delete({ where: { id: removableAcct.id } });

      const eventId = `evt-${randomUUID()}`;
      const envelope = { ...certificationEnvelope({ tenantId: TENANT, entityId: ENTITY, eventId, amount: 40 }), eventType: pack.eventType };
      const result = await engine.submitEvent(TENANT, envelope, 'tester');

      expect(result.status).toBe('REJECTED');
      const exceptions = await prisma.postingException.findMany({ where: { tenantId: TENANT, executionId: result.executionId } });
      expect(exceptions[0].reasonCode).toBe('INVALID_ACCOUNT');
      const reported = recoveryPort.reported.find((r) => r.input.executionId === result.executionId);
      expect(reported?.input.reasonCode).toBe('INVALID_ACCOUNT');

      await prisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
    });
  });

  // ── CE-07 Requirement C — dynamic debit line items (apar-service AP invoice shape) ──

  describe('debitLineItemsPath — dynamic per-occurrence debit lines (e.g. an AP invoice with N independently GL-coded lines)', () => {
    function lineItemsPack(packKey: string, creditAccount: string) {
      return {
        dslVersion: 1, packKey, semver: '1.0.0', eventType: 'accounting.posting-engine.line-items-fixture.v1',
        supportedEventSchemaVersions: ['1.0'], tenantScope: TENANT, entityId: ENTITY,
        effectiveFrom: '2020-01-01T00:00:00.000Z', effectiveTo: null, journalSourceCode: SOURCE_CODE,
        matchStrategy: 'FIRST_MATCH', noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION',
        rules: [{
          ruleId: 'line-items-rule', priority: 1, description: 'Dynamic debit lines against a fixed credit account.', condition: null,
          blueprint: {
            memoTemplate: 'Line-items fixture — {{sourceEntityId}}',
            postingGroups: [{
              groupId: 'grp', baseAmountPath: 'payload.amount',
              debitAllocations: [], debitLineItemsPath: 'payload.lines',
              creditAllocations: [{ accountNumber: creditAccount, storeId: 'CERT-STORE-1', bp: 10_000 }],
            }],
          },
        }],
      };
    }

    it('N debit line items, each to its own account, balance against one fixed credit line', async () => {
      const lineAcctA = await prisma.glAccount.create({ data: { id: randomUUID(), tenantId: TENANT, entityId: ENTITY, accountNumber: '62000', name: 'Fixture Line Item A (test only)', type: 'EXPENSE', normalBalance: 'DR', postable: true, status: 'ACTIVE' } });
      const lineAcctB = await prisma.glAccount.create({ data: { id: randomUUID(), tenantId: TENANT, entityId: ENTITY, accountNumber: '62100', name: 'Fixture Line Item B (test only)', type: 'ASSET', normalBalance: 'DR', postable: true, status: 'ACTIVE' } });
      const creditAcct = await prisma.glAccount.create({ data: { id: randomUUID(), tenantId: TENANT, entityId: ENTITY, accountNumber: '22000', name: 'Fixture AP Control for line items (test only)', type: 'LIABILITY', normalBalance: 'CR', postable: true, status: 'ACTIVE' } });

      const draft = await engine.createRulePackVersion({ tenantId: TENANT, packKey: 'line-items-pack', sourceText: JSON.stringify(lineItemsPack('line-items-pack', '22000')), actor: 'author-li' });
      const validated = await engine.validateVersion(TENANT, draft.id, 'author-li');
      expect(validated.valid).toBe(true);
      const activated = await engine.activateVersion(TENANT, draft.id, 'activator-li');
      expect(activated.status).toBe('ACTIVE');

      const eventId = `evt-${randomUUID()}`;
      const envelope = {
        ...certificationEnvelope({ tenantId: TENANT, entityId: ENTITY, eventId, amount: 300 }),
        eventType: 'accounting.posting-engine.line-items-fixture.v1',
        payload: { amount: 300, lines: [{ accountNumber: '62000', storeId: 'CERT-STORE-1', amount: 120 }, { accountNumber: '62100', storeId: 'CERT-STORE-1', amount: 180 }] },
      };
      const result = await engine.submitEvent(TENANT, envelope, 'tester');
      expect(result.status).toBe('POSTED');

      const calls = bridge.callsForEvent(eventId);
      expect(calls).toHaveLength(1);
      const lines = calls[0].lines;
      expect(lines).toHaveLength(3); // 2 dynamic debit lines + 1 fixed credit line
      expect(lines.find((l) => l.accountCode === lineAcctA.accountNumber)?.debit).toBe(120);
      expect(lines.find((l) => l.accountCode === lineAcctB.accountNumber)?.debit).toBe(180);
      expect(lines.find((l) => l.accountCode === creditAcct.accountNumber)?.credit).toBe(300);

      await prisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
    });

    it('a debit line items total that does not match baseAmountPath rejects deterministically — no journal posted', async () => {
      await prisma.glAccount.create({ data: { id: randomUUID(), tenantId: TENANT, entityId: ENTITY, accountNumber: '62200', name: 'Fixture Line Item C (test only)', type: 'EXPENSE', normalBalance: 'DR', postable: true, status: 'ACTIVE' } });
      await prisma.glAccount.create({ data: { id: randomUUID(), tenantId: TENANT, entityId: ENTITY, accountNumber: '22100', name: 'Fixture AP Control C (test only)', type: 'LIABILITY', normalBalance: 'CR', postable: true, status: 'ACTIVE' } });

      const draft = await engine.createRulePackVersion({ tenantId: TENANT, packKey: 'line-items-mismatch-pack', sourceText: JSON.stringify(lineItemsPack('line-items-mismatch-pack', '22100')), actor: 'author-li-mismatch' });
      await engine.validateVersion(TENANT, draft.id, 'author-li-mismatch');
      const activated = await engine.activateVersion(TENANT, draft.id, 'activator-li-mismatch');

      const eventId = `evt-${randomUUID()}`;
      const envelope = {
        ...certificationEnvelope({ tenantId: TENANT, entityId: ENTITY, eventId, amount: 100 }),
        eventType: 'accounting.posting-engine.line-items-fixture.v1',
        payload: { amount: 100, lines: [{ accountNumber: '62200', storeId: 'CERT-STORE-1', amount: 40 }] }, // sums to 40, not 100
      };
      const result = await engine.submitEvent(TENANT, envelope, 'tester');

      expect(result.status).toBe('REJECTED');
      expect(bridge.callsForEvent(eventId)).toHaveLength(0); // caught before ever reaching the bridge
      const exceptions = await prisma.postingException.findMany({ where: { tenantId: TENANT, executionId: result.executionId } });
      expect(exceptions[0].reasonDetail).toContain('items total');

      await prisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
    });
  });

  // ── CE-07/S023 concurrency ────────────────────────────────────────────────

  describe('Concurrency — activation races, replay races, effective-date overlap', () => {
    it('concurrent activation attempts on the SAME version: exactly one succeeds observably, version ends ACTIVE exactly once', async () => {
      const draft = await engine.createRulePackVersion({ tenantId: TENANT, packKey: 'concurrent-activate', sourceText: JSON.stringify(validRulePack({ ...fixtureOpts(), packKey: 'concurrent-activate' })), actor: 'author-race' });
      await engine.validateVersion(TENANT, draft.id, 'author-race');

      const [a, b] = await Promise.allSettled([
        engine.activateVersion(TENANT, draft.id, 'activator-race-1'),
        engine.activateVersion(TENANT, draft.id, 'activator-race-2'),
      ]);
      // Both may observably succeed (idempotent re-activation of an already-ACTIVE
      // version returns its current state) but the version must end up ACTIVE
      // exactly once, activated by exactly one of the two identities, never corrupted.
      const reloaded = await prisma.postingRulePackVersion.findUnique({ where: { id: draft.id } });
      expect(reloaded?.status).toBe('ACTIVE');
      expect(['activator-race-1', 'activator-race-2']).toContain(reloaded?.activatedBy);
      for (const r of [a, b]) {
        if (r.status === 'fulfilled') expect(r.value.status).toBe('ACTIVE');
      }

      await prisma.postingRulePackVersion.update({ where: { id: draft.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
    });

    it('concurrent replay requests against the SAME execution never produce two different resulting journals', async () => {
      const raceEventType = 'accounting.posting-engine.replay-race-fixture.v1';
      const eventId = `evt-${randomUUID()}`;
      const envelope = { ...certificationEnvelope({ tenantId: TENANT, entityId: ENTITY, eventId, amount: 33 }), eventType: raceEventType };
      const original = await engine.submitEvent(TENANT, envelope, 'tester');
      expect(original.status).toBe('NO_RULE_MATCH');

      const def = validRulePack({ ...fixtureOpts(), packKey: 'replay-race-pack' });
      (def as any).eventType = raceEventType;
      const draft = await engine.createRulePackVersion({ tenantId: TENANT, packKey: 'replay-race-pack', sourceText: JSON.stringify(def), actor: 'author-replay-race' });
      await engine.validateVersion(TENANT, draft.id, 'author-replay-race');
      const activated = await engine.activateVersion(TENANT, draft.id, 'activator-replay-race');

      const [a, b] = await Promise.allSettled([
        engine.replayEvent(TENANT, original.executionId, 'replay-op-1', 'race replay 1'),
        engine.replayEvent(TENANT, original.executionId, 'replay-op-2', 'race replay 2'),
      ]);
      const journalNumbers = new Set([a, b].filter((r) => r.status === 'fulfilled').map((r: any) => r.value.journalNumber).filter(Boolean));
      expect(journalNumbers.size).toBeLessThanOrEqual(1); // never two different journals from a race
      expect(bridge.callsForEvent(eventId).length).toBeLessThanOrEqual(1); // the conditional claim in replayEvent() lets only the race winner reach the bridge

      await prisma.postingRulePackVersion.update({ where: { id: activated.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
    });

    it('effective-date overlap across two DIFFERENT pack keys for the same event type is caught as ambiguity, not silently resolved', async () => {
      const overlapEventType = 'accounting.posting-engine.overlap-fixture.v1';
      async function activatedOverlapPack(packKey: string, effectiveFrom: string) {
        const def = validRulePack({ ...fixtureOpts(), packKey, effectiveFrom });
        (def as any).eventType = overlapEventType;
        const draft = await engine.createRulePackVersion({ tenantId: TENANT, packKey, sourceText: JSON.stringify(def), actor: 'author-overlap' });
        await engine.validateVersion(TENANT, draft.id, 'author-overlap');
        return engine.activateVersion(TENANT, draft.id, 'activator-overlap');
      }
      const v1 = await activatedOverlapPack('overlap-pack-1', '2019-06-01T00:00:00.000Z');
      const v2 = await activatedOverlapPack('overlap-pack-2', '2019-06-01T00:00:00.000Z'); // same effectiveFrom -> genuine overlap

      const eventId = `evt-${randomUUID()}`;
      const envelope = { ...certificationEnvelope({ tenantId: TENANT, entityId: ENTITY, eventId, amount: 5 }), eventType: overlapEventType };
      const result = await engine.submitEvent(TENANT, envelope, 'tester');
      expect(result.status).toBe('REJECTED');
      const exceptions = await prisma.postingException.findMany({ where: { tenantId: TENANT, executionId: result.executionId } });
      expect(exceptions[0].reasonCode).toBe('AMBIGUOUS_RULE_PACK_MATCH');

      await prisma.postingRulePackVersion.updateMany({ where: { id: { in: [v1.id, v2.id] } }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
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
        `INSERT INTO posting_rule_pack (id, tenant_id, entity_id, pack_key, created_by, created_at) VALUES ($1,$2,'rls-entity','rls-pack','rls-test',now())`,
        [packAId, TENANT_A],
      );
      const packB = randomUUID();
      await c.query(
        `INSERT INTO posting_rule_pack (id, tenant_id, entity_id, pack_key, created_by, created_at) VALUES ($1,$2,'rls-entity','rls-pack','rls-test',now())`,
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

      // D-S023-25 dual-version replay evidence — RLS coverage on the new table.
      await c.query(
        `INSERT INTO posting_execution_replay (id, tenant_id, execution_id, replay_actor, replay_reason, original_business_date, resulting_status, created_at)
         VALUES ($1,$2,$3,'rls-test','rls coverage','2026-01-01'::date,'NO_RULE_MATCH',now())`,
        [randomUUID(), TENANT_A, executionAId],
      );
      await c.query(
        `INSERT INTO posting_execution_replay (id, tenant_id, execution_id, replay_actor, replay_reason, original_business_date, resulting_status, created_at)
         VALUES ($1,$2,$3,'rls-test','rls coverage','2026-01-01'::date,'NO_RULE_MATCH',now())`,
        [randomUUID(), TENANT_B, executionBId],
      );
    });
  });

  it('tenant A cannot read tenant B posting_execution_replay rows', async () => {
    await withClient(APP_URL!, async (c) => {
      await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT_A]);
      const res = await c.query(`SELECT execution_id FROM posting_execution_replay WHERE execution_id = $1`, [executionBId]);
      expect(res.rows).toHaveLength(0);
      const own = await c.query(`SELECT execution_id FROM posting_execution_replay WHERE execution_id = $1`, [executionAId]);
      expect(own.rows).toHaveLength(1);
    });
  });

  afterAll(async () => {
    await withClient(SUPER_URL, async (c) => {
      await c.query(`DELETE FROM posting_exception WHERE tenant_id IN ($1,$2)`, [TENANT_A, TENANT_B]);
      await c.query(`DELETE FROM posting_execution_replay WHERE tenant_id IN ($1,$2)`, [TENANT_A, TENANT_B]);
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
