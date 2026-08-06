// CE-12 (Workstream R) — read-only access to schedule-service's ALREADY-
// CREATED open items (the reserve-receivable and product-remit-liability
// items deal-accounting-service's S084 journal originates). Mirrors
// services/apar-service/src/application/manual-payment-service.ts's
// `_relieveSchedule` discovery pattern (list schedules -> find the one
// mapped to the GL account role -> query open items by controlNumber) for
// the exact HTTP call shape.
//
// Design boundary (documented in this service's final summary): the actual
// RELIEF of these items happens via this service's own rule-pack postings
// carrying `applyNumberPath` (coa-service's posting engine -> gl-service's
// JOURNAL_ENTRY_POSTED -> schedule-service's already-running
// OpenItemService.processPostingEvent auto-relief pipeline) — this client
// is READ-ONLY (existence/balance lookups only), never a direct POST
// .../apply call, so relief always happens exactly once through the single
// canonical posting path.
export interface ScheduleSummary {
  id: string;
  scheduleNumber: string;
  glAccountNumbers: string[];
}

export interface ScheduleOpenItemSummary {
  id: string;
  itemNumber: string;
  controlNumber: string;
  scheduleNumber: string;
  originalAmount: string;
  remainingBalance: string;
  status: string;
}

export class ScheduleClientError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ScheduleClientError';
  }
}

export interface IScheduleOpenItemClient {
  findScheduleByGlAccount(tenantId: string, glAccountNumber: string): Promise<ScheduleSummary | null>;
  listOpenItems(tenantId: string, scheduleId: string, filters?: { controlNumber?: string; status?: string }): Promise<ScheduleOpenItemSummary[]>;
}

export class HttpScheduleOpenItemClient implements IScheduleOpenItemClient {
  private readonly baseUrl: string;

  constructor(
    private readonly jwtSecret: string,
    baseUrl = process.env['SCHEDULE_SERVICE_URL'] ?? 'http://schedule-service:3018',
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async headers(tenantId: string): Promise<Record<string, string>> {
    const { createServiceToken } = await import('@amacc/shared-kernel');
    const token = createServiceToken('fni-reserve-service', this.jwtSecret);
    return { 'x-tenant-id': tenantId, Authorization: `Bearer ${token}` };
  }

  async findScheduleByGlAccount(tenantId: string, glAccountNumber: string): Promise<ScheduleSummary | null> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/v1/schedules`, { headers: await this.headers(tenantId) });
    } catch (err: any) {
      throw new ScheduleClientError(`schedule-service unreachable: ${err?.message ?? String(err)}`, err);
    }
    if (!res.ok) return null;
    const schedules = (await res.json()) as ScheduleSummary[];
    return schedules.find((s) => s.glAccountNumbers?.includes(glAccountNumber)) ?? null;
  }

  async listOpenItems(
    tenantId: string,
    scheduleId: string,
    filters?: { controlNumber?: string; status?: string },
  ): Promise<ScheduleOpenItemSummary[]> {
    const qs = new URLSearchParams();
    if (filters?.controlNumber) qs.set('controlNumber', filters.controlNumber);
    if (filters?.status) qs.set('status', filters.status);
    const url = `${this.baseUrl}/api/v1/schedules/${scheduleId}/open-items${qs.toString() ? `?${qs}` : ''}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: await this.headers(tenantId) });
    } catch (err: any) {
      throw new ScheduleClientError(`schedule-service unreachable: ${err?.message ?? String(err)}`, err);
    }
    if (!res.ok) return [];
    return (await res.json()) as ScheduleOpenItemSummary[];
  }
}
