// S019/S020 — Posting Engine orchestration: rule-pack lifecycle (draft ->
// validate -> activate) and idempotent certification-event posting.
//
// SINGLE AUTHORITATIVE LEDGER DECISION: this service is a CLIENT of
// GlPostingBridge (services/coa-service/src/application/gl-posting-bridge.ts)
// — it never writes journal_entry/journal_line itself and no longer uses
// PostingService.post() (coa-service's own, separate ledger) for
// rule-engine-driven postings. Every journal a rule pack produces goes
// through gl-service's existing, certified posting door — the SAME one
// Trial Balance, Financial Statements, and schedule-service (via
// JOURNAL_ENTRY_POSTED) already read from. gl-service has no idempotency
// mechanism of its own, so claimExecution()'s DB-unique-constraint-backed
// claim (below) is now the sole duplicate-prevention point for a brand-new
// event; PostingExecution rows here remain execution/evaluation evidence —
// see the class doc-comments for detail.
import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { PrismaClient } from '.prisma/coa-client';
import { IEventPublisher, setTenantContextOnConnection } from '@amacc/shared-kernel';
import { validateRulePackSource, ValidationFinding, AccountLookup } from '../domain/posting-engine/validator';
import { RulePackDefinition } from '../domain/posting-engine/dsl';
import { freezeRulePack, hashRulePack } from '../domain/posting-engine/canonical';
import { assertEnvelopeShape, hashEnvelope, EnvelopeShapeError, SourceEventEnvelope } from '../domain/posting-engine/event-envelope';
import { selectRule, generateBlueprint, verifyBlueprint, hashBlueprint, BlueprintResolutionError, BlueprintLine } from '../domain/posting-engine/blueprint';
import { PostingRecoveryPort } from './posting-recovery-port';
import { GlPostingBridge, GlPostingBridgeError } from './gl-posting-bridge';

// ── Errors ───────────────────────────────────────────────────────────────────

export class PostingEngineInputError extends Error {
  readonly status = 400;
  readonly code = 'POSTING_ENGINE_INPUT_ERROR';
  constructor(message: string) { super(message); this.name = 'PostingEngineInputError'; }
}

export class RulePackNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'RULE_PACK_NOT_FOUND';
  constructor(packKey: string) { super(`Rule pack "${packKey}" not found`); this.name = 'RulePackNotFoundError'; }
}

export class RulePackVersionNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'RULE_PACK_VERSION_NOT_FOUND';
  constructor(id: string) { super(`Rule pack version "${id}" not found`); this.name = 'RulePackVersionNotFoundError'; }
}

export class ActivationNotEligibleError extends Error {
  readonly status = 422;
  readonly code = 'ACTIVATION_NOT_ELIGIBLE';
  constructor(message: string) { super(message); this.name = 'ActivationNotEligibleError'; }
}

/** S023/D-28, required by S024 (CE-12): a version's own author may never also activate it. */
export class ActivationSoDViolationError extends Error {
  readonly status = 422;
  readonly code = 'ACTIVATION_SOD_VIOLATION';
  constructor(message: string) { super(message); this.name = 'ActivationSoDViolationError'; }
}

export class EventIdentityConflictError extends Error {
  readonly status = 409;
  readonly code = 'EVENT_IDENTITY_CONFLICT';
  constructor(readonly executionId: string, readonly eventId: string) {
    super(`Event "${eventId}" was already received with different content (identity conflict).`);
    this.name = 'EventIdentityConflictError';
  }
}

/** D-S023-28 — identity-based author-vs-activator segregation of duties. Enforced server-side; never rely on UI-only restriction. */
export class SelfActivationForbiddenError extends Error {
  readonly status = 403;
  readonly code = 'SELF_ACTIVATION_FORBIDDEN';
  constructor(versionId: string) {
    super(`Rule pack version "${versionId}" was created by this same identity — a separately authorized user must activate it.`);
    this.name = 'SelfActivationForbiddenError';
  }
}

/** D-S023-08 — deterministic ambiguity rejection. Two or more ACTIVE rule-pack versions are equally the most-specific match; never silently tie-broken. */
export class AmbiguousRulePackMatchError extends Error {
  readonly status = 409;
  readonly code = 'AMBIGUOUS_RULE_PACK_MATCH';
  constructor(readonly candidateVersionIds: string[]) {
    super(`Ambiguous rule-pack match: ${candidateVersionIds.length} equally-specific ACTIVE versions match this event (${candidateVersionIds.join(', ')}). Never silently selecting one.`);
    this.name = 'AmbiguousRulePackMatchError';
  }
}

/** D-S023-25 — replay is only defined for an execution whose prior terminal outcome was NOT already POSTED. */
/** Internal-only signal (never surfaced to an HTTP caller directly) carrying which account number failed to resolve, thrown inside the account-resolution $transaction so a genuine miss aborts that transaction rather than silently continuing under a possibly-wrong RLS context. */
class AccountResolutionFailedError extends Error {
  constructor(readonly accountNumber: string) {
    super(`Account ${accountNumber} could not be resolved`);
    this.name = 'AccountResolutionFailedError';
  }
}

export class ReplayNotEligibleError extends Error {
  readonly status = 422;
  readonly code = 'REPLAY_NOT_ELIGIBLE';
  constructor(message: string) { super(message); this.name = 'ReplayNotEligibleError'; }
}

export class PostingExecutionNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'POSTING_EXECUTION_NOT_FOUND';
  constructor(id: string) { super(`Posting execution "${id}" not found`); this.name = 'PostingExecutionNotFoundError'; }
}

/** D-S023-21 — closed, deterministic failure taxonomy. Every code here gets its own durable posting_exception row (see finalizeRejected/finalizeFailed) — never a generic free-text-only rejection. */
export const POSTING_FAILURE_REASON_CODES = {
  NO_RULE_MATCH: 'NO_RULE_MATCH',
  EVENT_IDENTITY_CONFLICT: 'EVENT_IDENTITY_CONFLICT',
  AMBIGUOUS_RULE_PACK_MATCH: 'AMBIGUOUS_RULE_PACK_MATCH',
  UNBALANCED_BLUEPRINT: 'UNBALANCED_BLUEPRINT',
  INVALID_ACCOUNT: 'INVALID_ACCOUNT',
  MISSING_MANDATORY_FIELD: 'MISSING_MANDATORY_FIELD',
  PERIOD_CLOSED: 'PERIOD_CLOSED',
  RULE_PACK_EVALUATION_ERROR: 'RULE_PACK_EVALUATION_ERROR',
  POSTING_ENGINE_FAILURE: 'POSTING_ENGINE_FAILURE',
} as const;

/** Classifies a rejection/failure message into one of the closed taxonomy codes above — never a single generic catch-all. */
function classifyFailure(source: 'blueprint-resolution' | 'blueprint-verification' | 'account-resolution' | 'posting-violation' | 'posting-input' | 'unexpected', message: string): string {
  if (source === 'account-resolution') return POSTING_FAILURE_REASON_CODES.INVALID_ACCOUNT;
  if (source === 'blueprint-verification') {
    return message.includes('UNBALANCED_BLUEPRINT') ? POSTING_FAILURE_REASON_CODES.UNBALANCED_BLUEPRINT : POSTING_FAILURE_REASON_CODES.RULE_PACK_EVALUATION_ERROR;
  }
  if (source === 'blueprint-resolution') return POSTING_FAILURE_REASON_CODES.MISSING_MANDATORY_FIELD;
  if (source === 'posting-violation') {
    return /period/i.test(message) ? POSTING_FAILURE_REASON_CODES.PERIOD_CLOSED : POSTING_FAILURE_REASON_CODES.RULE_PACK_EVALUATION_ERROR;
  }
  if (source === 'posting-input') return POSTING_FAILURE_REASON_CODES.MISSING_MANDATORY_FIELD;
  return POSTING_FAILURE_REASON_CODES.POSTING_ENGINE_FAILURE;
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface CreateRulePackVersionDTO {
  tenantId: string;
  packKey: string;
  sourceText: string;
  actor: string;
}

export interface SimulateEventResult {
  wouldPost: boolean;
  status: 'WOULD_POST' | 'NO_RULE_MATCH' | 'AMBIGUOUS_RULE_PACK_MATCH' | 'WOULD_REJECT';
  rulePackVersionId?: string | null;
  ruleId?: string | null;
  proposedJournal?: { entityId: string; date: string; sourceCode: string; lines: BlueprintLine[] } | null;
  failureReason?: string | null;
}

export interface SubmitEventResult {
  executionId: string;
  eventId: string;
  status: 'POSTED' | 'NO_RULE_MATCH' | 'REJECTED' | 'FAILED';
  idempotent: boolean;
  rulePackVersionId?: string | null;
  ruleId?: string | null;
  journalEntryId?: string | null;
  journalNumber?: string | null;
  failureReason?: string | null;
}

/** CE-12 (S024) rule-pack keys live under this namespace — see isCE12PackKey(). */
export const CE12_PACK_KEY_PREFIX = 'ce12.';
export function isCE12PackKey(packKey: string): boolean {
  return packKey.startsWith(CE12_PACK_KEY_PREFIX);
}

/** S024 (CE-12) — distinct result shape for simulate() (dry-run blueprint preview), kept separate from CE-07's own SimulateEventResult (used by simulateEvent()) since the two methods have different status enums and payloads. */
export interface BlueprintSimulationResult {
  status: 'BLUEPRINT_GENERATED' | 'NO_RULE_MATCH' | 'REJECTED';
  rulePackVersionId?: string | null;
  ruleId?: string | null;
  blueprintHash?: string | null;
  lines?: BlueprintLine[];
  failureReason?: string | null;
}

@injectable()
export class PostingEngineService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
    @inject('GlPostingBridge') private readonly glPostingBridge: GlPostingBridge,
    @inject('PostingRecoveryPort') private readonly recovery: PostingRecoveryPort,
  ) {}

  private accountLookup(): AccountLookup {
    return async (entityId: string, accountNumber: string) => {
      const acct = await this.prisma.glAccount.findUnique({ where: { entityId_accountNumber: { entityId, accountNumber } } });
      if (!acct) return null;
      return { accountNumber: acct.accountNumber, type: acct.type, postable: acct.postable, status: acct.status };
    };
  }

  /**
   * Schedule-relevant open-item matching (gl-service) keys off controlNumber
   * — shared by evaluateAndPost (submitEvent) and replayEvent so a replayed
   * posting resolves to the SAME control number as an original submission
   * of the same event ever would. Previously replayEvent built its
   * gl-service line payload independently and omitted controlNumber
   * entirely, so a replayed posting to a schedule-relevant account always
   * landed with an empty controlNumber — silently unrelieved/unmatched by
   * the real schedule-service consumer.
   */
  private controlNumberFor(envelope: SourceEventEnvelope): string | null {
    const ref = envelope.payload?.['sourceDocId'] ?? envelope.payload?.['invoiceNumber'] ?? null;
    return ref != null ? String(ref) : null;
  }

  /** D-S023-30 — records the real before/after state (previously `before` was hardcoded null on every call site). `before` defaults to null for genuine creation/evaluation-only events where nothing existed to diff against. */
  private async audit(tenantId: string, docId: string, action: string, actor: string, after: unknown, tx: Pick<PrismaClient, 'auditOutboxEvent'> = this.prisma, before: unknown = null) {
    await tx.auditOutboxEvent.create({
      data: { id: crypto.randomUUID(), tenantId, docType: 'POSTING_ENGINE', docId, action, before: before as any, after: after as any, actor },
    });
  }

  /** D-S023-30 — shallow before/after field diff (mirrors audit-service's own diffFields pattern), used to produce a reconstructable mapping-change diff for every material rule-pack transition. */
  private diffFields(before: unknown, after: unknown): Array<{ field: string; before: unknown; after: unknown }> {
    const b = before && typeof before === 'object' ? (before as Record<string, unknown>) : {};
    const a = after && typeof after === 'object' ? (after as Record<string, unknown>) : {};
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    const diffs: Array<{ field: string; before: unknown; after: unknown }> = [];
    for (const key of keys) {
      const bv = b[key];
      const av = a[key];
      if (JSON.stringify(bv ?? null) !== JSON.stringify(av ?? null)) {
        diffs.push({ field: key, before: bv ?? null, after: av ?? null });
      }
    }
    return diffs;
  }

  // ── A/B — Rule pack draft / validate / activate / inquiry ──────────────────

  /** Stateless validation — no persistence. Used by the "Validate" button before saving. */
  async validateDraftSource(tenantId: string, sourceText: string): Promise<{ valid: boolean; findings: ValidationFinding[] }> {
    const result = await validateRulePackSource(sourceText, tenantId, this.accountLookup());
    return { valid: result.valid, findings: result.findings };
  }

  /** Create a new rule-pack version in DRAFT status. Requires well-formed strict JSON (an object); does not require full semantic validity — that's a separate validate step. */
  async createRulePackVersion(dto: CreateRulePackVersionDTO) {
    let parsedForShape: unknown;
    const initialCheck = await validateRulePackSource(dto.sourceText, dto.tenantId, this.accountLookup());
    // Even an invalid draft must at least be a JSON object with the fields we
    // need to file it (packKey/semver) — anything less isn't a draft, it's a
    // parse error the UI should surface before a version row is even created.
    if (initialCheck.findings.some((f) => f.code === 'JSON_PARSE_ERROR' || f.code === 'INVALID_ROOT_SHAPE')) {
      throw new PostingEngineInputError(initialCheck.findings[0].message);
    }
    parsedForShape = JSON.parse(dto.sourceText);
    const doc = parsedForShape as Record<string, unknown>;
    const packKey = typeof doc['packKey'] === 'string' && doc['packKey'] ? doc['packKey'] : dto.packKey;
    const semver = typeof doc['semver'] === 'string' ? doc['semver'] : '0.0.0';
    if (!packKey) throw new PostingEngineInputError('packKey is required.');
    // CE-07 legal-entity isolation defect — a pack key is only stable
    // identity WITHIN a legal entity (see PostingRulePack's doc-comment in
    // schema.prisma). Required here, not defaulted, so the browser must
    // supply it explicitly — the server never infers legal-entity ownership.
    const entityId = typeof doc['entityId'] === 'string' && doc['entityId'] ? doc['entityId'] : '';
    if (!entityId) throw new PostingEngineInputError('entityId is required.');

    const created = await this.prisma.$transaction(async (tx) => {
      // Interactive $transaction callbacks run on their OWN dedicated
      // connection, separate from the one the base client's $use middleware
      // set app.current_tenant_id on — see rls-middleware.ts's
      // setTenantContextOnConnection doc-comment (Final-R0 Batch C). Found
      // live during CE-07's browser certification: this call site never had
      // the fix applied, so it worked only by connection-pool luck under low
      // request volume and deterministically 42501'd once the pool churned.
      await setTenantContextOnConnection(tx, dto.tenantId);
      // CE-07 legal-entity isolation defect — find-or-create is now scoped
      // by (tenantId, entityId, packKey), not (tenantId, packKey), so a
      // second legal entity configuring the same packKey gets its OWN
      // parent row (and therefore its own independent version history and
      // activation state) instead of silently reusing entity A's row.
      let pack = await tx.postingRulePack.findUnique({ where: { tenantId_entityId_packKey: { tenantId: dto.tenantId, entityId, packKey } } });
      if (!pack) {
        pack = await tx.postingRulePack.create({ data: { id: crypto.randomUUID(), tenantId: dto.tenantId, entityId, packKey, createdBy: dto.actor } });
      }
      const contentHash = hashRulePack(freezeRulePack(doc as unknown as RulePackDefinition));
      const version = await tx.postingRulePackVersion.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: dto.tenantId,
          rulePackId: pack.id,
          packKey,
          semver,
          dslVersion: Number(doc['dslVersion'] ?? 0),
          eventType: String(doc['eventType'] ?? ''),
          eventSchemaVersions: Array.isArray(doc['supportedEventSchemaVersions']) ? (doc['supportedEventSchemaVersions'] as string[]) : [],
          entityId,
          effectiveFrom: doc['effectiveFrom'] ? new Date(doc['effectiveFrom'] as string) : new Date(0),
          effectiveTo: doc['effectiveTo'] ? new Date(doc['effectiveTo'] as string) : null,
          journalSourceCode: String(doc['journalSourceCode'] ?? ''),
          matchStrategy: String(doc['matchStrategy'] ?? ''),
          noMatchBehavior: String(doc['noMatchBehavior'] ?? ''),
          definition: doc as any,
          contentHash,
          status: 'DRAFT',
          validationFindings: initialCheck.findings as any,
          createdBy: dto.actor,
        },
      });
      await this.audit(dto.tenantId, version.id, 'DRAFT_CREATED', dto.actor, { packKey, semver, contentHash }, tx);
      return version;
    });
    return created;
  }

  /** Re-run full validation against a persisted version's current content and record the findings. */
  async validateVersion(tenantId: string, versionId: string, actor: string) {
    const version = await this.prisma.postingRulePackVersion.findFirst({ where: { id: versionId, tenantId } });
    if (!version) throw new RulePackVersionNotFoundError(versionId);

    const source = JSON.stringify(version.definition);
    const result = await validateRulePackSource(source, tenantId, this.accountLookup());
    const newStatus = version.status === 'DRAFT' && result.valid ? 'VALIDATED' : version.status === 'DRAFT' ? 'DRAFT' : version.status;

    const beforeState = { status: version.status, validationFindingCount: Array.isArray(version.validationFindings) ? version.validationFindings.length : 0 };
    const updated = await this.prisma.$transaction(async (tx) => {
      await setTenantContextOnConnection(tx, tenantId);
      const u = await tx.postingRulePackVersion.update({
        where: { id: versionId },
        data: { validationFindings: result.findings as any, validatedAt: new Date(), status: newStatus },
      });
      const afterState = { status: newStatus, validationFindingCount: result.findings.length, valid: result.valid };
      await this.audit(tenantId, versionId, 'VALIDATION_COMPLETED', actor, { ...afterState, fieldDiffs: this.diffFields(beforeState, afterState) }, tx, beforeState);
      return u;
    });
    return { version: updated, valid: result.valid, findings: result.findings };
  }

  /**
   * Activate a VALIDATED version. Immutable thereafter (DB trigger backstop).
   *
   * D-S023-28 (identity-based SoD, enforced here at the backend — never only
   * in the UI): the identity that created this version cannot be the same
   * identity that activates it. A version is created exactly once (there is
   * no in-place content-edit endpoint on this service — any change to
   * content is a new draft version, see createRulePackVersion), so
   * `createdBy` is the complete "authored or materially changed" identity
   * for this version.
   */
  async activateVersion(tenantId: string, versionId: string, actor: string) {
    const version = await this.prisma.postingRulePackVersion.findFirst({ where: { id: versionId, tenantId } });
    if (!version) throw new RulePackVersionNotFoundError(versionId);
    if (actor === version.createdBy) {
      await this.audit(tenantId, versionId, 'ACTIVATION_FAILED', actor, { reason: 'SELF_ACTIVATION_FORBIDDEN', createdBy: version.createdBy });
      throw new SelfActivationForbiddenError(versionId);
    }
    if (version.status !== 'VALIDATED') {
      await this.audit(tenantId, versionId, 'ACTIVATION_FAILED', actor, { reason: `status is ${version.status}, not VALIDATED` });
      throw new ActivationNotEligibleError(`Rule pack version is "${version.status}" — only a VALIDATED version may be activated.`);
    }
    // S023/D-28 (required by S024): the version's own author may not also be
    // its activator. Refusal is named and audited, never silently allowed.
    // Scoped to CE-12's own pack-key namespace ("ce12.") only — enforcing
    // this globally would change already-certified behavior for other
    // epics' rule packs (pre-CE-12 fixtures/tests author and activate with
    // the same actor), which the epic's own "shared files untouched" DoD
    // guard forbids. CE-12 packs opt into the stricter S023 SoD governance
    // this story requires without regressing prior epics.
    if (isCE12PackKey(version.packKey) && version.createdBy === actor) {
      await this.audit(tenantId, versionId, 'ACTIVATION_REFUSED_SOD', actor, { reason: 'actor is also the version author', createdBy: version.createdBy });
      throw new ActivationSoDViolationError(`Rule pack version "${versionId}" was authored by "${actor}" — a separately authorized user must activate it.`);
    }

    const activated = await this.prisma.$transaction(async (tx) => {
      await setTenantContextOnConnection(tx, tenantId);
      // CE-07 legal-entity isolation defect — THE concrete "activation in
      // entity A must never supersede entity B's active version" bug: this
      // query previously matched on (tenantId, packKey, status) alone, so
      // activating entity A's version silently superseded entity B's
      // active version of the same packKey. entityId is now part of the
      // supersede match, same as the version being activated.
      const supersededCandidates = await tx.postingRulePackVersion.findMany({
        where: { tenantId, entityId: version.entityId, packKey: version.packKey, status: 'ACTIVE' },
        select: { id: true, semver: true },
      });
      await tx.postingRulePackVersion.updateMany({
        where: { tenantId, entityId: version.entityId, packKey: version.packKey, status: 'ACTIVE' },
        data: { status: 'SUPERSEDED', supersededAt: new Date() },
      });
      // D-S023-30 — supersession is its own material transition, audited on the superseded version's own docId (previously not audited at all).
      for (const prior of supersededCandidates) {
        await this.audit(tenantId, prior.id, 'SUPERSEDED', actor, { status: 'SUPERSEDED', supersededBy: versionId }, tx, { status: 'ACTIVE' });
      }
      const u = await tx.postingRulePackVersion.update({
        where: { id: versionId },
        data: { status: 'ACTIVE', activatedBy: actor, activatedAt: new Date() },
      });
      const beforeState = { status: 'VALIDATED' };
      const afterState = { status: 'ACTIVE', activatedBy: actor, packKey: version.packKey, semver: version.semver, contentHash: version.contentHash };
      await this.audit(tenantId, versionId, 'ACTIVATION_SUCCEEDED', actor, { ...afterState, fieldDiffs: this.diffFields(beforeState, afterState) }, tx, beforeState);
      return u;
    });
    return activated;
  }

  /**
   * CE-07 legal-entity isolation defect — entityId is REQUIRED, not
   * optional: a single inquiry call is always scoped to exactly one legal
   * entity ("the browser must not infer or calculate legal-entity
   * ownership" — the caller supplies it, this method never guesses). Both
   * the pack lookup AND the version list are filtered by entityId as
   * defense-in-depth (rulePackId already ties a version to exactly one
   * entity via the pack's own entity-scoped identity, but a version row
   * filtered independently by the wrong entityId must still come back
   * empty, never leak from a mismatched rulePackId join).
   */
  async getRulePack(tenantId: string, packKey: string, entityId: string) {
    const pack = await this.prisma.postingRulePack.findUnique({ where: { tenantId_entityId_packKey: { tenantId, entityId, packKey } } });
    if (!pack) throw new RulePackNotFoundError(packKey);
    const versions = await this.prisma.postingRulePackVersion.findMany({ where: { tenantId, entityId, rulePackId: pack.id }, orderBy: { createdAt: 'desc' } });
    return { pack, versions };
  }

  async listRulePacks(tenantId: string, entityId: string) {
    const packs = await this.prisma.postingRulePack.findMany({ where: { tenantId, entityId }, orderBy: { createdAt: 'desc' } });
    const versions = await this.prisma.postingRulePackVersion.findMany({ where: { tenantId, entityId }, orderBy: { createdAt: 'desc' } });
    return packs.map((p) => ({ pack: p, versions: versions.filter((v) => v.rulePackId === p.id) }));
  }

  // ── D/E/F — Event ingestion, evaluation, posting orchestration ──────────────

  async submitEvent(authenticatedTenantId: string, rawEnvelope: unknown, actor: string): Promise<SubmitEventResult> {
    let envelope: SourceEventEnvelope;
    try {
      envelope = assertEnvelopeShape(rawEnvelope);
    } catch (e) {
      if (e instanceof EnvelopeShapeError) throw new PostingEngineInputError(e.message);
      throw e;
    }
    if (envelope.tenantId !== authenticatedTenantId) {
      throw new PostingEngineInputError('Event tenantId does not match the authenticated tenant context.');
    }

    const eventHash = hashEnvelope(envelope);

    // ── Idempotency identity: tenantId + eventId ──────────────────────────────
    const existing = await this.prisma.postingExecution.findUnique({
      where: { tenantId_eventId: { tenantId: authenticatedTenantId, eventId: envelope.eventId } },
    });
    if (existing) {
      if (existing.eventHash === eventHash) {
        await this.recordAttempt(existing.id, authenticatedTenantId, 'DUPLICATE', { eventHash });
        await this.audit(authenticatedTenantId, existing.id, 'DUPLICATE_NOOP', actor, { eventId: envelope.eventId });
        return this.toResult(existing, true);
      }
      await this.recordAttempt(existing.id, authenticatedTenantId, 'IDENTITY_CONFLICT', { existingHash: existing.eventHash, newHash: eventHash });
      await this.prisma.postingException.create({
        data: {
          id: crypto.randomUUID(), tenantId: authenticatedTenantId, executionId: existing.id,
          reasonCode: 'EVENT_IDENTITY_CONFLICT',
          reasonDetail: `Event ${envelope.eventId} was received again with a different content hash.`,
          eventType: envelope.eventType, eventSchemaVersion: envelope.eventSchemaVersion,
          rulePackVersionsConsidered: [] as any,
        },
      });
      await this.audit(authenticatedTenantId, existing.id, 'IDENTITY_CONFLICT', actor, { eventId: envelope.eventId });
      await this.recovery.reportFailure(authenticatedTenantId, {
        executionId: existing.id, envelope, legalEntityId: envelope.legalEntityId,
        reasonCode: 'EVENT_IDENTITY_CONFLICT', reasonDetail: `Event ${envelope.eventId} was received again with a different content hash.`,
        rulePackVersionId: existing.rulePackVersionId,
      });
      throw new EventIdentityConflictError(existing.id, envelope.eventId);
    }

    // ── Rule-pack version selection (deterministic; pinned before evaluation) ──
    // CE-07 legal-entity isolation defect — candidate selection previously
    // filtered by tenantId + eventType + status/effective window ONLY, so a
    // second entity's ACTIVE pack for the same event type in the same
    // tenant could be silently selected for the wrong entity's event. The
    // envelope's own legalEntityId (never inferred from a candidate that
    // happens to match) is now a hard filter, same standing as tenantId.
    const occurredAt = new Date(envelope.occurredAt);
    // fix(integration): pinned to the SAME connection the tenant-context SET
    // runs on — see createRulePackVersion's identical fix above for the
    // full explanation (rls-middleware.ts's disclosed connection-pool
    // limitation). Found live during CE-13 governed-posting certification:
    // this call had no such protection, so a real ACTIVE rule pack was
    // intermittently invisible to its own event-matching query.
    const candidates = await this.prisma.$transaction(async (tx) => {
      await setTenantContextOnConnection(tx, authenticatedTenantId);
      return tx.postingRulePackVersion.findMany({
        where: {
          tenantId: authenticatedTenantId,
          entityId: envelope.legalEntityId,
          eventType: envelope.eventType,
          status: 'ACTIVE',
          effectiveFrom: { lte: occurredAt },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: occurredAt } }],
        },
      });
    });
    const matchingSchema = candidates.filter((c) => c.eventSchemaVersions.includes(envelope.eventSchemaVersion));
    const considered = candidates.map((c) => ({ id: c.id, packKey: c.packKey, semver: c.semver }));

    if (matchingSchema.length === 0) {
      return this.finalizeNoMatch(authenticatedTenantId, envelope, eventHash, null, null, considered, 'No active rule pack version covers this event type/schema version/date.', actor);
    }

    // ── D-S023-08: deterministic most-specific selection; reject true ambiguity, never silently tie-break ──
    const ranked = [...matchingSchema].sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
    const topEffectiveFrom = ranked[0].effectiveFrom.getTime();
    const mostSpecific = ranked.filter((c) => c.effectiveFrom.getTime() === topEffectiveFrom);
    if (mostSpecific.length > 1) {
      return this.finalizeAmbiguous(authenticatedTenantId, envelope, eventHash, considered, mostSpecific.map((c) => c.id), actor);
    }
    const selected = mostSpecific[0];

    const pack = selected.definition as unknown as RulePackDefinition;
    const match = selectRule(pack, envelope);
    if (!match) {
      return this.finalizeNoMatch(authenticatedTenantId, envelope, eventHash, selected.id, null, considered, 'An active rule pack was selected but no rule condition matched this event.', actor);
    }

    let lines: BlueprintLine[];
    try {
      lines = generateBlueprint(match.rule, envelope);
    } catch (e) {
      const message = e instanceof BlueprintResolutionError ? e.message : String((e as Error).message ?? e);
      return this.finalizeRejected(authenticatedTenantId, envelope, eventHash, selected.id, match.rule.ruleId, null, message, classifyFailure('blueprint-resolution', message), actor);
    }
    const blueprintViolations = verifyBlueprint(lines);
    if (blueprintViolations.length > 0) {
      const message = `Blueprint failed defensive verification: ${blueprintViolations.map((v) => v.message).join('; ')}`;
      return this.finalizeRejected(authenticatedTenantId, envelope, eventHash, selected.id, match.rule.ruleId, null,
        message, classifyFailure('blueprint-verification', message), actor);
    }
    const blueprintHash = hashBlueprint(match.rule.ruleId, lines);

    // Resolve account ids for the accepted posting path's line shape.
    // fix(integration): pinned to one connection with the tenant context
    // explicitly SET on it — found live during CE-13 governed-posting
    // certification returning a false "could not be resolved" for an
    // account that genuinely existed (same rls-middleware.ts connection-pool
    // class of bug already fixed elsewhere in this file).
    let accountIds: Map<string, string>;
    try {
      accountIds = await this.prisma.$transaction(async (tx) => {
        await setTenantContextOnConnection(tx, authenticatedTenantId);
        const ids = new Map<string, string>();
        for (const line of lines) {
          if (ids.has(line.accountNumber)) continue;
          const acct = await tx.glAccount.findUnique({ where: { entityId_accountNumber: { entityId: pack.entityId, accountNumber: line.accountNumber } } });
          if (!acct) throw new AccountResolutionFailedError(line.accountNumber);
          ids.set(line.accountNumber, acct.id);
        }
        return ids;
      });
    } catch (e) {
      if (!(e instanceof AccountResolutionFailedError)) throw e;
      return this.finalizeRejected(authenticatedTenantId, envelope, eventHash, selected.id, match.rule.ruleId, blueprintHash,
        `Account ${e.accountNumber} could not be resolved for entity ${pack.entityId} at posting time.`, classifyFailure('account-resolution', ''), actor);
    }

    return this.evaluateAndPost(authenticatedTenantId, envelope, eventHash, pack, selected.id, match.rule.ruleId, blueprintHash, lines, accountIds, actor);
  }

  /**
   * Race-safe claim (single authoritative ledger decision): gl-service has
   * no idempotency mechanism of its own (confirmed — CreateJournalEntrySchema
   * has no idempotency key), so this claim, backed by postingExecution's real
   * DB unique constraint on (tenantId, eventId), is now the ONLY point
   * preventing two concurrent submissions of a brand-new event from each
   * calling the GL bridge and creating two authoritative journals. The
   * winner proceeds to evaluateAndPost's bridge call; every loser returns
   * the winner's row without ever calling the bridge.
   */
  private async claimExecution(tenantId: string, envelope: SourceEventEnvelope, eventHash: string) {
    try {
      const created = await this.prisma.postingExecution.create({
        data: {
          id: crypto.randomUUID(), tenantId, eventId: envelope.eventId, eventType: envelope.eventType,
          eventSchemaVersion: envelope.eventSchemaVersion, entityId: envelope.legalEntityId, sourceSystem: envelope.sourceSystem,
          sourceEntityType: envelope.sourceEntityType, sourceEntityId: envelope.sourceEntityId,
          correlationId: envelope.correlationId, causationId: envelope.causationId ?? null,
          businessDate: new Date(envelope.businessDate), eventHash, eventEnvelope: envelope as any,
          status: 'POSTING_IN_PROGRESS', rulePackVersionId: null, ruleId: null, blueprintHash: null,
          journalEntryId: null, journalNumber: null, failureReason: null,
        },
      });
      return { execution: created, claimed: true as const };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const winner = await this.prisma.postingExecution.findUnique({ where: { tenantId_eventId: { tenantId, eventId: envelope.eventId } } });
        if (winner) return { execution: winner, claimed: false as const };
      }
      throw err;
    }
  }

  /** Shared by submitEvent (new events) and replayEvent (D-S023-25) — posts the resolved blueprint through the gl-service bridge (single authoritative ledger) and finalizes the execution row. */
  private async evaluateAndPost(
    tenantId: string, envelope: SourceEventEnvelope, eventHash: string, pack: RulePackDefinition,
    rulePackVersionId: string, ruleId: string, blueprintHash: string,
    lines: BlueprintLine[], accountIds: Map<string, string>, actor: string,
  ): Promise<SubmitEventResult> {
    const claim = await this.claimExecution(tenantId, envelope, eventHash);
    if (!claim.claimed) {
      // Lost the race (or a genuine re-delivery arrived after the winner
      // already finished) — never call the bridge a second time for the
      // same (tenantId, eventId).
      return this.toResult(claim.execution, true);
    }
    const executionId = claim.execution.id;

    try {
      const result = await this.glPostingBridge.post({
        tenantId,
        businessDate: envelope.businessDate,
        journalSourceCode: pack.journalSourceCode,
        description: `Posting engine — ${envelope.eventType} — ${envelope.sourceEntityId}`,
        sourceRef: envelope.sourceEntityId?.slice(0, 8) ?? undefined,
        // CE-07 — authoritative GL idempotency: gl-service itself (not just
        // this claimed PostingExecution row) refuses to create a second
        // journal for the same (tenantId, eventId). Defense-in-depth against
        // a lost/crashed execution row — see gl-posting-bridge.ts and
        // journal-repository.ts's create() doc-comments.
        idempotencyKey: `${tenantId}:${envelope.eventId}`,
        legalEntityId: envelope.legalEntityId,
        postingExecutionId: executionId,
        rulePackKey: pack.packKey,
        rulePackVersion: pack.semver,
        sourceEventId: envelope.eventId,
        // accountCode (the portable account number), never coa-service's own
        // gl_account.id — see GlPostingLine's doc-comment (gl-posting-
        // bridge.ts): coa-service and gl-service maintain separate GlAccount
        // tables with independent, non-crosswalked ids. accountIds above
        // already proved this accountNumber exists in coa-service's own
        // table (INVALID_ACCOUNT pre-check) before we ever reach here.
        lines: lines.map((l) => ({
          accountCode: l.accountNumber, debit: l.dr, credit: l.cr, memo: l.memo ?? null,
          storeId: l.storeId, departmentCode: l.deptCode ?? null, controlNumber: this.controlNumberFor(envelope),
          applyNumber: l.applyNumber ?? undefined,
        })),
      });
      const updated = await this.prisma.postingExecution.update({
        where: { id: executionId },
        data: { status: 'POSTED', rulePackVersionId, ruleId, blueprintHash, journalEntryId: result.journalEntryId, journalNumber: result.journalNumber, failureReason: null },
      });
      await this.recordAttempt(executionId, tenantId, 'POSTED', { journalNumber: result.journalNumber, glStatus: result.status });
      await this.audit(tenantId, executionId, 'JOURNAL_ACCEPTED', actor, { eventId: envelope.eventId, journalNumber: result.journalNumber, journalEntryId: result.journalEntryId });
      return this.toResult(updated, false);
    } catch (e) {
      const message = e instanceof GlPostingBridgeError ? e.message : String((e as Error).message ?? e);
      const reasonCode = classifyFailure('posting-violation', message);
      await this.prisma.postingExecution.update({ where: { id: executionId }, data: { status: 'REJECTED', rulePackVersionId, ruleId, blueprintHash, failureReason: message } });
      await this.prisma.postingException.create({
        data: { id: crypto.randomUUID(), tenantId, executionId, reasonCode, reasonDetail: message, eventType: envelope.eventType, eventSchemaVersion: envelope.eventSchemaVersion, rulePackVersionsConsidered: [] as any },
      });
      await this.recordAttempt(executionId, tenantId, 'REJECTED', { reason: message, reasonCode });
      await this.audit(tenantId, executionId, 'JOURNAL_REJECTED', actor, { eventId: envelope.eventId, reason: message, reasonCode });
      await this.recovery.reportFailure(tenantId, { executionId, envelope, legalEntityId: envelope.legalEntityId, reasonCode, reasonDetail: message, rulePackVersionId });
      const reloaded = await this.prisma.postingExecution.findUniqueOrThrow({ where: { id: executionId } });
      return this.toResult(reloaded, false);
    }
  }

  /**
   * D-S023-25 (joint with D-S023-22, narrow scope) — authorized replay.
   *
   * Re-evaluates a previously non-POSTED execution's original envelope
   * against the CURRENTLY ACTIVE rule-pack version (not the version
   * originally attempted), and records dual-version evidence
   * (PostingExecutionReplay). Ordinary duplicate-event protection in
   * submitEvent() is completely unchanged by this method — this is a
   * SEPARATE, explicitly-authorized entry point, never reachable from an
   * ordinary event submission. Only callable against an execution whose
   * current status is NOT 'POSTED'; a prior terminal REJECTED/FAILED/
   * NO_RULE_MATCH result never blocks an authorized replay from proceeding.
   */
  async replayEvent(tenantId: string, executionId: string, actor: string, reason: string): Promise<SubmitEventResult> {
    const execution = await this.prisma.postingExecution.findFirst({ where: { id: executionId, tenantId } });
    if (!execution) throw new PostingExecutionNotFoundError(executionId);
    if (execution.status === 'POSTED') {
      throw new ReplayNotEligibleError(`Execution "${executionId}" is already POSTED — nothing to replay.`);
    }

    const envelope = execution.eventEnvelope as unknown as SourceEventEnvelope;
    const originalRulePackVersionId = execution.rulePackVersionId;
    const originalStatus = execution.status;
    const originalFailureReason = execution.failureReason;

    // Race-safe claim (single authoritative ledger decision): gl-service has
    // no idempotency mechanism of its own, so a conditional transition —
    // only succeeding if the status is STILL what we just read — is the
    // only thing preventing two concurrent replays of the same execution
    // from both calling the GL bridge and creating two authoritative
    // journals. The loser returns whatever the winner leaves behind rather
    // than ever calling the bridge itself.
    const claim = await this.prisma.postingExecution.updateMany({
      where: { id: executionId, tenantId, status: originalStatus },
      data: { status: 'REPLAY_IN_PROGRESS' },
    });
    if (claim.count === 0) {
      const current = await this.prisma.postingExecution.findUniqueOrThrow({ where: { id: executionId } });
      return this.toResult(current, true);
    }

    // CE-07 legal-entity isolation defect — replay must select ONLY the
    // ORIGINAL execution's legal entity (carried on its own stored
    // envelope, never a newly-supplied value), so a replay can never pick
    // up another entity's active pack even if one now exists for the same
    // packKey/eventType.
    const occurredAt = new Date(envelope.occurredAt);
    const candidates = await this.prisma.postingRulePackVersion.findMany({
      where: {
        tenantId, entityId: envelope.legalEntityId, eventType: envelope.eventType, status: 'ACTIVE',
        effectiveFrom: { lte: occurredAt },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: occurredAt } }],
      },
    });
    const matchingSchema = candidates.filter((c) => c.eventSchemaVersions.includes(envelope.eventSchemaVersion));
    const considered = candidates.map((c) => ({ id: c.id, packKey: c.packKey, semver: c.semver }));

    const recordReplay = async (resultingStatus: string, replayRulePackVersionId: string | null, resultingJournalEntryId: string | null, resultingJournalNumber: string | null) => {
      await this.prisma.postingExecutionReplay.create({
        data: {
          id: crypto.randomUUID(), tenantId, executionId,
          originalRulePackVersionId, replayRulePackVersionId,
          originalFailureReasonCode: originalStatus, originalFailureReasonDetail: originalFailureReason,
          replayActor: actor, replayReason: reason,
          originalBusinessDate: execution.businessDate,
          originalAttemptedPeriodId: null, currentPostingPeriodId: null,
          resultingStatus, resultingJournalEntryId, resultingJournalNumber,
        },
      });
      // D-S023-30 — replay evidence retains both the original and replay pack versions in the audit trail, not just the dedicated posting_execution_replay row.
      const beforeState = { status: originalStatus, rulePackVersionId: originalRulePackVersionId, failureReason: originalFailureReason };
      const afterState = { status: resultingStatus, rulePackVersionId: replayRulePackVersionId, journalEntryId: resultingJournalEntryId, journalNumber: resultingJournalNumber };
      await this.audit(tenantId, executionId, 'REPLAY_EXECUTED', actor, { ...afterState, reason, fieldDiffs: this.diffFields(beforeState, afterState) }, this.prisma, beforeState);
    };

    if (matchingSchema.length === 0) {
      await this.prisma.postingExecution.update({ where: { id: executionId }, data: { status: 'NO_RULE_MATCH', rulePackVersionId: null, failureReason: 'No active rule pack version covers this event type/schema version/date at replay time.' } });
      await this.recordAttempt(executionId, tenantId, 'REPLAY_NO_RULE_MATCH', { reason });
      await recordReplay('NO_RULE_MATCH', null, null, null);
      return this.toResult({ ...execution, status: 'NO_RULE_MATCH', rulePackVersionId: null, ruleId: null, journalEntryId: null, journalNumber: null, failureReason: 'No active rule pack version covers this event type/schema version/date at replay time.' }, false);
    }

    const ranked = [...matchingSchema].sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
    const topEffectiveFrom = ranked[0].effectiveFrom.getTime();
    const mostSpecific = ranked.filter((c) => c.effectiveFrom.getTime() === topEffectiveFrom);
    if (mostSpecific.length > 1) {
      await this.finalizeAmbiguous(tenantId, envelope, execution.eventHash, considered, mostSpecific.map((c) => c.id), actor);
      await recordReplay('REJECTED', null, null, null);
      return this.toResult({ ...execution, status: 'REJECTED', rulePackVersionId: null, ruleId: null, journalEntryId: null, journalNumber: null, failureReason: 'Ambiguous rule-pack match at replay time.' }, false);
    }
    const selected = mostSpecific[0];
    const pack = selected.definition as unknown as RulePackDefinition;
    const match = selectRule(pack, envelope);
    if (!match) {
      await this.prisma.postingExecution.update({ where: { id: executionId }, data: { status: 'NO_RULE_MATCH', rulePackVersionId: selected.id, failureReason: 'An active rule pack was selected but no rule condition matched this event at replay time.' } });
      await this.recordAttempt(executionId, tenantId, 'REPLAY_NO_RULE_MATCH', { reason });
      await recordReplay('NO_RULE_MATCH', selected.id, null, null);
      return this.toResult({ ...execution, status: 'NO_RULE_MATCH', rulePackVersionId: selected.id, ruleId: null, journalEntryId: null, journalNumber: null, failureReason: null }, false);
    }

    let lines: BlueprintLine[];
    try {
      lines = generateBlueprint(match.rule, envelope);
    } catch (e) {
      const message = e instanceof BlueprintResolutionError ? e.message : String((e as Error).message ?? e);
      await this.prisma.postingExecution.update({ where: { id: executionId }, data: { status: 'REJECTED', rulePackVersionId: selected.id, ruleId: match.rule.ruleId, failureReason: message } });
      await this.recordAttempt(executionId, tenantId, 'REPLAY_REJECTED', { reason: message });
      await recordReplay('REJECTED', selected.id, null, null);
      return this.toResult({ ...execution, status: 'REJECTED', rulePackVersionId: selected.id, ruleId: match.rule.ruleId, journalEntryId: null, journalNumber: null, failureReason: message }, false);
    }
    const blueprintViolations = verifyBlueprint(lines);
    if (blueprintViolations.length > 0) {
      const message = `Blueprint failed defensive verification: ${blueprintViolations.map((v) => v.message).join('; ')}`;
      await this.prisma.postingExecution.update({ where: { id: executionId }, data: { status: 'REJECTED', rulePackVersionId: selected.id, ruleId: match.rule.ruleId, failureReason: message } });
      await this.recordAttempt(executionId, tenantId, 'REPLAY_REJECTED', { reason: message });
      await recordReplay('REJECTED', selected.id, null, null);
      return this.toResult({ ...execution, status: 'REJECTED', rulePackVersionId: selected.id, ruleId: match.rule.ruleId, journalEntryId: null, journalNumber: null, failureReason: message }, false);
    }
    const blueprintHash = hashBlueprint(match.rule.ruleId, lines);

    const accountIds = new Map<string, string>();
    for (const line of lines) {
      if (accountIds.has(line.accountNumber)) continue;
      const acct = await this.prisma.glAccount.findUnique({ where: { entityId_accountNumber: { entityId: pack.entityId, accountNumber: line.accountNumber } } });
      if (!acct) {
        const message = `Account ${line.accountNumber} could not be resolved for entity ${pack.entityId} at replay time.`;
        await this.prisma.postingExecution.update({ where: { id: executionId }, data: { status: 'REJECTED', rulePackVersionId: selected.id, ruleId: match.rule.ruleId, blueprintHash, failureReason: message } });
        await this.recordAttempt(executionId, tenantId, 'REPLAY_REJECTED', { reason: message });
        await recordReplay('REJECTED', selected.id, null, null);
        return this.toResult({ ...execution, status: 'REJECTED', rulePackVersionId: selected.id, ruleId: match.rule.ruleId, journalEntryId: null, journalNumber: null, failureReason: message }, false);
      }
      accountIds.set(line.accountNumber, acct.id);
    }

    try {
      const result = await this.glPostingBridge.post({
        tenantId, businessDate: envelope.businessDate, journalSourceCode: pack.journalSourceCode,
        description: `Posting engine replay — ${envelope.eventType} — ${envelope.sourceEntityId}`,
        sourceRef: envelope.sourceEntityId?.slice(0, 8) ?? undefined,
        // CE-07 — scoped to the SPECIFIC rule-pack version selected for this
        // replay, never the original submitEvent's key. Replay's entire
        // purpose is to apply a newly-activated, possibly CORRECTED rule
        // pack — reusing the original key could silently resume a stale
        // DRAFT journal built from the OLD version's account selections
        // while the evidence trail (postingExecutionReplay) claims the NEW
        // version was used. Scoping by rule-pack version id keeps retries of
        // THIS SAME replay attempt safely idempotent while guaranteeing a
        // replay against a different version always produces a fresh journal.
        idempotencyKey: `${tenantId}:${envelope.eventId}:replay:${selected.id}`,
        lines: lines.map((l) => ({ accountCode: l.accountNumber, debit: l.dr, credit: l.cr, memo: l.memo ?? null, storeId: l.storeId, departmentCode: l.deptCode ?? null, controlNumber: this.controlNumberFor(envelope), applyNumber: l.applyNumber ?? undefined })),
      });
      await this.prisma.postingExecution.update({ where: { id: executionId }, data: { status: 'POSTED', rulePackVersionId: selected.id, ruleId: match.rule.ruleId, blueprintHash, journalEntryId: result.journalEntryId, journalNumber: result.journalNumber, failureReason: null } });
      await this.recordAttempt(executionId, tenantId, 'REPLAY_POSTED', { journalNumber: result.journalNumber, glStatus: result.status });
      await recordReplay('POSTED', selected.id, result.journalEntryId, result.journalNumber);
      return this.toResult({ ...execution, status: 'POSTED', rulePackVersionId: selected.id, ruleId: match.rule.ruleId, journalEntryId: result.journalEntryId, journalNumber: result.journalNumber, failureReason: null }, false);
    } catch (e) {
      const message = e instanceof GlPostingBridgeError ? e.message : String((e as Error).message ?? e);
      const status = 'REJECTED';
      await this.prisma.postingExecution.update({ where: { id: executionId }, data: { status, rulePackVersionId: selected.id, ruleId: match.rule.ruleId, blueprintHash, failureReason: message } });
      await this.recordAttempt(executionId, tenantId, `REPLAY_${status}`, { reason: message });
      await recordReplay(status, selected.id, null, null);
      return this.toResult({ ...execution, status, rulePackVersionId: selected.id, ruleId: match.rule.ruleId, journalEntryId: null, journalNumber: null, failureReason: message }, false);
    }
  }

  /**
   * D-S023-33 (Requirement M) — simulate/dry-run. Runs validation and rule
   * evaluation and resolves the selected mapping to show the proposed
   * journal, but performs NO journal posting, NO schedule change, and NO
   * operational-transaction mutation of any kind: PostingService.post() is
   * never called, and no postingExecution/postingException row is written.
   * Produces an audit event so the simulation itself is evidenced (Requirement L).
   */
  async simulateEvent(authenticatedTenantId: string, rawEnvelope: unknown, actor: string): Promise<SimulateEventResult> {
    let envelope: SourceEventEnvelope;
    try {
      envelope = assertEnvelopeShape(rawEnvelope);
    } catch (e) {
      if (e instanceof EnvelopeShapeError) throw new PostingEngineInputError(e.message);
      throw e;
    }
    if (envelope.tenantId !== authenticatedTenantId) {
      throw new PostingEngineInputError('Event tenantId does not match the authenticated tenant context.');
    }

    const occurredAt = new Date(envelope.occurredAt);
    const candidates = await this.prisma.postingRulePackVersion.findMany({
      where: {
        tenantId: authenticatedTenantId, entityId: envelope.legalEntityId, eventType: envelope.eventType, status: 'ACTIVE',
        effectiveFrom: { lte: occurredAt },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: occurredAt } }],
      },
    });
    const matchingSchema = candidates.filter((c) => c.eventSchemaVersions.includes(envelope.eventSchemaVersion));

    await this.audit(authenticatedTenantId, `simulate:${envelope.eventId}`, 'SIMULATION_RUN', actor, { eventId: envelope.eventId, entityId: envelope.legalEntityId, eventType: envelope.eventType });

    if (matchingSchema.length === 0) {
      return { wouldPost: false, status: 'NO_RULE_MATCH', failureReason: 'No active rule pack version covers this event type/schema version/date.' };
    }
    const ranked = [...matchingSchema].sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
    const topEffectiveFrom = ranked[0].effectiveFrom.getTime();
    const mostSpecific = ranked.filter((c) => c.effectiveFrom.getTime() === topEffectiveFrom);
    if (mostSpecific.length > 1) {
      return { wouldPost: false, status: 'AMBIGUOUS_RULE_PACK_MATCH', failureReason: `${mostSpecific.length} equally-specific ACTIVE versions match this event.` };
    }
    const selected = mostSpecific[0];
    const pack = selected.definition as unknown as RulePackDefinition;
    const match = selectRule(pack, envelope);
    if (!match) {
      return { wouldPost: false, status: 'NO_RULE_MATCH', rulePackVersionId: selected.id, failureReason: 'An active rule pack was selected but no rule condition matched this event.' };
    }

    let lines: BlueprintLine[];
    try {
      lines = generateBlueprint(match.rule, envelope);
    } catch (e) {
      const message = e instanceof BlueprintResolutionError ? e.message : String((e as Error).message ?? e);
      return { wouldPost: false, status: 'WOULD_REJECT', rulePackVersionId: selected.id, ruleId: match.rule.ruleId, failureReason: message };
    }
    const blueprintViolations = verifyBlueprint(lines);
    if (blueprintViolations.length > 0) {
      return { wouldPost: false, status: 'WOULD_REJECT', rulePackVersionId: selected.id, ruleId: match.rule.ruleId, failureReason: `Blueprint failed defensive verification: ${blueprintViolations.map((v) => v.message).join('; ')}` };
    }
    for (const line of lines) {
      const acct = await this.prisma.glAccount.findUnique({ where: { entityId_accountNumber: { entityId: pack.entityId, accountNumber: line.accountNumber } } });
      if (!acct) {
        return { wouldPost: false, status: 'WOULD_REJECT', rulePackVersionId: selected.id, ruleId: match.rule.ruleId, failureReason: `Account ${line.accountNumber} could not be resolved for entity ${pack.entityId}.` };
      }
    }

    return {
      wouldPost: true, status: 'WOULD_POST', rulePackVersionId: selected.id, ruleId: match.rule.ruleId,
      proposedJournal: { entityId: pack.entityId, date: envelope.businessDate, sourceCode: pack.journalSourceCode, lines },
    };
  }

  /**
   * S024 (CE-12) — dry-run rule selection + blueprint generation with no
   * persistence and no posting: returns the same structural blueprint
   * submitEvent() would post, without creating a PostingExecution row or
   * touching PostingService. Used by the S085 biller preview ("recap-vs-
   * journal preview") and by rule-pack authors validating a family's
   * structure end-to-end. Does not resolve/require GL account existence
   * (that check only happens at real submit-time) — a pack authored with
   * ACCOUNT_MAPPING_VALUES_PENDING rows still simulates successfully so its
   * structure can be reviewed before tenant account mapping is complete.
   */
  async simulate(authenticatedTenantId: string, rawEnvelope: unknown): Promise<BlueprintSimulationResult> {
    let envelope: SourceEventEnvelope;
    try {
      envelope = assertEnvelopeShape(rawEnvelope);
    } catch (e) {
      if (e instanceof EnvelopeShapeError) throw new PostingEngineInputError(e.message);
      throw e;
    }
    if (envelope.tenantId !== authenticatedTenantId) {
      throw new PostingEngineInputError('Event tenantId does not match the authenticated tenant context.');
    }

    const occurredAt = new Date(envelope.occurredAt);
    const candidates = await this.prisma.postingRulePackVersion.findMany({
      where: {
        // CE-07 legal-entity isolation — scoped by the envelope's own
        // legalEntityId, same standing as submitEvent()/simulateEvent(); a
        // preview must never resolve a different legal entity's active pack.
        tenantId: authenticatedTenantId, entityId: envelope.legalEntityId, eventType: envelope.eventType, status: 'ACTIVE',
        effectiveFrom: { lte: occurredAt },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: occurredAt } }],
      },
    });
    const matchingSchema = candidates.filter((c) => c.eventSchemaVersions.includes(envelope.eventSchemaVersion));

    if (matchingSchema.length === 0) {
      return { status: 'NO_RULE_MATCH', failureReason: 'No active rule pack version covers this event type/schema version/date.' };
    }
    // D-S023-08 — deterministic ambiguity rejection applies to preview too:
    // never silently tie-break two equally-specific ACTIVE versions.
    const ranked = [...matchingSchema].sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
    const topEffectiveFrom = ranked[0].effectiveFrom.getTime();
    const mostSpecific = ranked.filter((c) => c.effectiveFrom.getTime() === topEffectiveFrom);
    if (mostSpecific.length > 1) {
      return { status: 'REJECTED', failureReason: `Ambiguous rule-pack match: ${mostSpecific.length} equally-specific ACTIVE versions match this event.` };
    }
    const selected = mostSpecific[0];

    const pack = selected.definition as unknown as RulePackDefinition;
    const match = selectRule(pack, envelope);
    if (!match) {
      return { status: 'NO_RULE_MATCH', rulePackVersionId: selected.id, failureReason: 'An active rule pack was selected but no rule condition matched this event.' };
    }

    let lines: BlueprintLine[];
    try {
      lines = generateBlueprint(match.rule, envelope);
    } catch (e) {
      const message = e instanceof BlueprintResolutionError ? e.message : String((e as Error).message ?? e);
      return { status: 'REJECTED', rulePackVersionId: selected.id, ruleId: match.rule.ruleId, failureReason: message };
    }
    const violations = verifyBlueprint(lines);
    if (violations.length > 0) {
      return {
        status: 'REJECTED', rulePackVersionId: selected.id, ruleId: match.rule.ruleId,
        failureReason: `Blueprint failed defensive verification: ${violations.map((v) => v.message).join('; ')}`,
      };
    }
    return {
      status: 'BLUEPRINT_GENERATED', rulePackVersionId: selected.id, ruleId: match.rule.ruleId,
      blueprintHash: hashBlueprint(match.rule.ruleId, lines), lines,
    };
  }

  async getExecutionById(tenantId: string, id: string) {
    return this.prisma.postingExecution.findFirst({ where: { id, tenantId } });
  }

  async getExecutionByEventId(tenantId: string, eventId: string) {
    return this.prisma.postingExecution.findUnique({ where: { tenantId_eventId: { tenantId, eventId } } });
  }

  /** CE-07 legal-entity isolation defect — entityId is REQUIRED so a list call can never span every entity in the tenant by omission; the browser must supply it explicitly, never infer it. */
  async searchExecutions(tenantId: string, entityId: string, filter: { correlationId?: string; sourceEntityId?: string; status?: string }) {
    return this.prisma.postingExecution.findMany({
      where: {
        tenantId,
        entityId,
        ...(filter.correlationId ? { correlationId: filter.correlationId } : {}),
        ...(filter.sourceEntityId ? { sourceEntityId: filter.sourceEntityId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** CE-07 legal-entity isolation defect — lightweight lookups for async authz-scope resolution (posting-engine-routes.ts): a route guarding a resource that only carries its own entityId once loaded (a rule-pack version, a posting execution) resolves the permission-check scope from the resource itself, never a client-supplied value the browser could tamper with. */
  async resolveVersionEntityId(tenantId: string, versionId: string): Promise<string | null> {
    const version = await this.prisma.postingRulePackVersion.findFirst({ where: { id: versionId, tenantId }, select: { entityId: true } });
    return version?.entityId ?? null;
  }

  async resolveExecutionEntityId(tenantId: string, executionId: string): Promise<string | null> {
    const execution = await this.prisma.postingExecution.findFirst({ where: { id: executionId, tenantId }, select: { entityId: true } });
    return execution?.entityId ?? null;
  }

  async resolveExecutionEntityIdByEventId(tenantId: string, eventId: string): Promise<string | null> {
    const execution = await this.prisma.postingExecution.findUnique({ where: { tenantId_eventId: { tenantId, eventId } }, select: { entityId: true } });
    return execution?.entityId ?? null;
  }

  async listExceptions(tenantId: string, reasonCode?: string) {
    return this.prisma.postingException.findMany({
      where: { tenantId, ...(reasonCode ? { reasonCode } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** S023 UI — replay evidence for an execution's inquiry view (the dual-versioned trail recordReplay() writes inside replayEvent()). */
  async listReplaysForExecution(tenantId: string, executionId: string) {
    return this.prisma.postingExecutionReplay.findMany({
      where: { tenantId, executionId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Internal: create-or-reconcile a terminal execution row (P2002-race-safe,
  // mirroring PostingService.post()'s own idempotency-race idiom) ────────────

  private async createOrReconcileExecution(
    tenantId: string, envelope: SourceEventEnvelope, eventHash: string,
    status: string, rulePackVersionId: string | null, ruleId: string | null, blueprintHash: string | null,
    journalEntryId: string | null, journalNumber: string | null, failureReason: string | null,
  ) {
    try {
      return await this.prisma.postingExecution.create({
        data: {
          id: crypto.randomUUID(), tenantId, eventId: envelope.eventId, eventType: envelope.eventType,
          eventSchemaVersion: envelope.eventSchemaVersion, entityId: envelope.legalEntityId, sourceSystem: envelope.sourceSystem,
          sourceEntityType: envelope.sourceEntityType, sourceEntityId: envelope.sourceEntityId,
          correlationId: envelope.correlationId, causationId: envelope.causationId ?? null,
          businessDate: new Date(envelope.businessDate), eventHash, eventEnvelope: envelope as any,
          status, rulePackVersionId, ruleId, blueprintHash, journalEntryId, journalNumber, failureReason,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const winner = await this.prisma.postingExecution.findUnique({ where: { tenantId_eventId: { tenantId, eventId: envelope.eventId } } });
        if (winner) return winner;
      }
      throw err;
    }
  }

  private async recordAttempt(executionId: string, tenantId: string, outcome: string, detail: unknown) {
    const count = await this.prisma.postingExecutionAttempt.count({ where: { executionId } });
    try {
      await this.prisma.postingExecutionAttempt.create({
        data: { id: crypto.randomUUID(), tenantId, executionId, attemptNumber: count + 1, outcome, detail: detail as any },
      });
    } catch {
      // Unique(executionId, attemptNumber) race — a concurrent attempt already
      // recorded this number; the append-only ledger doesn't need a retry loop
      // for what is purely observational data, not a correctness gate.
    }
  }

  private toResult(exec: { id: string; eventId: string; status: string; rulePackVersionId: string | null; ruleId: string | null; journalEntryId: string | null; journalNumber: string | null; failureReason: string | null }, idempotent: boolean): SubmitEventResult {
    return {
      executionId: exec.id, eventId: exec.eventId, status: exec.status as SubmitEventResult['status'], idempotent,
      rulePackVersionId: exec.rulePackVersionId, ruleId: exec.ruleId,
      journalEntryId: exec.journalEntryId, journalNumber: exec.journalNumber, failureReason: exec.failureReason,
    };
  }

  private async finalizeNoMatch(tenantId: string, envelope: SourceEventEnvelope, eventHash: string, rulePackVersionId: string | null, ruleId: string | null, considered: Array<{ id: string; packKey: string; semver: string }>, reason: string, actor: string): Promise<SubmitEventResult> {
    const exec = await this.createOrReconcileExecution(tenantId, envelope, eventHash, 'NO_RULE_MATCH', rulePackVersionId, ruleId, null, null, null, reason);
    if (exec.status === 'NO_RULE_MATCH' && (await this.prisma.postingException.count({ where: { executionId: exec.id } })) === 0) {
      await this.prisma.postingException.create({
        data: {
          id: crypto.randomUUID(), tenantId, executionId: exec.id, reasonCode: 'NO_RULE_MATCH', reasonDetail: reason,
          eventType: envelope.eventType, eventSchemaVersion: envelope.eventSchemaVersion, rulePackVersionsConsidered: considered as any,
        },
      });
    }
    await this.recordAttempt(exec.id, tenantId, 'NO_RULE_MATCH', { reason });
    await this.audit(tenantId, exec.id, 'NO_RULE_MATCH_RECORDED', actor, { eventId: envelope.eventId, reason });
    await this.recovery.reportFailure(tenantId, { executionId: exec.id, envelope, legalEntityId: envelope.legalEntityId, reasonCode: 'NO_RULE_MATCH', reasonDetail: reason, rulePackVersionId });
    return this.toResult(exec, false);
  }

  /** D-S023-21 — every REJECTED outcome now also gets a distinct, durable posting_exception row with a classified reasonCode (previously only NO_RULE_MATCH/EVENT_IDENTITY_CONFLICT did). */
  private async finalizeRejected(tenantId: string, envelope: SourceEventEnvelope, eventHash: string, rulePackVersionId: string | null, ruleId: string | null, blueprintHash: string | null, reason: string, reasonCode: string, actor: string): Promise<SubmitEventResult> {
    const exec = await this.createOrReconcileExecution(tenantId, envelope, eventHash, 'REJECTED', rulePackVersionId, ruleId, blueprintHash, null, null, reason);
    if (exec.status === 'REJECTED' && (await this.prisma.postingException.count({ where: { executionId: exec.id } })) === 0) {
      await this.prisma.postingException.create({
        data: {
          id: crypto.randomUUID(), tenantId, executionId: exec.id, reasonCode, reasonDetail: reason,
          eventType: envelope.eventType, eventSchemaVersion: envelope.eventSchemaVersion, rulePackVersionsConsidered: [] as any,
        },
      });
    }
    await this.recordAttempt(exec.id, tenantId, 'REJECTED', { reason, reasonCode });
    await this.audit(tenantId, exec.id, 'JOURNAL_REJECTED', actor, { eventId: envelope.eventId, reason, reasonCode });
    await this.recovery.reportFailure(tenantId, { executionId: exec.id, envelope, legalEntityId: envelope.legalEntityId, reasonCode, reasonDetail: reason, rulePackVersionId });
    return this.toResult(exec, false);
  }

  private async finalizeFailed(tenantId: string, envelope: SourceEventEnvelope, eventHash: string, rulePackVersionId: string | null, ruleId: string | null, blueprintHash: string | null, reason: string, actor: string): Promise<SubmitEventResult> {
    const exec = await this.createOrReconcileExecution(tenantId, envelope, eventHash, 'FAILED', rulePackVersionId, ruleId, blueprintHash, null, null, reason);
    if (exec.status === 'FAILED' && (await this.prisma.postingException.count({ where: { executionId: exec.id } })) === 0) {
      await this.prisma.postingException.create({
        data: {
          id: crypto.randomUUID(), tenantId, executionId: exec.id, reasonCode: POSTING_FAILURE_REASON_CODES.POSTING_ENGINE_FAILURE, reasonDetail: reason,
          eventType: envelope.eventType, eventSchemaVersion: envelope.eventSchemaVersion, rulePackVersionsConsidered: [] as any,
        },
      });
    }
    await this.recordAttempt(exec.id, tenantId, 'FAILED', { reason });
    await this.audit(tenantId, exec.id, 'JOURNAL_SUBMISSION_FAILED', actor, { eventId: envelope.eventId, reason });
    await this.recovery.reportFailure(tenantId, { executionId: exec.id, envelope, legalEntityId: envelope.legalEntityId, reasonCode: POSTING_FAILURE_REASON_CODES.POSTING_ENGINE_FAILURE, reasonDetail: reason, rulePackVersionId });
    return this.toResult(exec, false);
  }

  /** D-S023-08 — deterministic ambiguity rejection: two or more equally-specific ACTIVE versions matched; never silently tie-broken. */
  private async finalizeAmbiguous(tenantId: string, envelope: SourceEventEnvelope, eventHash: string, considered: Array<{ id: string; packKey: string; semver: string }>, ambiguousVersionIds: string[], actor: string): Promise<SubmitEventResult> {
    const reason = `Ambiguous rule-pack match: ${ambiguousVersionIds.length} equally-specific ACTIVE versions match this event (${ambiguousVersionIds.join(', ')}).`;
    const exec = await this.createOrReconcileExecution(tenantId, envelope, eventHash, 'REJECTED', null, null, null, null, null, reason);
    if (exec.status === 'REJECTED' && (await this.prisma.postingException.count({ where: { executionId: exec.id } })) === 0) {
      await this.prisma.postingException.create({
        data: {
          id: crypto.randomUUID(), tenantId, executionId: exec.id, reasonCode: POSTING_FAILURE_REASON_CODES.AMBIGUOUS_RULE_PACK_MATCH, reasonDetail: reason,
          eventType: envelope.eventType, eventSchemaVersion: envelope.eventSchemaVersion, rulePackVersionsConsidered: considered as any,
        },
      });
    }
    await this.recordAttempt(exec.id, tenantId, 'AMBIGUOUS_RULE_PACK_MATCH', { ambiguousVersionIds });
    await this.audit(tenantId, exec.id, 'AMBIGUOUS_RULE_PACK_MATCH_RECORDED', actor, { eventId: envelope.eventId, ambiguousVersionIds });
    // Ambiguous match spans multiple candidate versions by definition — no single "original attempted version" to report.
    // CE-07 legal-entity isolation defect — candidates are now entity-scoped
    // (see submitEvent's candidate-selection query), so an ambiguous match
    // can only ever occur WITHIN the envelope's own legal entity; the
    // recovery report can and must carry it, never null.
    await this.recovery.reportFailure(tenantId, { executionId: exec.id, envelope, legalEntityId: envelope.legalEntityId, reasonCode: POSTING_FAILURE_REASON_CODES.AMBIGUOUS_RULE_PACK_MATCH, reasonDetail: reason, rulePackVersionId: null });
    return this.toResult(exec, false);
  }

  private async finalizePosted(tenantId: string, envelope: SourceEventEnvelope, eventHash: string, rulePackVersionId: string, ruleId: string, blueprintHash: string, result: { id: string; journalNumber: string; idempotent: boolean }, actor: string): Promise<SubmitEventResult> {
    const exec = await this.createOrReconcileExecution(tenantId, envelope, eventHash, 'POSTED', rulePackVersionId, ruleId, blueprintHash, result.id, result.journalNumber, null);
    await this.recordAttempt(exec.id, tenantId, 'POSTED', { journalNumber: result.journalNumber });
    await this.audit(tenantId, exec.id, 'JOURNAL_ACCEPTED', actor, { eventId: envelope.eventId, journalNumber: result.journalNumber });
    return this.toResult(exec, result.idempotent);
  }
}
