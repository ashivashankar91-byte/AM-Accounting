// S019/S020 — Posting Engine orchestration: rule-pack lifecycle (draft ->
// validate -> activate) and idempotent certification-event posting.
//
// This service is a CLIENT of PostingService.post() (the S013 accepted
// posting path) — it never writes journal_entry/journal_line itself. Every
// journal it produces goes through that single door, with idempotencyKey
// always `${tenantId}:${eventId}` so PostingService's own idempotency
// short-circuit and P2002-race reconciliation ARE the lost-response
// reconciliation mechanism this story requires — no second mechanism is
// invented here.
import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { PrismaClient } from '.prisma/coa-client';
import { IEventPublisher } from '@amacc/shared-kernel';
import { PostingService, PostingViolationError, PostingInputError } from './posting-service';
import { validateRulePackSource, ValidationFinding, AccountLookup } from '../domain/posting-engine/validator';
import { RulePackDefinition } from '../domain/posting-engine/dsl';
import { freezeRulePack, hashRulePack } from '../domain/posting-engine/canonical';
import { assertEnvelopeShape, hashEnvelope, EnvelopeShapeError, SourceEventEnvelope } from '../domain/posting-engine/event-envelope';
import { selectRule, generateBlueprint, verifyBlueprint, hashBlueprint, BlueprintResolutionError, BlueprintLine } from '../domain/posting-engine/blueprint';

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

export class EventIdentityConflictError extends Error {
  readonly status = 409;
  readonly code = 'EVENT_IDENTITY_CONFLICT';
  constructor(readonly executionId: string, readonly eventId: string) {
    super(`Event "${eventId}" was already received with different content (identity conflict).`);
    this.name = 'EventIdentityConflictError';
  }
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface CreateRulePackVersionDTO {
  tenantId: string;
  packKey: string;
  sourceText: string;
  actor: string;
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

@injectable()
export class PostingEngineService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
    @inject('PostingService') private readonly postingService: PostingService,
  ) {}

  private accountLookup(): AccountLookup {
    return async (entityId: string, accountNumber: string) => {
      const acct = await this.prisma.glAccount.findUnique({ where: { entityId_accountNumber: { entityId, accountNumber } } });
      if (!acct) return null;
      return { accountNumber: acct.accountNumber, type: acct.type, postable: acct.postable, status: acct.status };
    };
  }

  private async audit(tenantId: string, docId: string, action: string, actor: string, after: unknown, tx: Pick<PrismaClient, 'auditOutboxEvent'> = this.prisma) {
    await tx.auditOutboxEvent.create({
      data: { id: crypto.randomUUID(), tenantId, docType: 'POSTING_ENGINE', docId, action, before: null as any, after: after as any, actor },
    });
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

    const created = await this.prisma.$transaction(async (tx) => {
      let pack = await tx.postingRulePack.findUnique({ where: { tenantId_packKey: { tenantId: dto.tenantId, packKey } } });
      if (!pack) {
        pack = await tx.postingRulePack.create({ data: { id: crypto.randomUUID(), tenantId: dto.tenantId, packKey, createdBy: dto.actor } });
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
          entityId: String(doc['entityId'] ?? ''),
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

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.postingRulePackVersion.update({
        where: { id: versionId },
        data: { validationFindings: result.findings as any, validatedAt: new Date(), status: newStatus },
      });
      await this.audit(tenantId, versionId, 'VALIDATION_COMPLETED', actor, { valid: result.valid, findingCount: result.findings.length }, tx);
      return u;
    });
    return { version: updated, valid: result.valid, findings: result.findings };
  }

  /** Activate a VALIDATED version. Immutable thereafter (DB trigger backstop). */
  async activateVersion(tenantId: string, versionId: string, actor: string) {
    const version = await this.prisma.postingRulePackVersion.findFirst({ where: { id: versionId, tenantId } });
    if (!version) throw new RulePackVersionNotFoundError(versionId);
    if (version.status !== 'VALIDATED') {
      await this.audit(tenantId, versionId, 'ACTIVATION_FAILED', actor, { reason: `status is ${version.status}, not VALIDATED` });
      throw new ActivationNotEligibleError(`Rule pack version is "${version.status}" — only a VALIDATED version may be activated.`);
    }

    const activated = await this.prisma.$transaction(async (tx) => {
      await tx.postingRulePackVersion.updateMany({
        where: { tenantId, packKey: version.packKey, status: 'ACTIVE' },
        data: { status: 'SUPERSEDED', supersededAt: new Date() },
      });
      const u = await tx.postingRulePackVersion.update({
        where: { id: versionId },
        data: { status: 'ACTIVE', activatedBy: actor, activatedAt: new Date() },
      });
      await this.audit(tenantId, versionId, 'ACTIVATION_SUCCEEDED', actor, { packKey: version.packKey, semver: version.semver, contentHash: version.contentHash }, tx);
      return u;
    });
    return activated;
  }

  async getRulePack(tenantId: string, packKey: string) {
    const pack = await this.prisma.postingRulePack.findUnique({ where: { tenantId_packKey: { tenantId, packKey } } });
    if (!pack) throw new RulePackNotFoundError(packKey);
    const versions = await this.prisma.postingRulePackVersion.findMany({ where: { tenantId, rulePackId: pack.id }, orderBy: { createdAt: 'desc' } });
    return { pack, versions };
  }

  async listRulePacks(tenantId: string) {
    const packs = await this.prisma.postingRulePack.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    const versions = await this.prisma.postingRulePackVersion.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
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
      throw new EventIdentityConflictError(existing.id, envelope.eventId);
    }

    // ── Rule-pack version selection (deterministic; pinned before evaluation) ──
    const occurredAt = new Date(envelope.occurredAt);
    const candidates = await this.prisma.postingRulePackVersion.findMany({
      where: {
        tenantId: authenticatedTenantId,
        eventType: envelope.eventType,
        status: 'ACTIVE',
        effectiveFrom: { lte: occurredAt },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: occurredAt } }],
      },
    });
    const matchingSchema = candidates.filter((c) => c.eventSchemaVersions.includes(envelope.eventSchemaVersion));
    const selected = [...matchingSchema].sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime() || a.packKey.localeCompare(b.packKey))[0];

    const considered = candidates.map((c) => ({ id: c.id, packKey: c.packKey, semver: c.semver }));

    if (!selected) {
      return this.finalizeNoMatch(authenticatedTenantId, envelope, eventHash, null, null, considered, 'No active rule pack version covers this event type/schema version/date.', actor);
    }

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
      return this.finalizeRejected(authenticatedTenantId, envelope, eventHash, selected.id, match.rule.ruleId, null, message, actor);
    }
    const blueprintViolations = verifyBlueprint(lines);
    if (blueprintViolations.length > 0) {
      return this.finalizeRejected(authenticatedTenantId, envelope, eventHash, selected.id, match.rule.ruleId, null,
        `Blueprint failed defensive verification: ${blueprintViolations.map((v) => v.message).join('; ')}`, actor);
    }
    const blueprintHash = hashBlueprint(match.rule.ruleId, lines);

    // Resolve account ids for the accepted posting path's line shape.
    const accountIds = new Map<string, string>();
    for (const line of lines) {
      if (accountIds.has(line.accountNumber)) continue;
      const acct = await this.prisma.glAccount.findUnique({ where: { entityId_accountNumber: { entityId: pack.entityId, accountNumber: line.accountNumber } } });
      if (!acct) {
        return this.finalizeRejected(authenticatedTenantId, envelope, eventHash, selected.id, match.rule.ruleId, blueprintHash,
          `Account ${line.accountNumber} could not be resolved for entity ${pack.entityId} at posting time.`, actor);
      }
      accountIds.set(line.accountNumber, acct.id);
    }

    const idempotencyKey = `${authenticatedTenantId}:${envelope.eventId}`;
    try {
      const result = await this.postingService.post({
        tenantId: authenticatedTenantId,
        entityId: pack.entityId,
        date: envelope.businessDate,
        sourceCode: pack.journalSourceCode,
        memo: null,
        idempotencyKey,
        callerClass: 'SYSTEM',
        postedBy: actor,
        lines: lines.map((l) => ({ accountId: accountIds.get(l.accountNumber)!, storeId: l.storeId, deptCode: l.deptCode ?? null, dr: l.dr, cr: l.cr, memo: l.memo ?? null })),
      });
      return this.finalizePosted(authenticatedTenantId, envelope, eventHash, selected.id, match.rule.ruleId, blueprintHash, result, actor);
    } catch (e) {
      if (e instanceof PostingViolationError) {
        return this.finalizeRejected(authenticatedTenantId, envelope, eventHash, selected.id, match.rule.ruleId, blueprintHash,
          `Posting rejected: ${e.violations.map((v) => v.diagnostic).join('; ')}`, actor);
      }
      if (e instanceof PostingInputError) {
        return this.finalizeRejected(authenticatedTenantId, envelope, eventHash, selected.id, match.rule.ruleId, blueprintHash, e.message, actor);
      }
      return this.finalizeFailed(authenticatedTenantId, envelope, eventHash, selected.id, match.rule.ruleId, blueprintHash, String((e as Error).message ?? e), actor);
    }
  }

  async getExecutionById(tenantId: string, id: string) {
    return this.prisma.postingExecution.findFirst({ where: { id, tenantId } });
  }

  async getExecutionByEventId(tenantId: string, eventId: string) {
    return this.prisma.postingExecution.findUnique({ where: { tenantId_eventId: { tenantId, eventId } } });
  }

  async searchExecutions(tenantId: string, filter: { correlationId?: string; sourceEntityId?: string; status?: string }) {
    return this.prisma.postingExecution.findMany({
      where: {
        tenantId,
        ...(filter.correlationId ? { correlationId: filter.correlationId } : {}),
        ...(filter.sourceEntityId ? { sourceEntityId: filter.sourceEntityId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async listExceptions(tenantId: string, reasonCode?: string) {
    return this.prisma.postingException.findMany({
      where: { tenantId, ...(reasonCode ? { reasonCode } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
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
          eventSchemaVersion: envelope.eventSchemaVersion, sourceSystem: envelope.sourceSystem,
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
    return this.toResult(exec, false);
  }

  private async finalizeRejected(tenantId: string, envelope: SourceEventEnvelope, eventHash: string, rulePackVersionId: string | null, ruleId: string | null, blueprintHash: string | null, reason: string, actor: string): Promise<SubmitEventResult> {
    const exec = await this.createOrReconcileExecution(tenantId, envelope, eventHash, 'REJECTED', rulePackVersionId, ruleId, blueprintHash, null, null, reason);
    await this.recordAttempt(exec.id, tenantId, 'REJECTED', { reason });
    await this.audit(tenantId, exec.id, 'JOURNAL_REJECTED', actor, { eventId: envelope.eventId, reason });
    return this.toResult(exec, false);
  }

  private async finalizeFailed(tenantId: string, envelope: SourceEventEnvelope, eventHash: string, rulePackVersionId: string | null, ruleId: string | null, blueprintHash: string | null, reason: string, actor: string): Promise<SubmitEventResult> {
    const exec = await this.createOrReconcileExecution(tenantId, envelope, eventHash, 'FAILED', rulePackVersionId, ruleId, blueprintHash, null, null, reason);
    await this.recordAttempt(exec.id, tenantId, 'FAILED', { reason });
    await this.audit(tenantId, exec.id, 'JOURNAL_SUBMISSION_FAILED', actor, { eventId: envelope.eventId, reason });
    return this.toResult(exec, false);
  }

  private async finalizePosted(tenantId: string, envelope: SourceEventEnvelope, eventHash: string, rulePackVersionId: string, ruleId: string, blueprintHash: string, result: { id: string; journalNumber: string; idempotent: boolean }, actor: string): Promise<SubmitEventResult> {
    const exec = await this.createOrReconcileExecution(tenantId, envelope, eventHash, 'POSTED', rulePackVersionId, ruleId, blueprintHash, result.id, result.journalNumber, null);
    await this.recordAttempt(exec.id, tenantId, 'POSTED', { journalNumber: result.journalNumber });
    await this.audit(tenantId, exec.id, 'JOURNAL_ACCEPTED', actor, { eventId: envelope.eventId, journalNumber: result.journalNumber });
    return this.toResult(exec, result.idempotent);
  }
}
