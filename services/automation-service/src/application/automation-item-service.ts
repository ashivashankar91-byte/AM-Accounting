import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/automation-service-client';
import { requireCapabilityDefinition } from '../domain/capabilities';
import { canTransition } from '../domain/authority';
import {
  ItemNotFoundError, InvalidStateTransitionError, AutomationError, PolicyGateViolationError,
} from '../domain/errors';
import { assertApproverIsNotAutomation, AUTOMATION_IDENTITY } from '../domain/sod';
import { evaluatePolicy, assertPolicyAllows, PolicyEvaluationResult } from '../domain/policy-gate-evaluator';
import { executionIdempotencyKey, reversalIdempotencyKey, automationIdempotencyKey } from '../domain/idempotency';
import {
  IAutomationEventPublisher, ICloseReadinessClient, IAccountMappingClient, IPostingClient,
  CanonicalEventLine, PENDING_UPSTREAM,
} from '../domain/interfaces';
import { AutomationCapabilityService } from './capability-service';
import { PolicyGateService } from './policy-gate-service';
import { withSerializableRetry } from '../infrastructure/serializable-retry';

export interface CreateItemInput {
  tenantId: string;
  legalEntityId: string;
  capabilityCode: string;
  subjectRef: string;
  action?: string;
  automationIdentity?: string;
  sourceEvidenceRefs?: unknown[];
  recommendationEvidence?: Record<string, unknown>;
  ruleVersion?: string | null;
  modelVersion?: string | null;
  confidence?: string | number | null;
  proposedAmount?: string | number | null;
  exceptionCategory?: string | null;
  periodYear?: number;
  periodMonth?: number;
  postingLines?: CanonicalEventLine[];
}

const DEFAULT_AUTOMATION_IDENTITY = AUTOMATION_IDENTITY;

/**
 * CE-17 — The automation work item.
 *
 * An item is the unit of everything the epic promises: it carries its own
 * evidence, its own policy trace, its own idempotency key, and it can only
 * move between states the machine permits. Financial effect leaves this class
 * exactly once, through the CE-07 posting client, and comes back as a
 * reference that is written into an immutable execution record.
 */
@injectable()
export class AutomationItemService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IAutomationEventPublisher') private readonly events: IAutomationEventPublisher,
    @inject('ICloseReadinessClient') private readonly close: ICloseReadinessClient,
    @inject('IAccountMappingClient') private readonly mapping: IAccountMappingClient,
    @inject('IPostingClient') private readonly posting: IPostingClient,
    private readonly capabilities: AutomationCapabilityService,
    private readonly policies: PolicyGateService,
  ) {}

  async list(tenantId: string, filters: { legalEntityId?: string; capabilityCode?: string; state?: string; storyId?: string }) {
    return this.prisma.automationItem.findMany({
      where: {
        tenantId,
        ...(filters.legalEntityId ? { legalEntityId: filters.legalEntityId } : {}),
        ...(filters.capabilityCode ? { capabilityCode: filters.capabilityCode } : {}),
        ...(filters.state ? { state: filters.state } : {}),
        ...(filters.storyId ? { storyId: filters.storyId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  async get(tenantId: string, itemId: string) {
    const item = await this.prisma.automationItem.findFirst({
      where: { tenantId, id: itemId },
      include: { executions: { orderBy: { createdAt: 'asc' } } },
    });
    if (!item) throw new ItemNotFoundError(`Automation item ${itemId} does not exist for this tenant.`);
    return item;
  }

  /**
   * Creates (or returns) an item for a subject.
   *
   * The idempotency key is derived from the subject and rule version, so
   * asking twice for the same recommendation yields the same item rather than
   * a second copy of the same proposed money.
   */
  async create(input: CreateItemInput) {
    const def = requireCapabilityDefinition(input.capabilityCode);
    const capability = await this.capabilities.requireConfigured(input.tenantId, input.legalEntityId, input.capabilityCode);
    const automationIdentity = input.automationIdentity ?? DEFAULT_AUTOMATION_IDENTITY;

    const idempotencyKey = automationIdempotencyKey({
      tenantId: input.tenantId,
      legalEntityId: input.legalEntityId,
      capabilityCode: input.capabilityCode,
      subjectRef: input.subjectRef,
      action: input.action ?? 'RECOMMEND',
      version: input.ruleVersion ?? input.modelVersion ?? null,
    });

    const existing = await this.prisma.automationItem.findFirst({ where: { tenantId: input.tenantId, idempotencyKey } });
    if (existing) return { item: existing, deduplicated: true };

    // OBSERVE_ONLY produces observations, not recommendations. The distinction
    // is recorded in the state itself so no screen can misreport it.
    const state = capability.currentAuthority === 'SUSPENDED' ? 'SUSPENDED'
      : capability.currentAuthority === 'OBSERVE_ONLY' ? 'OBSERVATION_ONLY'
        : 'RECOMMENDATION_READY';

    const item = await this.prisma.automationItem.create({
      data: {
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        capabilityId: capability.id,
        capabilityCode: def.code,
        storyId: def.storyId,
        state,
        idempotencyKey,
        automationIdentity,
        sourceEvidenceRefs: (input.sourceEvidenceRefs ?? []) as any,
        recommendationEvidence: {
          ...(input.recommendationEvidence ?? {}),
          subjectRef: input.subjectRef,
          exceptionCategory: input.exceptionCategory ?? null,
          periodYear: input.periodYear ?? null,
          periodMonth: input.periodMonth ?? null,
          postingLines: input.postingLines ?? [],
        } as any,
        ruleVersion: input.ruleVersion ?? null,
        modelVersion: input.modelVersion ?? null,
        confidence: input.confidence === undefined || input.confidence === null ? null : String(input.confidence),
        proposedAmount: input.proposedAmount === undefined || input.proposedAmount === null ? null : String(input.proposedAmount),
        approvalRequired: def.irreversible || def.ceiling === 'EXECUTE_WITH_APPROVAL',
      },
    });

    await this.events.publish(input.tenantId, item.id, 'automation.item.created', {
      capabilityCode: def.code, storyId: def.storyId, state, idempotencyKey, automationIdentity,
    });
    return { item, deduplicated: false };
  }

  /**
   * Gathers the facts a policy decision needs and evaluates them. Kept public
   * so a screen can show *why* an item would be refused before anybody clicks
   * execute — a preview that runs exactly the code the execution runs.
   */
  async evaluate(tenantId: string, itemId: string, requestLegalEntityId: string): Promise<PolicyEvaluationResult> {
    const item = await this.get(tenantId, itemId);
    const def = requireCapabilityDefinition(item.capabilityCode);
    const capability = await this.prisma.automationCapability.findFirst({ where: { tenantId, id: item.capabilityId } });
    if (!capability) throw new ItemNotFoundError(`Capability for item ${itemId} is no longer configured.`);

    const evidence = (item.recommendationEvidence ?? {}) as Record<string, any>;
    const now = new Date();
    const periodYear = Number(evidence['periodYear'] ?? now.getUTCFullYear());
    const periodMonth = Number(evidence['periodMonth'] ?? now.getUTCMonth() + 1);

    const [periodClosed, accountMappingComplete, gate] = await Promise.all([
      this.close.isPeriodClosed(tenantId, item.legalEntityId, periodYear, periodMonth),
      this.mapping.isMappingComplete(tenantId, item.legalEntityId, item.capabilityCode),
      this.policies.effectiveGate(tenantId, item.legalEntityId, item.capabilityCode),
    ]);

    return evaluatePolicy({
      capability: def,
      authority: capability.currentAuthority as any,
      gate,
      itemLegalEntityId: item.legalEntityId,
      requestLegalEntityId,
      amount: item.proposedAmount === null ? null : item.proposedAmount.toString(),
      confidence: item.confidence === null ? null : item.confidence.toString(),
      exceptionCategory: evidence['exceptionCategory'] ?? null,
      periodClosed,
      accountMappingComplete,
      statutorySupported: evidence['statutorySupported'] !== false,
      alreadyApprovedBy: item.approvedBy,
      automationIdentity: item.automationIdentity,
      circuitBreakerCount: capability.circuitBreakerCount,
      capabilitySuspended: capability.currentAuthority === 'SUSPENDED',
    });
  }

  /**
   * Claims an item for a worker under SERIALIZABLE isolation with a version
   * guard. Two workers racing for the same item: exactly one wins, and the
   * loser is told so rather than quietly proceeding.
   */
  async claim(tenantId: string, itemId: string, claimedBy: string) {
    return withSerializableRetry(this.prisma, async (tx) => {
      const item = await tx.automationItem.findFirst({ where: { tenantId, id: itemId } });
      if (!item) throw new ItemNotFoundError(`Automation item ${itemId} does not exist for this tenant.`);
      if (item.claimedBy && item.claimedBy !== claimedBy) {
        throw new AutomationError(`Item is already claimed by ${item.claimedBy}.`, {
          statusCode: 409, code: 'ITEM_ALREADY_CLAIMED',
        });
      }
      const updated = await tx.automationItem.updateMany({
        where: { tenantId, id: itemId, version: item.version },
        data: { claimedBy, claimedAt: new Date(), version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        throw new AutomationError('Item was modified concurrently; claim refused.', {
          statusCode: 409, code: 'CONCURRENT_MODIFICATION',
        });
      }
      return tx.automationItem.findFirst({ where: { tenantId, id: itemId } });
    });
  }

  /**
   * Approval. The structural SoD check runs before anything is written, so a
   * self-approval attempt never leaves a trace of having half-succeeded.
   */
  async approve(tenantId: string, itemId: string, approver: string, note?: string) {
    const item = await this.get(tenantId, itemId);
    assertApproverIsNotAutomation(approver, item.automationIdentity, item.id);

    if (item.state === 'EXECUTED') {
      throw new InvalidStateTransitionError('An executed item cannot be approved again.');
    }
    if (item.state === 'SUSPENDED') {
      throw new InvalidStateTransitionError('A suspended item cannot be approved; lift the suspension first.');
    }
    if (item.approvedBy) {
      return item; // idempotent: approving twice is not a second approval
    }

    await this.prisma.automationItem.updateMany({
      where: { tenantId, id: itemId },
      data: {
        approvedBy: approver, approvedAt: new Date(), state: 'EXECUTION_PENDING',
        recommendationEvidence: { ...(item.recommendationEvidence as any), approvalNote: note ?? null } as any,
        version: { increment: 1 },
      },
    });
    await this.events.publish(tenantId, itemId, 'automation.item.approved', {
      capabilityCode: item.capabilityCode, approver, automationIdentity: item.automationIdentity,
    });
    return this.get(tenantId, itemId);
  }

  async reject(tenantId: string, itemId: string, actor: string, reason: string) {
    const item = await this.get(tenantId, itemId);
    assertApproverIsNotAutomation(actor, item.automationIdentity, item.id);
    if (item.state === 'EXECUTED') {
      throw new InvalidStateTransitionError('An executed item cannot be rejected; reverse or correct it instead.');
    }
    await this.prisma.automationItem.updateMany({
      where: { tenantId, id: itemId },
      data: {
        rejectedBy: actor, rejectedAt: new Date(), rejectionReason: reason,
        state: 'FAILED_CLOSED', failureReason: `Rejected by ${actor}: ${reason}`, version: { increment: 1 },
      },
    });
    await this.events.publish(tenantId, itemId, 'automation.item.rejected', {
      capabilityCode: item.capabilityCode, actor, reason,
    });
    return this.get(tenantId, itemId);
  }

  /**
   * Executes an approved (or in-policy) item through CE-07.
   *
   * Order is deliberate and non-negotiable:
   *   1. every policy gate is evaluated and must pass;
   *   2. the idempotency key is checked — a replay returns the first result;
   *   3. only then does anything leave this service.
   *
   * A refusal at (1) marks the item FAILED_CLOSED and advances the circuit
   * breaker. Nothing is posted, and no execution row claims otherwise.
   */
  async execute(tenantId: string, itemId: string, requestLegalEntityId: string, executedBy: string) {
    const item = await this.get(tenantId, itemId);

    if (item.state === 'EXECUTED' && item.executionId) {
      const prior = await this.prisma.automationExecution.findFirst({ where: { tenantId, id: item.executionId } });
      return { item, execution: prior, replayed: true };
    }

    const evaluation = await this.evaluate(tenantId, itemId, requestLegalEntityId);
    await this.prisma.automationItem.updateMany({
      where: { tenantId, id: itemId },
      data: { policyEvalTrace: evaluation as any },
    });

    if (!evaluation.allowed) {
      const nextState = evaluation.effectiveState;
      await this.prisma.automationItem.updateMany({
        where: { tenantId, id: itemId },
        data: { state: nextState, failureReason: evaluation.refusalReason ?? 'Policy gate refused the action.', version: { increment: 1 } },
      });
      if (nextState === 'FAILED_CLOSED') {
        await this.capabilities.recordFailure(tenantId, item.capabilityId);
        await this.events.publish(tenantId, itemId, 'automation.item.failed_closed', {
          capabilityCode: item.capabilityCode, gate: evaluation.refusalGate, reason: evaluation.refusalReason,
        });
      }
      assertPolicyAllows(evaluation);
    }

    const evidence = (item.recommendationEvidence ?? {}) as Record<string, any>;
    const lines: CanonicalEventLine[] = Array.isArray(evidence['postingLines']) ? evidence['postingLines'] : [];
    // Two keys, deliberately different in scope.
    //
    // The posting identity handed to CE-07 is stable across retries: CE-07 is
    // the authority on whether this act already reached the ledger, and giving
    // it the same identity every time is what makes a double-post impossible
    // even when an attempt's outcome was ambiguous.
    //
    // The execution row's key carries the attempt number, so each attempt is
    // recorded as its own immutable piece of evidence rather than overwriting
    // the failed one — and a replay of the same attempt still returns the
    // first result instead of trying again.
    const postingIdentity = executionIdempotencyKey(item.idempotencyKey, evaluation.policyVersion);
    const execKey = executionIdempotencyKey(item.idempotencyKey, `${evaluation.policyVersion}:${item.retryCount}`);

    const priorExecution = await this.prisma.automationExecution.findFirst({ where: { tenantId, idempotencyKey: execKey } });
    if (priorExecution) {
      return { item: await this.get(tenantId, itemId), execution: priorExecution, replayed: true };
    }

    // A non-financial capability (drafts, exports, evidence binders) executes
    // without a posting round-trip; a financial one always makes it.
    let postingExecutionId: string | null = null;
    let journalEntryId: string | null = null;
    let failureReason: string | null = null;
    let outcome: 'EXECUTED' | 'FAILED_CLOSED' = 'EXECUTED';

    if (lines.length > 0) {
      const result = await this.posting.post(tenantId, {
        legalEntityId: item.legalEntityId,
        sourceEntityType: `CE17_${item.capabilityCode}`,
        sourceEntityId: item.id,
        idempotencyIdentity: postingIdentity,
        businessDate: new Date().toISOString().slice(0, 10),
        journalFamily: 'AUTOMATION',
        memo: `CE-17 ${item.capabilityCode} automation execution ${item.id}`,
        lines,
      });
      if (result.status === 'POSTED') {
        postingExecutionId = result.postingExecutionId;
        journalEntryId = result.journalEntryId;
      } else {
        outcome = 'FAILED_CLOSED';
        failureReason = result.status === PENDING_UPSTREAM
          ? `CE-07 governed posting is unavailable: ${result.reason}. No journal was created and nothing is reported as executed.`
          : `CE-07 governed posting refused the entry: ${result.reason}`;
      }
    }

    const execution = await this.prisma.automationExecution.create({
      data: {
        tenantId,
        itemId: item.id,
        idempotencyKey: execKey,
        executedBy: item.automationIdentity,
        approvedBy: item.approvedBy,
        policyVersion: evaluation.policyVersion,
        ruleVersion: item.ruleVersion,
        modelVersion: item.modelVersion,
        sourceTransactionId: evidence['subjectRef'] ?? null,
        postingExecutionId,
        journalEntryId,
        outcome,
        failureReason,
        lineageTrace: {
          sourceEvidenceRefs: item.sourceEvidenceRefs,
          subjectRef: evidence['subjectRef'] ?? null,
          policyEvaluation: evaluation,
          approvedBy: item.approvedBy,
          requestedBy: executedBy,
          postingLines: lines,
        } as any,
      },
    });

    await this.prisma.automationItem.updateMany({
      where: { tenantId, id: itemId },
      data: {
        state: outcome, executionId: execution.id, failureReason,
        completedAt: outcome === 'EXECUTED' ? new Date() : null, version: { increment: 1 },
      },
    });

    if (outcome === 'EXECUTED') {
      await this.capabilities.recordSuccess(tenantId, item.capabilityId);
      await this.events.publish(tenantId, itemId, 'automation.item.executed', {
        capabilityCode: item.capabilityCode, executionId: execution.id, journalEntryId, postingExecutionId,
      });
    } else {
      await this.capabilities.recordFailure(tenantId, item.capabilityId);
      await this.events.publish(tenantId, itemId, 'automation.item.failed_closed', {
        capabilityCode: item.capabilityCode, reason: failureReason,
      });
    }

    await this.recordHealth(tenantId, item.legalEntityId, item.capabilityCode, outcome);
    return { item: await this.get(tenantId, itemId), execution, replayed: false };
  }

  /**
   * Retry after a failure. A retry is a fresh attempt at the same act, so it
   * re-runs every gate — a retry never inherits a stale approval to bypass
   * a gate that has since started refusing.
   */
  async retry(tenantId: string, itemId: string, requestLegalEntityId: string, actor: string) {
    const item = await this.get(tenantId, itemId);
    if (item.state !== 'FAILED_CLOSED') {
      throw new InvalidStateTransitionError(`Only a FAILED_CLOSED item can be retried; this one is ${item.state}.`);
    }
    if (!canTransition(item.state, 'EXECUTION_PENDING')) {
      throw new InvalidStateTransitionError(`${item.state} → EXECUTION_PENDING is not a permitted transition.`);
    }
    await this.prisma.automationItem.updateMany({
      where: { tenantId, id: itemId },
      data: { state: 'EXECUTION_PENDING', retryCount: { increment: 1 }, failureReason: null, version: { increment: 1 } },
    });
    await this.events.publish(tenantId, itemId, 'automation.item.retried', {
      capabilityCode: item.capabilityCode, actor, attempt: item.retryCount + 1,
    });
    return this.execute(tenantId, itemId, requestLegalEntityId, actor);
  }

  /**
   * Reversal. The executed record is never touched: a new item and a new
   * execution are created, pointing back at the original. That is what makes
   * the evidence chain immutable and still complete.
   */
  async reverse(tenantId: string, itemId: string, requestLegalEntityId: string, actor: string, reason: string) {
    const item = await this.get(tenantId, itemId);
    if (item.state !== 'EXECUTED' || !item.executionId) {
      throw new InvalidStateTransitionError('Only an executed item can be reversed.');
    }
    if (item.legalEntityId !== requestLegalEntityId) {
      throw new PolicyGateViolationError('CROSS_ENTITY',
        `Item belongs to legal entity ${item.legalEntityId} but the request is scoped to ${requestLegalEntityId}.`);
    }
    const original = await this.prisma.automationExecution.findFirst({ where: { tenantId, id: item.executionId } });
    if (!original) throw new ItemNotFoundError('The original execution record could not be found.');

    const existingReversal = await this.prisma.automationExecution.findFirst({
      where: { tenantId, reversalOf: original.id },
    });
    if (existingReversal) {
      return { execution: existingReversal, replayed: true };
    }

    const evidence = (item.recommendationEvidence ?? {}) as Record<string, any>;
    const lines: CanonicalEventLine[] = Array.isArray(evidence['postingLines']) ? evidence['postingLines'] : [];
    const reversedLines = lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit, memo: `REVERSAL: ${l.memo ?? ''}`.trim() }));
    const reversalKey = reversalIdempotencyKey(original.idempotencyKey);

    let postingExecutionId: string | null = null;
    let journalEntryId: string | null = null;
    let failureReason: string | null = null;
    let outcome: 'REVERSED' | 'FAILED_CLOSED' = 'REVERSED';

    if (reversedLines.length > 0) {
      const result = await this.posting.post(tenantId, {
        legalEntityId: item.legalEntityId,
        sourceEntityType: `CE17_${item.capabilityCode}_REVERSAL`,
        sourceEntityId: item.id,
        idempotencyIdentity: reversalKey,
        businessDate: new Date().toISOString().slice(0, 10),
        journalFamily: 'AUTOMATION_REVERSAL',
        memo: `CE-17 reversal of ${original.id}: ${reason}`,
        lines: reversedLines,
        originalJournalRef: original.journalEntryId,
      });
      if (result.status === 'POSTED') {
        postingExecutionId = result.postingExecutionId;
        journalEntryId = result.journalEntryId;
      } else {
        outcome = 'FAILED_CLOSED';
        failureReason = `Reversal could not be posted through CE-07: ${result.reason}`;
      }
    }

    const execution = await this.prisma.automationExecution.create({
      data: {
        tenantId,
        itemId: item.id,
        idempotencyKey: reversalKey,
        executedBy: item.automationIdentity,
        approvedBy: actor,
        policyVersion: original.policyVersion,
        ruleVersion: item.ruleVersion,
        modelVersion: item.modelVersion,
        sourceTransactionId: original.sourceTransactionId,
        postingExecutionId,
        journalEntryId,
        outcome,
        failureReason,
        reversalOf: original.id,
        lineageTrace: {
          reversalOf: original.id,
          originalJournalEntryId: original.journalEntryId,
          reason, actor, reversedLines,
        } as any,
      },
    });

    await this.events.publish(tenantId, itemId, 'automation.item.reversed', {
      capabilityCode: item.capabilityCode, originalExecutionId: original.id, reversalExecutionId: execution.id, actor, reason,
    });
    return { execution, replayed: false };
  }

  /** Full source-to-journal lineage for one item. */
  async lineage(tenantId: string, itemId: string) {
    const item = await this.get(tenantId, itemId);
    const capability = await this.prisma.automationCapability.findFirst({ where: { tenantId, id: item.capabilityId } });
    return {
      item: {
        id: item.id, capabilityCode: item.capabilityCode, storyId: item.storyId, state: item.state,
        idempotencyKey: item.idempotencyKey, automationIdentity: item.automationIdentity,
        proposedAmount: item.proposedAmount?.toString() ?? null,
        confidence: item.confidence?.toString() ?? null,
        approvedBy: item.approvedBy, approvedAt: item.approvedAt,
        rejectedBy: item.rejectedBy, rejectionReason: item.rejectionReason,
      },
      capability: capability
        ? { capabilityCode: capability.capabilityCode, currentAuthority: capability.currentAuthority, policyVersion: capability.policyVersion }
        : null,
      sourceEvidenceRefs: item.sourceEvidenceRefs,
      recommendationEvidence: item.recommendationEvidence,
      policyEvalTrace: item.policyEvalTrace,
      executions: item.executions.map((e: any) => ({
        id: e.id, outcome: e.outcome, idempotencyKey: e.idempotencyKey,
        postingExecutionId: e.postingExecutionId, journalEntryId: e.journalEntryId,
        policyVersion: e.policyVersion, ruleVersion: e.ruleVersion, modelVersion: e.modelVersion,
        failureReason: e.failureReason, reversalOf: e.reversalOf, createdAt: e.createdAt,
        lineageTrace: e.lineageTrace,
      })),
    };
  }

  /** Rolls a day's counters forward. Health is measured, never asserted. */
  private async recordHealth(tenantId: string, legalEntityId: string, capabilityCode: string, outcome: 'EXECUTED' | 'FAILED_CLOSED') {
    const periodDate = new Date(new Date().toISOString().slice(0, 10));
    await this.prisma.automationHealthMetric.upsert({
      where: { tenantId_legalEntityId_capabilityCode_periodDate: { tenantId, legalEntityId, capabilityCode, periodDate } },
      create: {
        tenantId, legalEntityId, capabilityCode, periodDate,
        totalItems: 1, executed: outcome === 'EXECUTED' ? 1 : 0, failedClosed: outcome === 'FAILED_CLOSED' ? 1 : 0,
      },
      update: {
        totalItems: { increment: 1 },
        executed: { increment: outcome === 'EXECUTED' ? 1 : 0 },
        failedClosed: { increment: outcome === 'FAILED_CLOSED' ? 1 : 0 },
      },
    });
  }
}
