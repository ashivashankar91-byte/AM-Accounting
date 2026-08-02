// CE-07 (single authoritative ledger decision) — the narrow S019/S020 →
// gl-service posting bridge.
//
// gl-service remains the sole authoritative financial ledger (Trial
// Balance, Financial Statements, and schedule-service all read from its
// journal_entries/GLAccount tables — coa-service's own journal_entry table
// is NOT a second ledger; PostingService.post() is no longer called for
// rule-engine-driven postings, see posting-engine-service.ts). This bridge
// calls gl-service's EXISTING, CERTIFIED posting door — the SAME
// POST /journal-entries -> POST /:id/post sequence apar-service's own
// _postApprovalLiability call site used directly before this change —
// never a second GL implementation.
//
// This bridge performs ONLY create (DRAFT) -> submit for review
// (PENDING_REVIEW, emits JOURNAL_ENTRY_SUBMITTED). It NEVER calls
// /approve. The existing agent-review gate and gl-service's own
// auto_post=true handling (AutoPostJob, unmodified, unchanged) remain the
// SOLE path from PENDING_REVIEW to POSTED — exactly as they are today for
// every other producer. This bridge does not weaken, bypass, or redesign
// that gate for any source, auto_post or not.
//
// PostingExecution's status reflects "successfully created and submitted
// to the authoritative ledger" (matching apar-service's own existing
// success semantics — it never waits for actual POSTED either, only for
// approvalGlEntryId to exist). Actual JOURNAL_ENTRY_POSTED emission and any
// resulting schedule effect happen later, entirely on gl-service's own
// existing review/auto-post timeline — coa-service never emits a competing
// JOURNAL_ENTRY_POSTED.
import { createServiceToken } from '@amacc/shared-kernel';

export interface GlPostingLine {
  /**
   * The account NUMBER (e.g. "60000") — NEVER coa-service's own gl_account.id.
   * coa-service and gl-service maintain two entirely separate GlAccount
   * tables with independent UUIDs (see class doc-comment) — there is no
   * crosswalk between their ids. gl-service's own POST /journal-entries
   * already supports resolving a line by `accountCode` against ITS OWN
   * accounts table (services/gl-service/src/http/routes.ts's
   * `needsCodeResolution` block, pre-existing and unmodified) — using that
   * existing capability is what makes this bridge correct without either
   * service needing to know the other's internal ids.
   */
  accountCode: string;
  debit: number;
  credit: number;
  memo?: string | null;
  storeId?: string | null;
  departmentCode?: string | null;
  controlNumber?: string | null;
  /** Schedule open-item relief reference (gl-service JournalLine.applyNumber, gated by applyCd='#') — see coa-service's BlueprintLine doc-comment. Omitted/null means this line creates a NEW open item (if its account has a scheduleCode), never relieves one. */
  applyNumber?: string | null;
}

export interface GlPostingRequest {
  tenantId: string;
  businessDate: string; // YYYY-MM-DD
  journalSourceCode: string;
  description: string;
  sourceRef?: string | null;
  lines: GlPostingLine[];
  /**
   * CE-07 — authoritative idempotency identity, persisted on gl-service's
   * own journal_entries row and enforced by a database-level unique index
   * there (never only coa-service's own PostingExecution claim row — see
   * journal-repository.ts's create() doc-comment). The SAME key always
   * returns the SAME journal, whether this is a genuine crash-retry
   * (sequential) or a true concurrent race (two callers at once).
   */
  idempotencyKey?: string;
}

export interface GlPostingResult {
  journalEntryId: string;
  journalNumber: string;
  /** gl-service's own status immediately after submission — PENDING_REVIEW under normal circumstances; this bridge never forces POSTED. */
  status: string;
}

export class GlPostingBridgeError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'GlPostingBridgeError';
  }
}

export interface GlPostingBridge {
  /** Creates and submits exactly one authoritative gl-service journal for review. Throws GlPostingBridgeError on any failure — the caller (posting-engine-service.ts) treats this identically to any other posting rejection/failure, never silently swallowed. */
  post(request: GlPostingRequest): Promise<GlPostingResult>;
}

export class HttpGlPostingBridge implements GlPostingBridge {
  private readonly baseUrl: string;
  constructor(private readonly jwtSecret: string, baseUrl = process.env['GL_SERVICE_URL'] ?? 'http://gl-service:3010') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private headers(tenantId: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
      Authorization: `Bearer ${createServiceToken('coa-service', this.jwtSecret)}`,
    };
  }

  async post(request: GlPostingRequest): Promise<GlPostingResult> {
    const headers = this.headers(request.tenantId);

    const createRes = await fetch(`${this.baseUrl}/api/v1/gl/journal-entries`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        entryDate: request.businessDate,
        description: request.description,
        source: request.journalSourceCode,
        sourceRef: request.sourceRef ?? undefined,
        idempotencyKey: request.idempotencyKey ?? undefined,
        lines: request.lines.map((l) => ({
          accountCode: l.accountCode, debit: l.debit, credit: l.credit, memo: l.memo ?? undefined,
          storeId: l.storeId ?? undefined, departmentCode: l.departmentCode ?? undefined, controlNumber: l.controlNumber ?? undefined,
          applyCd: l.applyNumber ? '#' : undefined, applyNumber: l.applyNumber ?? undefined,
        })),
      }),
    });
    if (!createRes.ok) {
      const text = await createRes.text().catch(() => '');
      throw new GlPostingBridgeError(`gl-service journal creation failed: HTTP ${createRes.status} ${text}`);
    }
    const created = (await createRes.json()) as { id: string; journalNumber?: string; status: string };

    // Idempotent hit (create() found an existing row for this key — either a
    // genuine crash-retry or the losing side of a create-time race) already
    // past DRAFT: it was already submitted (or approved/posted) by whichever
    // call reached the review gate first. Never call /post a second time —
    // that would either error (InvalidStatusTransitionError) or, worse if
    // gl-service's own behavior ever changed, risk a second review-gate
    // action for one journal. Return the current state as-is.
    if (created.status !== 'DRAFT') {
      return { journalEntryId: created.id, journalNumber: (created as any).journalNumber, status: created.status };
    }

    const submitRes = await fetch(`${this.baseUrl}/api/v1/gl/journal-entries/${created.id}/post`, { method: 'POST', headers, body: '{}' });
    if (submitRes.ok) {
      const submitted = (await submitRes.json()) as { id: string; journalNumber: string; status: string };
      return { journalEntryId: submitted.id, journalNumber: submitted.journalNumber, status: submitted.status };
    }

    // Submit failed. If a concurrent caller for the SAME idempotency key won
    // the create-time race but hadn't finished submitting when WE read
    // created.status === 'DRAFT' above, both of us could reach /post — the
    // loser gets InvalidStatusTransitionError, not because anything is
    // actually wrong, but because the winner already advanced the SAME
    // journal past DRAFT in between. Re-fetch and treat that as success
    // (never a second journal, never a spurious failure for a race that
    // resolved correctly) — but only for idempotency-keyed requests; an
    // un-keyed submit failure is always a genuine error.
    //
    // TOCTOU note: the winner's own /post call may not have committed yet at
    // the exact instant our /post call fails — a single immediate re-fetch
    // can still observe DRAFT. Since the winner's transition is a single,
    // fast DB update (no external I/O), a short bounded retry is enough to
    // clear that window without masking a genuine failure indefinitely.
    if (request.idempotencyKey) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const refetchRes = await fetch(`${this.baseUrl}/api/v1/gl/journal-entries/${created.id}`, { headers });
        if (refetchRes.ok) {
          const refetched = (await refetchRes.json()) as { id: string; journalNumber?: string; status: string };
          if (refetched.status !== 'DRAFT') {
            return { journalEntryId: refetched.id, journalNumber: (refetched as any).journalNumber, status: refetched.status };
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
    const text = await submitRes.text().catch(() => '');
    throw new GlPostingBridgeError(`gl-service journal submission-for-review failed: HTTP ${submitRes.status} ${text}`);
  }
}
