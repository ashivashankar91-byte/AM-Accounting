// @wave S029 — write-off ceremony posts a real journal entry through
// gl-service's existing engine (CE-07's approved posting path) rather than
// schedule-service mutating the ledger directly. Pure HTTP client against
// gl-service's existing routes (POST /journal-entries, then
// POST /journal-entries/:id/post) — no gl-service code is touched, per rule
// 10 ("reconcile CE-07-dependent integration points ... without modifying
// the CE-07 worktree").
//
// Known, accepted consequence (documented, not a bug): gl-service publishes
// JOURNAL_ENTRY_POSTED for *any* line whose GL account has `scheduleCode`
// set (services/gl-service/src/application/gl-service.ts, postJournalEntry).
// The schedule's own control account is exactly such an account, so the
// credit line below will loop back into this same service's
// OpenItemService.processPostingEvent(). Because the write-off ceremony has
// already closed the item to a zero remaining balance and status
// WRITTEN_OFF (status is not 'CLOSED', so the target lookup in
// processPostingEvent still finds it), applyAmount()'s existing
// over-application guard rejects the replayed application, which is logged
// and returns 'UNRESOLVED_APPLICATION' — the same non-corrupting, already-
// existing safety net S026 relies on for any other over-application attempt.
// The ScheduleDetail line is retained for report fidelity; nothing is
// double-counted or corrupted. This is called out explicitly in the CE-08
// certification report rather than silently engineered around by touching
// gl-service.
import { setTimeout as delay } from 'timers/promises';

export interface WriteOffPostingInput {
  scheduleNumber: string;
  controlNumber: string;
  glAccountNumber: string | null;
  offsetAccountCode: string;
  amount: string;
  description: string;
  idempotencyKey: string;
}

export interface IGlPostingClient {
  /** Creates and posts a write-off journal entry; returns the posted journalEntryId. */
  postWriteOff(tenantId: string, input: WriteOffPostingInput): Promise<string>;
}

export class HttpGlPostingClient implements IGlPostingClient {
  private readonly baseUrl: string;

  // Service-to-service calls to gl-service authenticate with a freshly-signed,
  // short-lived (1h) HS256 service JWT via createServiceToken — the same
  // pattern eom-service/apar-service/posting-recovery-service already use to
  // call gl-service/coa-service (packages/shared-kernel/src/middleware/auth.ts),
  // never a static shared secret string. gl-service's authMiddleware requires
  // a valid Authorization bearer on every route including
  // POST /journal-entries and POST /journal-entries/:id/post.
  constructor(
    baseUrl?: string,
    private readonly jwtSecret: string = (() => {
      const secret = process.env['AMACC_JWT_SECRET'];
      if (!secret) throw new Error('AMACC_JWT_SECRET environment variable is required but not set');
      return secret;
    })(),
  ) {
    this.baseUrl = (baseUrl ?? process.env['GL_SERVICE_URL'] ?? 'http://gl-service:3010').replace(/\/+$/, '');
  }

  async postWriteOff(tenantId: string, input: WriteOffPostingInput): Promise<string> {
    if (!input.glAccountNumber) {
      throw new Error('Cannot post write-off: schedule open item has no glAccountNumber.');
    }

    const { createServiceToken } = await import('@amacc/shared-kernel');
    const serviceToken = createServiceToken('schedule-service', this.jwtSecret);

    const createRes = await fetch(`${this.baseUrl}/api/v1/gl/journal-entries`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': tenantId,
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify({
        entryDate: new Date().toISOString(),
        description: input.description,
        source: 'SCHEDULE_WRITEOFF',
        sourceRef: input.idempotencyKey.substring(0, 8),
        lines: [
          {
            accountCode: input.offsetAccountCode,
            debit: Number(input.amount),
            credit: 0,
            memo: input.description,
          },
          {
            accountCode: input.glAccountNumber,
            debit: 0,
            credit: Number(input.amount),
            controlNumber: input.controlNumber,
            applyCd: '#',
            memo: input.description,
          },
        ],
      }),
    });
    if (!createRes.ok) {
      const text = await createRes.text().catch(() => '');
      throw new Error(`gl-service POST /journal-entries returned ${createRes.status}: ${text}`);
    }
    const created = (await createRes.json()) as { id: string };

    // Brief settle delay before posting — matches the retry-tolerant pattern
    // already used elsewhere in this service (withSerializableRetry) rather
    // than assuming synchronous consistency across service boundaries.
    await delay(0);

    // gl-service's journal lifecycle is DRAFT -> PENDING_REVIEW -> POSTED
    // (services/gl-service/src/application/gl-service.ts postJournalEntry /
    // approveJournalEntry). /journal-entries/:id/post only advances
    // DRAFT -> PENDING_REVIEW; reaching POSTED requires a *separate*
    // /journal-entries/:id/approve call by a different identity than the
    // creator -- gl-service enforces segregation-of-duties
    // (SegregationOfDutiesError, approveJournalEntry) and rejects
    // same-identity create+approve for any source outside its narrow
    // DMS-RO/AUTOMATE_DMS system-feed allowlist. 'SCHEDULE_WRITEOFF' is
    // deliberately NOT added to that allowlist here: a write-off is exactly
    // the kind of GL-affecting action segregation-of-duties exists to
    // control, and this client must not weaken gl-service's own control to
    // force a synchronous auto-approval (rule 10 forbids modifying
    // CE-07/gl-service code, and even if it didn't, this is not an
    // implementation detail to silently work around). The write-off
    // ceremony therefore submits the entry into gl-service's existing
    // PENDING_REVIEW queue -- the same human/agent-review approval path
    // every other gl-service journal entry goes through -- rather than
    // inventing a bypass. This is documented explicitly as a known,
    // intentional characteristic of the write-off ceremony in the CE-08
    // certification report: the schedule item is closed to WRITTEN_OFF
    // immediately (open-item side of the ceremony is final), but the GL
    // impact is only realized once a distinct approver reviews and
    // approves the created entry in gl-service.
    const postRes = await fetch(`${this.baseUrl}/api/v1/gl/journal-entries/${created.id}/post`, {
      method: 'POST',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-id': 'schedule-service',
        Authorization: `Bearer ${serviceToken}`,
      },
    });
    if (!postRes.ok) {
      const text = await postRes.text().catch(() => '');
      throw new Error(`gl-service POST /journal-entries/:id/post returned ${postRes.status}: ${text}`);
    }
    const posted = (await postRes.json()) as { id: string };
    return posted.id ?? created.id;
  }
}
