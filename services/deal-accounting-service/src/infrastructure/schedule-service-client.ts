// Gap-closure — real services/schedule-service linkage. Verified directly
// against services/schedule-service/src/http/routes.ts's
// GET /api/v1/schedules/:id/open-items?controlNumber=... (OpenItemService.
// listOpenItems). Used to make CIT/SNF inquiry endpoints authoritative from
// the REAL schedule-service open item (per gap-closure instructions) rather
// than only this service's own DealOpenItem shadow ledger — this service's
// local table remains the lineage/audit record, never the source of truth
// once a GL account carries a real scheduleCode.
//
// Best-effort by design: not every tenant/environment has the CE-12 test
// fixture rule packs (with controlNumberPath set + the target GL account's
// scheduleCode patched — see scripts/seed-ce12-rule-packs.ts) activated, so
// a lookup miss or an unreachable schedule-service is NOT an error — callers
// fall back to the local DealOpenItem value, exactly like every other
// best-effort integration in this service (posting-recovery dead-letter
// filing, PUTR outbox).

export interface ScheduleOpenItemSummary {
  id: string;
  controlNumber: string;
  originalAmount: string;
  remainingBalance: string;
  status: string;
}

export interface IScheduleServiceClient {
  /** Returns the real open item(s) for a given schedule + control number, or null if unreachable/not found. */
  getOpenItems(tenantId: string, scheduleNumber: string, controlNumber: string): Promise<ScheduleOpenItemSummary[] | null>;
}

export class HttpScheduleServiceClient implements IScheduleServiceClient {
  private readonly baseUrl: string;

  constructor(
    private readonly jwtSecret: string,
    baseUrl = process.env['SCHEDULE_SERVICE_URL'] ?? 'http://schedule-service:3018',
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async getOpenItems(tenantId: string, scheduleNumber: string, controlNumber: string): Promise<ScheduleOpenItemSummary[] | null> {
    try {
      const { createServiceToken } = await import('@amacc/shared-kernel');
      const token = createServiceToken('deal-accounting-service', this.jwtSecret);
      const res = await fetch(
        `${this.baseUrl}/api/v1/schedules/${encodeURIComponent(scheduleNumber)}/open-items?controlNumber=${encodeURIComponent(controlNumber)}`,
        { method: 'GET', headers: { 'x-tenant-id': tenantId, Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return null;
      const parsed: any = await res.json();
      const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.items) ? parsed.items : null);
      return items;
    } catch {
      return null;
    }
  }
}
