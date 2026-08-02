// CE-13 gap #2 — Governed posting boundary.
//
// Replaces the previous HttpGlPostingClient direct-to-gl-service journal
// creation with a narrow PostingGateway that submits a canonical payroll
// accounting event to CE-07 (coa-service's merged S019/S020 posting
// engine, PostingEngineService.submitEvent(), exposed at
// POST /api/v1/coa/posting-engine/events). This mirrors the precedent
// posting-recovery-service already established
// (services/posting-recovery-service/src/domain/ch01-adapter.ts) rather
// than inventing a second integration convention.
//
// payroll-service no longer constructs GL account codes/debit-credit lines
// itself for the source-transaction path — that responsibility now belongs
// entirely to CE-07's rule pack. This gateway only assembles the canonical
// SourceEventEnvelope (business facts: batch/line references, earnings/
// deduction/liability distributions, correlation+idempotency ids,
// tenant/legal-entity/business-date) and submits it.
//
// FAIL CLOSED: if coa-service is unreachable, returns a non-fallback
// PostingRefusedError (or PENDING_CE07_TECHNICAL_RECONCILIATION status for
// transport-only unavailability) — this gateway NEVER falls back to
// constructing/posting a journal entry directly against gl-service.
import crypto from 'crypto';

export class PostingRefusedError extends Error {
  readonly status = 422;
  readonly code = 'POSTING_REFUSED';
  constructor(message: string, readonly reasonCode: string) {
    super(message);
    this.name = 'PostingRefusedError';
  }
}

/** Fail-closed: thrown when CE-07 (coa-service posting engine) cannot be reached at all — never a signal to fall back to direct GL write. */
export class PostingGatewayUnavailableError extends Error {
  readonly status = 503;
  readonly code = 'PENDING_CE07_TECHNICAL_RECONCILIATION';
  constructor(message: string) {
    super(message);
    this.name = 'PostingGatewayUnavailableError';
  }
}

export class PostingIdentityConflictError extends Error {
  readonly status = 409;
  readonly code = 'POSTING_EVENT_IDENTITY_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'PostingIdentityConflictError';
  }
}

export interface PayrollDistributionLine {
  /** Tenant-configured pay component key (e.g. REGULAR_PAY, EMPLOYER_FICA_EXPENSE, NET_PAY, FED_TAX). CE-07's own rule pack maps this to a GL account — payroll-service does not resolve account codes itself anymore. */
  payComponent: string;
  department: string;
  amount: number;
  direction: 'DEBIT' | 'CREDIT';
}

export interface PayrollPostingEventInput {
  tenantId: string;
  legalEntityId?: string | null;
  batchId: string;
  batchNumber: string;
  businessDate: string; // YYYY-MM-DD
  payPeriodStart: string;
  payPeriodEnd: string;
  distributions: PayrollDistributionLine[];
  /** Idempotency: same batchId + eventType always yields the same eventId (deterministic), so re-submission after a crash is a safe no-op, never a duplicate journal. */
  idempotencyKey: string;
  correlationId: string;
  causationId?: string | null;
  rulePackVersionId?: string | null;
  actor: string;
  /** 'PAYROLL_BATCH_POSTED' | 'PAYROLL_BATCH_REVERSED' */
  eventType: 'PAYROLL_BATCH_POSTED' | 'PAYROLL_BATCH_REVERSED';
  /** For reversal events: the eventId of the original posting event (original-to-reversal linkage). */
  reversalOfEventId?: string | null;
}

export interface PostingGatewayResult {
  executionId: string;
  eventId: string;
  status: 'POSTED' | 'NO_RULE_MATCH' | 'REJECTED' | 'FAILED';
  idempotent: boolean;
  journalEntryId?: string | null;
  journalNumber?: string | null;
  rulePackVersionId?: string | null;
  failureReason?: string | null;
}

export interface IPostingGateway {
  submitPayrollEvent(input: PayrollPostingEventInput): Promise<PostingGatewayResult>;
}

/** Deterministic UUID-shaped eventId derived from the idempotency key, so retries of an identical batch action never mint a new identity. */
function deterministicEventId(idempotencyKey: string): string {
  const hash = crypto.createHash('sha256').update(idempotencyKey).digest('hex');
  return [hash.slice(0, 8), hash.slice(8, 12), '4' + hash.slice(13, 16), ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20), hash.slice(20, 32)].join('-');
}

/**
 * Real adapter: HTTP call to coa-service's posting-engine event endpoint.
 * Fails closed — any transport failure (network error, non-2xx/409 that
 * isn't a recognized posting-engine outcome) surfaces as
 * PostingGatewayUnavailableError; the caller (payroll-service.ts) must
 * treat that as PENDING_CE07_TECHNICAL_RECONCILIATION and MUST NOT post a
 * journal any other way.
 */
export class HttpPostingGateway implements IPostingGateway {
  private readonly baseUrl: string;

  constructor(
    private readonly jwtSecret: string = (() => {
      const secret = process.env['AMACC_JWT_SECRET'];
      if (!secret) throw new Error('AMACC_JWT_SECRET environment variable is required but not set');
      return secret;
    })(),
    baseUrl = process.env['COA_SERVICE_URL'] ?? 'http://coa-service:3016',
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async submitPayrollEvent(input: PayrollPostingEventInput): Promise<PostingGatewayResult> {
    const eventId = deterministicEventId(input.idempotencyKey);
    const nowIso = new Date().toISOString();

    // Canonical business-fact payload — earnings/deduction/liability
    // distributions as facts, never precomputed GL account ids. The
    // envelope shape matches coa-service's SourceEventEnvelope contract
    // exactly (services/coa-service/src/domain/posting-engine/event-envelope.ts).
    const envelope = {
      eventId,
      tenantId: input.tenantId,
      eventType: input.eventType,
      eventSchemaVersion: '1.0',
      occurredAt: nowIso,
      publishedAt: nowIso,
      sourceSystem: 'payroll-service',
      sourceEntityType: 'PayrollBatch',
      sourceEntityId: input.batchId,
      correlationId: input.correlationId,
      causationId: input.causationId ?? null,
      businessDate: input.businessDate,
      payload: {
        batchId: input.batchId,
        batchNumber: input.batchNumber,
        legalEntityId: input.legalEntityId ?? null,
        payPeriodStart: input.payPeriodStart,
        payPeriodEnd: input.payPeriodEnd,
        distributions: input.distributions,
        rulePackVersionId: input.rulePackVersionId ?? null,
        reversalOfEventId: input.reversalOfEventId ?? null,
        actor: input.actor,
      },
      metadata: { source: 'ce13-payroll-posting-gateway' },
    };

    let res: Response;
    try {
      const { createServiceToken } = await import('@amacc/shared-kernel');
      const serviceToken = createServiceToken('payroll-service', this.jwtSecret);
      res = await fetch(`${this.baseUrl}/api/v1/coa/posting-engine/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': input.tenantId,
          'x-user-id': input.actor,
          Authorization: 'Bearer ' + serviceToken,
        },
        body: JSON.stringify(envelope),
      });
    } catch (err: any) {
      throw new PostingGatewayUnavailableError(
        `CE-07 posting engine (coa-service) is unreachable: ${err?.message ?? String(err)}. ` +
          `PENDING_CE07_TECHNICAL_RECONCILIATION — no direct GL write was attempted.`,
      );
    }

    let parsed: any = null;
    try { parsed = await res.json(); } catch { /* no body */ }

    if (res.status === 409) {
      throw new PostingIdentityConflictError(
        `Posting event ${eventId} was already submitted with a different payload (EVENT_IDENTITY_CONFLICT). ` +
          `executionId=${parsed?.executionId ?? 'unknown'}.`,
      );
    }
    if (res.status === 404 || res.status === 502 || res.status === 503) {
      throw new PostingGatewayUnavailableError(
        `CE-07 posting engine responded ${res.status} — PENDING_CE07_TECHNICAL_RECONCILIATION. No direct GL write was attempted.`,
      );
    }
    if (!res.ok) {
      throw new PostingGatewayUnavailableError(
        `CE-07 posting engine call failed (HTTP ${res.status}): ${parsed?.message ?? 'unknown error'}. PENDING_CE07_TECHNICAL_RECONCILIATION.`,
      );
    }

    const status: string = parsed?.status ?? 'FAILED';
    if (status === 'NO_RULE_MATCH' || status === 'REJECTED') {
      throw new PostingRefusedError(
        parsed?.failureReason ?? `CE-07 refused to post this payroll event: ${status}. This is a deterministic missing-mapping/rule refusal, not a partial post.`,
        status,
      );
    }

    return {
      executionId: parsed.executionId,
      eventId: parsed.eventId ?? eventId,
      status: status as 'POSTED' | 'NO_RULE_MATCH' | 'REJECTED' | 'FAILED',
      idempotent: Boolean(parsed.idempotent),
      journalEntryId: parsed.journalEntryId ?? null,
      journalNumber: parsed.journalNumber ?? null,
      rulePackVersionId: parsed.rulePackVersionId ?? null,
      failureReason: parsed.failureReason ?? null,
    };
  }
}

/**
 * Fail-closed placeholder — used only when COA_SERVICE_URL/AMACC_JWT_SECRET
 * are not configured. Never wired as a silent fallback to direct GL
 * writes; always throws PostingGatewayUnavailableError.
 */
export class UnavailablePostingGateway implements IPostingGateway {
  async submitPayrollEvent(): Promise<PostingGatewayResult> {
    throw new PostingGatewayUnavailableError(
      'CE-07 posting gateway is not configured (COA_SERVICE_URL / AMACC_JWT_SECRET missing). ' +
        'PENDING_CE07_TECHNICAL_RECONCILIATION — payroll-service will not fall back to a direct GL write.',
    );
  }
}
