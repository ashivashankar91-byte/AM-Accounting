// S021 — the CH01 (posting-evaluator, S019/S020) adapter boundary.
//
// R1 completion slice: CH01 has now landed as merged, stable code —
// services/coa-service's PostingEngineService.submitEvent(), exposed at
// POST /api/v1/coa/posting-engine/events (see coa-service's
// posting-engine-routes.ts). This file remains the single, explicit seam
// posting-recovery depends on instead of importing anything from CH01
// directly — HttpCH01PostingExecutionPort below is the real adapter;
// call sites never talk to coa-service directly.
//
// Field-name reconciliation performed in this slice (the foundation-slice
// comment above predicted exactly this step): CH01's real
// SourceEventEnvelope (services/coa-service/src/domain/posting-engine/
// event-envelope.ts) requires eventSchemaVersion, publishedAt and
// sourceEntityId — none of which the S021 foundation slice captured at
// intake. Added here and to PostingDeadLetter (see the R1 S021-completion
// migration note in prisma/migrations/20260729010000_init_posting_recovery_svc)
// so a byte-identical replay envelope can be reconstructed. CH01 computes
// its own identity hash from eventId/tenantId/eventType/eventSchemaVersion/
// occurredAt/sourceSystem/sourceEntityType/sourceEntityId/correlationId/
// causationId/businessDate/payload/metadata (publishedAt excluded) — any
// drift between what we reconstruct and what CH01 originally hashed
// surfaces as CH01's own EVENT_IDENTITY_CONFLICT (409), mapped to a FAILED
// replay outcome below, never silently swallowed.

import { PostingFailureCategory } from './taxonomy';
import { PostingFailureStage } from './taxonomy';

/** The original source event, exactly as CH01 would have received it. */
export interface SourceEventEnvelope {
  /** Immutable idempotency identity component #1: (tenantId, eventId). */
  eventId: string;
  tenantId: string;
  legalEntityId?: string | null;
  storeId?: string | null;
  eventType: string;
  /** CH01 rule-pack version selection filters on this. Required by CH01 — optional here only because a DLQ item captured for failureCategory EVENT_CONTRACT_INVALID may legitimately lack it; enforced at replay-eligibility time, not intake time. */
  eventSchemaVersion?: string | null;
  sourceSystem: string;
  /** Required by CH01 (part of its identity hash), though optional in this DTO for back-compat with pre-completion-slice intake rows. */
  sourceEntityType?: string | null;
  /** Required by CH01 (part of its identity hash). Distinct from sourceTransactionId (display-only, DLQ-side enrichment). */
  sourceEntityId?: string | null;
  /** The originating business transaction (RO#, deal#, invoice#, ...). DLQ-side enrichment only — not part of CH01's envelope. */
  sourceTransactionId?: string | null;
  /** Immutable idempotency identity component #2. */
  correlationId: string;
  causationId?: string | null;
  /** ISO-8601. The original event's occurrence time — never intake time. */
  occurredAt: string;
  /** ISO-8601. Excluded from CH01's identity hash; safe to backfill at replay time if the original was never captured. */
  publishedAt?: string | null;
  /** ISO-8601 date, when applicable. Required by CH01. */
  businessDate?: string | null;
  /** The posting idempotency identity CH01 would use to post this event. */
  postingIdempotencyKey: string;
  payload: Record<string, unknown>;
  /** SHA-256 hex digest of `payload` (canonical JSON), computed by the caller. */
  payloadHash: string;
}

export interface PostingFailureDetail {
  failureCategory: PostingFailureCategory;
  failureCode: string;
  failureStage: PostingFailureStage;
  failureMessage: string;
  fieldErrors?: Record<string, unknown> | null;
  ruleContext?: Record<string, unknown> | null;
  /** ISO-8601. */
  occurredAt: string;
}

/** The failure envelope CH01 (or its outbox/DLQ) hands to posting-recovery intake. */
export interface PostingFailureEnvelope {
  event: SourceEventEnvelope;
  failure: PostingFailureDetail;
}

export type CH01ReplayOutcome = 'POSTED' | 'NOOP_ALREADY_POSTED' | 'REJECTED' | 'FAILED';

export interface CH01ReplayResult {
  outcome: CH01ReplayOutcome;
  journalReference?: string;
  message?: string;
  /** True when CH01 returned its ORIGINAL cached result for this eventId rather than performing a fresh evaluation — see CH01PostingExecutionPort doc below. */
  idempotentPassthrough?: boolean;
}

/**
 * The execution seam posting-recovery depends on for real replay. CH01's
 * own idempotency model (PostingEngineService.submitEvent) keys off
 * (tenantId, eventId) alone: once CH01 has created a postingExecution row
 * for an eventId — POSTED *or* REJECTED/FAILED/NO_RULE_MATCH — resubmitting
 * the identical envelope short-circuits to that ORIGINAL result rather than
 * re-evaluating rules. This is CH01's real, published contract (not
 * something this slice may change per this story's ownership rules), so
 * replay of an event CH01 already terminally recorded a non-POSTED outcome
 * for will observably return that SAME outcome again, not a fresh
 * evaluation — `idempotentPassthrough: true` on the result surfaces this to
 * the caller/operator instead of misleadingly implying a retry occurred.
 * Replay is only able to produce a genuinely fresh outcome for events CH01
 * never got as far as recording a postingExecution row for at all.
 */
export interface CH01PostingExecutionPort {
  replay(envelope: PostingFailureEnvelope): Promise<CH01ReplayResult>;
}

/** Production placeholder: throws. Used only when no CH01 execution contract is configured (e.g. missing COA_SERVICE_URL/AMACC_JWT_SECRET) — never wired as the default in index.ts. */
export class UnavailableCH01PostingExecutionPort implements CH01PostingExecutionPort {
  async replay(): Promise<CH01ReplayResult> {
    throw new Error(
      'CH01 posting execution is not available: posting-recovery-service is not configured to reach coa-service ' +
        '(COA_SERVICE_URL / AMACC_JWT_SECRET missing).',
    );
  }
}

/** Deterministic in-memory test double, used only by tests and fixtures. */
export class InMemoryCH01PostingExecutionPort implements CH01PostingExecutionPort {
  constructor(private readonly scriptedResult: CH01ReplayResult = { outcome: 'FAILED', message: 'unscripted test double call' }) {}

  async replay(_envelope: PostingFailureEnvelope): Promise<CH01ReplayResult> {
    return this.scriptedResult;
  }
}

/**
 * Real adapter: calls coa-service's merged S019/S020 posting-engine event
 * endpoint over HTTP, service-to-service, using the same createServiceToken
 * pattern eom-service/apar-service already use to call gl-service
 * (packages/shared-kernel/src/middleware/auth.ts) — a freshly-signed,
 * short-lived (1h) HS256 service JWT, never a static shared secret string.
 */
export class HttpCH01PostingExecutionPort implements CH01PostingExecutionPort {
  private readonly baseUrl: string;

  constructor(
    private readonly jwtSecret: string,
    baseUrl = process.env['COA_SERVICE_URL'] ?? 'http://coa-service:3016',
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async replay(envelope: PostingFailureEnvelope): Promise<CH01ReplayResult> {
    const { createServiceToken } = await import('@amacc/shared-kernel');
    const serviceToken = createServiceToken('posting-recovery-service', this.jwtSecret);
    const event = envelope.event;

    const body = {
      eventId: event.eventId,
      tenantId: event.tenantId,
      eventType: event.eventType,
      eventSchemaVersion: event.eventSchemaVersion,
      occurredAt: event.occurredAt,
      publishedAt: event.publishedAt ?? new Date().toISOString(),
      sourceSystem: event.sourceSystem,
      sourceEntityType: event.sourceEntityType ?? '',
      sourceEntityId: event.sourceEntityId ?? '',
      correlationId: event.correlationId,
      causationId: event.causationId ?? null,
      businessDate: event.businessDate ?? '',
      payload: event.payload,
      metadata: null,
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/v1/coa/posting-engine/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': event.tenantId,
          Authorization: `Bearer ${serviceToken}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err: any) {
      return { outcome: 'FAILED', message: `coa-service unreachable: ${err?.message ?? String(err)}` };
    }

    let parsed: any;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }

    if (res.status === 409) {
      return {
        outcome: 'FAILED',
        message:
          `CH01 rejected this replay as an EVENT_IDENTITY_CONFLICT: the reconstructed envelope does not match ` +
          `the original event CH01 already recorded for event ${event.eventId} (executionId=${parsed?.executionId ?? 'unknown'}). ` +
          `This indicates the dead-letter capture drifted from the original envelope — do not retry unmodified.`,
      };
    }

    if (!res.ok) {
      const message = parsed?.message ?? `coa-service HTTP ${res.status}`;
      return { outcome: 'FAILED', message: `Posting engine call failed: ${message}` };
    }

    const status: string | undefined = parsed?.status;
    const idempotent: boolean = Boolean(parsed?.idempotent);
    const journalReference: string | undefined = parsed?.journalNumber ?? undefined;

    if (status === 'POSTED') {
      return {
        outcome: idempotent ? 'NOOP_ALREADY_POSTED' : 'POSTED',
        journalReference,
        message: idempotent
          ? `Event was already posted as journal ${journalReference} — no new journal created.`
          : `Posted as journal ${journalReference}.`,
        idempotentPassthrough: idempotent,
      };
    }

    if (status === 'NO_RULE_MATCH' || status === 'REJECTED') {
      return {
        outcome: 'REJECTED',
        message: parsed?.failureReason ?? `Posting engine returned ${status}.`,
        idempotentPassthrough: idempotent,
      };
    }

    return {
      outcome: 'FAILED',
      message: parsed?.failureReason ?? `Posting engine returned unexpected status: ${status ?? 'unknown'}.`,
      idempotentPassthrough: idempotent,
    };
  }
}
