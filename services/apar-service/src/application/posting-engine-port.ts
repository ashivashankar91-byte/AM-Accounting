// CE-07 (single authoritative ledger decision) — apar-service's outbound
// seam to coa-service's S019/S020 posting engine. Replaces the old direct-
// to-gl-service HTTP calls in invoice-approval-service.ts's
// `_postApprovalLiability` (S039). Unlike cash-service's
// HttpCashReceiptPostingPort (which is deliberately best-effort/silent),
// this port's caller preserves the EXISTING non-blocking-but-visible
// contract: on failure it returns a reason so the caller can still write its
// own GL_POSTING_FAILED audit event and let retryGlPosting() try again later
// — the approval decision itself is still never rolled back or blocked.
import { createServiceToken, CanonicalSourceEventEnvelope } from '@amacc/shared-kernel';

export interface PostingEngineSubmitResult {
  ok: boolean;
  status?: string;
  journalEntryId?: string | null;
  journalNumber?: string | null;
  failureReason?: string | null;
}

export interface PostingEnginePort {
  submit(envelope: CanonicalSourceEventEnvelope): Promise<PostingEngineSubmitResult>;
}

export class HttpPostingEnginePort implements PostingEnginePort {
  private readonly baseUrl: string;
  constructor(private readonly jwtSecret: string, baseUrl = process.env['COA_SERVICE_URL'] ?? 'http://coa-service:3016') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async submit(envelope: CanonicalSourceEventEnvelope): Promise<PostingEngineSubmitResult> {
    try {
      const serviceToken = createServiceToken('apar-service', this.jwtSecret);
      const res = await fetch(`${this.baseUrl}/api/v1/coa/posting-engine/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': envelope.tenantId, Authorization: `Bearer ${serviceToken}` },
        body: JSON.stringify({
          eventId: envelope.idempotencyIdentity, tenantId: envelope.tenantId, eventType: envelope.eventType,
          eventSchemaVersion: envelope.schemaVersion, occurredAt: new Date().toISOString(), publishedAt: new Date().toISOString(),
          sourceSystem: envelope.sourceSystem, sourceEntityType: envelope.sourceEntityType, sourceEntityId: envelope.sourceEntityId,
          correlationId: envelope.correlationId, causationId: envelope.causationId ?? null, businessDate: envelope.businessDate,
          payload: envelope.payload, metadata: null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { status?: string; journalEntryId?: string | null; journalNumber?: string | null; failureReason?: string | null };
      if (!res.ok && res.status !== 409) {
        return { ok: false, failureReason: `posting engine submission failed: HTTP ${res.status} ${JSON.stringify(body)}` };
      }
      // 409 EVENT_IDENTITY_CONFLICT means the SAME idempotencyIdentity was
      // already submitted with different content — a real error, not success.
      if (res.status === 409) {
        return { ok: false, failureReason: `posting engine reported an identity conflict: ${JSON.stringify(body)}` };
      }
      if (body.status === 'REJECTED' || body.status === 'FAILED' || body.status === 'NO_RULE_MATCH') {
        return { ok: false, status: body.status, failureReason: body.failureReason ?? `posting engine returned ${body.status}` };
      }
      return { ok: true, status: body.status, journalEntryId: body.journalEntryId ?? null, journalNumber: body.journalNumber ?? null };
    } catch (err: any) {
      return { ok: false, failureReason: err?.message ?? 'Unknown posting engine submission error' };
    }
  }
}
