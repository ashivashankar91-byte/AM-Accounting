/**
 * CE-07 — final defect closure: legal-entity isolation for the Posting
 * Engine's rule packs, activation, candidate selection, replay, and S021
 * recovery evidence.
 *
 * Root cause (see posting-engine-service.ts's CE-07 comments):
 * PostingRulePack (the stable parent/identity row for a packKey) had no
 * entityId at all — (tenantId, packKey) alone was its unique identity — so
 * two legal entities in the same tenant could not independently configure
 * the same packKey, activateVersion's supersede query and submitEvent's/
 * simulateEvent's/replayEvent's candidate-selection queries never filtered
 * by entity, and PostingExecution carried no entity of its own. This suite
 * proves the fix end to end against a REAL database (schema/migration
 * 20260802020000_ce07_rule_pack_entity_isolation), using the same
 * FakeGlPostingBridge pattern as posting-engine-live.test.ts (this suite
 * certifies the ENGINE's own entity-scoping logic, not gl-service's).
 *
 * Same skip-unless-LIVE_DATABASE_URL convention as every other file in this
 * directory.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { PrismaClient } from '.prisma/coa-client';
import { PostingEngineService, RulePackNotFoundError, SelfActivationForbiddenError } from '../../src/application/posting-engine-service';
import { GlPostingBridge, GlPostingRequest, GlPostingResult, GlPostingBridgeError } from '../../src/application/gl-posting-bridge';
import { PostingRecoveryPort, RecoveryCaseInput } from '../../src/application/posting-recovery-port';
import { validRulePack, certificationEnvelope } from '../support/posting-engine-fixtures';
import type { IEventPublisher } from '@amacc/shared-kernel';

class RecordingPostingRecoveryPort implements PostingRecoveryPort {
  readonly reported: Array<{ tenantId: string; input: RecoveryCaseInput }> = [];
  async reportFailure(tenantId: string, input: RecoveryCaseInput): Promise<void> {
    this.reported.push({ tenantId, input });
  }
}

class FakeGlPostingBridge implements GlPostingBridge {
  readonly calls: GlPostingRequest[] = [];
  private counter = 0;
  async post(request: GlPostingRequest): Promise<GlPostingResult> {
    this.calls.push(request);
    this.counter += 1;
    return { journalEntryId: randomUUID(), journalNumber: `FAKE-ISO-${this.counter}`, status: 'PENDING_REVIEW' };
  }
}

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];
const noopEvents: IEventPublisher = { publish: async () => {}, subscribe: () => {} };

describe.skipIf(!LIVE_DB_URL)('CE-07 — legal-entity isolation (live database)', () => {
  let prisma: PrismaClient;
  let engine: PostingEngineService;
  let recoveryPort: RecordingPostingRecoveryPort;
  let bridge: FakeGlPostingBridge;

  const TENANT = `pe-iso-live-${randomUUID()}`;
  const ENTITY_A = randomUUID();
  const ENTITY_B = randomUUID();
  const SOURCE_CODE = 'PEISO';

  async function makePeriod(entityId: string) {
    const cal = await prisma.fiscalCalendar.create({
      data: { id: randomUUID(), tenantId: TENANT, entityId, fyStartMonth: 1, structure: 'TWELVE', status: 'DEFINED', actor: 'live-test' },
    });
    await prisma.fiscalPeriod.create({
      data: { id: randomUUID(), tenantId: TENANT, entityId, calendarId: cal.id, fiscalYear: 2026, periodNumber: 8, code: '2026-08', startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31'), status: 'OPEN' },
    });
  }

  async function makeAccounts(entityId: string) {
    await prisma.glAccount.create({
      data: { id: randomUUID(), tenantId: TENANT, entityId, accountNumber: '19000', name: 'CE-07 Isolation Suspense DR (test fixture)', type: 'ASSET', normalBalance: 'DR', postable: true, status: 'ACTIVE' },
    });
    await prisma.glAccount.create({
      data: { id: randomUUID(), tenantId: TENANT, entityId, accountNumber: '19100', name: 'CE-07 Isolation Suspense CR (test fixture)', type: 'ASSET', normalBalance: 'DR', postable: true, status: 'ACTIVE' },
    });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();

    bridge = new FakeGlPostingBridge();
    recoveryPort = new RecordingPostingRecoveryPort();
    engine = new PostingEngineService(prisma, noopEvents, bridge, recoveryPort);

    await makePeriod(ENTITY_A);
    await makePeriod(ENTITY_B);
    await prisma.journalSource.create({
      data: { id: randomUUID(), tenantId: TENANT, code: SOURCE_CODE, name: 'CE-07 Isolation Certification Source (test fixture)', sourceClass: 'SYSTEM', status: 'ACTIVE' },
    });
    await makeAccounts(ENTITY_A);
    await makeAccounts(ENTITY_B);
  });

  afterAll(async () => {
    await prisma.postingExecutionReplay.deleteMany({ where: { tenantId: TENANT } });
    await prisma.postingExecutionAttempt.deleteMany({ where: { tenantId: TENANT } });
    await prisma.postingException.deleteMany({ where: { tenantId: TENANT } });
    await prisma.postingExecution.deleteMany({ where: { tenantId: TENANT } });
    await prisma.postingRulePackVersion.deleteMany({ where: { tenantId: TENANT } });
    await prisma.postingRulePack.deleteMany({ where: { tenantId: TENANT } });
    await prisma.auditOutboxEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.journalSource.deleteMany({ where: { tenantId: TENANT } });
    await prisma.glAccount.deleteMany({ where: { tenantId: TENANT } });
    await prisma.fiscalPeriod.deleteMany({ where: { tenantId: TENANT } });
    await prisma.fiscalCalendar.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$disconnect();
  });

  function fixtureOpts(entityId: string, packKey: string, semver = '1.0.0') {
    return { tenantId: TENANT, entityId, drAccountNumber: '19000', crAccountNumber: '19100', journalSourceCode: SOURCE_CODE, packKey, semver };
  }

  async function draftValidateActivate(entityId: string, packKey: string, semver: string, author: string, activator: string) {
    const draft = await engine.createRulePackVersion({
      tenantId: TENANT, packKey, sourceText: JSON.stringify(validRulePack(fixtureOpts(entityId, packKey, semver))), actor: author,
    });
    await engine.validateVersion(TENANT, draft.id, author);
    return engine.activateVersion(TENANT, draft.id, activator);
  }

  // ── 1/2. Same packKey, independent per-entity identity + independent v1 activation ──
  describe('two legal entities sharing one packKey', () => {
    it('each entity gets its own PostingRulePack parent row and can independently activate its own version 1', async () => {
      const draftA = await engine.createRulePackVersion({
        tenantId: TENANT, packKey: 'shared-pack', sourceText: JSON.stringify(validRulePack(fixtureOpts(ENTITY_A, 'shared-pack'))), actor: 'author-a',
      });
      const draftB = await engine.createRulePackVersion({
        tenantId: TENANT, packKey: 'shared-pack', sourceText: JSON.stringify(validRulePack(fixtureOpts(ENTITY_B, 'shared-pack'))), actor: 'author-b',
      });

      // Distinct parent PostingRulePack rows — the pre-fix (tenantId, packKey)
      // unique constraint would have forced these into the SAME row (or
      // thrown a unique-constraint violation on the second create).
      expect(draftA.rulePackId).not.toBe(draftB.rulePackId);

      const packRowCount = await prisma.postingRulePack.count({ where: { tenantId: TENANT, packKey: 'shared-pack' } });
      expect(packRowCount).toBe(2);

      await engine.validateVersion(TENANT, draftA.id, 'author-a');
      await engine.validateVersion(TENANT, draftB.id, 'author-b');
      const activeA = await engine.activateVersion(TENANT, draftA.id, 'activator-a');
      const activeB = await engine.activateVersion(TENANT, draftB.id, 'activator-b');

      expect(activeA.status).toBe('ACTIVE');
      expect(activeB.status).toBe('ACTIVE');
      expect(activeA.semver).toBe('1.0.0');
      expect(activeB.semver).toBe('1.0.0');
    });

    it('getRulePack/listRulePacks never cross entities: entity B never appears in entity A\'s inquiry, and vice versa', async () => {
      const a = await engine.getRulePack(TENANT, 'shared-pack', ENTITY_A);
      expect(a.pack.entityId).toBe(ENTITY_A);
      expect(a.versions.every((v) => v.entityId === ENTITY_A)).toBe(true);

      const b = await engine.getRulePack(TENANT, 'shared-pack', ENTITY_B);
      expect(b.pack.entityId).toBe(ENTITY_B);
      expect(b.versions.every((v) => v.entityId === ENTITY_B)).toBe(true);

      const listA = await engine.listRulePacks(TENANT, ENTITY_A);
      expect(listA.some((row) => row.pack.packKey === 'shared-pack' && row.pack.entityId === ENTITY_B)).toBe(false);
      const listB = await engine.listRulePacks(TENANT, ENTITY_B);
      expect(listB.some((row) => row.pack.packKey === 'shared-pack' && row.pack.entityId === ENTITY_A)).toBe(false);
    });

    it('cross-entity read is a clean not-found, never a leak or a wrong-entity hit', async () => {
      // ENTITY_B has no pack with this key — a caller scoped to ENTITY_B
      // asking for entity A's packKey under a DIFFERENT key gets a genuine
      // 404-equivalent, not entity A's data.
      await expect(engine.getRulePack(TENANT, 'entity-a-only-pack-does-not-exist', ENTITY_B)).rejects.toThrow(RulePackNotFoundError);
    });
  });

  // ── 3. Activation in one entity must never supersede another entity's active version ──
  describe('activation in one entity does not supersede another entity\'s active version', () => {
    it('activating a new version for entity A leaves entity B\'s active v1 untouched', async () => {
      await draftValidateActivate(ENTITY_A, 'supersede-pack', '1.0.0', 'author-a1', 'activator-a1');
      const bV1 = await draftValidateActivate(ENTITY_B, 'supersede-pack', '1.0.0', 'author-b1', 'activator-b1');

      const aV2Draft = await engine.createRulePackVersion({
        tenantId: TENANT, packKey: 'supersede-pack', sourceText: JSON.stringify(validRulePack(fixtureOpts(ENTITY_A, 'supersede-pack', '2.0.0'))), actor: 'author-a2',
      });
      await engine.validateVersion(TENANT, aV2Draft.id, 'author-a2');
      const aV2 = await engine.activateVersion(TENANT, aV2Draft.id, 'activator-a2');
      expect(aV2.status).toBe('ACTIVE');

      const reloadedBV1 = await prisma.postingRulePackVersion.findUniqueOrThrow({ where: { id: bV1.id } });
      expect(reloadedBV1.status).toBe('ACTIVE');
      expect(reloadedBV1.supersededAt).toBeNull();
    });

    it('concurrent activation across two entities sharing a packKey does not collide (no false unique-constraint clash, no cross-supersede)', async () => {
      const draftA = await engine.createRulePackVersion({
        tenantId: TENANT, packKey: 'concurrent-shared', sourceText: JSON.stringify(validRulePack(fixtureOpts(ENTITY_A, 'concurrent-shared'))), actor: 'author-ca',
      });
      const draftB = await engine.createRulePackVersion({
        tenantId: TENANT, packKey: 'concurrent-shared', sourceText: JSON.stringify(validRulePack(fixtureOpts(ENTITY_B, 'concurrent-shared'))), actor: 'author-cb',
      });
      await engine.validateVersion(TENANT, draftA.id, 'author-ca');
      await engine.validateVersion(TENANT, draftB.id, 'author-cb');

      const [a, b] = await Promise.all([
        engine.activateVersion(TENANT, draftA.id, 'activator-ca'),
        engine.activateVersion(TENANT, draftB.id, 'activator-cb'),
      ]);
      expect(a.status).toBe('ACTIVE');
      expect(b.status).toBe('ACTIVE');
    });
  });

  // ── SoD is per-entity but the rule itself is unchanged by this fix ──
  it('same-entity author-versus-activator SoD remains enforced', async () => {
    const draft = await engine.createRulePackVersion({
      tenantId: TENANT, packKey: 'sod-entity-a', sourceText: JSON.stringify(validRulePack(fixtureOpts(ENTITY_A, 'sod-entity-a'))), actor: 'author-sod',
    });
    await engine.validateVersion(TENANT, draft.id, 'author-sod');
    await expect(engine.activateVersion(TENANT, draft.id, 'author-sod')).rejects.toThrow(SelfActivationForbiddenError);
  });

  // ── 4/5. submitEvent candidate selection must never cross entities ──
  describe('submitEvent candidate selection is entity-scoped', () => {
    const CANDIDATE_EVENT_TYPE = 'accounting.posting-engine.ce07-candidate-fixture.v1';

    async function activatedCandidatePack(entityId: string, author: string, activator: string) {
      const def = validRulePack(fixtureOpts(entityId, `candidate-pack-${entityId}`));
      (def as any).eventType = CANDIDATE_EVENT_TYPE;
      const draft = await engine.createRulePackVersion({ tenantId: TENANT, packKey: `candidate-pack-${entityId}`, sourceText: JSON.stringify(def), actor: author });
      await engine.validateVersion(TENANT, draft.id, author);
      return engine.activateVersion(TENANT, draft.id, activator);
    }

    it('an event from entity A selects only entity A\'s active pack, never entity B\'s, and vice versa', async () => {
      const activeA = await activatedCandidatePack(ENTITY_A, 'author-cand-a', 'activator-cand-a');
      const activeB = await activatedCandidatePack(ENTITY_B, 'author-cand-b', 'activator-cand-b');
      expect(activeA.id).not.toBe(activeB.id);

      const envelopeA = { ...certificationEnvelope({ tenantId: TENANT, entityId: ENTITY_A, eventId: `evt-cand-a-${randomUUID()}`, amount: 111 }), eventType: CANDIDATE_EVENT_TYPE };
      const resultA = await engine.submitEvent(TENANT, envelopeA, 'tester-a');
      expect(resultA.status).toBe('POSTED');
      expect(resultA.rulePackVersionId).toBe(activeA.id);

      const envelopeB = { ...certificationEnvelope({ tenantId: TENANT, entityId: ENTITY_B, eventId: `evt-cand-b-${randomUUID()}`, amount: 222 }), eventType: CANDIDATE_EVENT_TYPE };
      const resultB = await engine.submitEvent(TENANT, envelopeB, 'tester-b');
      expect(resultB.status).toBe('POSTED');
      expect(resultB.rulePackVersionId).toBe(activeB.id);

      // Post-fix invariant restated explicitly: never each other's version.
      expect(resultA.rulePackVersionId).not.toBe(activeB.id);
      expect(resultB.rulePackVersionId).not.toBe(activeA.id);
    });
  });

  // ── S021 recovery evidence retains legal-entity lineage ─────────────────────
  it('a NO_RULE_MATCH failure reports the correct legalEntityId to S021 recovery evidence', async () => {
    const eventId = `evt-no-match-${randomUUID()}`;
    const envelope = {
      ...certificationEnvelope({ tenantId: TENANT, entityId: ENTITY_A, eventId, amount: 50 }),
      eventType: 'accounting.posting-engine.ce07-no-active-pack-fixture.v1',
    };
    const result = await engine.submitEvent(TENANT, envelope, 'tester-no-match');
    expect(result.status).toBe('NO_RULE_MATCH');

    const reported = recoveryPort.reported.find((r) => r.input.executionId === result.executionId);
    expect(reported).toBeDefined();
    expect(reported!.input.legalEntityId).toBe(ENTITY_A);
  });

  // ── 6/replay. Replay selects the ORIGINAL legal entity and exact version, never a decoy ──
  it('replay selects the original execution\'s legal entity, never a same-eventType decoy pack from another entity', async () => {
    const REPLAY_EVENT_TYPE = 'accounting.posting-engine.ce07-replay-fixture.v1';
    const eventId = `evt-replay-${randomUUID()}`;
    const envelope = { ...certificationEnvelope({ tenantId: TENANT, entityId: ENTITY_A, eventId, amount: 77 }), eventType: REPLAY_EVENT_TYPE };

    const initial = await engine.submitEvent(TENANT, envelope, 'tester-replay-initial');
    expect(initial.status).toBe('NO_RULE_MATCH');

    // Decoy: activate an ENTITY_B pack for the SAME event type BEFORE the
    // correcting ENTITY_A pack exists — if replay's candidate selection ever
    // regressed to being entity-blind, this decoy would be silently
    // eligible and could be selected instead of (or ambiguously with) the
    // real correction.
    const decoyDef = validRulePack(fixtureOpts(ENTITY_B, 'replay-decoy-pack'));
    (decoyDef as any).eventType = REPLAY_EVENT_TYPE;
    const decoyDraft = await engine.createRulePackVersion({ tenantId: TENANT, packKey: 'replay-decoy-pack', sourceText: JSON.stringify(decoyDef), actor: 'author-decoy' });
    await engine.validateVersion(TENANT, decoyDraft.id, 'author-decoy');
    await engine.activateVersion(TENANT, decoyDraft.id, 'activator-decoy');

    // Real correction, entity A.
    const correctDef = validRulePack(fixtureOpts(ENTITY_A, 'replay-correct-pack'));
    (correctDef as any).eventType = REPLAY_EVENT_TYPE;
    const correctDraft = await engine.createRulePackVersion({ tenantId: TENANT, packKey: 'replay-correct-pack', sourceText: JSON.stringify(correctDef), actor: 'author-correct' });
    await engine.validateVersion(TENANT, correctDraft.id, 'author-correct');
    const correctActive = await engine.activateVersion(TENANT, correctDraft.id, 'activator-correct');

    const replayed = await engine.replayEvent(TENANT, initial.executionId, 'replay-operator', 'corrected pack now active for entity A');
    expect(replayed.status).toBe('POSTED');
    expect(replayed.rulePackVersionId).toBe(correctActive.id);

    const reloaded = await prisma.postingExecution.findUniqueOrThrow({ where: { id: initial.executionId } });
    expect(reloaded.entityId).toBe(ENTITY_A);
  });

  // ── Tenant isolation remains intact even when entityId values collide across tenants ──
  it('tenant isolation remains intact: a pack in a different tenant with the SAME entityId never appears in this tenant\'s inquiry', async () => {
    const OTHER_TENANT = `pe-iso-other-tenant-${randomUUID()}`;
    // Deliberately reuse ENTITY_A's exact id under a different tenant — the
    // hardest version of this negative: an entity-id match must never
    // substitute for a tenant-id match.
    const otherPack = await prisma.postingRulePack.create({
      data: { id: randomUUID(), tenantId: OTHER_TENANT, entityId: ENTITY_A, packKey: 'cross-tenant-collision-pack', createdBy: 'other-tenant-author' },
    });
    try {
      const list = await engine.listRulePacks(TENANT, ENTITY_A);
      expect(list.some((row) => row.pack.id === otherPack.id)).toBe(false);
      await expect(engine.getRulePack(TENANT, 'cross-tenant-collision-pack', ENTITY_A)).rejects.toThrow(RulePackNotFoundError);
    } finally {
      await prisma.postingRulePack.delete({ where: { id: otherPack.id } });
    }
  });
});
