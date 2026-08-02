// CE-07 / S023 (D-S023-23) — coa-service's outbound seam to S021
// (posting-recovery-service). Every eligible deterministic posting failure
// creates or updates a recovery case there, carrying: the canonical event,
// tenant and legal entity, event ID and correlation ID, failure code and
// classification, original attempted pack version, posting execution ID,
// and recoverability status. Idempotent on (tenantId, eventId) at the
// receiving end (DeadLetterIntakeService) — a retry of the same failure
// never creates a duplicate case.
import { createServiceToken } from '@amacc/shared-kernel';
import { createHash } from 'crypto';
import { SourceEventEnvelope } from '../domain/posting-engine/event-envelope';

export type PostingRecoveryFailureCategory =
  | 'EVENT_CONTRACT_INVALID' | 'RULE_NOT_FOUND' | 'RULE_CONFIGURATION_INVALID'
  | 'ACCOUNTING_MAPPING_UNRESOLVED' | 'ACCOUNTING_PERIOD_BLOCKED' | 'IDEMPOTENCY_CONFLICT'
  | 'INFRASTRUCTURE_FAILURE' | 'UNKNOWN_FAILURE';

/** Maps this service's closed reasonCode taxonomy onto S021's own closed 13-value category set — never a generic catch-all. */
export function reasonCodeToRecoveryCategory(reasonCode: string): PostingRecoveryFailureCategory {
  switch (reasonCode) {
    case 'NO_RULE_MATCH': return 'RULE_NOT_FOUND';
    case 'AMBIGUOUS_RULE_PACK_MATCH': return 'RULE_CONFIGURATION_INVALID';
    case 'UNBALANCED_BLUEPRINT': return 'RULE_CONFIGURATION_INVALID';
    case 'RULE_PACK_EVALUATION_ERROR': return 'RULE_CONFIGURATION_INVALID';
    case 'INVALID_ACCOUNT': return 'ACCOUNTING_MAPPING_UNRESOLVED';
    case 'MISSING_MANDATORY_FIELD': return 'EVENT_CONTRACT_INVALID';
    case 'PERIOD_CLOSED': return 'ACCOUNTING_PERIOD_BLOCKED';
    case 'EVENT_IDENTITY_CONFLICT': return 'IDEMPOTENCY_CONFLICT';
    case 'POSTING_ENGINE_FAILURE': return 'INFRASTRUCTURE_FAILURE';
    default: return 'UNKNOWN_FAILURE';
  }
}

export interface RecoveryCaseInput {
  executionId: string;
  envelope: SourceEventEnvelope;
  legalEntityId: string | null;
  reasonCode: string;
  reasonDetail: string;
  rulePackVersionId: string | null;
}

export interface PostingRecoveryPort {
  reportFailure(tenantId: string, input: RecoveryCaseInput): Promise<void>;
}

/** Never throws — a recovery-reporting failure must never mask or block the original posting-engine result. */
export class HttpPostingRecoveryPort implements PostingRecoveryPort {
  private readonly baseUrl: string;
  constructor(private readonly jwtSecret: string, baseUrl = process.env['POSTING_RECOVERY_SERVICE_URL'] ?? 'http://posting-recovery-service:3040') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async reportFailure(tenantId: string, input: RecoveryCaseInput): Promise<void> {
    try {
      const { envelope } = input;
      const payload = envelope.payload ?? {};
      const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const serviceEnvelope = {
        eventId: envelope.eventId,
        tenantId,
        legalEntityId: input.legalEntityId,
        eventType: envelope.eventType,
        eventSchemaVersion: envelope.eventSchemaVersion,
        sourceSystem: envelope.sourceSystem,
        sourceEntityType: envelope.sourceEntityType,
        sourceEntityId: envelope.sourceEntityId,
        sourceTransactionId: envelope.sourceEntityId,
        correlationId: envelope.correlationId,
        causationId: envelope.causationId ?? null,
        occurredAt: envelope.occurredAt,
        publishedAt: envelope.publishedAt ?? new Date().toISOString(),
        businessDate: envelope.businessDate,
        postingIdempotencyKey: `${tenantId}:${envelope.eventId}`,
        payload,
        payloadHash,
      };
      const failure = {
        failureCategory: reasonCodeToRecoveryCategory(input.reasonCode),
        failureCode: input.reasonCode,
        failureStage: 'RULE_RESOLUTION',
        failureMessage: input.reasonDetail,
        fieldErrors: null,
        ruleContext: { executionId: input.executionId, rulePackVersionId: input.rulePackVersionId },
        occurredAt: new Date().toISOString(),
      };
      const serviceToken = createServiceToken('coa-service', this.jwtSecret);
      // CE-07 — posting-recovery-service mounts its real routes under
      // /posting-recovery/v1 (see its own index.ts:
      // app.register(postingRecoveryRoutes, { prefix: '/posting-recovery/v1' })),
      // never at the bare service root. A bare `${baseUrl}/dead-letters` 404s
      // every time — silently, since this method never throws (see the class
      // doc-comment) — so no S021 recovery case was ever actually created by
      // this path until real end-to-end certification against a real running
      // posting-recovery-service process first exercised it.
      await fetch(`${this.baseUrl}/posting-recovery/v1/dead-letters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId, Authorization: `Bearer ${serviceToken}` },
        body: JSON.stringify({ envelope: { event: serviceEnvelope, failure }, actor: 'coa-service' }),
      });
    } catch {
      // Deliberately swallowed — see class doc-comment. The posting-engine's
      // own postingException row is already the durable record of this
      // failure regardless of whether S021 is reachable.
    }
  }
}

/** Used only when POSTING_RECOVERY_SERVICE_URL/AMACC_JWT_SECRET are not configured (e.g. local dev without that service running). */
export class NoopPostingRecoveryPort implements PostingRecoveryPort {
  async reportFailure(): Promise<void> {}
}
