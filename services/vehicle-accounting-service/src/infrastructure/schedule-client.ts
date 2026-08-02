// CE-08 schedule-service integration boundary.
//
// UPDATE (CE-12 gap-close): coa-service's PostingService now emits a real
// JOURNAL_ENTRY_POSTED-shaped bridge event for every posted journal line
// whose GlAccount carries a scheduleCode AND a controlNumber
// (services/coa-service/src/application/posting-service.ts,
// `scheduleBridgeEvents`) — schedule-service's OpenItemService.
// processPostingEvent() genuinely opens/relieves a real ScheduleOpenItem
// from a coa-service posting today, for any GL account whose scheduleCode
// is set. This service's 3 assigned schedules (80/81/82 — see
// domain/rule-pack-definitions.ts's SCHEDULE_NUMBERS/SCHEDULE_LINKS) and its
// rule packs' existing controlNumberPath/applyNumberPath wiring are
// therefore now live end-to-end in any environment where
// scripts/seed-ce12-rule-packs.ts --test-tenant has PATCHed scheduleCode
// onto the corresponding fixture GL accounts (19001/19011/19012) and
// created the matching Schedule rows.
//
// This client's inquiry/relief methods below are scheduleNumber-NATIVE (not
// GL-account-lookup-based) precisely because this service already knows its
// own 3 assigned scheduleNumbers statically — no indirection through "find
// the schedule whose glAccountNumbers include X" is needed or correct here
// (that indirection previously papered over not having real scheduleNumbers
// to call with). `getOpenItemsBalance` is this service's tie-out/inquiry
// endpoints' AUTHORITATIVE balance source (see application/
// vehicle-unit-service.ts's getUnit() and application/dealer-trade-
// service.ts's getTrade()) — this service's own Prisma tables remain the
// source of cost-basis/lineage DETAIL, never a second, independently
// recomputed "does this tie to the GL" number.
//
// Both inquiry and relief degrade honestly: a schedule/open item that does
// not exist (scheduleCode not yet wired for this tenant/entity, or no
// matching business key posted yet) returns a typed null/NOT_FOUND outcome,
// never a fabricated balance or success.
export interface ScheduleSummary {
  id: string;
  scheduleNumber: string;
  glAccountNumbers: string[];
}

export interface OpenItemSummary {
  id: string;
  status: string;
  itemNumber: string;
  remainingBalance: string;
  originalAmount?: string;
}

export type RelieveOutcome = 'RELIEVED' | 'NOT_FOUND' | 'FAILED';

export interface RelieveResult {
  outcome: RelieveOutcome;
  applicationId?: string | null;
  message?: string | null;
}

export interface OpenItemsBalance {
  /** Sum of remainingBalance (cents) across every non-CLOSED item for this
   * scheduleNumber + controlNumber — the authoritative tie-out balance. */
  remainingBalanceCents: number;
  openItemCount: number;
  items: OpenItemSummary[];
}

export class ScheduleServiceClient {
  private readonly baseUrl: string;

  constructor(baseUrl = process.env['SCHEDULE_SERVICE_URL'] ?? 'http://schedule-service:3018') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private headers(tenantId: string, extra?: Record<string, string>): Record<string, string> {
    return { 'x-tenant-id': tenantId, ...(extra ?? {}) };
  }

  private async serviceToken(): Promise<string> {
    const { createServiceToken } = await import('@amacc/shared-kernel');
    const secret = process.env['AMACC_JWT_SECRET'];
    if (!secret) throw new Error('AMACC_JWT_SECRET is required to call schedule-service.');
    return createServiceToken('vehicle-accounting-service', secret);
  }

  /** Real open-items lookup, scoped to one of this service's 3 assigned
   * scheduleNumbers (80/81/82) and a business-key controlNumber (stock# or
   * trade#, ≤10 chars — schedule-service's ScheduleDetail.controlNumber is
   * VarChar(10)). Returns null (not a thrown error) when schedule-service is
   * unreachable or the schedule itself does not exist — callers must treat
   * that as "no schedule-service truth available yet," never as zero. */
  async getOpenItems(tenantId: string, scheduleNumber: string, controlNumber: string): Promise<OpenItemSummary[] | null> {
    try {
      const token = await this.serviceToken();
      const res = await fetch(
        `${this.baseUrl}/api/v1/schedules/${encodeURIComponent(scheduleNumber)}/open-items?controlNumber=${encodeURIComponent(controlNumber)}`,
        { headers: this.headers(tenantId, { Authorization: `Bearer ${token}` }) },
      );
      if (!res.ok) return null;
      return (await res.json()) as OpenItemSummary[];
    } catch {
      return null;
    }
  }

  /** Sums remainingBalance (in cents) across every non-CLOSED open item —
   * the authoritative "does this tie to the GL" number for a tie-out
   * inquiry. Returns null (never a fabricated 0) when the underlying lookup
   * itself failed/schedule doesn't exist (see getOpenItems). */
  async getOpenItemsBalance(tenantId: string, scheduleNumber: string, controlNumber: string): Promise<OpenItemsBalance | null> {
    const items = await this.getOpenItems(tenantId, scheduleNumber, controlNumber);
    if (items === null) return null;
    const open = items.filter((i) => i.status !== 'CLOSED');
    const remainingBalanceCents = open.reduce((acc, i) => acc + Math.round(Number(i.remainingBalance) * 100), 0);
    return { remainingBalanceCents, openItemCount: open.length, items };
  }

  /** Applies `amount` against the oldest OPEN/PARTIALLY_APPLIED item found
   * for scheduleNumber + controlNumber. Used at settlement time (S077).
   * Mirrors apar-service's manual-payment-service.ts `_relieveSchedule`
   * lookup-then-apply HTTP sequence, but scheduleNumber-native (see file
   * header) rather than GL-account-lookup-based. */
  async relieveOpenItem(
    tenantId: string,
    scheduleNumber: string,
    controlNumber: string,
    amount: string,
    idempotencyKey: string,
    note: string,
  ): Promise<RelieveResult> {
    try {
      const items = await this.getOpenItems(tenantId, scheduleNumber, controlNumber);
      if (items === null) return { outcome: 'NOT_FOUND', message: `Schedule ${scheduleNumber} unreachable or not found` };
      const item = items.find((i) => i.status === 'OPEN' || i.status === 'PARTIALLY_APPLIED');
      if (!item) return { outcome: 'NOT_FOUND', message: `No open item found in schedule ${scheduleNumber} for control number ${controlNumber}` };

      const token = await this.serviceToken();
      const applyRes = await fetch(`${this.baseUrl}/api/v1/schedules/${encodeURIComponent(scheduleNumber)}/open-items/${item.id}/apply`, {
        method: 'POST',
        headers: this.headers(tenantId, { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
        body: JSON.stringify({ amount, idempotencyKey, note }),
      });
      if (!applyRes.ok) {
        const text = await applyRes.text().catch(() => '');
        return { outcome: 'FAILED', message: `apply failed: HTTP ${applyRes.status} ${text}` };
      }
      const application = (await applyRes.json()) as { id: string };
      return { outcome: 'RELIEVED', applicationId: application.id };
    } catch (err: any) {
      return { outcome: 'FAILED', message: err?.message ?? 'Unknown error' };
    }
  }

  /** Used only by scripts/seed-ce12-rule-packs.ts --test-tenant fixture
   * mode, to pre-create the 3 real Schedule rows (scheduleNumbers 80/81/82)
   * this service's fixture GL accounts (19001/19011/19012) get
   * scheduleCode-linked to. */
  async createSchedule(
    tenantId: string,
    dto: { scheduleNumber: string; title: string; scheduleType: number; glAccountNumbers: string[]; eomPurgeType: number; reportSequence?: string },
  ): Promise<ScheduleSummary> {
    const token = await this.serviceToken();
    const res = await fetch(`${this.baseUrl}/api/v1/schedules`, {
      method: 'POST',
      headers: this.headers(tenantId, { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
      body: JSON.stringify(dto),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`schedule-service createSchedule failed: HTTP ${res.status} ${text}`);
    }
    return res.json() as Promise<ScheduleSummary>;
  }
}
